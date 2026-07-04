/**
 * 轻量 className 合并工具
 *
 * 复刻 shadcn/cn 的行为：
 *  - 过滤掉 falsy 值（false / null / undefined / 0 / ""）
 *  - 合并多个类名字符串，支持条件表达式
 *  - 使用本地简化版 tailwind-merge，避免引入新依赖
 *
 * 为什么不直接用 tailwind-merge：
 *  tailwind-merge 是一个相对庞大的包（约 30KB），仅做"同组类名互相覆盖"的工作。
 *  本项目类名组合相对简单（不使用同组覆盖），用 split(" ") 即可达到效果。
 */
export function cn(...inputs: Array<string | false | null | undefined>): string {
  return inputs.filter((value): value is string => Boolean(value)).join(" ");
}
