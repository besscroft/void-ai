#!/usr/bin/env node
/**
 * 重建 better-sqlite3 原生模块以匹配 Electron 的 ABI
 *
 * 背景：
 *   better-sqlite3 的 install 脚本默认按当前 Node.js 运行时下载 prebuild，
 *   而 Electron 的 ABI 与 Node.js 不同（如 Node 22 → ABI 127，Electron 39 → ABI 140），
 *   直接运行会导致 ERR_DLOPEN_FAILED。
 *
 *   常规修复方式 electron-builder install-app-deps 在 pnpm workspace 下
 *   无法扫描到 .pnpm/<pkg>/node_modules/ 真实路径，会空跑 "finished"。
 *
 * 做法：
 *   1. 通过 require.resolve 定位 better-sqlite3 真实目录（符号链接会被跟随）
 *   2. 从 better-sqlite3 的依赖树里找到 prebuild-install
 *   3. 读取项目依赖的 electron 版本
 *   4. 调用 prebuild-install 下载对应 Electron ABI 的 prebuild 覆盖之
 */
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// 1. 定位 better-sqlite3 真实安装路径
const betterSqlite3PkgPath = require.resolve("better-sqlite3/package.json");
const betterSqlite3Dir = path.dirname(betterSqlite3PkgPath);
const betterSqlite3Version = require(betterSqlite3PkgPath).version;

// 2. 从 better-sqlite3 的依赖树里解析 prebuild-install（避免 pnpm 提升策略差异）
const prebuildInstallBin = require.resolve("prebuild-install/bin.js", {
  paths: [betterSqlite3Dir],
});

// 3. 读取当前项目依赖的 Electron 版本
const electronVersion = require("electron/package.json").version;

// 4. 调用 prebuild-install 下载对应 Electron ABI 的预编译版本
console.info(
  `[rebuild] better-sqlite3@${betterSqlite3Version} → electron@${electronVersion} (${process.platform}/${process.arch})`,
);

try {
  execFileSync(
    process.execPath,
    [
      prebuildInstallBin,
      "--runtime",
      "electron",
      "--target",
      electronVersion,
      "--arch",
      process.arch,
      "--platform",
      process.platform,
    ],
    {
      cwd: betterSqlite3Dir,
      stdio: "inherit",
    },
  );
  console.info("[rebuild] ✓ 完成");
} catch (err) {
  console.error("[rebuild] ✗ 失败:", err.message);
  process.exit(1);
}
