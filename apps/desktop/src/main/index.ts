import { app, shell, BrowserWindow, ipcMain } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";
import { initDb, closeDb } from "./lib/db";
import { startServer, stopServer } from "./server";
import { registerIpcHandlers } from "./ipc";

function createWindow(): BrowserWindow {
  // 创建浏览器窗口
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  // HMR for renderer based on electron-vite cli.
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    void mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return mainWindow;
}

// 应用就绪后初始化所有子系统
void app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.void-ai");

  // 默认在开发环境用 F12 打开 DevTools，生产环境忽略 Cmd/Ctrl+R
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // 1. 初始化数据库（node:sqlite，实验性 API，需 flag 启用）
  //    通过 NODE_OPTIONS 或环境变量在启动前已设置 --experimental-sqlite
  try {
    initDb();
    console.log("[main] 数据库已初始化");
  } catch (err) {
    // 注意：electron-vite dev 下 stderr 偶发不刷新，改用 console.log 确保可见
    console.log("[main] 数据库初始化失败:", err);
  }

  // 2. 启动本地 HTTP 服务（用于 AI SDK 流式通信）
  try {
    const port = await startServer();
    console.log(`[main] AI 服务端口: ${port}`);
  } catch (err) {
    console.error("[main] AI 服务启动失败:", err);
  }

  // 3. 注册 IPC handlers
  const mainWindow = createWindow();
  registerIpcHandlers(mainWindow);

  // IPC test（保留模板自带的 ping）
  ipcMain.on("ping", () => console.log("pong"));

  app.on("activate", function () {
    // macOS 上点击 dock 图标时若无窗口则重建
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 所有窗口关闭时退出（macOS 除外）
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// 应用退出前清理资源
app.on("before-quit", () => {
  stopServer();
  closeDb();
});

// 其余 main 进程代码可以拆分到独立文件并在此 require
