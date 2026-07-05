/**
 * 消息输入（Prompt Composer）
 *
 * 在 ai-elements PromptInput 之上扩展：
 *  - 表情选择器（EmojiPicker）：左侧按钮，分类网格 + 搜索
 *  - 附件上传：左侧按钮 / 拖拽 / 粘贴图片
 *  - 附件预览：textarea 上方横排 chip，可移除
 *  - 模型/Agent 选择器：保留原有交互
 *  - 发送按钮：文本 + 附件均满足时启用
 *  - 停止按钮：流式生成中替换发送按钮
 *
 * 视觉示意：
 *   ┌──────────────────────────────────────────────────────┐
 *   │ [chip 1] [chip 2]  ← 附件预览（无附件时整行隐藏）        │
 *   │ ┌──────────────────────────────────────────────────┐ │
 *   │ │ textarea...                                       │ │
 *   │ └──────────────────────────────────────────────────┘ │
 *   │ [😊] [📎] [Agent] [Model]                  [⏹ / ↑]   │
 *   └──────────────────────────────────────────────────────┘
 *
 * 受 AI Elements 接口约束：
 *  - onSend 签名扩展为 ({ text, files }) => void
 *  - files 为 ai-sdk FileUIPart[]（base64 data URL）
 *  - 父组件 ChatView 负责将 files 通过 sendMessage 发送
 */
import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { AgentSelector } from "./AgentSelector";
import { ModelSelector } from "./ModelSelector";
import { ReasoningSelector } from "./ReasoningSelector";
import { ToolSelector } from "./ToolSelector";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
  EmojiPicker,
  AttachmentChip,
  ContextPopover,
  type AttachmentItem,
  type ContextMetrics,
  type FilePartLike,
} from "./ai-elements";
import { useT } from "../lib/i18n";
import { cn } from "../lib/utils";
import { IconPaperclip, IconSmile } from "./icons";
import type { ChatReasoningLevel, ChatToolSelectionRequest, ProviderInfo } from "@shared/types";

/** 单个待发送附件（含 File 引用） */
export interface PendingAttachment extends AttachmentItem {
  file: File;
}

interface MessageInputProps {
  isLoading: boolean;
  /** 发送回调：包含文本与文件（ai-sdk FileUIPart[]） */
  onSend: (payload: { text: string; files: FilePartLike[] }) => void;
  /** 流式中允许停止：替换发送按钮为停止按钮 */
  onStop?: () => void;
  selectedModel: string | null;
  selectedAgentId: string | null;
  reasoningLevel: ChatReasoningLevel;
  toolSelection: ChatToolSelectionRequest;
  onModelChange: (modelRef: string | null) => void;
  onAgentChange: (agentId: string) => void;
  onReasoningLevelChange: (level: ChatReasoningLevel) => void;
  onToolSelectionChange: (selection: ChatToolSelectionRequest) => void;
  providers: ProviderInfo[];
  /** 单个附件最大字节数（默认 10MB） */
  maxFileSize?: number;
  /** 允许的 MIME 类型前缀（默认图片 + 文本 + pdf） */
  accept?: string;
  /** 上下文用量（用于输入框旁的 ContextPopover） */
  contextMetrics?: ContextMetrics;
}

/** 允许上传的 MIME 类型（默认比较宽松，覆盖图片/PDF/文本/办公文档） */
const DEFAULT_ACCEPT =
  "image/*,application/pdf,text/*,application/json,application/zip,application/msword,application/vnd.openxmlformats-officedocument.*";
/** 默认附件上限 10MB */
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024;

