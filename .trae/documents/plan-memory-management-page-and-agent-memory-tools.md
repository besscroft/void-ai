# 记忆管理页面与智能体记忆工具实现计划

## Summary

将当前只读的 `MemoryPanel` 扩展为独立、完整的记忆管理页面：支持语义/文本搜索、多维度筛选、排序、批量操作、新建与编辑记忆。智能体侧采用“自动提取-待确认”与显式记忆工具双路径编辑记忆；用户侧集中在记忆管理页面手动增删改查。

参考 Memoh 项目的多记忆提供者架构，本项目当前已采用“内置 Mem0 OSS + SQLite 镜像”的单一提供者方案，短期内不新增其他提供者，重点完善记忆生命周期管理与 UI 操作能力。

## Current State Analysis

| 模块                                                            | 现状                                                                                                                                                                                             | 剩余工作                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `MainPanelView.tsx`                                             | 仅展示记忆卡片列表与统计                                                                                                                                                                         | **重构为完整记忆管理页**（搜索/筛选/排序/批量/新建编辑 Modal/待确认区域） |
| `db.ts`                                                         | 已提供 `listMemories` / `searchMemories` / `getMemoryById` / `saveMemory` / `deleteMemory` / `deleteMemoriesBatch` / `updateMemoriesBatch`，且已双写 Mem0 向量索引                               | 无需改动                                                                  |
| `ipc/index.ts` / `preload/index.ts` / `renderer/src/lib/api.ts` | 已暴露 `memories.search/get/deleteBatch/updateBatch/pending.*`                                                                                                                                   | 无需改动                                                                  |
| `agent-learning.ts`                                             | 已实现 `pendingMemories` 队列、`listPendingMemories` / `confirmPendingMemory` / `rejectPendingMemory` / `confirmAllPendingMemories` / `rejectAllPendingMemories`，`runLearning` 改为先入队待确认 | 无需改动                                                                  |
| `chat-tools.ts`                                                 | 已声明并实现 `memory_update` / `memory_delete` 工具，审批配置已覆盖                                                                                                                              | 无需改动                                                                  |
| `shared/types.ts`                                               | 已新增 `MemoryPendingSuggestion` 类型，`MemoryScope` / `MemoryKind` / `MemoryRecord` 已存在                                                                                                      | 无需改动                                                                  |
| `i18n.messages.ts`                                              | 已新增搜索、筛选、批量、编辑、待确认等中英双语 key                                                                                                                                               | 无需改动                                                                  |
| `chat-tools.test.ts`                                            | 覆盖 web_search / current_time / memory_search 等                                                                                                                                                | **补充 memory_save / memory_update / memory_delete 的断言**               |

## Proposed Changes

### 1. `apps/desktop/src/renderer/src/components/MainPanelView.tsx`

将 `MemoryPanel` 重构为完整记忆管理页，保持与现有 `MainPanelView` 的刷新/加载模式一致。

#### 状态设计

- `memories: MemoryRecord[]`
- `pending: MemoryPendingSuggestion[]`
- `query: string`
- `filters: { scope: MemoryScope \| "all"; kind: MemoryKind \| "all"; pinned: boolean \| null }`
- `sortBy: "salience" \| "updated" \| "created"`
- `sortOrder: "asc" \| "desc"`
- `selectedIds: Set<string>`
- `isEditModalOpen: boolean`
- `editingMemory: MemoryRecord \| null`（`null` 表示新建）
- `deleteTarget: MemoryRecord \| null`（单条删除确认）
- `deleteBatchIds: string[]`（批量删除确认）
- `isLoading / isSaving / isDeleting` 等 pending 状态

#### 数据加载

- 页面挂载与 `section === "memory"` 时调用 `load()`。
- `load()` 使用 `api.memories.search({ query, scope, kind, pinned, sortBy, sortOrder, limit: 200 })` 拉取记忆列表。
- 同时调用 `api.memories.pending.list()` 拉取待确认记忆。
- 每次增删改、批量操作、确认/拒绝 pending 后重新调用 `load()`。

#### UI 布局

基于现有 `Card` / `Button` / `Input` / `TextArea` / `Chip` / `Switch` / `Slider` / `ToggleButtonGroup` / `ConfirmDialog` 组件实现，不引入新依赖。

