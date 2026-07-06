const fs = require("fs");

function edit(path, fn) {
  const original = fs.readFileSync(path, "utf8");
  const next = fn(original);
  if (next === original) console.error(`no changes for ${path}`);
  fs.writeFileSync(path, next, "utf8");
}

edit("apps/desktop/src/renderer/src/lib/chat-media.ts", (s) => {
  s = s.replace(
    'export function buildMediaPendingMessage(id: string, kind: MediaGenerationKind): UIMessage {\n  return {\n    id,\n    role: "assistant",\n    metadata: { mediaGeneration: { kind, status: "pending" } },\n    parts: [{ type: "text", text: `Generating ${mediaKindLabel(kind)}...` }],\n  };\n}',
    'export function buildMediaPendingMessage(\n  id: string,\n  kind: MediaGenerationKind,\n  selection?: MediaGenerationSelection,\n): UIMessage {\n  return {\n    id,\n    role: "assistant",\n    metadata: {\n      mediaGeneration: {\n        kind,\n        status: "pending",\n        modelRef: selection?.modelRef ?? undefined,\n        options: selection?.options ?? undefined,\n      },\n    },\n    parts: [{ type: "text", text: `Generating ${mediaKindLabel(kind)}...` }],\n  };\n}',
  );
  s = s.replace(
    'export function buildMediaErrorMessage(\n  id: string,\n  kind: MediaGenerationKind,\n  error: string,\n): UIMessage {\n  return {\n    id,\n    role: "assistant",\n    metadata: { mediaGeneration: { kind, status: "error", error } },\n    parts: [{ type: "text", text: `Media generation failed: ${error}` }],\n  };\n}',
    'export function buildMediaErrorMessage(\n  id: string,\n  kind: MediaGenerationKind,\n  error: string,\n  selection?: MediaGenerationSelection,\n): UIMessage {\n  return {\n    id,\n    role: "assistant",\n    metadata: {\n      mediaGeneration: {\n        kind,\n        status: "error",\n        error,\n        modelRef: selection?.modelRef ?? undefined,\n        options: selection?.options ?? undefined,\n      },\n    },\n    parts: [{ type: "text", text: `Media generation failed: ${error}` }],\n  };\n}',
  );
  return s;
});

edit("apps/desktop/src/renderer/src/components/MessageList.tsx", (s) => {
  s = s.replace(
    "  onRetry?: () => void;\n  onDismissError?: () => void;",
    "  onRetry?: () => void;\n  onRetryMessage?: (messageId: string) => Promise<void> | void;\n  onDismissError?: () => void;",
  );
  s = s.replace(
    "  onRetry,\n  onDismissError,",
    "  onRetry,\n  onRetryMessage,\n  onDismissError,",
  );
  s = s.replace(
    "            onDelete={onDeleteMessage}\n            onToolApprovalResponse={onToolApprovalResponse}",
    "            onDelete={onDeleteMessage}\n            onRetry={onRetryMessage}\n            onToolApprovalResponse={onToolApprovalResponse}",
  );
  s = s.replace(
    "  onDelete?: (messageId: string) => void;\n  onToolApprovalResponse?: ChatAddToolApproveResponseFunction;",
    "  onDelete?: (messageId: string) => void;\n  onRetry?: (messageId: string) => Promise<void> | void;\n  onToolApprovalResponse?: ChatAddToolApproveResponseFunction;",
  );
  s = s.replace(
    "  onDelete,\n  onToolApprovalResponse,",
    "  onDelete,\n  onRetry,\n  onToolApprovalResponse,",
  );
  s = s.replace(
    '  const isUser = message.role === "user";\n  // 是否允许 hover 动作（仅在非流式中）',
    '  const isUser = message.role === "user";\n  const isMediaError = message.role === "assistant" && isMediaGenerationError(message);\n  // 是否允许 hover 动作（仅在非流式中）',
  );
  s = s.replace(
    "  /* ---------- 删除：user 同时删除紧跟其后的 assistant ---------- */",
    '  /* ---------- 重试媒体生成：仅媒体错误 assistant 消息 ---------- */\n  const handleMediaRetry = async (): Promise<void> => {\n    if (!onRetry || !isMediaError) return;\n    try {\n      await onRetry(message.id);\n    } catch (err) {\n      console.error("[chat] media retry failed:", err);\n    }\n  };\n\n  /* ---------- 删除：user 同时删除紧跟其后的 assistant ---------- */',
  );
  s = s.replace(
    "          onResend={isUser && onResend ? handleResend : undefined}\n          onDelete={onDelete ? handleDelete : undefined}",
    "          onResend={\n            isUser && onResend\n              ? handleResend\n              : isMediaError && onRetry\n                ? handleMediaRetry\n                : undefined\n          }\n          onDelete={onDelete ? handleDelete : undefined}",
  );
  s = s.replace(
    '\nfunction isTextPart(part: MessagePart): part is Extract<MessagePart, { type: "text" }> {',
    '\nfunction isMediaGenerationError(message: UIMessage): boolean {\n  const metadata = message.metadata as\n    | { mediaGeneration?: { status?: unknown } }\n    | null\n    | undefined;\n  return metadata?.mediaGeneration?.status === "error";\n}\n\nfunction isTextPart(part: MessagePart): part is Extract<MessagePart, { type: "text" }> {',
  );
  return s;
});

