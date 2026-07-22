import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { ModelSelector } from "./ModelSelector";
import { ReasoningSelector } from "./ReasoningSelector";
import { ToolSelector } from "./ToolSelector";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
  AttachmentChip,
  ContextPopover,
  type AttachmentItem,
  type ContextMetrics,
  type FilePartLike,
} from "./ai-elements";
import { useT } from "../lib/i18n";
import { cn } from "../lib/utils";
import {
  detectMediaIntent,
  getMediaCapableProviders,
  MEDIA_GENERATION_KINDS,
  selectMediaModelRef,
  type MediaGenerationSelection,
} from "../lib/chat-media";
import { IconClose, IconPaperclip, IconSparkles } from "./icons";
import type {
  ChatReasoningLevel,
  ChatToolSelectionRequest,
  MediaGenerationKind,
  MediaGenerationOptions,
  MediaGenerationSettings,
  ProviderInfo,
} from "@shared/types";

export interface PendingAttachment extends AttachmentItem {
  file: File;
}

interface MessageInputProps {
  isLoading: boolean;
  isRunActive?: boolean;
  onSend: (payload: {
    text: string;
    files: FilePartLike[];
    media?: MediaGenerationSelection;
  }) => void;
  onStop?: () => void;
  selectedModel: string | null;
  reasoningLevel: ChatReasoningLevel;
  toolSelection: ChatToolSelectionRequest;
  onModelChange: (modelRef: string | null) => void;
  onReasoningLevelChange: (level: ChatReasoningLevel) => void;
  onToolSelectionChange: (selection: ChatToolSelectionRequest) => void;
  providers: ProviderInfo[];
  mediaSettings: MediaGenerationSettings;
  onMediaSettingsChange: (settings: MediaGenerationSettings) => void;
  maxFileSize?: number;
  accept?: string;
  contextMetrics?: ContextMetrics;
}

const DEFAULT_ACCEPT =
  "image/*,audio/*,video/*,application/pdf,text/*,application/json,application/zip,application/msword,application/vnd.openxmlformats-officedocument.*";
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024;

