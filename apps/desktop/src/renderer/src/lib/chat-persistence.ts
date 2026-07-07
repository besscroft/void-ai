import type { UIMessage } from "ai";
import { api } from "./api";
import { buildMessageSnapshotRows } from "./chat-messages";

export async function persistMessagesSnapshot(
  conversationId: string,
  messages: UIMessage[],
  createdAtById: Map<string, number>,
): Promise<void> {
  if (messages.length === 0) return;

  const rows = buildMessageSnapshotRows({ conversationId, messages, createdAtById });
  await api.messages.saveBatch(rows);
  for (const row of rows) createdAtById.set(row.id, row.created_at);
}
