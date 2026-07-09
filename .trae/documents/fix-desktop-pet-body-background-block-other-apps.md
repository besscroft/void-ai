# 修复桌宠 body 背景挡住其它 app

## 1. Summary

桌宠 BrowserWindow 在拖动时"看上去越来越大、还会挡住其它软件"，根因是 `body` 在桌宠 entry 下仍是 `background-color: var(--color-background)`（接近白色 `oklch(0.985 0 0)`），撑满整个 180×180 BrowserWindow。视觉上球外面有一大圈浅色块盖在其它 app 上面，让人以为"范围很大 / 挡视野"。

最小修复：在 `html[data-surface="pet"]` 作用域下把 `body` 和 `#root` 的 `background-color` 显式设为 `transparent`，让 BrowserWindow 的透明区域真正"透"出去。**不动** BrowserWindow 物理 bounds、拖动逻辑、clamp 规则、debug 颜色。

## 2. Current State Analysis

### 关键文件

- [main.css](file:///c:/github/void-ai/apps/desktop/src/renderer/src/assets/main.css)
  - 第 249-257 行：`body { background-color: var(--color-background); ... }`，浅色主题下 ≈ 接近白色
  - 第 241-247 行：`html, body, #root { height: 100%; }`，body 撑满整个 BrowserWindow
  - 第 271-273 行：`.desktop-pet-root { background-color: rgba(255, 82, 82, 0.35); }`（debug 红色，保留）
  - 第 296-301 行：`html[data-surface="pet"] body, html[data-surface="pet"] #root { pointer-events: none; position: relative; }` —— **只**覆盖了 pointer-events，**没**覆盖 background-color

- [DesktopPetApp.tsx](file:///c:/github/void-ai/apps/desktop/src/renderer/src/components/DesktopPetApp.tsx)
  - 第 94-99 行：mount 时强制 `setWindowSize(DEFAULT)`，把任何 db 残留大尺寸收回
  - 第 224-229 行：`<div className="desktop-pet-root absolute bottom-0 right-0 flex flex-col items-center gap-1 bg-transparent p-1 ...">` —— root 用 `absolute` 不撑满 BrowserWindow，**只**包住"球 + 状态文字"

- [desktop-pet-window.ts](file:///c:/github/void-ai/apps/desktop/src/main/lib/desktop-pet-window.ts)
  - 第 261-289 行：`ensureWindow` 强制 `initialWidth = DEFAULT_DESKTOP_PET_WINDOW.width`、`initialHeight = height`，**不**用 db 残留
  - 第 118-131 行：`moveWindowBy` 用 `current.width/height` 不变 size
  - 第 317-336 行：`applyWindowConfig` 也用 `current.width/height` 不变 size
  - 第 357-383 行：`flushBoundsSave` 只写 position，**不**写 width/height

- [desktop-pet-bounds.ts](file:///c:/github/void-ai/apps/desktop/src/main/lib/desktop-pet-bounds.ts)
  - 第 73-76 行：拖动时 KEEP_VISIBLE_PX = 50
  - 第 83-88 行：返回 `{ x: newX, y: newY, width: current.width, height: current.height }` —— size 永远不变

- [shared/types.ts](file:///c:/github/void-ai/apps/desktop/src/shared/types.ts) 第 879-885 行
  - `DEFAULT_DESKTOP_PET_WINDOW = { width: 180, height: 180, alwaysOnTop: false, scale: 1, opacity: 1 }`

### 根因（精确）

```
桌宠 entry 下：
  html[data-surface="pet"] body {
    background-color: var(--color-background);  ← 来自 line 251，未被覆盖
    /* pointer-events: none; */                ← 来自 line 298
  }
  body 撑满 BrowserWindow（180×180）
  + .desktop-pet-root 自己的 layout box ≈ 球+状态文字 ≈ 100×100
  → 视觉上"180×180 浅色 body 背景 + 中心 100×100 root 红色"两块拼起来
  → 用户看到"灰白色块在球外面一圈" + 球的 box-shadow 60px 模糊
  → 觉得"范围很大、挡住其它 app"
```

`pointer-events: none` 已经让事件穿透（**不会**真挡点击），但**视觉**上 body 的近白背景还在盖视野，用户的"挡住其它软件"是视觉感受。

### 为什么不是"真扩大"

- BrowserWindow 物理 bounds 从 `ensureWindow` 强制 DEFAULT 创建
- `moveWindowBy` / `applyWindowConfig` 都用 `current.width/height` 不改 size
- `flushBoundsSave` 不写 size
- `moveDesktopPetBounds` 也不改 size
- **size 真的没动过**，是 body 背景在 180×180 上"看起来大"

## 3. Proposed Changes

### Change 1：在 main.css 桌宠 entry 规则下加 `background-color: transparent`

**文件**：[main.css](file:///c:/github/void-ai/apps/desktop/src/renderer/src/assets/main.css) 第 296-301 行

**为什么**：让 `body` 和 `#root` 在 `html[data-surface="pet"]` 作用域下真正 transparent，BrowserWindow 的透明区域不再被近白色覆盖。

**怎么改**：在原有规则中加一行 `background-color: transparent;`

**改前**：

```css
html[data-surface="pet"] body,
html[data-surface="pet"] #root {
  pointer-events: none;
  /* 让 .desktop-pet-root 的 absolute 定位以 #root 为参照 */
  position: relative;
}
```

**改后**：

```css
html[data-surface="pet"] body,
html[data-surface="pet"] #root {
  /*
   * 主窗口下 body 有 background-color: var(--color-background)（line 251），
   * 否则主窗口会全黑。桌宠 entry 必须显式 transparent，
   * 否则 body 会撑满整个 180×180 BrowserWindow 并显示近白背景，
   * 在球外面盖一大圈浅色块——视觉上"占位大、挡住其它 app"。
   * pointer-events: none 让事件穿透，但视觉遮挡必须靠 transparent 消除。
   */
  background-color: transparent;
  pointer-events: none;
  /* 让 .desktop-pet-root 的 absolute 定位以 #root 为参照 */
  position: relative;
}
```

### Change 2（保留/不动）

- **保留**第 271-273 行的 debug 红色 `.desktop-pet-root { background-color: rgba(255, 82, 82, 0.35); }`（用户明确要求保留用来"看清楚问题"）
- **不动** BrowserWindow 物理 bounds / 创建逻辑
- **不动** `moveWindowBy` / `applyWindowConfig` / `setWindowSize` / `flushBoundsSave`
- **不动** `desktop-pet-bounds.ts` 的 clamp 规则（KEEP_VISIBLE_PX = 50 合理）
- **不动** `DesktopPetApp.tsx` 的 mount `setWindowSize(DEFAULT)` 兜底
- **不动** `bg-transparent` utility（root 上 utility 被 unlayered CSS 覆盖是预期行为）

## 4. Assumptions & Decisions

| 假设                                      | 依据                                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 根因是 body 背景而非 BrowserWindow bounds | 代码层证明 size 永远不变，body 背景在 180×180 上视觉遮挡                                                  |
| 用户描述的"越大"是视觉错觉（不是真扩大）  | code review 已证明 size 强制 DEFAULT，move/clamp/save 都不改 size                                         |
| debug 颜色必须保留                        | 用户明确："保留颜色是为了看清楚问题"                                                                      |
| 修一行 CSS 即可，不动 JS/TS               | 根因在 CSS 层，最小变更                                                                                   |
| 不需要拆出独立 chat overlay BrowserWindow | 用户最初同意"独立 BrowserWindow"方案，但根因不在这，**当前轮**优先修"body 挡视野"                         |
| 主窗口 body 背景不受影响                  | 选择器 `html[data-surface="pet"]` 只命中桌宠 entry，主窗口 entry 是 `data-surface="main"`，走不到这条规则 |

## 5. Verification

### 自动验证

1. `vp test` —— 跑 desktop-pet 单元测试（10/10 应继续通过）
2. `vp check` —— lint + type check

### 手动验证（按用户原描述顺序）

1. **"现在保留颜色是为了看清楚问题"** —— 启动桌宠，期望看到 debug 红色区域，**大小 ≈ 球**（100×100 左右），**不再**有外圈 180×180 的近白 body 块
2. **"为什么会有这么个大小"** —— 修复后 debug 红就是 root 容器的实际大小 ≈ 球大小；外圈 180×180 的 body 灰白消失，BrowserWindow 真正 transparent
3. **"越是拖动桌宠，它的范围越大"** —— 拖动后，debug 红色大小**不变**（始终 ≈ 球），**只**是位置在变
4. **"还会挡住其它软件的操作"** —— 拖到其它 app（如浏览器/IDE）上面，桌宠透明区域**视觉上**透出底下的 app，**不再**有"近白块挡视野"的感觉
5. **hit-testing 验证** —— 拖到桌宠透明区域的位置**仍然**能点击到底下的 app（pointer-events: none 一直在）

### 回归

- 主窗口的 body 背景仍然是 `var(--color-background)`（不被改动）
- 桌宠 mount 时的 `setWindowSize(DEFAULT)` 兜底逻辑保留
- 拖动 / 双击 / 状态机 / 音效 / 托盘 / 右键菜单行为不变
