import { BrowserWindow, ipcMain, screen } from "electron";
import {
  DEFAULT_DESKTOP_PET_WINDOW,
  type DesktopPetConfig,
  type DesktopPetConfigPatch,
  type DesktopPetSnapshot,
} from "../../shared/types";
import {
  getDesktopPetSnapshot,
  isDesktopPetEnabled,
  setDesktopPetEnabled,
  updateDesktopPetConfig,
} from "./db";
import {
  clampDesktopPetBounds,
  moveDesktopPetBounds,
  type DesktopPetBounds,
  type DesktopPetDisplayBounds,
} from "./desktop-pet-bounds";

export const DESKTOP_PET_OPEN_CONVERSATION_CHANNEL = "desktopPet:openConversation";
export const DESKTOP_PET_OPEN_SETTINGS_CHANNEL = "desktopPet:openSettings";
export const DESKTOP_PET_OPEN_ABOUT_CHANNEL = "desktopPet:openAbout";

/**
 * 展开/收起桌宠时窗口大小的硬性范围。
 * 下限 = 球本身能塞下的最小值；上限 = 防止设置异常导致窗口飞出屏幕。
 */
const RESIZE_MIN_PX = 100;
const RESIZE_MAX_PX = 800;

interface DesktopPetWindowControllerOptions {
  getMainWindow: () => BrowserWindow;
  preloadPath: string;
  rendererFilePath: string;
  rendererDevUrl?: string;
  /** 渲染层触发右键菜单时调用 */
  onContextMenu?: (win: BrowserWindow) => void;
  /** 桌宠需要"打开主窗口设置面板"时调用 */
  openMainSettings?: () => void;
  /** 桌宠需要"打开关于对话框"时调用 */
  openAbout?: () => void;
  /** 桌宠需要"真正退出应用"时调用 */
  quitApp?: () => void;
  /** 同步托盘菜单状态 */
  syncTrayMenu?: () => void;
}

export class DesktopPetWindowController {
  private petWindow: BrowserWindow | null = null;
  private saveBoundsTimer: ReturnType<typeof setTimeout> | null = null;
  private closingFromApi = false;
  private isAppQuitting = false;

  constructor(private readonly options: DesktopPetWindowControllerOptions) {}

  registerIpcHandlers(): void {
    ipcMain.handle("desktopPet:getSnapshot", () => getDesktopPetSnapshot());
    ipcMain.handle("desktopPet:setEnabled", (_event, enabled: boolean) =>
      this.setEnabled(Boolean(enabled)),
    );
    ipcMain.handle("desktopPet:updateConfig", (_event, patch: DesktopPetConfigPatch) =>
      this.updateConfig(patch),
    );
    ipcMain.handle("desktopPet:show", () => this.show());
    ipcMain.handle("desktopPet:hide", () => this.hide());
    ipcMain.handle("desktopPet:resetPosition", () => this.resetPosition());
    ipcMain.handle("desktopPet:moveWindowBy", (_event, delta: { dx?: unknown; dy?: unknown }) =>
      this.moveWindowBy(delta),
    );
    ipcMain.handle("desktopPet:openMain", (_event, conversationId?: string) =>
      this.openMain(conversationId),
    );
    ipcMain.handle("desktopPet:showContextMenu", () => this.showContextMenu());
    ipcMain.handle("desktopPet:setFrameRate", (_event, fps: number) => this.setFrameRate(fps));
    ipcMain.handle(
      "desktopPet:setWindowSize",
      (_event, size: { width?: unknown; height?: unknown }) => this.setWindowSize(size),
    );
    ipcMain.handle("desktopPet:setIgnoreMouseEvents", (_event, ignore: boolean) =>
      this.setIgnoreMouseEvents(Boolean(ignore)),
    );
  }

  async restoreIfEnabled(): Promise<void> {
    if (!isDesktopPetEnabled()) return;
    await this.ensureWindow(getDesktopPetSnapshot());
  }

  async setEnabled(enabled: boolean): Promise<DesktopPetSnapshot> {
    if (enabled) return this.show();
    return this.hide();
  }

  async show(): Promise<DesktopPetSnapshot> {
    const snapshot = setDesktopPetEnabled(true);
    await this.ensureWindow(snapshot);
    this.options.syncTrayMenu?.();
    return getDesktopPetSnapshot();
  }

  async hide(): Promise<DesktopPetSnapshot> {
    const snapshot = setDesktopPetEnabled(false);
    this.closePetWindow();
    this.options.syncTrayMenu?.();
    return snapshot;
  }