export function MessageInput({
  isLoading,
  onSend,
  onStop,
  selectedModel,
  selectedAgentId,
  reasoningLevel,
  toolSelection,
  onModelChange,
  onAgentChange,
  onReasoningLevelChange,
  onToolSelectionChange,
  providers,
  maxFileSize = DEFAULT_MAX_SIZE,
  accept = DEFAULT_ACCEPT,
  contextMetrics,
}: MessageInputProps): React.JSX.Element {
  const { t } = useT();
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const modelSelected = !!selectedModel;
  const status = isLoading ? "streaming" : "ready";
  // 提交按钮 disabled 判定：必须满足"已选模型 + 有文本或附件 + 非生成中"
  const hasContent = input.trim().length > 0 || attachments.length > 0;
  const canSend = modelSelected && hasContent && !isLoading;

  /** 提交：把 File 异步读取为 base64 dataURL，并组装 ai-sdk FileUIPart */
  const handleSubmit = (msg: PromptInputMessage): void => {
    if (!canSend) return;
    void flushSubmit(msg.text);
  };

  /**
   * 真正处理提交：
   *  1. 并行读取所有 File 为 base64 dataURL
   *  2. 调用 onSend 回调
   *  3. 失败时恢复 input / attachments
   */
  const flushSubmit = async (text: string): Promise<void> => {
    try {
      const fileParts: FilePartLike[] = await Promise.all(
        attachments.map(async (a) => ({
          type: "file",
          mediaType: a.mediaType,
          filename: a.name,
          // ai-sdk FileUIPart 用 url 承载 dataURL
          url: await readFileAsDataURL(a.file),
        })),
      );
      onSend({ text, files: fileParts });
      setInput("");
      setAttachments([]);
    } catch (err) {
      console.error("[MessageInput] failed to read attachments:", err);
    }
  };

  /** 选中 emoji：插入到光标位置 */
  const handleEmojiSelect = useCallback((emoji: string) => {
    const ta = textareaRef.current;
    setInput((prev) => {
      if (!ta) return prev + emoji;
      const start = ta.selectionStart ?? prev.length;
      const end = ta.selectionEnd ?? prev.length;
      return prev.slice(0, start) + emoji + prev.slice(end);
    });
    // 把焦点放回 textarea（下一帧）
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
    });
  }, []);

  /** 把 File 列表转为 PendingAttachment，并经过大小/类型校验 */
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
      if (next.length === 0) return;
      setAttachments((prev) => [...prev, ...next]);
    },
    [maxFileSize],
  );

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
    if (e.currentTarget.files) ingestFiles(e.currentTarget.files);
    // 重置 input 以便重复选择同一文件
    e.currentTarget.value = "";
  };

  /** 拖拽上传 */
  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  };
  const handleDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    // 只在离开整个 drop zone 时取消（relatedTarget 为 null 或外层）
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  };
  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer?.files) ingestFiles(e.dataTransfer.files);
  };

  /** 粘贴图片 */
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) {
          // 剪贴板里的图片常常没有 filename，给一个默认名
          if (!f.name) {
            const ext = (f.type.split("/")[1] || "png").toLowerCase();
            files.push(new File([f], `pasted-${Date.now()}.${ext}`, { type: f.type }));
          } else {
            files.push(f);
          }
        }
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      ingestFiles(files);
    }
  };

  /** 处理键盘：Cmd/Ctrl+Enter 也提交 */
  const handleKeyDownExtra = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  };

  /** 移除附件 */
  const removeAttachment = (id: string): void => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  return (
    <div className="shrink-0 bg-background/70 px-3 pb-3 pt-2 backdrop-blur-xl sm:px-4">
      <div className="mx-auto w-full max-w-[min(1400px,100%)]">
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "rounded-[24px] border bg-background/95 shadow-[0_18px_60px_-42px_rgba(15,23,42,0.65)] transition-all duration-200",
            "focus-within:border-accent/45 focus-within:ring-4 focus-within:ring-accent/10",
            isDragging
              ? "border-accent/60 ring-4 ring-accent/15"
              : modelSelected
                ? "border-foreground/15"
                : "border-warning/35",
          )}
        >
          <div className="px-4 pb-2 pt-4">
            <PromptInput status={status} onSubmit={handleSubmit} className="relative">
              {/* 附件预览行 */}
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
                  isLoading
                    ? t("input.generating")
                    : attachments.length > 0
                      ? t("input.placeholder.withAttachments")
                      : t("input.placeholder")
                }
                aria-label={t("input.placeholder")}
              />

              <div className="relative flex min-h-11 flex-wrap items-center justify-between gap-1.5 px-3 pt-2">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {/* 表情选择 */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setEmojiOpen((v) => !v)}
                      aria-label={t("input.emoji")}
                      title={t("input.emoji")}
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-xl text-foreground/60 transition",
                        "hover:bg-foreground/10 hover:text-foreground",
                        emojiOpen && "bg-foreground/10 text-foreground",
                      )}
                    >
                      <IconSmile className="size-4" />
                    </button>
                    <EmojiPicker
                      open={emojiOpen}
                      onOpenChange={setEmojiOpen}
                      onSelect={handleEmojiSelect}
                    />
                  </div>

                  {/* 附件按钮 */}
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

                  <span className="mx-1 h-4 w-px shrink-0 bg-foreground/10" />

                  <ToolSelector
                    value={toolSelection}
                    onChange={onToolSelectionChange}
                    selectedModel={selectedModel}
                    providers={providers}
                    disabled={isLoading}
                  />
                  <AgentSelector value={selectedAgentId} onChange={onAgentChange} placement="top" />
                  <ModelSelector value={selectedModel} onChange={onModelChange} placement="top" />
                  <ReasoningSelector
                    value={reasoningLevel}
                    onChange={onReasoningLevelChange}
                    placement="top"
                  />

                  {contextMetrics ? (
                    <ContextPopover metrics={contextMetrics} trigger="hover" className="ml-1" />
                  ) : null}
                </div>

                {isLoading && onStop ? (
                  <button
                    type="button"
                    onClick={onStop}
                    aria-label={t("input.stop")}
                    data-slot="prompt-input-stop"
                    className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-foreground/20 bg-foreground/10 text-foreground/80 transition hover:bg-foreground/15"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      stroke="none"
                      aria-hidden
                    >
                      <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                  </button>
                ) : (
                  <PromptInputSubmit
                    status={status}
                    disabled={!canSend}
                    aria-label={t("input.send")}
                    className="size-8"
                  />
                )}
              </div>

              {/* 拖拽提示蒙层 */}
              {isDragging && (
                <div
                  data-slot="composer-drop-overlay"
                  className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent/40 bg-accent/5 text-sm text-accent"
                >
                  {t("input.dropHint")}
                </div>
              )}
            </PromptInput>

            {!modelSelected && (
              <p
                id="message-input-model-warning"
                className="mt-2 inline-flex max-w-full rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning"
              >
                {t("input.noModel")}
              </p>
            )}
          </div>
        </div>
      </div>

      <p className="mt-1.5 px-1 text-[10px] text-foreground/35">{t("input.shortcutHint")}</p>
    </div>
  );
}

/**
 * 把 File 读取为 base64 dataURL（与 ai-sdk FileUIPart.data 协议一致）
 *
 * 不使用 FileReader.readAsArrayBuffer 后再转 base64（增加一次内存拷贝），
 * 直接 readAsDataURL 一次性产出 data URL 字符串。
 */
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
