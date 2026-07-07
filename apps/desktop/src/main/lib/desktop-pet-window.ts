import { BrowserWindow, ipcMain, screen } from "electron";
import type {
  DesktopPetConfig,
  DesktopPetConfigPatch,
  DesktopPetSnapshot,
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
} from "./desktop-pet-bounds";

export const DESKTOP_PET_OPEN_CONVERSATION_CHANNEL = "desktopPet:openConversation";

interface DesktopPetWindowControllerOptions {
  getMainWindow: () => BrowserWindow;
  preloadPath: string;
  rendererFilePath: string;
  rendererDevUrl?: string;
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
    return getDesktopPetSnapshot();
  }

  async hide(): Promise<DesktopPetSnapshot> {
    const snapshot = setDesktopPetEnabled(false);
    this.closePetWindow();
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
    const win = new BrowserWindow({
      ...bounds,
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
      backgroundColor: "#00000000",
      hasShadow: false,
      title: "Void desktop pet",
      webPreferences: {
        preload: this.options.preloadPath,
        sandbox: false,
      },
    });

    this.petWindow = win;

    win.on("ready-to-show", () => {
      if (!win.isDestroyed()) win.show();
    });
    win.on("move", () => this.scheduleBoundsSave());
    win.on("closed", () => {
      this.petWindow = null;
      if (!this.closingFromApi && !this.isAppQuitting) setDesktopPetEnabled(false);
      this.closingFromApi = false;
    });

    await this.loadPetRenderer(win);
    return win;
  }

  private applyWindowConfig(config: DesktopPetConfig): void {
    if (!this.petWindow || this.petWindow.isDestroyed()) return;
    const bounds = getClampedDesktopPetBounds(config);
    this.petWindow.setAlwaysOnTop(config.window.alwaysOnTop);
    this.petWindow.setBounds(bounds);
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
      updateDesktopPetConfig({
        window: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          alwaysOnTop: getDesktopPetSnapshot().config.window.alwaysOnTop,
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
