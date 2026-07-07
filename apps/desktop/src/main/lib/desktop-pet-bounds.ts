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
