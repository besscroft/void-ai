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

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { AppLanguage, LanguageMode } from "@shared/types";

/** 翻译键集合（由 zh-CN 字典推断，保证两种语言键一致） */
type Dict = Record<string, string>;

export function resolveLanguage(mode: LanguageMode, systemLocale?: string | null): AppLanguage {
  if (mode !== "system") return mode;
  const normalized = (systemLocale || "").toLowerCase();
  if (normalized.startsWith("zh")) return "zh-CN";
  if (normalized.startsWith("en")) return "en";
  return "en";
}

const zhCN: Dict = {
  // —— 通用 ——
  "common.save": "保存",
  "common.saved": "已保存",
  "common.delete": "删除",
  "common.edit": "编辑",
  "common.clear": "清除",
  "common.cancel": "取消",
  "common.confirm": "确认",
  "common.apply": "应用",
  "common.close": "关闭",
  "common.retry": "\u91cd\u8bd5",
  "common.done": "完成",
  "common.reset": "恢复默认设置",
  "common.restore": "恢复",
  "common.permanentDelete": "永久删除",
  "common.yes": "是",
  "common.no": "否",

  // —— AppShell ——
  "shell.newConversation": "新建会话",
  "shell.noConversation": "暂无会话\n点击上方按钮开始",
  "shell.conversations": "对话历史",
  "shell.searchPlaceholder": "搜索会话…",
  "shell.noSearchResult": "没有匹配的会话",
  "shell.group.today": "今天",
  "shell.group.yesterday": "昨天",
  "shell.group.thisWeek": "本周",
  "shell.group.earlier": "更早",
  "shell.settings": "设置",
  "shell.theme.light": "浅色",
  "shell.theme.dark": "深色",
  "shell.theme.system": "跟随系统",

  // —— ChatView ——
  "chat.title": "对话",
  "chat.selectModel": "选择模型",
  "chat.loadingHistory": "加载历史...",
  "chat.initializing": "正在初始化...",
  "chat.empty.title": "开始一段新对话",
  "chat.empty.subtitle": "向 Void 提问，或先试试下面这些示例问题",
  "chat.copy": "复制消息",
  "chat.copied": "已复制",

  // —— MessageInput ——
  "input.placeholder": "问 Void 任何事...",
  "input.placeholder.withAttachments": "添加一些文字，或直接发送附件",
  "input.generating": "Void 正在思考...",
  "input.noModel": "先选择一个模型即可开始对话",
  "input.send": "发送消息",
  "input.stop": "停止生成",
  "input.params": "Temp {temperature} · Max {maxTokens}",
  "input.emoji": "插入表情",
  "input.attach": "上传附件",
  "input.dropHint": "松手即可附加文件",
  "input.shortcutHint":
    "Enter 发送 · Shift+Enter 换行 · ⌘/Ctrl+Enter 强制发送 · 也可直接拖入或粘贴图片",

  // —— MessageList ——
  "msg.empty.title": "开始一段新对话",
  "msg.empty.desc": "输入你的问题，AI 会在这里回应你",
  "msg.error.title": "请求失败",
  "msg.avatar.you": "我",
  "msg.copy": "复制",
  "msg.copied": "已复制",

  // —— 设置弹窗 ——
  "settings.title": "设置",
  "settings.tab.theme": "主题",
  "settings.tab.system": "系统",
  "settings.tab.appearance": "外观",
  "settings.tab.model": "模型管理",
  "settings.tab.apiKey": "API Key",
  "settings.tab.trash": "回收站",

  "settings.reset.title": "恢复默认设置",
  "settings.reset.confirm": "确定要将所有设置恢复为默认值吗？此操作不可撤销。",
  "settings.reset.done": "已恢复默认设置",
  "settings.reset.scopeTitle": "恢复{scope}默认设置",
  "settings.reset.scopeConfirm": "确定要将{scope}设置恢复为默认值吗？此操作不可撤销。",
  "settings.reset.appearance": "外观",

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

  // 外观（新）
  "appearance.title": "外观",
  "appearance.subtitle": "主题、字体、颜色与交互偏好，所有改动即时生效",
  "appearance.mode": "主题模式",
  "appearance.mode.desc": "切换浅色、深色或跟随系统，模式与主题包可自由组合",
  "appearance.bundle": "主题包",
  "appearance.bundle.desc": "快速切换 HeroUI 语义变量主题，与浅色/深色模式叠加生效",
  "appearance.accent": "强调色",
  "appearance.accent.desc": "使用主题默认色或挑选独立强调色，实时预览",
  "appearance.accent.theme": "使用主题默认",
  "appearance.accent.custom": "自定义颜色",
  "appearance.colors": "颜色",
  "appearance.colors.desc": "为空时沿用主题包提供的颜色",
  "appearance.background": "背景",
  "appearance.foreground": "前景",
  "appearance.contrast": "对比度",
  "appearance.contrast.desc": "微调强调色与文字的明暗对比，0 最低、100 最高",
  "appearance.fonts": "字体",
  "appearance.fonts.desc": "UI 字体作用于整体界面，等宽字体作用于代码块与差异视图",
  "appearance.font.ui": "UI 字体",
  "appearance.font.ui.hint": "例如 PingFang SC, Inter, system-ui",
  "appearance.font.mono": "代码字体",
  "appearance.font.mono.hint": "例如 JetBrains Mono, SF Mono, Menlo",
  "appearance.typography": "排版",
  "appearance.fontSize": "字体大小",
  "appearance.fontSize.desc": "调整界面整体字号",
  "appearance.codeFontSize": "代码字体大小",
  "appearance.codeFontSize.desc": "聊天与差异视图中代码使用的基础字号（px）",
  "appearance.interaction": "交互",
  "appearance.translucent": "半透明侧边栏",
  "appearance.translucent.desc": "为侧边栏启用毛玻璃效果",
  "appearance.pointer": "使用指针光标",
  "appearance.pointer.desc": "悬停于交互元素时切换为指针光标",
  "appearance.motion": "减少动态效果",
  "appearance.motion.desc": "降低动画与过渡强度，减少视觉干扰",
  "appearance.motion.system": "跟随系统",
  "appearance.motion.on": "开启",
  "appearance.motion.off": "关闭",
  "appearance.density": "界面密度",
  "appearance.density.desc": "紧凑模式节省空间，宽松模式更舒适",
  "appearance.density.compact": "紧凑",
  "appearance.density.comfortable": "标准",
  "appearance.density.loose": "宽松",
  "appearance.diff": "差异标记",
  "appearance.diff.desc": "使用颜色或 +/- 符号标记代码差异",
  "appearance.diff.color": "颜色",
  "appearance.diff.symbol": "+/-",
  "appearance.advanced": "高级",
  "appearance.language": "语言",
  "appearance.language.desc": "切换界面显示语言",

  // 语言选项（兼容旧键名）
  "system.language.system": "跟随系统",
  "system.language.zhCN": "简体中文",
  "system.language.en": "English",

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
  "model.catalog": "模型目录",
  "model.catalog.desc": "管理可用于对话的服务商与模型",
  "model.provider.builtin": "内置",
  "model.provider.custom": "自定义",
  "model.provider.apiKeyReady": "API Key 已配置",
  "model.provider.apiKeyMissing": "API Key 未配置",
  "model.provider.baseUrl": "Base URL",
  "model.provider.delete": "删除服务商",
  "model.provider.delete.confirm":
    "确定要删除 {label} 吗？该服务商下的自定义模型和 API Key 也会被清除。",
  "model.modelId": "模型 ID",
  "model.modelName": "显示名称",
  "model.provider": "服务商",
  "model.enabled": "启用",
  "model.apiKey": "API Key",
  "model.configureKey": "配置 Key",
  "model.editModel": "编辑模型",
  "model.editModel.desc": "更新显示名称、启用状态和 API Key",
  "model.selected": "当前默认",
  "model.use": "设为默认",
  "model.empty": "暂无模型，先添加一个模型 ID",
  "model.custom": "自定义",
  "model.deleteModel.confirm": "确定要删除 {label} 吗？",
  "model.addModel": "添加模型",
  "model.addModel.desc": "给任意服务商添加新的模型 ID",
  "model.addToProvider": "使用已有服务商",
  "model.addWithProvider": "创建自定义服务商",
  "model.addProvider": "添加自定义服务商",
  "model.addProvider.desc": "适用于兼容 OpenAI Chat Completions 的服务",
  "model.providerId": "服务商 ID",
  "model.providerName": "服务商名称",
  "model.baseUrl": "Base URL",
  "model.helpUrl": "API Key 页面",
  "model.placeholder.providerId": "留空自动生成，如 my-provider",
  "model.placeholder.providerName": "例如 My Gateway",
  "model.placeholder.baseUrl": "https://api.example.com/v1",
  "model.placeholder.helpUrl": "https://example.com/keys",
  "model.placeholder.modelId": "例如 deepseek-chat 或 vendor/model-name",
  "model.placeholder.modelName": "可选，例如 DeepSeek Chat",
  "model.placeholder.apiKey": "可选，粘贴该模型的 API Key",

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
  "toast.settings.resettingScope": "正在恢复{scope}默认设置...",
  "toast.settings.resetScope": "已恢复{scope}默认设置",
  "toast.settings.resetScopeFailed": "恢复{scope}默认设置失败",
  "toast.cache.clearing": "正在清理缓存...",
  "toast.cache.cleared": "缓存已清理",
  "toast.cache.clearFailed": "清理缓存失败",
  "toast.apikey.saving": "正在保存 API Key...",
  "toast.apikey.saved": "API Key 已保存",
  "toast.apikey.saveFailed": "保存 API Key 失败",
  "toast.apikey.clearing": "正在清除 API Key...",
  "toast.apikey.cleared": "API Key 已清除",
  "toast.apikey.clearFailed": "清除 API Key 失败",
  "toast.model.providerSaving": "正在保存服务商...",
  "toast.model.providerSaved": "服务商已保存",
  "toast.model.providerSaveFailed": "保存服务商失败",
  "toast.model.providerDeleting": "正在删除服务商...",
  "toast.model.providerDeleted": "服务商已删除",
  "toast.model.providerDeleteFailed": "删除服务商失败",
  "toast.model.modelSaving": "正在保存模型...",
  "toast.model.modelSaved": "模型已保存",
  "toast.model.modelSaveFailed": "保存模型失败",
  "toast.model.modelDeleting": "正在删除模型...",
  "toast.model.modelDeleted": "模型已删除",
  "toast.model.modelDeleteFailed": "删除模型失败",
  "toast.chat.failed": "聊天请求失败",
  "theme.bundle": "主题包",
  "theme.bundle.desc": "切换 HeroUI 语义变量主题，与浅色/深色模式组合生效",
  "theme.preset.default": "默认",
  "theme.preset.ocean": "海洋",
  "theme.preset.forest": "森林",
  "theme.preset.rose": "玫瑰",
  "theme.accent": "强调色",
  "theme.accent.desc": "使用主题默认色或选择独立强调色",
  "theme.accent.theme": "使用主题默认",
  "theme.accent.indigo": "靛蓝",
  "theme.accent.emerald": "翡翠",
  "theme.accent.rose": "玫瑰",
  "theme.accent.amber": "琉珀",
  "theme.accent.sky": "天蓝",
  "theme.accent.violet": "紫罗兰",
};

