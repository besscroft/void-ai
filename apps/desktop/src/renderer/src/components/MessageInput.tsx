/**
 * 消息输入
 *
 * 渲染输入框 + 工具选择 + 提交按钮，使用 AI Elements：
 *  - <PromptInput>          form 外壳（含 onSubmit）
 *  - <PromptInputTextarea>  自动撑高的 textarea（Enter 提交 / Shift+Enter 换行）
 *  - <PromptInputSubmit>    提交按钮（status 决定图标/disabled）
 *
 * 沿用既有交互：
 *  - 模型未选择时显示警告条，禁用提交
 *  - 模型 / Agent 选择器继续用项目自有的 HeroUI v3 组件
 *    （局部引入 AI Elements 原则：其它外壳保持不变）
 *
 * 布局示意：
 *
 *   ┌─────────────────────────────────────────────────┐
 *   │ [textarea ............ ]                          │
 *   │ [Agent] [Model]                  [↑ send btn]    │
 *   └─────────────────────────────────────────────────┘
 */
import { useState } from "react";
import { AgentSelector } from "./AgentSelector";
import { ModelSelector } from "./ModelSelector";
import { PromptInput, PromptInputSubmit, PromptInputTextarea } from "./ai-elements";
import { useT } from "../lib/i18n";

interface MessageInputProps {
  isLoading: boolean;
  onSend: (text: string) => void;
  /** 流式中允许停止：替换发送按钮为停止按钮 */
  onStop?: () => void;
  selectedModel: string | null;
  selectedAgentId: string | null;
  onModelChange: (modelRef: string | null) => void;
  onAgentChange: (agentId: string) => void;
}

export function MessageInput({
  isLoading,
  onSend,
  onStop,
  selectedModel,
  selectedAgentId,
  onModelChange,
  onAgentChange,
}: MessageInputProps): React.JSX.Element {
  const { t } = useT();
  const [input, setInput] = useState("");
  const modelSelected = !!selectedModel;
  const status = isLoading ? "streaming" : "ready";
  // 提交按钮 disabled 判定：必须满足"已选模型 + 有文本 + 非生成中"
  const canSend = modelSelected && input.trim().length > 0 && !isLoading;

  return (
    <div className="shrink-0 bg-background/70 px-4 pb-3 pt-2 backdrop-blur-xl">
      <div className="mx-auto w-full max-w-4xl">
        <div
          className={[
            "rounded-[24px] border bg-background/95 shadow-[0_18px_60px_-42px_rgba(15,23,42,0.65)] transition-all duration-200",
            "focus-within:border-accent/45 focus-within:ring-4 focus-within:ring-accent/10",
            modelSelected ? "border-foreground/15" : "border-warning/35",
          ].join(" ")}
        >
          <div className="px-4 pb-2 pt-4">
            <PromptInput
              status={status}
              onSubmit={({ text }) => {
                if (!canSend) return;
                onSend(text);
                setInput("");
              }}
            >
              <PromptInputTextarea
                value={input}
                onChange={(e) => setInput(e.currentTarget.value)}
                placeholder={isLoading ? t("input.generating") : t("input.placeholder")}
                aria-label={t("input.placeholder")}
              />

              <div className="flex min-h-11 flex-wrap items-center justify-between gap-1.5 px-3 pt-2">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <AgentSelector value={selectedAgentId} onChange={onAgentChange} placement="top" />
                  <ModelSelector value={selectedModel} onChange={onModelChange} placement="top" />
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
    </div>
  );
}
