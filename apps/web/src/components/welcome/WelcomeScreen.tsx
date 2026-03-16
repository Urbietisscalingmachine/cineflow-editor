import { useState, useCallback, useEffect, useRef } from "react";
import {
  Clock,
  Layers,
  ArrowRight,
  Smartphone,
  Monitor,
  Square,
  FolderOpen,
  Upload,
  Bot,
  Scissors,
  Film,
  Sparkles,
  CheckCircle,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { Button, Switch, Label } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { SOCIAL_MEDIA_PRESETS, type SocialMediaCategory } from "@openreel/core";
import { TemplateGallery } from "./TemplateGallery";
import { RecentProjects } from "./RecentProjects";
import { useRouter } from "../../hooks/use-router";
import { useEditorPreload } from "../../hooks/useEditorPreload";
import { useAnalytics, AnalyticsEvents } from "../../hooks/useAnalytics";

// ─── API CONFIG ────────────────────────────────────────────
const API_BASE =
  "https://aitendencijos-platform-urbietis23s-projects.vercel.app";

// ─── TYPES ─────────────────────────────────────────────────
interface FormatOption {
  id: string;
  preset: SocialMediaCategory;
  label: string;
  ratio: string;
  icon: React.ElementType;
}

const FORMAT_OPTIONS: FormatOption[] = [
  { id: "vertical", preset: "tiktok", label: "9:16", ratio: "9:16", icon: Smartphone },
  { id: "horizontal", preset: "youtube-video", label: "16:9", ratio: "16:9", icon: Monitor },
  { id: "square", preset: "instagram-post", label: "1:1", ratio: "1:1", icon: Square },
  { id: "portrait", preset: "instagram-stories" as SocialMediaCategory, label: "4:5", ratio: "4:5", icon: Film },
];

type WelcomeStep = "upload" | "processing" | "ready";
type EditingMode = "ai" | "manual" | null;
type ViewMode = "home" | "templates" | "recent";

interface ProcessingState {
  step: "transcribing" | "analyzing" | "generating" | "importing" | "done" | "error";
  progress: number;
  message: string;
  error?: string;
}

interface AIResult {
  transcript: string;
  segments: { start: number; end: number; text: string }[];
  analysis: {
    title?: string;
    summary?: string;
    broll_suggestions?: string[];
    hooks?: string[];
  } | null;
}

// ─── CINEFLOW LOGO ────────────────────────────────────────
const CineflowLogo: React.FC<{ className?: string }> = ({ className = "" }) => (
  <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <rect x="2" y="2" width="44" height="44" rx="12" stroke="currentColor" strokeWidth="3" />
    <path d="M18 14l16 10-16 10V14z" fill="currentColor" opacity="0.9" />
    <circle cx="24" cy="24" r="3" fill="currentColor" opacity="0.4" />
  </svg>
);

// ─── MAIN COMPONENT ────────────────────────────────────────

interface WelcomeScreenProps {
  initialTab?: "templates" | "recent";
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ initialTab }) => {
  const setSkipWelcomeScreen = useUIStore((state) => state.setSkipWelcomeScreen);
  const skipWelcomeScreen = useUIStore((state) => state.skipWelcomeScreen);
  const createNewProject = useProjectStore((state) => state.createNewProject);
  const importMedia = useProjectStore((state) => state.importMedia);
  const addClipToNewTrack = useProjectStore((state) => state.addClipToNewTrack);
  const addSubtitle = useProjectStore((state) => state.addSubtitle);
  const { navigate } = useRouter();
  const { track } = useAnalytics();

  const [viewMode, setViewMode] = useState<ViewMode>(initialTab ?? "home");
  const [welcomeStep, setWelcomeStep] = useState<WelcomeStep>("upload");
  const [editingMode, setEditingMode] = useState<EditingMode>(null);
  const [selectedFormat, setSelectedFormat] = useState<string>("vertical");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [processing, setProcessing] = useState<ProcessingState>({
    step: "transcribing",
    progress: 0,
    message: "",
  });
  const [aiResult, setAiResult] = useState<AIResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEditorPreload(true);

  // ── File handling ──────────────────────────────────────
  const handleFileSelect = useCallback((file: File) => {
    const validTypes = [
      "video/mp4",
      "video/quicktime",
      "video/webm",
      "video/x-matroska",
      "video/avi",
    ];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(mp4|mov|webm|mkv|avi)$/i)) {
      alert("Please upload a video file (MP4, MOV, WebM, MKV, AVI)");
      return;
    }
    setUploadedFile(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect],
  );

  // ── AI Processing pipeline ────────────────────────────
  const runAIProcessing = useCallback(async (file: File) => {
    setWelcomeStep("processing");
    setProcessing({ step: "transcribing", progress: 10, message: "Transcribing audio..." });

    try {
      // Step 1: Get API key
      const keyRes = await fetch(`${API_BASE}/api/whisper-key`);
      if (!keyRes.ok) throw new Error("Failed to get API key");
      const keyData = await keyRes.json();
      const apiKey = keyData.key || keyData.apiKey;
      if (!apiKey) throw new Error("No API key returned");

      setProcessing({ step: "transcribing", progress: 25, message: "Sending to Whisper..." });

      // Step 2: Transcribe with OpenAI Whisper (client-side)
      const formData = new FormData();
      formData.append("file", file);
      formData.append("model", "whisper-1");
      formData.append("response_format", "verbose_json");
      formData.append("timestamp_granularities[]", "segment");

      const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });

      if (!whisperRes.ok) {
        const errText = await whisperRes.text();
        throw new Error(`Whisper API error: ${whisperRes.status} — ${errText}`);
      }

      const whisperData = await whisperRes.json();
      const transcript = whisperData.text || "";
      const segments: { start: number; end: number; text: string }[] =
        (whisperData.segments || []).map((s: { start: number; end: number; text: string }) => ({
          start: s.start,
          end: s.end,
          text: s.text,
        }));

      setProcessing({ step: "analyzing", progress: 60, message: "Analyzing content..." });

      // Step 3: Analyze with backend
      let analysis = null;
      try {
        const analyzeRes = await fetch(`${API_BASE}/api/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript, segments }),
        });
        if (analyzeRes.ok) {
          analysis = await analyzeRes.json();
        }
      } catch {
        // analysis is optional, continue without it
      }

      setProcessing({ step: "generating", progress: 80, message: "Generating subtitles..." });

      const result: AIResult = { transcript, segments, analysis };
      setAiResult(result);

      setProcessing({ step: "done", progress: 100, message: "Ready!" });
      setWelcomeStep("ready");
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      setProcessing({
        step: "error",
        progress: 0,
        message: errMsg,
        error: errMsg,
      });
    }
  }, []);

  // ── Launch editor with AI content ─────────────────────
  const launchEditorWithAI = useCallback(async () => {
    if (!uploadedFile || !aiResult) return;

    setProcessing({ step: "importing", progress: 90, message: "Importing to editor..." });

    const formatOption = FORMAT_OPTIONS.find((f) => f.id === selectedFormat) || FORMAT_OPTIONS[0];
    const preset = SOCIAL_MEDIA_PRESETS[formatOption.preset];

    createNewProject("AI Video Project", {
      width: preset.width,
      height: preset.height,
      frameRate: preset.frameRate,
    });

    // Import the video file
    try {
      const importResult = await importMedia(uploadedFile);
      if (importResult.success) {
        // Get the media item that was just imported
        const project = useProjectStore.getState().project;
        const lastMedia = project.mediaLibrary.items[project.mediaLibrary.items.length - 1];

        if (lastMedia) {
          // Add video clip to timeline
          await addClipToNewTrack(lastMedia.id, 0);

          // Add subtitles from AI segments
          if (aiResult.segments && aiResult.segments.length > 0) {
            for (const seg of aiResult.segments) {
              await addSubtitle({
                id: crypto.randomUUID(),
                text: seg.text.trim(),
                startTime: seg.start,
                endTime: seg.end,
                style: {
                  fontFamily: "Inter",
                  fontSize: 42,
                  color: "#FFFFFF",
                  backgroundColor: "rgba(0,0,0,0.6)",
                  position: "bottom",
                },
              });
            }
          }
        }
      }
    } catch (err) {
      console.error("Failed to import media:", err);
    }

    track(AnalyticsEvents.PROJECT_CREATED, {
      preset: formatOption.preset,
      source: "ai_upload",
    });

    navigate("editor");
  }, [uploadedFile, aiResult, selectedFormat, createNewProject, importMedia, addClipToNewTrack, addSubtitle, track, navigate]);

  // ── Manual flow ───────────────────────────────────────
  const launchManualEditor = useCallback(async () => {
    const formatOption = FORMAT_OPTIONS.find((f) => f.id === selectedFormat) || FORMAT_OPTIONS[0];
    const preset = SOCIAL_MEDIA_PRESETS[formatOption.preset];

    createNewProject(`New ${formatOption.label} Video`, {
      width: preset.width,
      height: preset.height,
      frameRate: preset.frameRate,
    });

    if (uploadedFile) {
      try {
        const importResult = await importMedia(uploadedFile);
        if (importResult.success) {
          const project = useProjectStore.getState().project;
          const lastMedia = project.mediaLibrary.items[project.mediaLibrary.items.length - 1];
          if (lastMedia) {
            await addClipToNewTrack(lastMedia.id, 0);
          }
        }
      } catch (err) {
        console.error("Failed to import media:", err);
      }
    }

    track(AnalyticsEvents.PROJECT_CREATED, {
      preset: formatOption.preset,
      source: "manual_upload",
    });

    navigate("editor");
  }, [selectedFormat, uploadedFile, createNewProject, importMedia, addClipToNewTrack, track, navigate]);

  // ── Keyboard & skip ───────────────────────────────────
  useEffect(() => {
    if (skipWelcomeScreen) navigate("editor");
  }, [skipWelcomeScreen, navigate]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (viewMode !== "home") {
          setViewMode("home");
        } else {
          navigate("editor");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, viewMode]);

  // ── Sub-views: templates & recent ─────────────────────
  if (viewMode === "templates") {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <header className="flex items-center justify-between px-6 py-4 border-b border-border">
          <Button variant="ghost" size="sm" onClick={() => setViewMode("home")}>
            <ArrowRight className="rotate-180" size={16} />
            Back
          </Button>
          <h2 className="text-sm font-medium text-text-primary">Templates</h2>
          <div className="w-16" />
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          <TemplateGallery onTemplateApplied={() => navigate("editor")} />
        </div>
      </div>
    );
  }

  if (viewMode === "recent") {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <header className="flex items-center justify-between px-6 py-4 border-b border-border">
          <Button variant="ghost" size="sm" onClick={() => setViewMode("home")}>
            <ArrowRight className="rotate-180" size={16} />
            Back
          </Button>
          <h2 className="text-sm font-medium text-text-primary">Recent Projects</h2>
          <div className="w-16" />
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          <RecentProjects onProjectSelected={() => navigate("editor")} />
        </div>
      </div>
    );
  }

  // ─── PROCESSING VIEW ──────────────────────────────────
  if (welcomeStep === "processing") {
    return (
      <div className="fixed inset-0 z-50 bg-background overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(139,92,246,0.08),transparent_60%)]" />
        <div className="relative h-full flex flex-col items-center justify-center px-6">
          <div className="w-full max-w-lg text-center">
            <div className="flex items-center gap-3 justify-center mb-8">
              <div className="w-10 h-10 text-[#8B5CF6]">
                <CineflowLogo className="w-full h-full" />
              </div>
              <span className="text-lg font-semibold text-text-primary tracking-tight">Cineflow</span>
            </div>

            {processing.step === "error" ? (
              <div className="space-y-6">
                <div className="w-16 h-16 mx-auto rounded-full bg-red-500/10 flex items-center justify-center">
                  <AlertCircle size={32} className="text-red-500" />
                </div>
                <h2 className="text-2xl font-bold text-text-primary">Processing Failed</h2>
                <p className="text-sm text-text-muted max-w-md mx-auto">{processing.error}</p>
                <div className="flex gap-3 justify-center">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setWelcomeStep("upload");
                      setUploadedFile(null);
                      setEditingMode(null);
                    }}
                  >
                    Try Again
                  </Button>
                  <Button
                    onClick={launchManualEditor}
                    className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white"
                  >
                    Continue Manually
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-8">
                <div className="w-16 h-16 mx-auto rounded-full bg-[#8B5CF6]/10 flex items-center justify-center">
                  <Loader2 size={32} className="text-[#8B5CF6] animate-spin" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-text-primary mb-2">
                    {processing.step === "transcribing" && "Transcribing Audio..."}
                    {processing.step === "analyzing" && "Analyzing Content..."}
                    {processing.step === "generating" && "Generating Subtitles..."}
                    {processing.step === "importing" && "Importing to Editor..."}
                    {processing.step === "done" && "Ready!"}
                  </h2>
                  <p className="text-sm text-text-muted">{processing.message}</p>
                </div>

                {/* Progress bar */}
                <div className="w-full max-w-xs mx-auto">
                  <div className="h-2 bg-background-tertiary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#8B5CF6] rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${processing.progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-text-muted mt-2">{processing.progress}%</p>
                </div>

                {/* Processing steps */}
                <div className="flex items-center justify-center gap-8 text-xs text-text-muted">
                  <StepIndicator
                    label="Transcribe"
                    active={processing.step === "transcribing"}
                    done={["analyzing", "generating", "importing", "done"].includes(processing.step)}
                  />
                  <div className="w-8 h-px bg-border" />
                  <StepIndicator
                    label="Analyze"
                    active={processing.step === "analyzing"}
                    done={["generating", "importing", "done"].includes(processing.step)}
                  />
                  <div className="w-8 h-px bg-border" />
                  <StepIndicator
                    label="Generate"
                    active={processing.step === "generating"}
                    done={["importing", "done"].includes(processing.step)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── READY VIEW ───────────────────────────────────────
  if (welcomeStep === "ready" && aiResult) {
    return (
      <div className="fixed inset-0 z-50 bg-background overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(139,92,246,0.08),transparent_60%)]" />
        <div className="relative h-full flex flex-col items-center justify-center px-6">
          <div className="w-full max-w-lg text-center space-y-8">
            <div className="flex items-center gap-3 justify-center">
              <div className="w-10 h-10 text-[#8B5CF6]">
                <CineflowLogo className="w-full h-full" />
              </div>
              <span className="text-lg font-semibold text-text-primary tracking-tight">Cineflow</span>
            </div>

            <div className="w-16 h-16 mx-auto rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle size={32} className="text-green-500" />
            </div>

            <div>
              <h2 className="text-2xl font-bold text-text-primary mb-2">AI Processing Complete!</h2>
              <p className="text-sm text-text-muted">
                {aiResult.segments.length} subtitle segments generated
                {aiResult.analysis?.broll_suggestions
                  ? ` · ${aiResult.analysis.broll_suggestions.length} B-roll suggestions`
                  : ""}
              </p>
            </div>

            {/* Preview snippet */}
            <div className="bg-background-secondary border border-border rounded-xl p-4 text-left max-h-32 overflow-y-auto">
              <p className="text-xs font-medium text-text-muted mb-2 uppercase tracking-wide">Transcript Preview</p>
              <p className="text-sm text-text-secondary leading-relaxed">
                {aiResult.transcript.slice(0, 300)}
                {aiResult.transcript.length > 300 ? "..." : ""}
              </p>
            </div>

            <Button
              onClick={launchEditorWithAI}
              className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white px-8 py-3 text-base"
            >
              <Sparkles size={18} />
              Open in Editor
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── MAIN UPLOAD VIEW ─────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-background overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(139,92,246,0.05),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(139,92,246,0.03),transparent_50%)]" />

      <div className="relative h-full flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-2xl">
          {/* Header */}
          <div className="flex flex-col items-center text-center mb-10">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 text-[#8B5CF6]">
                <CineflowLogo className="w-full h-full" />
              </div>
              <span className="text-2xl font-bold text-text-primary tracking-tight">Cineflow</span>
            </div>
            <p className="text-base text-text-secondary">AI Video Editing Platform</p>
          </div>

          {/* Upload zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`
              relative cursor-pointer rounded-2xl border-2 border-dashed p-10 mb-8
              flex flex-col items-center justify-center text-center
              transition-all duration-200
              ${
                isDragging
                  ? "border-[#8B5CF6] bg-[#8B5CF6]/5 scale-[1.01]"
                  : uploadedFile
                    ? "border-[#8B5CF6]/50 bg-[#8B5CF6]/5"
                    : "border-border hover:border-[#8B5CF6]/40 hover:bg-background-secondary"
              }
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/avi,.mp4,.mov,.webm,.mkv,.avi"
              onChange={handleInputChange}
              className="hidden"
            />

            {uploadedFile ? (
              <>
                <div className="w-14 h-14 rounded-xl bg-[#8B5CF6]/10 flex items-center justify-center mb-4">
                  <CheckCircle size={28} className="text-[#8B5CF6]" />
                </div>
                <p className="text-base font-medium text-text-primary mb-1">{uploadedFile.name}</p>
                <p className="text-sm text-text-muted">
                  {(uploadedFile.size / (1024 * 1024)).toFixed(1)} MB · Click to change
                </p>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-xl bg-background-tertiary flex items-center justify-center mb-4">
                  <Upload size={28} className="text-text-muted" />
                </div>
                <p className="text-base font-medium text-text-primary mb-1">
                  Drop your video here or click to upload
                </p>
                <p className="text-sm text-text-muted">MP4, MOV, WebM, MKV, AVI</p>
              </>
            )}
          </div>

          {/* Editing mode selector */}
          <div className="mb-6">
            <p className="text-sm font-medium text-text-secondary mb-3 text-center">Choose editing mode</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setEditingMode("ai")}
                className={`
                  group relative flex items-center gap-3 p-4 rounded-xl border transition-all duration-200
                  ${
                    editingMode === "ai"
                      ? "border-[#8B5CF6] bg-[#8B5CF6]/10 ring-1 ring-[#8B5CF6]/30"
                      : "border-border hover:border-[#8B5CF6]/40 hover:bg-background-secondary"
                  }
                `}
              >
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    editingMode === "ai" ? "bg-[#8B5CF6]/20" : "bg-background-tertiary"
                  }`}
                >
                  <Bot size={20} className={editingMode === "ai" ? "text-[#8B5CF6]" : "text-text-muted"} />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-text-primary">🤖 AI Full Auto</p>
                  <p className="text-xs text-text-muted">Transcribe, subtitles, analysis</p>
                </div>
              </button>

              <button
                onClick={() => setEditingMode("manual")}
                className={`
                  group relative flex items-center gap-3 p-4 rounded-xl border transition-all duration-200
                  ${
                    editingMode === "manual"
                      ? "border-[#8B5CF6] bg-[#8B5CF6]/10 ring-1 ring-[#8B5CF6]/30"
                      : "border-border hover:border-[#8B5CF6]/40 hover:bg-background-secondary"
                  }
                `}
              >
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    editingMode === "manual" ? "bg-[#8B5CF6]/20" : "bg-background-tertiary"
                  }`}
                >
                  <Scissors size={20} className={editingMode === "manual" ? "text-[#8B5CF6]" : "text-text-muted"} />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-text-primary">✂️ Manual Edit</p>
                  <p className="text-xs text-text-muted">Skip AI, go straight to editor</p>
                </div>
              </button>
            </div>
          </div>

          {/* Format selector */}
          <div className="mb-8">
            <p className="text-sm font-medium text-text-secondary mb-3 text-center">Format</p>
            <div className="flex items-center justify-center gap-2">
              {FORMAT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setSelectedFormat(opt.id)}
                  className={`
                    px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
                    ${
                      selectedFormat === opt.id
                        ? "bg-[#8B5CF6] text-white shadow-lg shadow-[#8B5CF6]/25"
                        : "bg-background-secondary text-text-muted hover:bg-background-tertiary hover:text-text-primary border border-border"
                    }
                  `}
                >
                  {opt.ratio}
                </button>
              ))}
            </div>
          </div>

          {/* Action button */}
          <div className="flex justify-center mb-8">
            {editingMode === "ai" ? (
              <Button
                onClick={() => uploadedFile && runAIProcessing(uploadedFile)}
                disabled={!uploadedFile}
                className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white px-8 py-3 text-base disabled:opacity-40"
              >
                <Sparkles size={18} />
                Start AI Processing
              </Button>
            ) : editingMode === "manual" ? (
              <Button
                onClick={launchManualEditor}
                className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white px-8 py-3 text-base"
              >
                <ArrowRight size={18} />
                {uploadedFile ? "Open with Video" : "Open Empty Editor"}
              </Button>
            ) : (
              <p className="text-sm text-text-muted">Select an editing mode to continue</p>
            )}
          </div>

          {/* Bottom links */}
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" onClick={() => setViewMode("templates")} className="rounded-xl">
              <Layers size={16} />
              Templates
            </Button>
            <Button variant="outline" onClick={() => setViewMode("recent")} className="rounded-xl">
              <Clock size={16} />
              Recent
            </Button>
            <Button variant="outline" onClick={() => navigate("editor")} className="rounded-xl">
              <FolderOpen size={16} />
              Open Editor
            </Button>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="skip-welcome"
              checked={skipWelcomeScreen}
              onCheckedChange={setSkipWelcomeScreen}
            />
            <Label htmlFor="skip-welcome" className="text-xs text-text-muted cursor-pointer">
              Skip on startup
            </Label>
          </div>
          <span className="text-text-muted/30">·</span>
          <p className="text-xs text-text-muted/60">
            Press{" "}
            <kbd className="px-1.5 py-0.5 bg-background-tertiary border border-border rounded text-text-muted font-mono text-[10px]">
              Esc
            </kbd>{" "}
            to skip
          </p>
        </div>
      </div>
    </div>
  );
};

// ─── STEP INDICATOR ────────────────────────────────────
const StepIndicator: React.FC<{ label: string; active: boolean; done: boolean }> = ({
  label,
  active,
  done,
}) => (
  <div className="flex flex-col items-center gap-1">
    <div
      className={`
      w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all
      ${done ? "bg-[#8B5CF6] text-white" : active ? "bg-[#8B5CF6]/20 text-[#8B5CF6] ring-2 ring-[#8B5CF6]/40" : "bg-background-tertiary text-text-muted"}
    `}
    >
      {done ? "✓" : active ? "•" : "○"}
    </div>
    <span className={active ? "text-text-primary font-medium" : ""}>{label}</span>
  </div>
);

export default WelcomeScreen;
