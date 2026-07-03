/**
 * 轻量 i18n 基础设施
 *
 * 设计：
 *  - 平铺键值字典，zh-CN 为基准语言，en 为翻译
 *  - React Context 提供 t() 函数，语言切换即时生效
 *  - 仅覆盖应用内可见文案；缺失键回退到 zh-CN，再回退到键名本身
 *
 * 扩展方式：新增语言只需在 LOCALES 增加一项，并在 Translations 中补全。
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AppLanguage } from "@shared/types";

/** 翻译键集合（由 zh-CN 字典推断，保证两种语言键一致） */
type Dict = Record<string, string>;

const zhCN: Dict = {
  // —— 通用 ——
  "common.save": "保存",
  "common.saved": "已保存",
  "common.delete": "删除",
  "common.clear": "清除",
  "common.cancel": "取消",
  "common.confirm": "确认",
  "common.apply": "应用",
  "common.close": "关闭",
  "common.done": "完成",
  "common.reset": "恢复默认设置",
  "common.restore": "恢复",
  "common.permanentDelete": "永久删除",
  "common.yes": "是",
  "common.no": "否",

  // —— AppShell ——
  "shell.newConversation": "新建会话",
  "shell.noConversation": "暂无会话\n点击上方按钮开始",
  "shell.settings": "设置",
  "shell.theme.light": "浅色",
  "shell.theme.dark": "深色",
  "shell.theme.system": "跟随系统",

  // —— ChatView ——
  "chat.title": "对话",
  "chat.selectModel": "选择模型",
  "chat.loadingHistory": "加载历史...",
  "chat.initializing": "正在初始化...",

  // —— MessageInput ——
  "input.placeholder": "输入消息（Enter 发送，Shift+Enter 换行）",
  "input.generating": "AI 正在回复...",
  "input.noModel": "请先在右上角选择一个 AI 模型，或在设置中配置对应 Provider 的 API Key",
  "input.send": "发送消息",

  // —— MessageList ——
  "msg.empty.title": "开始一段新对话",
  "msg.empty.desc": "输入你的问题，AI 会在这里回应你",
  "msg.error.title": "请求失败",
  "msg.avatar.you": "我",

  // —— 设置弹窗 ——
  "settings.title": "设置",
  "settings.tab.theme": "主题",
  "settings.tab.system": "系统",
  "settings.tab.model": "模型",
  "settings.tab.apiKey": "API Key",
  "settings.tab.trash": "回收站",

  "settings.reset.title": "恢复默认设置",
  "settings.reset.confirm": "确定要将所有设置恢复为默认值吗？此操作不可撤销。",
  "settings.reset.done": "已恢复默认设置",

  "conversation.delete.title": "删除会话",
  "conversation.delete.confirm":
    "确定要删除“{title}”吗？会话将移入回收站，并在 7 天后自动永久删除。",

  "trash.title": "回收站",
  "trash.desc": "删除后的会话最多保留 7 天。你可以在此恢复，也可以手动永久删除。",
  "trash.empty": "回收站为空",
  "trash.deletedAt": "删除时间",
  "trash.purgeIn": "剩余",
  "trash.expired": "等待自动清理",
  "trash.permanent.title": "永久删除会话",
  "trash.permanent.confirm": "确定要永久删除“{title}”吗？此操作会同时删除消息记录，且不可恢复。",

  // 主题
  "theme.section.appearance": "外观",
  "theme.mode": "主题模式",
  "theme.mode.desc": "选择浅色、深色或跟随系统",
  "theme.preset": "强调色",
  "theme.preset.desc": "点击切换主色调，实时预览",
  "theme.custom": "自定义",
  "theme.preview": "预览",
  "theme.preview.button": "主要按钮",
  "theme.preview.text": "这是正文示例，用于预览当前主题效果。",

  // 系统
  "system.fontSize": "字体大小",
  "system.fontSize.desc": "调整界面整体字号",
  "system.density": "界面密度",
  "system.density.desc": "紧凑模式节省空间，宽松模式更舒适",
  "system.density.compact": "紧凑",
  "system.density.comfortable": "标准",
  "system.density.loose": "宽松",
  "system.language": "语言",
  "system.language.desc": "切换界面显示语言",

  // 模型
  "model.default": "默认模型",
  "model.default.desc": "新会话启动时使用的模型",
  "model.params": "模型参数",
  "model.params.desc": "调整生成行为，变更后实时生效",
  "model.temperature": "温度",
  "model.temperature.hint": "越高越随机创造，越低越确定保守",
  "model.maxTokens": "最大输出长度",
  "model.maxTokens.hint": "单次回复的最大 token 数",
  "model.topP": "Top-P",
  "model.topP.hint": "核采样概率阈值",
  "model.cache": "缓存管理",
  "model.cache.desc": "管理应用缓存以释放磁盘空间",
  "model.cache.used": "当前占用",
  "model.cache.limit": "上限",
  "model.cache.clear": "清理缓存",
  "model.cache.clearing": "清理中...",
  "model.cache.confirm": "确定要清理缓存吗？清理后部分资源需重新下载。",
  "model.cache.cleared": "缓存已清理",
  "model.cache.size": "缓存上限（MB）",

  // API Key
  "apikey.title": "API Key",
  "apikey.desc":
    "密钥使用 AES-256-GCM 加密后本地存储，仅用于 main 进程内调用 AI 服务，不会上传到任何服务器。",
  "apikey.configured": "已配置",
  "apikey.notConfigured": "未配置",
  "apikey.placeholder.set": "粘贴 {label} API Key",
  "apikey.placeholder.replace": "••••••••（已保存，输入新值替换）",
  "apikey.getKey": "获取 API Key ↗",
  "apikey.confirmDelete": "确定要清除 {label} 的 API Key 吗？",

  "toast.conversation.deleting": "正在移入回收站...",
  "toast.conversation.deleted": "会话已移入回收站",
  "toast.conversation.deleteFailed": "删除会话失败",
  "toast.conversation.restoring": "正在恢复会话...",
  "toast.conversation.restored": "会话已恢复",
  "toast.conversation.restoreFailed": "恢复会话失败",
  "toast.conversation.permanentDeleting": "正在永久删除...",
  "toast.conversation.permanentDeleted": "会话已永久删除",
  "toast.conversation.permanentDeleteFailed": "永久删除失败",
  "toast.trash.loadFailed": "加载回收站失败",
  "toast.settings.resetting": "正在恢复默认设置...",
  "toast.settings.reset": "已恢复默认设置",
  "toast.settings.resetFailed": "恢复默认设置失败",
  "toast.cache.clearing": "正在清理缓存...",
  "toast.cache.cleared": "缓存已清理",
  "toast.cache.clearFailed": "清理缓存失败",
  "toast.apikey.saving": "正在保存 API Key...",
  "toast.apikey.saved": "API Key 已保存",
  "toast.apikey.saveFailed": "保存 API Key 失败",
  "toast.apikey.clearing": "正在清除 API Key...",
  "toast.apikey.cleared": "API Key 已清除",
  "toast.apikey.clearFailed": "清除 API Key 失败",
  "toast.chat.failed": "聊天请求失败",
};

