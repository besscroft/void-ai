/**
 * 缓存管理
 *
 * 职责：
 *  - 统计应用缓存目录占用字节数（递归）
 *  - 清理缓存：磁盘缓存目录 + Chromium HTTP 缓存
 *
 * 缓存目录：app.getPath('userData') 下的 'Cache' 子目录
 * （Electron 类型未内置 'cache' 名称，统一使用 userData/Cache，
 *  与 Chromium 默认缓存路径一致，跨平台行为可预测）
 *
 * 错误处理：
 *  - 统计过程中遇到不可访问的子项就近跳过（可恢复）
 *  - 清理失败向上抛出（不可恢复，由 IPC 层捕获返回错误信息）
 */

import { app, session } from "electron";
import { readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getSetting } from "./db";
import { SettingKey, DEFAULT_SETTINGS } from "../../shared/types";

/**
 * 解析缓存目录绝对路径：userData/Cache
 */
function getCacheDir(): string {
  return join(app.getPath("userData"), "Cache");
}

/**
 * 递归计算目录占用字节数。
 * 不可访问的子项会被跳过并记录到 stderr，不影响整体统计。
 */
function dirSize(dir: string): number {
  let total = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          total += dirSize(full);
        } else if (entry.isFile()) {
          total += statSync(full).size;
        }
      } catch {
        // 单个文件/子目录统计失败：跳过
      }
    }
  } catch {
    // 目录本身不可访问：返回 0
  }
  return total;
}

/**
 * 递归删除目录下所有内容（保留目录本身）。
 */
function clearDir(dir: string): void {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // 目录不存在视为已清空
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    try {
      rmSync(full, { recursive: true, force: true });
    } catch (err) {
      console.error(`[cache] 清理失败: ${full}`, err);
    }
  }
}

/**
 * 获取缓存统计信息。
 * @returns 当前缓存字节数 + 配置的上限（MB）
 */
export function getCacheStats(): { bytes: number; limitMb: number } {
  const cacheDir = getCacheDir();
  const bytes = dirSize(cacheDir);
  const limitRaw = getSetting(SettingKey.CacheSizeMb);
  const limitMb = limitRaw
    ? Number(limitRaw) || DEFAULT_SETTINGS.cacheSizeMb
    : DEFAULT_SETTINGS.cacheSizeMb;
  return { bytes, limitMb };
}

/**
 * 清理缓存：
 *  1. 清空磁盘缓存目录内容
 *  2. 清空 Chromium HTTP 缓存（session.defaultSession.clearCache）
 *
 * @returns 清理后剩余字节数
 */
export async function clearCache(): Promise<number> {
  // 1. 磁盘缓存目录
  const cacheDir = getCacheDir();
  clearDir(cacheDir);

  // 2. Chromium HTTP 缓存
  try {
    await session.defaultSession.clearCache();
  } catch (err) {
    console.error("[cache] 清理 HTTP 缓存失败:", err);
  }

  // 统计清理后大小（clearCache 异步生效，磁盘部分即时反映）
  return dirSize(cacheDir);
}