```
┌─────────────────────────────────────────────────────────────┐
│  记忆管理                              [刷新] [+ 新建记忆]    │
├─────────────────────────────────────────────────────────────┤
│  [搜索...]  [范围 ▼] [类型 ▼] [已固定 ▼] [排序 ▼] [升/降 ▼]  │
├─────────────────────────────────────────────────────────────┤
│  已选择 2 项    [固定] [取消固定] [改类型 ▼] [改范围 ▼] [删除] │
├─────────────────────────────────────────────────────────────┤
│  ┌────────────┐  ┌──────────────────────────────────────┐  │
│  │ 总条数 128 │  │  ☑ 标题 A              [编辑][删除]  │  │
│  │ 已固定 12  │  │  全局 / 事实                            │  │
│  │ 待确认 3   │  │  内容摘要...                            │  │
│  └────────────┘  └──────────────────────────────────────┘  │
│                   ... 更多卡片 ...                          │
├─────────────────────────────────────────────────────────────┤
│  待确认记忆（3）    [全部确认] [全部拒绝]                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 用户偏好深色模式                          [确认][拒绝] │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

- **顶部标题栏**：左侧标题+副标题，右侧刷新按钮与“新建记忆”按钮。
- **搜索与筛选栏**：
  - 搜索框使用 `Input`，placeholder 取 `main.memory.search.placeholder`。
  - 范围筛选：all / global / agent / conversation。
  - 类型筛选：all / fact / preference / episode / profile / skill。
  - 固定筛选：all / pinned / unpinned（使用 ToggleButtonGroup）。
  - 排序：salience / updated / created + asc / desc。
  - 搜索与筛选变化时即时重新拉取。
- **批量操作栏**：`selectedIds.size > 0` 时显示，提供：
  - 固定 / 取消固定（调用 `api.memories.updateBatch(ids, { pinned })`）。
  - 修改 kind（下拉选择，调用 `updateBatch`）。
  - 修改 scope（下拉选择，调用 `updateBatch`）。
  - 批量删除（弹出 `ConfirmDialog`，调用 `api.memories.deleteBatch(ids)`）。
- **左侧统计卡片**：总条数、已固定数、待确认数。
- **右侧记忆卡片网格**：
  - 卡片左上角复选框，点击切换选中。
  - 标题行：标题 + scope/kind chip + 固定标识。
  - 内容摘要 `line-clamp-4`。
  - 卡片操作：编辑按钮（打开编辑 Modal）、删除按钮（打开确认弹窗）。
- **待确认区域**：
  - 标题显示 `main.memory.pending.title` + 待确认数量。
  - 每条显示标题、内容摘要、建议时间。
  - 操作：确认（`api.memories.pending.confirm`）、拒绝（`api.memories.pending.reject`）。
  - 顶部提供“全部确认”与“全部拒绝”。
- **新建/编辑 Modal**：
  - `editingMemory === null` 为新建，否则为编辑。
  - 表单字段：标题 `Input`、内容 `TextArea`、范围 `ToggleButtonGroup`、类型 `ToggleButtonGroup`、重要性 `Slider`（1–100）、固定 `Switch`。
  - 保存时：新建调用 `api.memories.save(record)`；编辑同样调用 `api.memories.save(record)` 利用 upsert 语义完成更新。
- **删除确认弹窗**：复用 `ConfirmDialog`，单条删除使用 `main.memory.deleteConfirm`（带 `title` 插值），批量删除使用 `main.memory.deleteBatchConfirm`（带 `count` 插值）。

### 2. `apps/desktop/src/main/lib/chat-tools.test.ts`

补充以下测试覆盖：

- 在“auto mode 默认工具”断言中确认 `memory_save` / `memory_update` / `memory_delete` 不会默认启用（`defaultAuto: false`）。
- 新增测试：手动选择 `memory_save` / `memory_update` / `memory_delete` 时，工具集中存在对应工具。
- 新增测试：`executeChatHostTool` 调用 `memory_save` 能正确保存记忆。
- 新增测试：`executeChatHostTool` 调用 `memory_update` 能正确更新记忆。
- 新增测试：`executeChatHostTool` 调用 `memory_delete` 能正确删除记忆。
- 这些测试需要通过 mock `db.ts`（使用 `node:test` mock）来避免真实数据库与 Mem0 副作用。

### 3. 验证

- 运行 `vp check` 确认类型、lint、format 通过。
- 运行 `vp test` 确认单元测试通过。
- 手动验证（可选，视环境而定）：
  - 记忆管理页搜索、筛选、排序生效。
  - 新建/编辑记忆后列表刷新。
  - 批量固定、批量删除生效。
  - 智能体学习产生的 pending 记忆可在页面中确认/拒绝。
  - 聊天中显式调用 `memory_update` / `memory_delete` 经审批后生效。

## Assumptions & Decisions

1. **待确认队列不持久化**：pending 记忆仅存于主进程内存，重启后丢失；重新学习会再次产生候选。避免引入新的持久化复杂度。
2. **智能体“编辑记忆”双路径**：
   - 自动路径：对话结束后由 `agent-learning` 提取候选，进入 pending，用户确认后写入。
   - 显式路径：智能体在聊天中调用 `memory_save` / `memory_update` / `memory_delete` 工具（后两者需要用户审批）。
3. **用户手动更改入口**：集中在 `MemoryPanel` 扩展后的记忆管理页面。
4. **不新增第三方依赖**：复用项目已有的 `mem0ai`、shadcn/Base UI 组件、Drizzle ORM。
5. **单条更新复用 `saveMemory`**：利用 SQLite 的 upsert 语义与 Mem0 向量同步，避免新增 `updateMemory` 函数；前端通过 `api.memories.save` 提交完整 `MemoryRecord` 完成编辑。
6. **审批策略**：`memory_update` / `memory_delete` 默认手动、需要审批，与 `memory_save` 保持一致，防止智能体擅自修改用户记忆。
7. **Modal 自行实现**：当前项目未提供通用 Modal 组件，在 `MainPanelView.tsx` 内联实现一个简单 Modal（固定定位、遮罩、居中面板），保持与 `ConfirmDialog` 一致的视觉风格。
