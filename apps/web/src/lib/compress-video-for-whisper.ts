/**
 * Compress video for Whisper API using two strategies:
 * 1. FFmpeg WASM (fast, extracts audio only) — may fail on some browsers
 * 2. MediaRecorder fallback (records audio stream from <video>) — works everywhere
 * 
 * Output: small audio file (<25MB) suitable for Whisper API
 */

export async function compressForWhisper(
  videoFile: File,
  onProgress?: (message: string, pct: number) => void
): Promise<File> {
  // If small enough, return as-is
  if (videoFile.size <= 24 * 1024 * 1024) {
    return videoFile;
  }

  console.log(`[compress] Video ${(videoFile.size / 1048576).toFixed(1)}MB — need to extract audio`);

  // Strategy 1: Try FFmpeg WASM
  try {
    onProgress?.("Loading FFmpeg...", 10);
    const { extractAudioForWhisper } = await import("./extract-audio-ffmpeg");
    const audioFile = await extractAudioForWhisper(videoFile, onProgress);
    if (audioFile && audioFile.size <= 25 * 1024 * 1024) {
      console.log(`[compress] FFmpeg success: ${(audioFile.size / 1024).toFixed(0)}KB`);
      return audioFile;
    }
    if (audioFile) {
      console.warn(`[compress] FFmpeg audio still too large: ${(audioFile.size / 1048576).toFixed(1)}MB`);
    }
  } catch (err) {
    console.warn("[compress] FFmpeg failed, trying MediaRecorder:", err);
  }

  // Strategy 2: MediaRecorder — record audio from video playback at 2x speed
  onProgress?.("Extracting audio (alternative method)...", 20);
  return await extractViaMediaRecorder(videoFile, onProgress);
}

async function extractViaMediaRecorder(
  videoFile: File,
  onProgress?: (message: string, pct: number) => void
): Promise<File> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = false; // Need audio
    video.playsInline = true;
    video.preload = "auto";

    const url = URL.createObjectURL(videoFile);
    video.src = url;

    video.onloadedmetadata = async () => {
      try {
        const duration = video.duration;
        if (!duration || !isFinite(duration)) {
          throw new Error("Cannot determine video duration");
        }

        // Create audio context and capture stream
        const audioCtx = new AudioContext();
        const source = audioCtx.createMediaElementSource(video);
        const dest = audioCtx.createMediaStreamDestination();
        source.connect(dest);
        // Also connect to speakers (muted via volume)
        const gain = audioCtx.createGain();
        gain.gain.value = 0; // silent
        source.connect(gain);
        gain.connect(audioCtx.destination);

        // Record the audio stream
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/mp4")
            ? "audio/mp4"
            : "audio/webm";

        const recorder = new MediaRecorder(dest.stream, {
          mimeType,
          audioBitsPerSecond: 64000, // 64kbps — ~480KB/min
        });

        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
          URL.revokeObjectURL(url);
          audioCtx.close();

          const audioBlob = new Blob(chunks, { type: mimeType });
          const ext = mimeType.includes("mp4") ? "m4a" : "webm";
          const audioFile = new File([audioBlob], `audio.${ext}`, { type: mimeType });

          console.log(`[compress] MediaRecorder: ${(audioFile.size / 1024).toFixed(0)}KB ${mimeType}`);

          if (audioFile.size > 25 * 1024 * 1024) {
            reject(new Error(`Extracted audio still ${(audioFile.size / 1048576).toFixed(0)}MB`));
          } else {
            resolve(audioFile);
          }
        };

        recorder.onerror = (e) => {
          URL.revokeObjectURL(url);
          reject(new Error(`MediaRecorder error: ${e}`));
        };

        // Play at max speed
        video.playbackRate = 16; // 16x speed — 1 min video = ~4 sec
        recorder.start(1000); // chunk every 1s

        video.onended = () => {
          recorder.stop();
        };

        video.ontimeupdate = () => {
          const pct = Math.min(95, 20 + (video.currentTime / duration) * 75);
          onProgress?.(`Extracting audio... ${Math.round(pct)}%`, pct);
        };

        // Safari needs user gesture — try to play
        try {
          await video.play();
        } catch {
          // If autoplay blocked, try muted then unmute
          video.muted = true;
          await video.play();
          // Re-create source with muted audio — won't capture audio
          // Fall back to error
          recorder.stop();
          reject(new Error("Cannot play video for audio extraction (autoplay blocked)"));
        }

        // Timeout — max 60 seconds for extraction
        setTimeout(() => {
          if (recorder.state === "recording") {
            recorder.stop();
          }
        }, 60000);

      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load video"));
    };
  });
}
