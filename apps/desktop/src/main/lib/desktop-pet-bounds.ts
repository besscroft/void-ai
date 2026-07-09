import type { DesktopPetConfig } from "../../shared/types";

export interface DesktopPetDisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopPetBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 拖动时 pet 必须保留在屏幕内的最小可见像素。
 *
 * 50px 是个保守值 —— 用户既能感知到 pet 还在屏幕里，
 * 又能把 pet 拖到屏幕几乎任意一个角落（甚至大部分越界）。
 */
const KEEP_VISIBLE_PX = 50;

export function clampDesktopPetBounds(
  config: DesktopPetConfig,
  displays: DesktopPetDisplayBounds[],
  fallbackDisplay: DesktopPetDisplayBounds,
): DesktopPetBounds {
  const width = config.window.width;
  const height = config.window.height;
  const display =
    displays.find((item) => pointInBounds(config.window.x, config.window.y, item)) ??
    fallbackDisplay;
  const defaultX = display.x + display.width - width - 24;
  const defaultY = display.y + display.height - height - 24;
  // 初始化/重置位置时仍然把 pet 完全放进屏幕内（更安全）
  const minX = display.x;
  const maxX = display.x + Math.max(0, display.width - width);
  const minY = display.y;
  const maxY = display.y + Math.max(0, display.height - height);

  return {
    x: clampCoordinate(config.window.x ?? defaultX, minX, maxX),
    y: clampCoordinate(config.window.y ?? defaultY, minY, maxY),
    width,
    height,
  };
}

export function moveDesktopPetBounds(
  _config: DesktopPetConfig,
  current: DesktopPetBounds,
  delta: { dx: number; dy: number },
  displays: DesktopPetDisplayBounds[],
  fallbackDisplay: DesktopPetDisplayBounds,
): DesktopPetBounds {
  // _config 保留作为 API 形参（与其他 clamp 函数签名一致），内部不再使用
  // 因为拖动时只需要 current bounds 和 display 范围，不需要 config.window
  void _config;
  // 关键：基于"当前位置"找 display，而不是基于"目标位置"。
  // 原因：目标位置（current + delta）可能临时越界（renderer 持续发送
  // 越界 dx），pointInBounds 会返回 false，fallback 到 primary display，
  // clamp 范围错位，导致窗口被持续推到错误方向。
  const display =
    displays.find((item) => pointInBounds(current.x, current.y, item)) ?? fallbackDisplay;

  // 拖动时允许 pet 越过屏幕边缘，但必须保证至少 KEEP_VISIBLE_PX 像素在
  // 屏幕内可见。这样：
  //   - 鼠标在屏幕中央拖动时，pet 完全跟手
  //   - 鼠标到达屏幕边缘时，pet 也到达屏幕边缘（不会被"硬挡"）
  //   - 但 pet 永远不会被完全推出屏幕外（用户始终能拖回来）
  const minX = display.x - current.width + KEEP_VISIBLE_PX;
  const maxX = display.x + display.width - KEEP_VISIBLE_PX;
  const minY = display.y - current.height + KEEP_VISIBLE_PX;
  const maxY = display.y + display.height - KEEP_VISIBLE_PX;

  const targetX = current.x + delta.dx;
  const targetY = current.y + delta.dy;
  const newX = clampCoordinate(targetX, minX, maxX);
  const newY = clampCoordinate(targetY, minY, maxY);

  return {
    x: newX,
    y: newY,
    width: current.width,
    height: current.height,
  };
}

function pointInBounds(
  x: number | undefined,
  y: number | undefined,
  bounds: DesktopPetDisplayBounds,
): boolean {
  if (x === undefined || y === undefined) return false;
  return (
    x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height
  );
}

function clampCoordinate(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}
