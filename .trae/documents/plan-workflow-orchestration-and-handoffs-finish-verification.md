# 工作流模块收尾：测试接入与验证

## 1. Summary

继续完成 [plan-workflow-orchestration-and-handoffs.md](file:///c:/github/void-ai/.trae/documents/plan-workflow-orchestration-and-handoffs.md) 的剩余两项收尾工作：

1. 把已写好的 `workflow-dag.test.ts` 接入 `apps/desktop/package.json` 的 `test` 脚本，让 `vp test` 真正跑这套用例。
2. 跑 `vp check` + `vp test`，确认实现满足规范、没有 typecheck/lint/测试失败。

不再扩展功能、不再补 DB 依赖重的测试（`workflow-engine.test.ts` 已删除、`workflow-runs.test.ts` 故意未建），符合本项目"避免为追求覆盖率而忽视逻辑的测试"的工程约定。

## 2. Current State Analysis

### 2.1 已实现（来自前次会话）

**后端核心**

- [workflow-dag.ts](file:///c:/github/void-ai/apps/desktop/src/main/lib/workflow-dag.ts) — DAG 校验、拓扑排序、ready 计算、并行子节点解析、终态判定
- [workflow-types.ts](file:///c:/github/void-ai/apps/desktop/src/main/lib/workflow-types.ts) — `DEFAULT_RETRY_POLICY`、`makeAdHocWorkflow`、`normalizeDefinition`、`linearizeSteps`、`buildNodeFromLegacyStep` 等
- [workflow-executor.ts](file:///c:/github/void-ai/apps/desktop/src/main/lib/workflow-executor.ts) — 9 种节点执行器（prompt/tool/approval/memory/handoff/consult/delay/parallel/branch）
- [workflow-engine.ts](file:///c:/github/void-ai/apps/desktop/src/main/lib/workflow-engine.ts) — 状态机主循环、retry/补偿/取消/审批超时
- [workflow-dispatcher.ts](file:///c:/github/void-ai/apps/desktop/src/main/lib/workflow-dispatcher.ts) — 真实依赖装配（skill/chat/childAgent/审批/记忆）
- [workflow-runs.ts](file:///c:/github/void-ai/apps/desktop/src/main/lib/workflow-runs.ts) — DB CRUD + 旧 `steps_json` 兼容升级
- [workflow-template.ts](file:///c:/github/void-ai/apps/desktop/src/main/lib/workflow-template.ts) — `{{ path }}` 模板插值
- [workflow-cancellation.ts](file:///c:/github/void-ai/apps/desktop/src/main/lib/workflow-cancellation.ts) — AbortController 注册表

**集成层**

- [schema.ts](file:///c:/github/void-ai/apps/desktop/src/main/lib/schema.ts) — Drizzle 表结构（workflows / workflow_runs 扩列 + workflow_step_runs / workflow_transitions 新表）
- [drizzle/0002_workflow_orchestration.sql](file:///c:/github/void-ai/apps/desktop/drizzle/0002_workflow_orchestration.sql) — 18 条 ALTER/CREATE
- [db.ts](file:///c:/github/void-ai/apps/desktop/src/main/lib/db.ts) — `upgradeLegacyWorkflows()` 启动钩子
- [agent-runtime.ts](file:///c:/github/void-ai/apps/desktop/src/main/lib/agent-runtime.ts) — `run_workflow` 工具（用 `liveRunId` 容器 + `depsFactory` 解循环依赖）
- [server/index.ts](file:///c:/github/void-ai/apps/desktop/src/main/server/index.ts) — 9 个 Hono 端点
- [ipc/index.ts](file:///c:/github/void-ai/apps/desktop/src/main/ipc/index.ts) — 8 个 IPC channel
- [preload/index.ts](file:///c:/github/void-ai/apps/desktop/src/preload/index.ts) + [index.d.ts](file:///c:/github/void-ai/apps/desktop/src/preload/index.d.ts) — 白名单与类型
- [shared/types.ts](file:///c:/github/void-ai/apps/desktop/src/shared/types.ts) — 全部新类型

**渲染层**

- [WorkflowRunsPanel.tsx](file:///c:/github/void-ai/apps/desktop/src/renderer/src/components/WorkflowRunsPanel.tsx) — 列表 + 2s 轮询
- [WorkflowRunDetail.tsx](file:///c:/github/void-ai/apps/desktop/src/renderer/src/components/WorkflowRunDetail.tsx) — 节点时间线、取消/审批、transition 折叠
- [workflow-format.ts](file:///c:/github/void-ai/apps/desktop/src/renderer/src/lib/workflow-format.ts) — 文案/颜色/时长工具
- [api.ts](file:///c:/github/void-ai/apps/desktop/src/renderer/src/lib/api.ts) — `workflows.*` 客户端
- [AppShell.tsx](file:///c:/github/void-ai/apps/desktop/src/renderer/src/components/AppShell.tsx) — 左侧导航
- [MainPanelView.tsx](file:///c:/github/void-ai/apps/desktop/src/renderer/src/components/MainPanelView.tsx) — 路由
- [i18n.messages.ts](file:///c:/github/void-ai/apps/desktop/src/renderer/src/lib/i18n.messages.ts) — 9 个新 i18n 键

**测试**

- [workflow-dag.test.ts](file:///c:/github/void-ai/apps/desktop/src/main/lib/workflow-dag.test.ts) — 7 个 describe / 17 个 case，使用 `node:test` + `assert/strict`，覆盖校验/终态/ready/下游/topo/parallel/adhoc
- `workflow-engine.test.ts` 已删除（DB 依赖重，无 test-mode DB 模式）
- `workflow-runs.test.ts` 故意未建（同上原因）

### 2.2 待办（本次解决）

1. **测试未接入 CI 脚本**：`apps/desktop/package.json` 的 `test` 脚本硬编码了 `*.test.ts` 文件清单（[package.json:27](file:///c:/github/void-ai/apps/desktop/package.json#L27)），`workflow-dag.test.ts` 没有被列入。
2. **未跑过 `vp check` / `vp test`**：前次会话实现完但未做最终验证。

## 3. Proposed Changes

### 3.1 接入 `workflow-dag.test.ts` 到 `test` 脚本

**文件**：[package.json](file:///c:/github/void-ai/apps/desktop/package.json) 第 27 行

**修改**：在 `tsx --tsconfig tsconfig.node.json --test` 命令的 node 测试文件列表末尾追加新文件。位置在 `drizzle-metadata.test.ts` 之后。

**变更前后（节选）**：

```diff
- ... src/main/lib/desktop-pet.test.ts src/main/lib/drizzle-metadata.test.ts
+ ... src/main/lib/desktop-pet.test.ts src/main/lib/drizzle-metadata.test.ts src/main/lib/workflow-dag.test.ts
```

**为什么这样改**：

- 项目 [package.json:27](file:///c:/github/void-ai/apps/desktop/package.json#L27) 把 `test` 脚本写死为白名单列表（不是 glob），所以新测试文件必须手动追加
- 顺序保持末尾追加，与"按模块内聚排列"的现有风格一致
- 不引入 `node:test` 之外的 runner，遵循项目已有约定（`desktop-pet.test.ts` / `drizzle-metadata.test.ts` 都是 `node:test`）

**风险点**：

- `vp test` 在 root 跑 `apps/desktop` 的 `test` 脚本（见 [AGENTS.md](file:///c:/github/void-ai/AGENTS.md) 引用 `vp test`）—— 修改 `apps/desktop/package.json` 就够用，无需改 root
- 如果 `tsx --tsconfig tsconfig.node.json` 对 `workflow-dag.ts` 的 `import type { WorkflowDefinition, WorkflowNode, WorkflowNodeStatus } from "../../shared/types"` 解析失败，要检查 `tsconfig.node.json` 的 `include`（已是 `src/main/**/*`、`src/preload/**/*`、`src/shared/**/*`），预期无问题

### 3.2 跑 `vp check`

**目的**：format + lint + typecheck（`typecheck:node` + `typecheck:web`）一次过。

**期望结果**：

- 无 lint 错误（`workflow-*` 文件遵循现有 ESLint 规则）
- typecheck 通过（特别是 `agent-runtime.ts` 中 `await import("./runtime-recorder")` 动态导入）
- format 自动修复

**若失败**：按错误位置回查 `workflow-*` 文件；常见可能：

- `workflow-executor.ts` / `workflow-dispatcher.ts` 中的 `any` 显式标注（如有）—— 不必扩大类型严格度，按现有 `// eslint-disable-next-line` 风格处理
- 渲染层 `WorkflowRunDetail.tsx` 的 JSX 嵌套（如 `<table>` 在 React 19 中已无警告，但 `<div>` 包 `<tr>` 仍可能命中 a11y 规则）—— 与现有 `MemoryPanel` 同等粒度处理

### 3.3 跑 `vp test`

**目的**：所有 `*.test.ts` 套件通过。

**重点看**：

- `workflow-dag.test.ts` 的 7 个 describe 全部通过
- `drizzle-metadata.test.ts` 不被新 migration 文件破坏（已有 `meta/_journal.json` idx=2）
- 现有 `desktop-pet.test.ts` 等不被 `package.json` 改动影响

**若失败**：分析失败 case，回查 `workflow-dag.ts` 对应函数实现；优先怀疑 cycle-detection 中 GRAY 节点回溯（`parent.get(cur)` 在 stack pop 之后可能已经不存在），按需修正。

### 3.4 不做

- **不写 `workflow-engine.test.ts` / `workflow-runs.test.ts`**：这俩文件都强依赖 `db.ts` 初始化（`createWorkflowRunRecord` 走 `better-sqlite3` 真实连接），项目当前没有 in-memory 或 mock DB 测试模式，强行 mock 会触发"过度 Mock/Stub 导致测试失真"反模式。前次会话已删除 `workflow-engine.test.ts`，与本约定一致。
- **不引入新依赖**：`vp install` 理论上不需要运行。
- **不动 DAG 视觉**、**不写 README**：按用户选择 `后端 + 只读可视化`，功能已交付；不在用户未要求的情况下补文档。
- **不构建 Windows 安装包**：用户没要求 build 验证；`build:desktop:win` 走 Windows Defender 已知坑（见 project memory），不应擅自执行。

## 4. Assumptions & Decisions

- **测试接入方式选择**：用修改 `test` 脚本白名单的方式接入；不动 `vp test` 的实际行为
- **`vp check` / `vp test` 在 root 跑**：与 [AGENTS.md](file:///c:/github/void-ai/AGENTS.md) "Run `vp check` and `vp test` to format, lint, type check and test changes" 一致
- **不补 DB 测试**：与 AGENTS.md "避免过度 Mock/Stub 导致测试失真" 一致
- **不动 build**：不擅自跑 `build:desktop:win`（涉及 Windows Defender 已知坑，且不在用户本次请求中）
- **plan 文件命名**：本次是前次 plan 的收尾动作，与前次 plan 共享同一个工作流模块主题，归档在同一目录下做收尾记录

## 5. Verification Steps

1. **修改 package.json**：
   - [package.json:27](file:///c:/github/void-ai/apps/desktop/package.json#L27) 末尾追加 `src/main/lib/workflow-dag.test.ts`
2. **跑 `vp check`**：
   - 命令：`vp check`（在 `c:\github\void-ai` 根目录）
   - 期望：无错误输出，exit 0
3. **跑 `vp test`**：
   - 命令：`vp test`（在根目录）
   - 期望：所有 `*.test.ts` 套件通过；`workflow-dag.test.ts` 至少 17 个 case 全绿
4. **二次确认**：
   - `git diff apps/desktop/package.json` 应只新增一行（追加文件）
   - `git status` 确认无未预期改动

## 6. 收尾判定

- ✅ `workflow-dag.test.ts` 出现在 `vp test` 输出中
- ✅ `vp check` 0 错误
- ✅ `vp test` 0 失败
- ✅ 未引入新依赖
- ✅ 未扩展需求范围（不补 DB 测试、不补文档、不构建安装包）