export function MessageInput({
  isLoading,
  isRunActive = isLoading,
  onSend,
  onStop,
  selectedModel,
  reasoningLevel,
  toolSelection,
  onModelChange,
  onReasoningLevelChange,
  onToolSelectionChange,
  providers,
  mediaSettings,
  onMediaSettingsChange,
  maxFileSize = DEFAULT_MAX_SIZE,
  accept = DEFAULT_ACCEPT,
  contextMetrics,
}: MessageInputProps): React.JSX.Element {
  const { t } = useT();
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [mediaMenuOpen, setMediaMenuOpen] = useState(false);
  const [activeMediaKind, setActiveMediaKind] = useState<MediaGenerationKind | null>(null);
  const selectedReasoningModel = useMemo(() => {
    if (!selectedModel) return undefined;
    const separator = selectedModel.indexOf("/");
    if (separator <= 0) return undefined;
    const providerId = selectedModel.slice(0, separator);
    const modelId = selectedModel.slice(separator + 1);
    return providers
      .find((provider) => provider.id === providerId)
      ?.models.find((model) => model.id === modelId);
  }, [providers, selectedModel]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const detectedMediaKind = useMemo(
    () => (activeMediaKind ? null : (detectMediaIntent(input, attachments)?.kind ?? null)),
    [activeMediaKind, attachments, input],
  );
  const effectiveMediaKind = activeMediaKind ?? detectedMediaKind;
  const selectedMediaModel = effectiveMediaKind
    ? selectMediaModelRef(providers, mediaSettings, effectiveMediaKind)
    : null;
  const hasText = input.trim().length > 0;
  const hasAttachments = attachments.length > 0;
  const hasAudioAttachment = attachments.some((file) => file.mediaType.startsWith("audio/"));
  const mediaInputReady = effectiveMediaKind
    ? effectiveMediaKind === "transcription"
      ? hasAudioAttachment
      : hasText
    : false;
  const modelReady = effectiveMediaKind ? !!selectedMediaModel : !!selectedModel;
  const hasContent = effectiveMediaKind ? mediaInputReady : hasText || hasAttachments;
  const canSend = modelReady && hasContent;

  const handleSubmit = (msg: PromptInputMessage): void => {
    if (!canSend) return;
    void flushSubmit(msg.text);
  };

  const flushSubmit = async (text: string): Promise<void> => {
    try {
      const fileParts: FilePartLike[] = await Promise.all(
        attachments.map(async (a) => ({
          type: "file",
          mediaType: a.mediaType,
          filename: a.name,
          url: await readFileAsDataURL(a.file),
        })),
      );
      const media = activeMediaKind
        ? {
            kind: activeMediaKind,
            modelRef: selectMediaModelRef(providers, mediaSettings, activeMediaKind),
            options: mediaSettings.defaults[activeMediaKind]?.options ?? {},
          }
        : undefined;
      onSend({ text, files: fileParts, media });
      setInput("");
      setAttachments([]);
      setMediaMenuOpen(false);
    } catch (err) {
      console.error("[MessageInput] failed to read attachments:", err);
    }
  };

  const ingestFiles = useCallback(
    (files: FileList | File[]) => {
      const next: PendingAttachment[] = [];
      for (const file of Array.from(files)) {
        if (file.size > maxFileSize) {
          console.warn(
            `[MessageInput] skip ${file.name}: ${(file.size / 1024 / 1024).toFixed(1)}MB > limit`,
          );
          continue;
        }
        next.push({
          id: crypto.randomUUID(),
          file,
          name: file.name,
          mediaType: file.type || "application/octet-stream",
          size: file.size,
        });
      }
      if (next.length > 0) setAttachments((prev) => [...prev, ...next]);
    },
    [maxFileSize],
  );

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
    if (e.currentTarget.files) ingestFiles(e.currentTarget.files);
    e.currentTarget.value = "";
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer?.files) ingestFiles(e.dataTransfer.files);
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind !== "file") continue;
      const pasted = item.getAsFile();
      if (!pasted) continue;
      if (!pasted.name) {
        const ext = (pasted.type.split("/")[1] || "png").toLowerCase();
        files.push(new File([pasted], `pasted-${Date.now()}.${ext}`, { type: pasted.type }));
      } else {
        files.push(pasted);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      ingestFiles(files);
    }
  };

  const handleKeyDownExtra = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  };

  const removeAttachment = (id: string): void => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const runtimeWarning = !modelReady
    ? effectiveMediaKind
      ? t("input.media.noModel")
      : t("input.noModel")
    : null;

  return (
    <div className="shrink-0 bg-background/70 px-3 pb-3 pt-2 backdrop-blur-xl sm:px-4">
      <div className="mx-auto w-full max-w-[min(1400px,100%)]">
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "select-none rounded-[24px] border bg-background/95 shadow-[0_18px_60px_-42px_rgba(15,23,42,0.65)] transition-all duration-200",
            "focus-within:border-accent/45 focus-within:ring-4 focus-within:ring-accent/10",
            isDragging
              ? "border-accent/60 ring-4 ring-accent/15"
              : modelReady
                ? "border-foreground/15"
                : "border-warning/35",
          )}
        >
          <div className="px-4 pb-2 pt-4">
            <PromptInput
              status={isLoading ? "streaming" : "ready"}
              onSubmit={handleSubmit}
              className="relative"
            >
              {activeMediaKind && (
                <MediaSettingsPanel
                  kind={activeMediaKind}
                  providers={providers}
                  settings={mediaSettings}
                  onChange={onMediaSettingsChange}
                  onClear={() => setActiveMediaKind(null)}
                />
              )}

              {attachments.length > 0 && (
                <div
                  className="mb-2 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto pb-1"
                  data-slot="composer-attachments"
                >
                  {attachments.map((a) => (
                    <AttachmentChip key={a.id} item={a} onRemove={removeAttachment} />
                  ))}
                </div>
              )}

              <PromptInputTextarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.currentTarget.value)}
                onPaste={handlePaste}
                onKeyDown={handleKeyDownExtra}
                placeholder={
                  attachments.length > 0
                    ? t("input.placeholder.withAttachments")
                    : t("input.placeholder")
                }
                aria-label={t("input.placeholder")}
                className="select-text"
              />

              <div className="relative flex min-h-11 items-start gap-2 px-3 pt-2">
                <div className="inline-flex min-w-0 w-fit max-w-[calc(100%-2.75rem)] flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label={t("input.attach")}
                    title={t("input.attach")}
                    className="flex size-8 shrink-0 items-center justify-center rounded-xl text-foreground/60 transition hover:bg-foreground/10 hover:text-foreground"
                  >
                    <IconPaperclip className="size-4" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={accept}
                    onChange={handleFileInputChange}
                    className="hidden"
                    aria-hidden
                  />

                  <div className="relative">
                    <button
                      type="button"
                      disabled={isRunActive}
                      onClick={() => setMediaMenuOpen((v) => !v)}
                      aria-label={t("input.media")}
                      title={t("input.media")}
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-xl text-foreground/60 transition hover:bg-foreground/10 hover:text-foreground",
                        activeMediaKind && "bg-accent/10 text-accent",
                        isRunActive && "cursor-not-allowed opacity-40",
                      )}
                    >
                      <IconSparkles className="size-4" />
                    </button>
                    {mediaMenuOpen && (
                      <div className="absolute bottom-full left-0 z-50 mb-2 w-48 overflow-hidden rounded-lg border border-foreground/15 bg-background p-1 shadow-xl">
                        {MEDIA_GENERATION_KINDS.map((kind) => (
                          <button
                            key={kind}
                            type="button"
                            className={cn(
                              "flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition hover:bg-foreground/5",
                              activeMediaKind === kind && "bg-accent/10 text-accent",
                            )}
                            onClick={() => {
                              setActiveMediaKind(kind);
                              setMediaMenuOpen(false);
                            }}
                          >
                            <span>{t(mediaKindLabelKey(kind))}</span>
                            {kind === "video" && (
                              <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">
                                {t("input.media.experimental")}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <span className="mx-1 h-4 w-px shrink-0 bg-foreground/10" />

                  <ToolSelector
                    value={toolSelection}
                    onChange={onToolSelectionChange}
                    selectedModel={selectedModel}
                    providers={providers}
                    disabled={isRunActive}
                  />
                  <ModelSelector
                    value={selectedModel}
                    onChange={onModelChange}
                    placement="top"
                    disabled={isRunActive}
                  />
                  <ReasoningSelector
                    value={reasoningLevel}
                    onChange={onReasoningLevelChange}
                    placement="top"
                    model={selectedReasoningModel}
                    disabled={isRunActive}
                  />

                  {contextMetrics ? (
                    <ContextPopover metrics={contextMetrics} trigger="hover" className="ml-1" />
                  ) : null}
                </div>

                <PromptInputSubmit
                  status="ready"
                  disabled={!canSend}
                  aria-label={t("input.send")}
                  className="ml-auto size-8"
                />
                {isRunActive && onStop ? (
                  <button
                    type="button"
                    onClick={onStop}
                    aria-label={t("input.stop")}
                    data-slot="prompt-input-stop"
                    className="flex size-8 shrink-0 items-center justify-center rounded-md border border-foreground/20 bg-foreground/10 text-foreground/80 transition hover:bg-foreground/15"
                  >
                    <span className="size-3 rounded-[2px] bg-current" aria-hidden />
                  </button>
                ) : null}
              </div>

              {isDragging && (
                <div
                  data-slot="composer-drop-overlay"
                  className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent/40 bg-accent/5 text-sm text-accent"
                >
                  {t("input.dropHint")}
                </div>
              )}
            </PromptInput>

            {runtimeWarning && (
              <p
                id="message-input-model-warning"
                className="mt-2 inline-flex max-w-full rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning"
              >
                {runtimeWarning}
              </p>
            )}
          </div>
        </div>
      </div>

      <p className="mt-1.5 px-1 text-[10px] text-foreground/35">{t("input.shortcutHint")}</p>
    </div>
  );
}

function MediaSettingsPanel({
  kind,
  providers,
  settings,
  onChange,
  onClear,
}: {
  kind: MediaGenerationKind;
  providers: ProviderInfo[];
  settings: MediaGenerationSettings;
  onChange: (settings: MediaGenerationSettings) => void;
  onClear: () => void;
}): React.JSX.Element {
  const { t } = useT();
  const capableProviders = useMemo(
    () => getMediaCapableProviders(providers, kind),
    [kind, providers],
  );
  const selectedModel = selectMediaModelRef(providers, settings, kind) ?? "";
  const kindSettings = settings.defaults[kind];
  const options = kindSettings?.options ?? {};

  const updateKindSettings = (
    patch: Partial<{ modelRef: string | null; options: MediaGenerationOptions }>,
  ): void => {
    onChange({
      version: 1,
      defaults: {
        ...settings.defaults,
        [kind]: {
          modelRef:
            patch.modelRef !== undefined ? patch.modelRef : (kindSettings?.modelRef ?? null),
          options: patch.options ?? options,
        },
      },
    });
  };

  const updateOption = <K extends keyof MediaGenerationOptions>(
    key: K,
    value: MediaGenerationOptions[K] | undefined,
  ): void => {
    updateKindSettings({ options: { ...options, [key]: value } });
  };

  return (
    <div className="mb-2 rounded-2xl border border-accent/15 bg-accent/[0.035] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 rounded-full bg-accent" />
          <span className="text-sm font-medium text-foreground/80">
            {t(mediaKindLabelKey(kind))}
          </span>
          {kind === "video" && (
            <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">
              {t("input.media.experimental")}
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label={t("input.media.clear")}
          title={t("input.media.clear")}
          onClick={onClear}
          className="flex size-7 items-center justify-center rounded-lg text-foreground/45 transition hover:bg-foreground/10 hover:text-foreground"
        >
          <IconClose className="size-3.5" />
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <SelectControl
          label={t("input.media.model")}
          value={selectedModel}
          onChange={(value) => updateKindSettings({ modelRef: value || null })}
        >
          {capableProviders.length === 0 ? <option value="">No model</option> : null}
          {capableProviders.map((provider) => (
            <optgroup key={provider.id} label={provider.label}>
              {provider.models.map((model) => (
                <option key={model.id} value={`${provider.id}/${model.id}`}>
                  {model.label ?? model.id}
                </option>
              ))}
            </optgroup>
          ))}
        </SelectControl>

        {kind === "image" && (
          <>
            <SelectControl
              label={t("input.media.size")}
              value={options.size ?? ""}
              onChange={(value) => updateOption("size", value || undefined)}
            >
              <option value="">Auto</option>
              <option value="1024x1024">1024x1024</option>
              <option value="1024x1536">1024x1536</option>
              <option value="1536x1024">1536x1024</option>
            </SelectControl>
            <SelectControl
              label={t("input.media.aspectRatio")}
              value={options.aspectRatio ?? ""}
              onChange={(value) => updateOption("aspectRatio", value || undefined)}
            >
              <option value="">Auto</option>
              <option value="1:1">1:1</option>
              <option value="4:3">4:3</option>
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
            </SelectControl>
            <NumberControl
              label={t("input.media.count")}
              value={options.count}
              min={1}
              max={8}
              onChange={(value) => updateOption("count", value)}
            />
          </>
        )}

        {kind === "speech" && (
          <>
            <TextControl
              label={t("input.media.voice")}
              value={options.voice ?? ""}
              placeholder="alloy / Kore"
              onChange={(value) => updateOption("voice", value || undefined)}
            />
            <SelectControl
              label={t("input.media.format")}
              value={options.outputFormat ?? ""}
              onChange={(value) => updateOption("outputFormat", value || undefined)}
            >
              <option value="">Auto</option>
              <option value="mp3">mp3</option>
              <option value="wav">wav</option>
            </SelectControl>
            <NumberControl
              label={t("input.media.speed")}
              value={options.speed}
              min={0.25}
              max={4}
              step={0.05}
              onChange={(value) => updateOption("speed", value)}
            />
            <TextControl
              label={t("input.media.language")}
              value={options.language ?? ""}
              placeholder="auto"
              onChange={(value) => updateOption("language", value || undefined)}
            />
          </>
        )}

        {kind === "transcription" && (
          <TextControl
            label={t("input.media.language")}
            value={options.language ?? ""}
            placeholder="auto"
            onChange={(value) => updateOption("language", value || undefined)}
          />
        )}

        {kind === "video" && (
          <>
            <SelectControl
              label={t("input.media.aspectRatio")}
              value={options.aspectRatio ?? ""}
              onChange={(value) => updateOption("aspectRatio", value || undefined)}
            >
              <option value="">Auto</option>
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
            </SelectControl>
            <SelectControl
              label={t("input.media.resolution")}
              value={options.resolution ?? ""}
              onChange={(value) => updateOption("resolution", value || undefined)}
            >
              <option value="">Auto</option>
              <option value="1280x720">1280x720</option>
              <option value="1920x1080">1920x1080</option>
            </SelectControl>
            <NumberControl
              label={t("input.media.duration")}
              value={options.duration}
              min={1}
              max={60}
              onChange={(value) => updateOption("duration", value)}
            />
            <NumberControl
              label={t("input.media.fps")}
              value={options.fps}
              min={1}
              max={120}
              onChange={(value) => updateOption("fps", value)}
            />
            <NumberControl
              label={t("input.media.count")}
              value={options.count}
              min={1}
              max={4}
              onChange={(value) => updateOption("count", value)}
            />
            <label className="flex h-10 select-none items-center gap-2 rounded-lg border border-foreground/10 bg-background/70 px-2.5 text-xs text-foreground/70">
              <input
                type="checkbox"
                checked={options.generateAudio ?? false}
                onChange={(event) => updateOption("generateAudio", event.currentTarget.checked)}
              />
              {t("input.media.generateAudio")}
            </label>
          </>
        )}
      </div>
    </div>
  );
}

function SelectControl({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="flex min-w-0 select-none flex-col gap-1 text-xs text-foreground/55">
      <span className="font-medium">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="h-9 min-w-0 select-none rounded-lg border border-foreground/10 bg-background/80 px-2 text-xs text-foreground outline-none focus:border-accent/45"
      >
        {children}
      </select>
    </label>
  );
}

function TextControl({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <label className="flex min-w-0 select-none flex-col gap-1 text-xs text-foreground/55">
      <span className="font-medium">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="h-9 min-w-0 select-none rounded-lg border border-foreground/10 bg-background/80 px-2 text-xs text-foreground outline-none focus:border-accent/45"
      />
    </label>
  );
}

function NumberControl({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value?: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number | undefined) => void;
}): React.JSX.Element {
  return (
    <label className="flex min-w-0 select-none flex-col gap-1 text-xs text-foreground/55">
      <span className="font-medium">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value ?? ""}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          onChange(raw === "" ? undefined : Number(raw));
        }}
        className="h-9 min-w-0 select-none rounded-lg border border-foreground/10 bg-background/80 px-2 text-xs text-foreground outline-none focus:border-accent/45"
      />
    </label>
  );
}

function mediaKindLabelKey(
  kind: MediaGenerationKind,
): "input.media.image" | "input.media.speech" | "input.media.transcription" | "input.media.video" {
  switch (kind) {
    case "image":
      return "input.media.image";
    case "speech":
      return "input.media.speech";
    case "transcription":
      return "input.media.transcription";
    case "video":
      return "input.media.video";
  }
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("FileReader did not return a string"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}
