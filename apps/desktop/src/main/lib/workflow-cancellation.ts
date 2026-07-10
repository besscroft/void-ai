/**
 * 工作流运行取消：维护 runId -> AbortController 的映射，
 * 外部（IPC / HTTP）调用 cancelWorkflowRun 时 abort 对应的 controller，
 * 引擎在循环中检测到 abort 后把 run 标记为 cancelled。
 */

const controllers = new Map<string, AbortController>();

/** 由引擎在开始执行时调用，注册一个新的 controller 并返回其 signal。 */
export function attachWorkflowController(runId: string): {
  signal: AbortSignal;
  controller: AbortController;
} {
  const existing = controllers.get(runId);
  if (existing) return { signal: existing.signal, controller: existing };
  const controller = new AbortController();
  controllers.set(runId, controller);
  controller.signal.addEventListener(
    "abort",
    () => {
      // run 结束或 cancel 后延时清理，让观察者仍能读到 abort 状态
      setTimeout(() => {
        if (controllers.get(runId) === controller) controllers.delete(runId);
      }, 5_000);
    },
    { once: true },
  );
  return { signal: controller.signal, controller };
}

/** 外部 cancel：返回是否成功 abort。 */
export function cancelWorkflowRun(runId: string): boolean {
  const controller = controllers.get(runId);
  if (!controller) return false;
  controller.abort();
  return true;
}

/** 引擎结束时主动清理。 */
export function detachWorkflowController(runId: string): void {
  controllers.delete(runId);
}

/** 测试 / 调试：当前活跃的 run 数。 */
export function activeWorkflowCount(): number {
  return controllers.size;
}
