import { useEffect } from "react";
import { Button } from "@heroui/react";
import { IconClose } from "./icons";
import { useT } from "../lib/i18n";

interface ConfirmDialogProps {
  /** 控制显隐 */
  open: boolean;
  /** 标题 */
  title: string;
  /** 说明文案 */
  message: string;
  /** 确认按钮文案（默认取 i18n common.confirm） */
  confirmLabel?: string;
  /** 取消按钮文案（默认取 i18n common.cancel） */
  cancelLabel?: string;
  /** 是否为危险操作（确认按钮使用 danger 变体） */
  danger?: boolean;
  /** 确认回调 */
  onConfirm: () => void;
  /** 取消/关闭回调 */
  onClose: () => void;
}

/**
 * 通用确认弹窗
 *
 * 用于关键/破坏性操作的二次确认（重置设置、清理缓存、删除 API Key 等）。
 * 点击遮罩或按 ESC 视为取消。
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps): React.JSX.Element | null {
  const { t } = useT();

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-lg border border-foreground/15 bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-foreground/10 px-5 py-3">
          <h3 id="confirm-title" className="text-sm font-semibold">
            {title}
          </h3>
          <button
            type="button"
            className="rounded p-1 text-foreground/50 hover:bg-foreground/10 hover:text-foreground"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <IconClose className="size-4" />
          </button>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-foreground/70">{message}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-foreground/10 px-5 py-3">
          <Button variant="tertiary" size="sm" onPress={onClose}>
            {cancelLabel ?? t("common.cancel")}
          </Button>
          <Button variant={danger ? "danger" : "primary"} size="sm" onPress={onConfirm}>
            {confirmLabel ?? t("common.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