  async updateConfig(patch: DesktopPetConfigPatch): Promise<DesktopPetSnapshot> {
    const snapshot = updateDesktopPetConfig(patch);
    if (this.petWindow && !this.petWindow.isDestroyed()) {
      this.applyWindowConfig(snapshot.config);
    }
    return snapshot;
  }

  async resetPosition(): Promise<DesktopPetSnapshot> {
    return this.updateConfig({ window: { x: undefined, y: undefined } });
  }

  async moveWindowBy(delta: { dx?: unknown; dy?: unknown }): Promise<boolean> {
    if (!this.petWindow || this.petWindow.isDestroyed()) return false;
    const dx = typeof delta.dx === "number" && Number.isFinite(delta.dx) ? delta.dx : 0;
    const dy = typeof delta.dy === "number" && Number.isFinite(delta.dy) ? delta.dy : 0;
    if (dx === 0 && dy === 0) return true;

    const current = this.petWindow.getBounds();
    const snapshot = getDesktopPetSnapshot();
    const nextBounds = getMovedDesktopPetBounds(snapshot.config, current, { dx, dy });

    this.petWindow.setBounds(nextBounds);
    this.scheduleBoundsSave();
    return true;
  }

  async openMain(conversationId?: string): Promise<boolean> {
    const snapshot = getDesktopPetSnapshot();
    const targetConversationId = conversationId ?? snapshot.config.conversationId;
    const mainWindow = this.options.getMainWindow();

    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();

    const send = (): void => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(DESKTOP_PET_OPEN_CONVERSATION_CHANNEL, targetConversationId);
      }
    };

    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once("did-finish-load", send);
    } else {
      send();
    }

    return true;
  }

  /** 由 IPC 触发，在桌宠窗口位置弹出原生右键菜单 */
  showContextMenu(): void {
    if (!this.petWindow || this.petWindow.isDestroyed()) return;
    this.options.onContextMenu?.(this.petWindow);
  }

  /**
   * 内存优化：渲染层在 sleep 状态下请求降到 1fps。
   * 1~60 之间有效，1 表示最省电，60 表示流畅。
   */
  setFrameRate(fps: number): boolean {
    if (!this.petWindow || this.petWindow.isDestroyed()) return false;
    const clamped = Math.max(1, Math.min(60, Math.round(fps)));
    this.petWindow.webContents.setFrameRate(clamped);
    return true;
  }

  /**
   * 渲染层（点开 / 收起对话气泡）触发的窗口尺寸调整。
   *
   * 关键约束：
   * - 桌宠"右下角"必须固定不动，否则展开 / 收起时球会跳位置。
   * - **不**把 size 写回 config。db 里的 width/height 始终代表
   *   "桌宠默认尺寸"，下次启动一定是 128×128，不会被展开态污染。
   *   mount 时 useEffect 强制 setSize(DEFAULT) 会把任何老 db 残留
   *   （比如 280×360）收回去。
   * - 软 clamp：让新尺寸"基本"在屏幕内（保留 80px 可见），避免聊天区
   *   被推到完全看不到的地方。
   */
  setWindowSize(size: { width?: unknown; height?: unknown }): boolean {
    if (!this.petWindow || this.petWindow.isDestroyed()) return false;
    const width = clampInt(size.width, RESIZE_MIN_PX, RESIZE_MAX_PX);
    const height = clampInt(size.height, RESIZE_MIN_PX, RESIZE_MAX_PX);
    if (width === null || height === null) return false;

    const current = this.petWindow.getBounds();
    // 右下角保持不动 → 新左上 = 旧右下 - 新尺寸
    const desiredX = current.x + current.width - width;
    const desiredY = current.y + current.height - height;

    // 软 clamp：保证至少 80px 可见，避免聊天完全跑出屏幕
    const displays = screen.getAllDisplays().map((display) => display.workArea);
    const activeDisplay =
      displays.find((display) => pointInDesktopPetDisplay(display, current)) ??
      screen.getPrimaryDisplay().workArea;
    const KEEP_VISIBLE_PX = 80;
    const minX = activeDisplay.x - width + KEEP_VISIBLE_PX;
    const maxX = activeDisplay.x + activeDisplay.width - KEEP_VISIBLE_PX;
    const minY = activeDisplay.y - height + KEEP_VISIBLE_PX;
    const maxY = activeDisplay.y + activeDisplay.height - KEEP_VISIBLE_PX;
    const newX = Math.min(maxX, Math.max(minX, desiredX));
    const newY = Math.min(maxY, Math.max(minY, desiredY));

    const finalX = Math.round(newX);
    const finalY = Math.round(newY);
    this.petWindow.setBounds({ x: finalX, y: finalY, width, height });

    // 只在位置被软 clamp 调整过时写回 config（修正位置）。
    // size 永远不写：db 里的 size 始终等于 DEFAULT，下次回 mount 又是干净的。
    if (finalX !== current.x || finalY !== current.y) {
      this.persistPositionOnly(finalX, finalY);
    }
    return true;
  }

  /**
   * 透明窗口点击穿透的核心：动态切换 setIgnoreMouseEvents。
   *
   * 背景：Electron transparent BrowserWindow 在 Windows/macOS 上，
   * 即便 CSS 把 body/#root 设成 pointer-events: none，OS 层级
   * 整个窗口 bounds 仍会拦截鼠标点击——表现就是"半屏被遮挡无法点击"。
   * 必须显式调 setIgnoreMouseEvents(true) 才能让点击真正穿透到底下 app。
   *
   * - ignore=true + forward=true：窗口忽略点击（穿透），但 mousemove
   *   仍转发给渲染层，渲染层据此检测鼠标何时进入桌宠可视区，再切回
   *   ignore=false 恢复交互。
   * - ignore=false：窗口正常接收事件，球可拖动 / 点击 / hover。
   *
   * 渲染层在 document 上监听 mousemove 做动态切换（见 DesktopPetApp.tsx）。
   */
  setIgnoreMouseEvents(ignore: boolean): boolean {
    if (!this.petWindow || this.petWindow.isDestroyed()) return false;
    // forward 仅在 ignore=true 时有意义；ignore=false 时窗口本就接收事件。
    this.petWindow.setIgnoreMouseEvents(ignore, { forward: true });
    return true;
  }

  /** 仅持久化窗口位置（不写尺寸），用于 setWindowSize 软 clamp 后 */
  private persistPositionOnly(x: number, y: number): void {
    try {
      const snapshot = getDesktopPetSnapshot();
      const w = snapshot.config.window;
      updateDesktopPetConfig({
        window: {
          x,
          y,
          width: w.width,
          height: w.height,
          alwaysOnTop: w.alwaysOnTop,
          scale: w.scale,
          opacity: w.opacity,
        },
      });
    } catch (err) {
      console.error("[desktop-pet] failed to save position after resize:", err);
    }
  }

  prepareForAppQuit(): void {
    this.isAppQuitting = true;
    this.flushBoundsSave();
  }

  private async ensureWindow(snapshot: DesktopPetSnapshot): Promise<BrowserWindow> {
    if (this.petWindow && !this.petWindow.isDestroyed()) {
      this.applyWindowConfig(snapshot.config);
      this.petWindow.show();
      return this.petWindow;
    }

    const bounds = getClampedDesktopPetBounds(snapshot.config);
    // 关键：用 DEFAULT 尺寸（128×128）创建 BrowserWindow，**不**用 db 残留
    // 的 width/height。否则老用户从 280×360 的 db 启动时，BrowserWindow 物理
    // bounds 一开始就是 280×360，渲染层 mount 后虽然 useEffect 会调
    // setSize 收回去，但中间有几十 ms 的"红色大框"可见。
    // 注意：位置（x/y）仍读 config，保留用户上次拖到的位置。
    const initialWidth = DEFAULT_DESKTOP_PET_WINDOW.width;
    const initialHeight = DEFAULT_DESKTOP_PET_WINDOW.height;
    const win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: initialWidth,
      height: initialHeight,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: snapshot.config.window.alwaysOnTop,
      // 桌宠窗口不参与任务切换；不抢焦点影响其他窗口
      focusable: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      title: "Void desktop pet",
      webPreferences: {
        preload: this.options.preloadPath,
        sandbox: false,
        // 内存优化：禁用背景节流（桌宠窗口始终可见）
        backgroundThrottling: false,
      },
    });

    this.petWindow = win;

    win.on("ready-to-show", () => {
      if (!win.isDestroyed()) {
        // 在 not-focusable=false 时，show() 会自动抢焦点。
        // 桌宠场景下我们希望它只是"出现"，不夺焦点。
        // Electron 没有直接 API：使用 showInactive() 避免抢焦点。
        win.showInactive();
        // 内存优化：默认 60fps；sleep 状态下渲染层会请求降到 1fps。
        win.webContents.setFrameRate(60);
        // 关键：初始即让透明区域点击穿透。否则窗口刚 show 时整块 180×180
        // 会挡住底下 app（渲染层 mousemove 接管前有一段"全挡"空窗期）。
        // forward=true 保证 mousemove 仍转发，渲染层据此动态切换。
        win.setIgnoreMouseEvents(true, { forward: true });
      }
    });
    win.on("move", () => this.scheduleBoundsSave());
    win.on("closed", () => {
      this.petWindow = null;
      if (!this.closingFromApi && !this.isAppQuitting) {
        setDesktopPetEnabled(false);
        this.options.syncTrayMenu?.();
      }
      this.closingFromApi = false;
    });

    await this.loadPetRenderer(win);
    return win;
  }

  private applyWindowConfig(config: DesktopPetConfig): void {
    if (!this.petWindow || this.petWindow.isDestroyed()) return;
    const bounds = getClampedDesktopPetBounds(config);
    this.petWindow.setAlwaysOnTop(config.window.alwaysOnTop);
    // 关键：只动 position（x/y），不强制 setBounds size。
    // BrowserWindow 的 size 由 setWindowSize 单独管（用户可见的视图状态），
    // 这里的 applyWindowConfig 来自 settings tab 修改，仅同步位置/alwaysOnTop/不透明度。
    const current = this.petWindow.getBounds();
    this.petWindow.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: current.width,
      height: current.height,
    });
    // 透明度：0~255 整数
    const opacity = Math.max(0, Math.min(255, Math.round(config.window.opacity * 255)));
    this.petWindow.setOpacity(opacity / 255);
    // scale 通过 CSS 在渲染层处理（--pet-scale 变量）
    this.petWindow.webContents.send("desktopPet:configApplied", config);
  }

  private closePetWindow(): void {
    if (this.saveBoundsTimer) {
      clearTimeout(this.saveBoundsTimer);
      this.saveBoundsTimer = null;
    }
    if (!this.petWindow || this.petWindow.isDestroyed()) return;
    this.closingFromApi = true;
    this.petWindow.close();
  }

  private scheduleBoundsSave(): void {
    if (!this.petWindow || this.petWindow.isDestroyed()) return;
    if (this.saveBoundsTimer) clearTimeout(this.saveBoundsTimer);
    this.saveBoundsTimer = setTimeout(() => {
      this.saveBoundsTimer = null;
      this.flushBoundsSave();
    }, 250);
  }

  private flushBoundsSave(): void {
    if (this.saveBoundsTimer) {
      clearTimeout(this.saveBoundsTimer);
      this.saveBoundsTimer = null;
    }
    if (!this.petWindow || this.petWindow.isDestroyed()) return;
    const bounds = this.petWindow.getBounds();
    try {
      const current = getDesktopPetSnapshot().config.window;
      // 关键：只持久化位置，不写 width/height。
      // 展开/收起时窗口物理尺寸会变（128 → 280 等），
      // 但 config 里的 width/height 始终代表"默认尺寸"，下次启动仍按 128 出来。
      updateDesktopPetConfig({
        window: {
          x: bounds.x,
          y: bounds.y,
          width: current.width,
          height: current.height,
          alwaysOnTop: current.alwaysOnTop,
          scale: current.scale,
          opacity: current.opacity,
        },
      });
    } catch (err) {
      console.error("[desktop-pet] failed to save bounds:", err);
    }
  }

  private async loadPetRenderer(win: BrowserWindow): Promise<void> {
    if (this.options.rendererDevUrl) {
      await win.loadURL(`${this.options.rendererDevUrl}?surface=pet`);
      return;
    }
    await win.loadFile(this.options.rendererFilePath, { query: { surface: "pet" } });
  }
}