const en: Dict = {
  "common.save": "Save",
  "common.saved": "Saved",
  "common.delete": "Delete",
  "common.clear": "Clear",
  "common.cancel": "Cancel",
  "common.confirm": "Confirm",
  "common.apply": "Apply",
  "common.close": "Close",
  "common.done": "Done",
  "common.reset": "Reset to defaults",
  "common.restore": "Restore",
  "common.permanentDelete": "Delete forever",
  "common.yes": "Yes",
  "common.no": "No",

  "shell.newConversation": "New chat",
  "shell.noConversation": "No conversations yet\nClick above to start",
  "shell.settings": "Settings",
  "shell.theme.light": "Light",
  "shell.theme.dark": "Dark",
  "shell.theme.system": "System",

  "chat.title": "Chat",
  "chat.selectModel": "Select model",
  "chat.loadingHistory": "Loading history...",
  "chat.initializing": "Initializing...",

  "input.placeholder": "Type a message (Enter to send, Shift+Enter for newline)",
  "input.generating": "AI is replying...",
  "input.noModel":
    "Please select an AI model in the top-right, or configure the provider's API Key in settings",
  "input.send": "Send message",

  "msg.empty.title": "Start a new conversation",
  "msg.empty.desc": "Type your question and the AI will respond here",
  "msg.error.title": "Request failed",
  "msg.avatar.you": "Me",

  "settings.title": "Settings",
  "settings.tab.theme": "Theme",
  "settings.tab.system": "System",
  "settings.tab.model": "Model",
  "settings.tab.apiKey": "API Key",
  "settings.tab.trash": "Trash",

  "settings.reset.title": "Reset to defaults",
  "settings.reset.confirm": "Reset all settings to defaults? This cannot be undone.",
  "settings.reset.done": "Settings reset to defaults",

  "conversation.delete.title": "Delete conversation",
  "conversation.delete.confirm":
    "Delete “{title}”? The conversation will move to Trash and be permanently deleted after 7 days.",

  "trash.title": "Trash",
  "trash.desc":
    "Deleted conversations are kept for up to 7 days. Restore them here or delete them forever.",
  "trash.empty": "Trash is empty",
  "trash.deletedAt": "Deleted",
  "trash.purgeIn": "Remaining",
  "trash.expired": "Pending cleanup",
  "trash.permanent.title": "Delete conversation forever",
  "trash.permanent.confirm":
    "Delete “{title}” forever? This also deletes its messages and cannot be undone.",

  "theme.section.appearance": "Appearance",
  "theme.mode": "Theme mode",
  "theme.mode.desc": "Choose light, dark, or follow system",
  "theme.preset": "Accent color",
  "theme.preset.desc": "Click to switch the primary color with live preview",
  "theme.custom": "Custom",
  "theme.preview": "Preview",
  "theme.preview.button": "Primary button",
  "theme.preview.text": "This is sample body text to preview the current theme.",

  "system.fontSize": "Font size",
  "system.fontSize.desc": "Adjust the overall interface font size",
  "system.density": "Layout density",
  "system.density.desc": "Compact saves space, loose is more comfortable",
  "system.density.compact": "Compact",
  "system.density.comfortable": "Comfortable",
  "system.density.loose": "Loose",
  "system.language": "Language",
  "system.language.desc": "Switch the interface language",

  "model.default": "Default model",
  "model.default.desc": "Model used when a new conversation starts",
  "model.params": "Model parameters",
  "model.params.desc": "Tune generation behavior; changes apply immediately",
  "model.temperature": "Temperature",
  "model.temperature.hint": "Higher is more random/creative, lower is more deterministic",
  "model.maxTokens": "Max output length",
  "model.maxTokens.hint": "Maximum tokens per response",
  "model.topP": "Top-P",
  "model.topP.hint": "Nucleus sampling probability threshold",
  "model.cache": "Cache management",
  "model.cache.desc": "Manage app cache to free disk space",
  "model.cache.used": "Used",
  "model.cache.limit": "Limit",
  "model.cache.clear": "Clear cache",
  "model.cache.clearing": "Clearing...",
  "model.cache.confirm": "Clear the cache? Some resources will need to be re-downloaded.",
  "model.cache.cleared": "Cache cleared",
  "model.cache.size": "Cache limit (MB)",

  "apikey.title": "API Key",
  "apikey.desc":
    "Keys are encrypted with AES-256-GCM and stored locally. They are only used inside the main process to call AI services and never uploaded.",
  "apikey.configured": "Configured",
  "apikey.notConfigured": "Not configured",
  "apikey.placeholder.set": "Paste {label} API Key",
  "apikey.placeholder.replace": "•••••••• (saved, type new value to replace)",
  "apikey.getKey": "Get API Key ↗",
  "apikey.confirmDelete": "Clear the API Key for {label}?",

  "toast.conversation.deleting": "Moving to Trash...",
  "toast.conversation.deleted": "Conversation moved to Trash",
  "toast.conversation.deleteFailed": "Failed to delete conversation",
  "toast.conversation.restoring": "Restoring conversation...",
  "toast.conversation.restored": "Conversation restored",
  "toast.conversation.restoreFailed": "Failed to restore conversation",
  "toast.conversation.permanentDeleting": "Deleting forever...",
  "toast.conversation.permanentDeleted": "Conversation deleted forever",
  "toast.conversation.permanentDeleteFailed": "Failed to delete forever",
  "toast.trash.loadFailed": "Failed to load Trash",
  "toast.settings.resetting": "Resetting settings...",
  "toast.settings.reset": "Settings reset",
  "toast.settings.resetFailed": "Failed to reset settings",
  "toast.cache.clearing": "Clearing cache...",
  "toast.cache.cleared": "Cache cleared",
  "toast.cache.clearFailed": "Failed to clear cache",
  "toast.apikey.saving": "Saving API Key...",
  "toast.apikey.saved": "API Key saved",
  "toast.apikey.saveFailed": "Failed to save API Key",
  "toast.apikey.clearing": "Clearing API Key...",
  "toast.apikey.cleared": "API Key cleared",
  "toast.apikey.clearFailed": "Failed to clear API Key",
  "toast.chat.failed": "Chat request failed",
};

/** 语言字典映射 */
const LOCALES: Record<AppLanguage, Dict> = {
  "zh-CN": zhCN,
  en,
};

/** 支持的语言选项（用于 UI 选择） */
export const LANGUAGE_OPTIONS: { value: AppLanguage; label: string }[] = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
];

interface I18nContextValue {
  locale: AppLanguage;
  /** 翻译函数，支持 {name} 占位符插值 */
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "zh-CN",
  t: (key) => key,
});

/**
 * i18n Provider
 *
 * 由 App 传入当前语言（来自 useSettings），切换时所有消费组件自动重渲染。
 */
export function AppI18nProvider({
  locale,
  children,
}: {
  locale: AppLanguage;
  children: ReactNode;
}): React.JSX.Element {
  const value = useMemo<I18nContextValue>(() => {
    const dict = LOCALES[locale] ?? zhCN;
    const t = (key: string, params?: Record<string, string | number>): string => {
      // 回退链：当前语言 -> zh-CN -> 键名
      let text = dict[key] ?? zhCN[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
      }
      return text;
    };
    return { locale, t };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** 翻译 Hook */
export function useT(): I18nContextValue {
  return useContext(I18nContext);
}
