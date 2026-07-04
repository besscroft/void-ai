/**
 * AI Elements - MessageAttachments 组件
 *
 * 设计目标：
 *  - 渲染已发送消息中的附件列表（图片网格 / 文件列表）
 *  - 适配 ai-sdk 的 UIMessage.parts 中的 file 类型 part
 *  - 图片：3 列网格，点击可放大（这里只展示，不做全屏预览）
 *
 * 用法：
 *   const parts = message.parts.filter(p => p.type === 'file');
 *   <MessageAttachments parts={parts} />
 */
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { AttachmentChip } from "./attachment-chip";
import type { AttachmentItem } from "./attachment-chip";

/** 简化的 file part 类型（不直接 import ai-sdk，便于解耦） */
export interface FilePartLike {
  type: string;
  mediaType?: string;
  filename?: string;
  /** dataURL 字符串（与 ai-sdk FileUIPart.url 协议一致） */
  url?: string;
  /** 兼容旧字段命名 */
  data?: string;
}

interface MessageAttachmentsProps {
  parts: FilePartLike[];
  className?: string;
}

export function MessageAttachments({
  parts,
  className,
}: MessageAttachmentsProps): React.JSX.Element | null {
  if (parts.length === 0) return null;

  const items: AttachmentItem[] = parts.map((p, i) => ({
    id: `${p.type}-${i}`,
    name: p.filename ?? "file",
    mediaType: p.mediaType ?? "application/octet-stream",
    size: 0,
    // 兼容 url 字段（ai-sdk FileUIPart 标准）和 data 字段（历史/旧版本）
    url: p.url ?? p.data,
    variant: p.mediaType?.startsWith("image/")
      ? "image"
      : p.mediaType?.startsWith("video/")
        ? "video"
        : p.mediaType?.startsWith("audio/")
          ? "audio"
          : "file",
  }));

  const images = items.filter((it) => it.variant === "image");
  const others = items.filter((it) => it.variant !== "image");

  return (
    <div data-slot="message-attachments" className={cn("flex w-full flex-col gap-2", className)}>
      {images.length > 0 && (
        <div
          className={cn(
            "grid gap-1.5",
            images.length === 1
              ? "grid-cols-1"
              : images.length === 2
                ? "grid-cols-2"
                : "grid-cols-3",
          )}
        >
          {images.map((img) => (
            <ImageTile key={img.id} item={img} />
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {others.map((it) => (
            <AttachmentChip key={it.id} item={it} compact />
          ))}
        </div>
      )}
    </div>
  );
}

function ImageTile({ item }: { item: AttachmentItem }): ReactNode {
  if (!item.url) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-lg bg-foreground/10 text-xs text-foreground/40">
        {item.name}
      </div>
    );
  }
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer noopener"
      className="group/tile relative block aspect-square overflow-hidden rounded-lg bg-foreground/5"
      title={item.name}
    >
      <img
        src={item.url}
        alt={item.name}
        className="size-full object-cover transition group-hover/tile:scale-105"
        loading="lazy"
      />
    </a>
  );
}