const en: Dict = {
  "common.save": "Save",
  "common.saved": "Saved",
  "common.delete": "Delete",
  "common.edit": "Edit",
  "common.clear": "Clear",
  "common.cancel": "Cancel",
  "common.confirm": "Confirm",
  "common.apply": "Apply",
  "common.close": "Close",
  "common.retry": "Retry",
  "common.done": "Done",
  "common.reset": "Reset to defaults",
  "common.restore": "Restore",
  "common.permanentDelete": "Delete forever",
  "common.yes": "Yes",
  "common.no": "No",

  "shell.newConversation": "New chat",
  "shell.noConversation": "No conversations yet\nClick above to start",
  "shell.conversations": "Conversations",
  "shell.searchPlaceholder": "Search conversations…",
  "shell.noSearchResult": "No matching conversations",
  "shell.group.today": "Today",
  "shell.group.yesterday": "Yesterday",
  "shell.group.thisWeek": "This week",
  "shell.group.earlier": "Earlier",
  "shell.settings": "Settings",
  "shell.theme.light": "Light",
  "shell.theme.dark": "Dark",
  "shell.theme.system": "System",

  "chat.title": "Chat",
  "chat.selectModel": "Select model",
  "chat.loadingHistory": "Loading history...",
  "chat.initializing": "Initializing...",
  "chat.empty.title": "Start a new conversation",
  "chat.empty.subtitle": "Ask Void anything, or try one of the prompts below to get going.",
  "chat.copy": "Copy message",
  "chat.copied": "Copied",

  "input.placeholder": "Ask Void anything...",
  "input.placeholder.withAttachments": "Add some text, or send the attachments as-is",
  "input.generating": "Void is thinking...",
  "input.noModel": "Choose a model to start chatting",
  "input.send": "Send message",
  "input.stop": "Stop generating",
  "input.params": "Temp {temperature} · Max {maxTokens}",
  "input.emoji": "Insert emoji",
  "input.attach": "Attach file",
  "input.dropHint": "Drop files to attach",
  "input.shortcutHint":
    "Enter to send · Shift+Enter for newline · ⌘/Ctrl+Enter to force send · drop or paste files to attach",

  "msg.empty.title": "Start a new conversation",
  "msg.empty.desc": "Type your question and the AI will respond here",
  "msg.error.title": "Request failed",
  "msg.avatar.you": "Me",
  "msg.copy": "Copy",
  "msg.copied": "Copied",

  // 设置弹窗
  "settings.title": "Settings",
  "settings.tab.theme": "Theme",
  "settings.tab.system": "System",
  "settings.tab.appearance": "Appearance",
  "settings.tab.model": "Model management",
  "settings.tab.apiKey": "API Key",
  "settings.tab.trash": "Trash",

  "settings.reset.title": "Reset to defaults",
  "settings.reset.confirm": "Reset all settings to defaults? This cannot be undone.",
  "settings.reset.done": "Settings reset to defaults",
  "settings.reset.scopeTitle": "Reset {scope} defaults",
  "settings.reset.scopeConfirm": "Reset {scope} settings to defaults? This cannot be undone.",
  "settings.reset.appearance": "Appearance",

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

  // Appearance (new)
  "appearance.title": "Appearance",
  "appearance.subtitle":
    "Theme, typography, colors and interaction preferences. Changes apply instantly.",
  "appearance.mode": "Theme mode",
  "appearance.mode.desc": "Switch light/dark or follow system, and freely combine with theme packs",
  "appearance.bundle": "Theme pack",
  "appearance.bundle.desc": "Switch HeroUI semantic variable themes and stack with light/dark mode",
  "appearance.accent": "Accent color",
  "appearance.accent.desc": "Use the theme default accent or pick an independent one with live preview",
  "appearance.accent.theme": "Use theme default",
  "appearance.accent.custom": "Custom color",
  "appearance.colors": "Colors",
  "appearance.colors.desc": "Leave empty to use the colors from the active theme pack",
  "appearance.background": "Background",
  "appearance.foreground": "Foreground",
  "appearance.contrast": "Contrast",
  "appearance.contrast.desc":
    "Fine-tune the contrast between accent and text. 0 is the lowest, 100 the highest.",
  "appearance.fonts": "Typography",
  "appearance.fonts.desc":
    "UI font applies to the entire interface; monospace applies to code blocks and diff views.",
  "appearance.font.ui": "UI font",
  "appearance.font.ui.hint": "e.g. PingFang SC, Inter, system-ui",
  "appearance.font.mono": "Code font",
  "appearance.font.mono.hint": "e.g. JetBrains Mono, SF Mono, Menlo",
  "appearance.typography": "Typography",
  "appearance.fontSize": "Font size",
  "appearance.fontSize.desc": "Adjust the overall interface font size",
  "appearance.codeFontSize": "Code font size",
  "appearance.codeFontSize.desc": "Base font size for code in chats and diff views (px)",
  "appearance.interaction": "Interaction",
  "appearance.translucent": "Translucent sidebar",
  "appearance.translucent.desc": "Enable a frosted-glass effect on the sidebar",
  "appearance.pointer": "Use pointer cursor",
  "appearance.pointer.desc": "Switch to a pointer cursor when hovering over interactive elements",
  "appearance.motion": "Reduce motion",
  "appearance.motion.desc": "Lower animation and transition intensity to reduce visual noise",
  "appearance.motion.system": "Follow system",
  "appearance.motion.on": "On",
  "appearance.motion.off": "Off",
  "appearance.density": "Layout density",
  "appearance.density.desc": "Compact saves space, loose is more comfortable",
  "appearance.density.compact": "Compact",
  "appearance.density.comfortable": "Comfortable",
  "appearance.density.loose": "Loose",
  "appearance.diff": "Diff marks",
  "appearance.diff.desc": "Use colors or +/- symbols to mark code differences",
  "appearance.diff.color": "Color",
  "appearance.diff.symbol": "+/-",
  "appearance.advanced": "Advanced",
  "appearance.language": "Language",
  "appearance.language.desc": "Switch the interface language",

  // Language options (legacy key names retained)
  "system.language.system": "Follow system",
  "system.language.zhCN": "Simplified Chinese",
  "system.language.en": "English",

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
  "model.catalog": "Model catalog",
  "model.catalog.desc": "Manage providers and models available for chat",
  "model.provider.builtin": "Built-in",
  "model.provider.custom": "Custom",
  "model.provider.apiKeyReady": "API Key configured",
  "model.provider.apiKeyMissing": "API Key missing",
  "model.provider.baseUrl": "Base URL",
  "model.provider.delete": "Delete provider",
  "model.provider.delete.confirm":
    "Delete {label}? Its custom models and API Key will also be cleared.",
  "model.modelId": "Model ID",
  "model.modelName": "Display name",
  "model.provider": "Provider",
  "model.enabled": "Enabled",
  "model.apiKey": "API Key",
  "model.configureKey": "Configure key",
  "model.editModel": "Edit model",
  "model.editModel.desc": "Update display name, enabled state, and API Key",
  "model.selected": "Current default",
  "model.use": "Set default",
  "model.empty": "No models yet. Add a model ID first.",
  "model.custom": "Custom",
  "model.deleteModel.confirm": "Delete {label}?",
  "model.addModel": "Add model",
  "model.addModel.desc": "Add a model ID to any provider",
  "model.addToProvider": "Use existing provider",
  "model.addWithProvider": "Create custom provider",
  "model.addProvider": "Add custom provider",
  "model.addProvider.desc": "For services compatible with OpenAI Chat Completions",
  "model.providerId": "Provider ID",
  "model.providerName": "Provider name",
  "model.baseUrl": "Base URL",
  "model.helpUrl": "API Key page",
  "model.placeholder.providerId": "Leave blank to generate, e.g. my-provider",
  "model.placeholder.providerName": "e.g. My Gateway",
  "model.placeholder.baseUrl": "https://api.example.com/v1",
  "model.placeholder.helpUrl": "https://example.com/keys",
  "model.placeholder.modelId": "e.g. deepseek-chat or vendor/model-name",
  "model.placeholder.modelName": "Optional, e.g. DeepSeek Chat",
  "model.placeholder.apiKey": "Optional, paste this model API Key",

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
  "toast.settings.resettingScope": "Resetting {scope} settings...",
  "toast.settings.resetScope": "{scope} settings reset",
  "toast.settings.resetScopeFailed": "Failed to reset {scope} settings",
  "toast.cache.clearing": "Clearing cache...",
  "toast.cache.cleared": "Cache cleared",
  "toast.cache.clearFailed": "Failed to clear cache",
  "toast.apikey.saving": "Saving API Key...",
  "toast.apikey.saved": "API Key saved",
  "toast.apikey.saveFailed": "Failed to save API Key",
  "toast.apikey.clearing": "Clearing API Key...",
  "toast.apikey.cleared": "API Key cleared",
  "toast.apikey.clearFailed": "Failed to clear API Key",
  "toast.model.providerSaving": "Saving provider...",
  "toast.model.providerSaved": "Provider saved",
  "toast.model.providerSaveFailed": "Failed to save provider",
  "toast.model.providerDeleting": "Deleting provider...",
  "toast.model.providerDeleted": "Provider deleted",
  "toast.model.providerDeleteFailed": "Failed to delete provider",
  "toast.model.modelSaving": "Saving model...",
  "toast.model.modelSaved": "Model saved",
  "toast.model.modelSaveFailed": "Failed to save model",
  "toast.model.modelDeleting": "Deleting model...",
  "toast.model.modelDeleted": "Model deleted",
  "toast.model.modelDeleteFailed": "Failed to delete model",
  "toast.chat.failed": "Chat request failed",
  "theme.bundle": "Theme package",
  "theme.bundle.desc": "Switch HeroUI semantic variable themes together with light or dark mode",
  "theme.preset.default": "Default",
  "theme.preset.ocean": "Ocean",
  "theme.preset.forest": "Forest",
  "theme.preset.rose": "Rose",
  "theme.accent": "Accent color",
  "theme.accent.desc": "Use the theme default color or choose an independent accent",
  "theme.accent.theme": "Use theme default",
  "theme.accent.indigo": "Indigo",
  "theme.accent.emerald": "Emerald",
  "theme.accent.rose": "Rose",
  "theme.accent.amber": "Amber",
  "theme.accent.sky": "Sky",
  "theme.accent.violet": "Violet",
};

/** 语言字典映射 */
const LOCALES: Record<AppLanguage, Dict> = {
  "zh-CN": zhCN,
  en,
};

/** 支持的语言选项（用于 UI 选择） */
export const LANGUAGE_OPTIONS: { value: LanguageMode; labelKey: string }[] = [
  { value: "system", labelKey: "system.language.system" },
  { value: "zh-CN", labelKey: "system.language.zhCN" },
  { value: "en", labelKey: "system.language.en" },
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
  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = locale;
  }, [locale]);

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
