# 工作流模块收尾：UI 形态调整（侧栏菜单 → Chat 页面悬浮框）

## Summary

把工作流模块的"侧栏菜单 + 独立页面"形态收掉，改为 chat 页面右上方一个可折叠的悬浮状态框。
后端编排引擎、交接流程、Handoff/Consult、approval/timeout、cancellation、DB schema **全部保留**——只是用户感知到的"工作流"入口消失，转为由系统在底层默认编排、chat 页面内显示状态。

不动特性：handoff/consult 行为、approval 决议、cancellation、retry/补偿、DB 持久化、i18n 字典其它键。

## Current State

- 侧栏 `AppShell.tsx:35-42` 暴露 `workflows` / `workflowRuns` 两个菜单项
- `MainPanelView.tsx:17` 暴露 `"workflows" | "workflowRuns"` 两个 section
- `MainPanelView.tsx:98-129` 内联 `WorkflowsPanel`（定义列表卡片）
- `MainPanelView.tsx:127-129` 引入 `WorkflowRunsPanel` 组件
- `WorkflowRunsPanel.tsx`（独立组件，135 行，含轮询/详情侧栏）
- `WorkflowRunDetail.tsx`（详情侧栏，依赖 `workflow-format.ts`）
- `workflow-format.ts` 纯渲染层辅助
- `preload/index.ts:67-80` 暴露 `api.workflows.*` / `api.workflows.runs/runDetail/cancelRun/resolveApproval`
- `preload/index.d.ts` 同步声明
- `main/ipc/index.ts` 注册 `workflows:*` 和 `workflowRuns:*` handlers
- `main/server/index.ts` 暴露 `/api/workflows/*` HTTP 端点
- `i18n.messages.ts` 9 条 workflow 键：定义/运行/详情/取消/重试/审批/empty
- 后端保留：`workflow-engine.ts` / `workflow-dag.ts` / `workflow-executor.ts` / `workflow-runs.ts` / `workflow-cancellation.ts` / `workflow-types.ts` / `workflow-template.ts` / `workflow-dispatcher.ts` / DB schema / `agent-runtime.ts` 里 `executeWorkflow` 调用
- 已有数据源：`api.runtime.events.list()` 已经在 chat 流里读取 `kind: "workflow"` 事件，可复用
- `workflow_runs` 表 schema 有 `conversationId` 字段（外键到 `conversations.id`），可按 conversation 过滤

## Proposed Changes

### 1) 删除（前端 UI 代码 + 暴露面）

