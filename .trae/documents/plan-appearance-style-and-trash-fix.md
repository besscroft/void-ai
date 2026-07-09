# 计划：外观 / 风格 / 智能体回收站收尾

## Summary

上一轮已经把 4 项需求的主体功能完成（types/settings/theme/db/ipc/api/preload/SettingsDialog/AgentsPanel），剩下的是**清理工作**：i18n 残留的已删除键、两个测试文件还引用了已删除字段、`AgentsPanel` 的 `AgentCard` 仍有未使用的 `onArchive/onRestore` 参数。修完后跑 `vp check` 验证。

## Current State

### 已完成（主体功能落地）

- [types.ts](file:///c:/github/void-ai/apps/desktop/src/shared/types.ts) — `STYLE_PRESETS` 已新增；`FONT_PRESETS` 乱码已修；`AppSettings.style: StylePresetId` 已加；`ACCENT_PRESETS`/`AccentPreset`/`SettingKey.AccentColor/BackgroundColor/ForegroundColor/Contrast` 已删；`AppSettings.accentColor/backgroundColor/foregroundColor/contrast` 已删；`DEFAULT_SETTINGS.style = "mira"` ✓
- [settings.tsx](file:///c:/github/void-ai/apps/desktop/src/renderer/src/lib/settings.tsx) — `APP_SETTING_KEYS.Style` 加、`ACCENT_PRESETS` 移除、`parseSettings.style`、`persist.style`、reset 补丁 ✓
- [theme.ts](file:///c:/github/void-ai/apps/desktop/src/renderer/src/lib/theme.ts) — `applyStyle`/`applyFonts` 实现，`applyAccent` 移除，`applyTheme` 改用 `settings.style` ✓
- [db.ts](file:///c:/github/void-ai/apps/desktop/src/main/lib/db.ts) — `deleteAgent` 已实现（守卫 `kind === "main"` 不可删，先删 `agentPolicies`） ✓
- [ipc/index.ts](file:///c:/github/void-ai/apps/desktop/src/main/ipc/index.ts) — `agents:delete` 已注册 ✓
- [api.ts](file:///c:/github/void-ai/apps/desktop/src/renderer/src/lib/api.ts) — `agents.delete` 已加 ✓
- [preload/index.ts](file:///c:/github/void-ai/apps/desktop/src/preload/index.ts) 与 [preload/index.d.ts](file:///c:/github/void-ai/apps/desktop/src/preload/index.d.ts) — `delete` 已加 ✓
- [SettingsDialog.tsx](file:///c:/github/void-ai/apps/desktop/src/renderer/src/components/SettingsDialog.tsx) — 风格 SettingSection 已加、放在主题包 SettingSection 旁；强调色 + 颜色 SettingSection 已删；字体 SettingSection 保留；回收站智能体行已加"永久删除"按钮 + `ConfirmDialog` ✓
- [AgentsPanel.tsx](file:///c:/github/void-ai/apps/desktop/src/renderer/src/components/AgentsPanel.tsx) — `AgentPanelTab = "active" | "draft"`、`archived` Tab 移除、archive/restore 状态与回调已清、editor 状态选项移除 archived ✓
- [i18n.messages.ts](file:///c:/github/void-ai/apps/desktop/src/renderer/src/lib/i18n.messages.ts) — `theme.style.*` / `appearance.style*` / `toast.agent.delete*` / `trash.agents.delete.*` 全部新增 ✓

### 仍需清理（让 `vp check` 通过）

1. **i18n.messages.ts** — 残留 7 处已不再使用的键：
   - `entries` 段（en/zh 共用）：
     - L44-50 `appearance.accent*`（4 个：`appearance.accent` / `.custom` / `.desc` / `.theme`）
     - L60 `appearance.color.placeholder`
     - L61-65 `appearance.colors` / `.desc`
     - L66-67 `appearance.contrast` / `.desc`
     - L52 `appearance.background`（不再用，但保留无害；一并删以保持 i18n 紧凑）
     - L86 `appearance.foreground`（同上）
     - L645-653 `theme.accent*`（9 个：`theme.accent` / `.desc` / `.theme` / `.amber` / `.emerald` / `.indigo` / `.rose` / `.sky` / `.violet`）
   - `zhOverrides` 段（仅 zh）：
     - L1033-1036 `appearance.accent*`（4 个）
     - L1038 `appearance.background`
     - L1045 `appearance.color.placeholder`
     - L1046-1047 `appearance.colors*`（2 个）
     - L1048-1049 `appearance.contrast*`（2 个）
     - L1068 `appearance.foreground`
     - L1257-1265 `theme.accent*`（9 个）
   - `agentZh` 段（仅 zh）：
     - L1479 `agents.action.archive`
     - L1483 `agents.action.restore`
     - L1485-1486 `agents.archive.message` / `.title`
     - L1552 `agents.tab.archived`

   > i18n.test.ts 强制 `Object.keys(en) === Object.keys(zhCN)`，所以 en 和 zhCN 必须**同步**删，不能只删一边。

2. **settings.test.ts** — 引用了已删除的 `settings.accentColor` / `SettingKey.AccentColor`：
   - L7-15 用例"uses ... theme accent by default"断言 `settings.accentColor === "theme"` → 改为断言 `settings.style === "mira"`
   - L17-25 用例"keeps compatible legacy ... accent values" — 整段改测"keeps style value"
   - L27-41 用例"rejects invalid enum values"中 `SettingKey.AccentColor` 注入与 `accentColor` 断言 → 改用 `SettingKey.Style` 与 `style`

3. **theme.test.ts** — `applyTheme` 不再接受 `accentColor`，且不再写 `--accent` / `--accent-foreground`：
   - L80-98 第一个用例 `themeSettings({ ... accentColor: "theme" ... })` → 去掉 `accentColor`，改测 `--style-radius` 与 `data-style` 属性
   - L100-127 第二个用例基于 `--accent` / `--accent-foreground` 断言 → 改为基于 `--style-radius`（或类似）断言；并把"clears custom accent"重构为"applies chosen style radius"测试
   - `FakeDocumentElement` 已有的 `setAttribute/removeAttribute` 已支持 `data-theme-preset`，需要扩展支持 `data-style` 以读取值；或直接用 `root.style.getPropertyValue("--style-radius")`（FakeStyle 已支持）

4. **AgentsPanel.tsx** — `AgentCard` 组件签名残留 `onArchive`/`onRestore` 参数（声明但未在函数体使用）：
   - L364-383 `AgentCard({... onArchive, onRestore ...})` 移除这两个参数和函数体里没有的 props
   - 同步去掉这些未使用参数（保持类型干净，避免 `vp check` 报警）

## Proposed Changes

### 1. `apps/desktop/src/renderer/src/lib/i18n.messages.ts`

- 删除 `entries` 段 L44-50 / L52 / L60-67 / L86 / L645-653 的所有 `appearance.accent*` / `appearance.colors*` / `appearance.contrast*` / `appearance.background` / `appearance.foreground` / `appearance.color.placeholder` / `theme.accent*` 键
- 删除 `zhOverrides` 段 L1033-1036 / L1038 / L1045-1049 / L1068 / L1257-1265 同样的键
- 删除 `agentZh` 段 L1479 / L1483 / L1485-1486 / L1552 的 `agents.action.archive` / `agents.action.restore` / `agents.archive.*` / `agents.tab.archived`

> 删除需谨慎，确保 en 与 zhCN 同步减键（i18n.test.ts parity 测试会校验）。

### 2. `apps/desktop/src/renderer/src/lib/settings.test.ts`

- L7-15 改为断言 `settings.style === "mira"`（代替 `settings.accentColor === "theme"`）
- L17-25 重构为"keeps compatible style value"：注入 `[SettingKey.Style]: "nova"` → `settings.style === "nova"`
- L27-41 删除 `SettingKey.AccentColor` 注入与 `accentColor` 断言；改注入 `[SettingKey.Style]: "not-a-style"` → `settings.style === "mira"`（默认值）

### 3. `apps/desktop/src/renderer/src/lib/theme.test.ts`

- L80-98 第一个用例：去掉 `accentColor: "theme"`；增加 `style: "mira"`；增加断言 `root.style.getPropertyValue("--style-radius") === "12px"`（mira radius=12）
- L100-127 第二个用例：去掉 `accentColor: "#123456"` / `--accent` 断言；改测 `style: "vega"`（radius=10）+ `style: "mira"` 后 `applyTheme` 重新设置 `--style-radius`

### 4. `apps/desktop/src/renderer/src/components/AgentsPanel.tsx`

- L364-383 `AgentCard` 组件签名移除 `onArchive: () => void` / `onRestore: () => void` 两个 prop

## Assumptions & Decisions

1. **保留 en/zh 对称**：i18n.test.ts 有 parity 断言，必须双侧同步删除。
2. **`appearance.background` / `appearance.foreground` / `appearance.contrast` 键也删除**：这些键在 `entries` 段是双语共用的，仅在 `zhOverrides` 段有单边残留。`appearance.colors*` 整段已删（`colors` 卡片被整体移除），而 `background`/`foreground`/`contrast` 是挂在 `colors` 卡片下的，逻辑上同命运，应一并删以免死键残留。
3. **`STATUS_KEYS.archived` 保留**：在 `AgentsPanel` 与 runtime event 类型中仍可能命中，保守不删。
4. **测试重构而非删除**：用现有结构重写断言，避免降低覆盖率。
5. **`AgentCard` 未用 props 清理**：以 lint 干净为目的（小型清理，与本次计划主题一致）。

## Verification

- `vp install` 拉依赖（如未拉）
- `vp check` 通过（lint + format + type）
- `vp test` 通过（settings.test / theme.test / i18n.test）
- 手动启动应用，进入"设置 → 外观"：不再有"颜色"或"强调色"卡片
- "风格"卡片可点 5 项
- 字体选择器下拉显示正常中文（"Inter / 苹方黑体"）
- 智能体页只剩"可用"+"草稿"两个 Tab
- 回收站智能体行有"恢复"+"永久删除"两个按钮
