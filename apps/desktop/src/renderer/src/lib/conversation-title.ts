const PLACEHOLDER_CONVERSATION_TITLES = new Set(["新会话", "新建会话", "New chat"]);

/**
 * 判断当前标题是否已经是“真实标题”。
 * 默认占位文案不算已生成标题，仍应允许自动总结覆盖。
 */
export function hasMeaningfulConversationTitle(title: string | null | undefined): boolean {
  const normalized = title?.trim();
  if (!normalized) return false;
  return !PLACEHOLDER_CONVERSATION_TITLES.has(normalized);
}