| 文件                                                             | 操作                                                                                                                                                                                                             |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/renderer/src/components/WorkflowRunsPanel.tsx` | DELETE（整文件）                                                                                                                                                                                                 |
| `apps/desktop/src/renderer/src/components/WorkflowRunDetail.tsx` | DELETE（整文件）                                                                                                                                                                                                 |
| `apps/desktop/src/renderer/src/lib/workflow-format.ts`           | DELETE（只服务于被删组件）                                                                                                                                                                                       |
| `apps/desktop/src/renderer/src/components/AppShell.tsx`          | EDIT：从 `primaryNav` 移除 `workflows` / `workflowRuns` 两项；移除 `IconSliders` 中未使用的 import                                                                                                               |
| `apps/desktop/src/renderer/src/components/MainPanelView.tsx`     | EDIT：从 `MainSection` 移除 `"workflows"` / `"workflowRuns"`；移除 `WorkflowsPanel` / `WorkflowRunsSection`；移除 `WorkflowDefinition` import；移除 `workflows: []` 初始 state / 拉取；移除 `IconSliders` import |
| `apps/desktop/src/renderer/src/lib/api.ts`                       | EDIT：移除 `api.workflows.*` 声明（`list/get/create/update/delete/run/runs/runDetail/cancelRun/resolveApproval`）                                                                                                |
| `apps/desktop/src/preload/index.ts`                              | EDIT：移除 `workflows: { ... }` 块                                                                                                                                                                               |
| `apps/desktop/src/preload/index.d.ts`                            | EDIT：移除 `workflows` 类型声明                                                                                                                                                                                  |
| `apps/desktop/src/main/ipc/index.ts`                             | EDIT：移除 `workflows:*` 和 `workflowRuns:*` handlers（共 ~10 条）                                                                                                                                               |
| `apps/desktop/src/main/server/index.ts`                          | EDIT：移除 `/api/workflows/*` 路由（~50 行）                                                                                                                                                                     |
| `apps/desktop/src/renderer/src/lib/i18n.messages.ts`             | EDIT：移除 9 条 workflow 键（`workflow.run.*` / `workflow.runs.empty` / `main.title.workflows` / `main.title.workflowRuns` / `main.subtitle.workflows` / `main.subtitle.workflowRuns`）                          |
| `apps/desktop/src/renderer/src/components/icons.tsx`             | EDIT：若 `IconSliders` 仅在删除处使用则一并移除；保留则不删                                                                                                                                                      |

### 2) 新增（一个 widget + 一条新 IPC）

**新文件**：`apps/desktop/src/renderer/src/components/WorkflowStatusWidget.tsx`

- 浮在 `ChatView` 右上角（`fixed top-3 right-3` 之类），宽度 ~300px，可折叠
- 默认行为：
  - 当前 conversation 无活动 run → **隐藏**
  - 当前 conversation 有活动 run（status 在 `running` / `waiting_approval` / `waiting_handoff` 之一）→ 显示，**默认展开**一个紧凑摘要（runId 短码 + status label + 当前节点标题 + 已耗时）
  - 点击展开/折叠按钮 → 显示完整 timeline（最近 N 条 `runtime_events` 里 `kind=workflow` 且 conversationId 匹配的事件）
  - 终态（succeeded / failed / cancelled）→ 显示一个 toast-style 短暂徽标 5 秒后自动隐藏
- 数据源：
  - 主：`api.runtime.events.list()`（已存在，conversationId 过滤后做差分/排序）
  - 轮询：1.5 秒一次（与原来 `WorkflowRunsPanel` 一致）
  - 取消：直接调 `api.workflows.cancelRun(runId)`（→ 走保留的 IPC，**不**删除）

**新 IPC**：`workflowRuns:activeForConversation`

- 位置：`apps/desktop/src/main/ipc/index.ts`（即使其它 workflows:\* 删掉，这一条作为 widget 专用 IPC 留下）
- 入参：`{ conversationId: string }`
- 出参：`| { id, workflowId, status, currentNodeId?, currentNodeTitle?, startedAt, finishedAt? } | null`
- 逻辑：在 `workflow_runs` 表里查 `conversation_id = ? AND status IN ('queued','running','waiting_approval','waiting_handoff')` 最近的 1 条；若没有再返回最近 1 条任意状态的（用于显示终态徽标）
- 这个 IPC 跟 `api.workflows.cancelRun` 一起作为"widget 唯一需要的后端暴露面"保留；其它 workflows 端点全部下线

### 3) 挂载点

- 在 `ChatView` 组件树内挂载 `WorkflowStatusWidget`（不在 `AppShell`，因为需要拿到 `conversationId`）
- 若 `ChatView` 接收 `conversationId` prop（从 `App.tsx:149` 已知）则直接用

### 4) 不动

- 后端引擎 8 个文件
- `agent-runtime.ts` 的 `executeWorkflow` 调用
- `runtime-recorder.ts` 的 `insertRuntimeEvent`（"workflow"/"handoff" 事件继续写）
- DB schema 与迁移
- `i18n.messages.ts` 里**不在**第 1 节列表中的键
- `ApiKey` / 记忆 / 工具 / 智能体 / 桌宠 / 设置 / 其它模块

## 关键决策（已与用户对齐）

| 决策点                | 选定                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| Chat 页面展示位置     | 右上角悬浮，可折叠                                                                              |
| 是否保留两个组件      | 全部删除                                                                                        |
| 后端编排/交接是否保留 | **保留**——这是核心模块                                                                          |
| 是否保留 IPC/HTTP     | 仅保留 widget 必需的 `workflowRuns:activeForConversation` + `workflowRuns:cancel`；其余全部下线 |

## 实施步骤

1. 写新 widget `WorkflowStatusWidget.tsx`
2. 加新 IPC `workflowRuns:activeForConversation`（含 handler + preload 暴露 + 类型声明）
3. 在 `ChatView` 挂载 widget
4. 删除 `WorkflowRunsPanel.tsx` / `WorkflowRunDetail.tsx` / `workflow-format.ts`
5. 移除 `AppShell.tsx` 侧栏菜单项
6. 简化 `MainPanelView.tsx`（去 `MainSection` 两个值 + 内联组件 + 拉取）
7. 移除 `api.ts` 暴露 + `preload/index.ts` / `preload/index.d.ts` 大块
8. 移除 `main/ipc/index.ts` 大部分 handlers（保留 `workflowRuns:activeForConversation` + `workflowRuns:cancel`）
9. 移除 `main/server/index.ts` 的 `/api/workflows/*` 路由
10. 清理 `i18n.messages.ts` 9 条键
11. 检查 `IconSliders` 是否还使用，否则移除

## Verification

- [ ] `vp check` 通过（0 errors）
- [ ] `vp run test` node 套件 69/69 通过（`workflow-dag.test.ts` 不受影响）
- [ ] renderer 端手动验证：当前 conversation 无 run → 看不到 widget；触发含 workflow 的对话 → 右上角出现可折叠框；点击取消 → run 进入 cancelled → 5s 后 widget 消失
- [ ] `git status` 变更面与本计划一致

## 收尾判定

完成后整套工作流模块的状态：

- **后端**：编排引擎 + 交接 + approval + cancel 完整保留
- **前端**：用户不可见地"在底层默认编排"，仅 chat 页面右上角一个浮动 widget
- **数据库**：workflows / workflow_runs / workflow_step_runs / workflow_transitions 四张表持续写入
- **i18n**：9 条 workflow 键移除
- **公开 API**：仅 `api.workflows.cancelRun` + `api.workflows.activeRunForConversation`（重命名后）两条暴露给渲染层