export function getClampedDesktopPetBounds(config: DesktopPetConfig): DesktopPetBounds {
  const displays = screen.getAllDisplays().map((display) => display.workArea);
  return clampDesktopPetBounds(config, displays, screen.getPrimaryDisplay().workArea);
}

export function getMovedDesktopPetBounds(
  config: DesktopPetConfig,
  current: DesktopPetBounds,
  delta: { dx: number; dy: number },
): DesktopPetBounds {
  const displays = screen.getAllDisplays().map((display) => display.workArea);
  return moveDesktopPetBounds(
    config,
    current,
    delta,
    displays,
    screen.getPrimaryDisplay().workArea,
  );
}

/**
 * 校验一个数字是否在 [min, max] 区间内。是则返回整数（四舍五入），
 * 否则返回 null。供 IPC 参数清洗使用——任何"非法值"必须被丢弃而不是
 * 静默接受。
 */
function clampInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) return null;
  return rounded;
}

/** 判断点 (x, y) 是否在某个 display 工作区内 */
function pointInDesktopPetDisplay(
  display: DesktopPetDisplayBounds,
  point: { x: number; y: number },
): boolean {
  return (
    point.x >= display.x &&
    point.x <= display.x + display.width &&
    point.y >= display.y &&
    point.y <= display.y + display.height
  );
}