edit("apps/desktop/src/renderer/src/components/ChatView.tsx", (s) => {
  s = s.replace(
    "  type MediaGenerationResponse,\n  type MediaGenerationSettings,",
    "  type MediaGenerationKind,\n  type MediaGenerationResponse,\n  type MediaGenerationSettings,",
  );
  s = s.replace(
    "  const handleMediaSend = async ({\n    text,\n    files,\n    media,\n  }: {\n    text: string;\n    files: ReturnType<typeof toFileUIParts>;\n    media: MediaGenerationSelection;\n  }): Promise<void> => {",
    "  const handleMediaSend = async ({\n    text,\n    files,\n    media,\n    userMessageId,\n    assistantMessageId: requestedAssistantMessageId,\n    baseMessages,\n  }: {\n    text: string;\n    files: ReturnType<typeof toFileUIParts>;\n    media: MediaGenerationSelection;\n    userMessageId?: string;\n    assistantMessageId?: string;\n    baseMessages?: UIMessage[];\n  }): Promise<void> => {",
  );
  s = s.replace(
    "    const messageId = crypto.randomUUID();\n    const assistantMessageId = crypto.randomUUID();",
    "    const messageId = userMessageId ?? crypto.randomUUID();\n    const assistantMessageId = requestedAssistantMessageId ?? crypto.randomUUID();",
  );
  s = s.replace(
    "    const userMessages = appendOrReplaceMessage(latestMessagesRef.current, userMessage);\n    const pendingMessage = buildMediaPendingMessage(assistantMessageId, media.kind);",
    "    const userMessages = appendOrReplaceMessage(baseMessages ?? latestMessagesRef.current, userMessage);\n    const pendingMessage = buildMediaPendingMessage(assistantMessageId, media.kind, media);",
  );
  s = s.replace(
    "      const errorMessage = buildMediaErrorMessage(assistantMessageId, media.kind, detail);",
    "      const errorMessage = buildMediaErrorMessage(assistantMessageId, media.kind, detail, media);",
  );
  s = s.replace(
    "  const handleRetry = (): void => {\n    setChatError(null);\n    setIsStopped(false);\n    chat.clearError();\n    void chat.regenerate().finally(() => {\n      void persistMessagesSnapshot(conversationId, latestMessagesRef.current, createdAtRef.current);\n      void api.conversations.touch(conversationId);\n    });\n  };",
    '  const handleRetry = (): void => {\n    setChatError(null);\n    setIsStopped(false);\n    chat.clearError();\n    void chat.regenerate().finally(() => {\n      void persistMessagesSnapshot(conversationId, latestMessagesRef.current, createdAtRef.current);\n      void api.conversations.touch(conversationId);\n    });\n  };\n\n  const handleRetryMediaMessage = async (messageId: string): Promise<void> => {\n    const messages = latestMessagesRef.current;\n    const assistantIndex = messages.findIndex((message) => message.id === messageId);\n    if (assistantIndex < 0) return;\n    const metadata = readMediaGenerationMetadata(messages[assistantIndex]);\n    if (!metadata || metadata.status !== "error") return;\n\n    let userIndex = -1;\n    for (let index = assistantIndex - 1; index >= 0; index -= 1) {\n      if (messages[index]?.role === "user") {\n        userIndex = index;\n        break;\n      }\n    }\n\n    const userMessage = userIndex >= 0 ? messages[userIndex] : undefined;\n    if (!userMessage) {\n      notify.error(t("toast.media.failed"), "Original media request is no longer available.", locale);\n      return;\n    }\n\n    const text = (userMessage.parts ?? [])\n      .filter((part) => part.type === "text")\n      .map((part) => (part as { text: string }).text)\n      .join("\\n\\n");\n    const files = (userMessage.parts ?? []).filter(\n      (part): part is ReturnType<typeof toFileUIParts>[number] => part.type === "file",\n    );\n\n    await handleMediaSend({\n      text,\n      files,\n      media: { kind: metadata.kind, modelRef: metadata.modelRef, options: metadata.options },\n      userMessageId: userMessage.id,\n      assistantMessageId: messageId,\n      baseMessages: messages.slice(0, userIndex + 1),\n    });\n  };',
  );
  s = s.replace(
    "          onRetry={handleRetry}\n          onDismissError={handleDismissError}",
    "          onRetry={handleRetry}\n          onRetryMessage={handleRetryMediaMessage}\n          onDismissError={handleDismissError}",
  );
  s = s.replace(
    "\nasync function readMediaErrorResponse(response: Response): Promise<string> {",
    '\nfunction readMediaGenerationMetadata(message: UIMessage | undefined):\n  | {\n      kind: MediaGenerationKind;\n      status?: string;\n      modelRef?: string | null;\n      options?: MediaGenerationSelection["options"];\n    }\n  | null {\n  const metadata = message?.metadata as\n    | {\n        mediaGeneration?: {\n          kind?: unknown;\n          status?: unknown;\n          modelRef?: unknown;\n          options?: unknown;\n        };\n      }\n    | null\n    | undefined;\n  const media = metadata?.mediaGeneration;\n  if (!media || !isMediaGenerationKind(media.kind)) return null;\n  return {\n    kind: media.kind,\n    status: typeof media.status === "string" ? media.status : undefined,\n    modelRef: typeof media.modelRef === "string" ? media.modelRef : null,\n    options:\n      media.options && typeof media.options === "object" && !Array.isArray(media.options)\n        ? (media.options as MediaGenerationSelection["options"])\n        : undefined,\n  };\n}\n\nfunction isMediaGenerationKind(value: unknown): value is MediaGenerationKind {\n  return value === "image" || value === "speech" || value === "transcription" || value === "video";\n}\n\nasync function readMediaErrorResponse(response: Response): Promise<string> {',
  );
  return s;
});
