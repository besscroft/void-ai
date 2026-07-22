# Memory Agent Select Design

## Goal

Move the agent selector from the memory navigation sidebar into the `SOUL.MD` file header, immediately before the refresh action shown in the reference image. Replace the native HTML select with the project's shadcn Select component.

## Scope

- Show the selector only while the Soul memory file is active.
- Preserve the existing selected-agent state and memory-file loading behavior.
- Remove the selector and its label from the left navigation.
- Do not change IPC, persistence, or memory-file semantics.

## Component Design

Add the shadcn Select component configured for the project's Base UI foundation and export it from the existing UI component barrel. `MemoryPanel` continues to own `selectedAgentId` and passes the available agents, selected value, and change handler to `MemoryFilePanel`.

`MemoryFilePanel` renders the selector in its header action row only when `kind === "soul"`. The selector appears before Refresh and Edit, uses a stable width that fits the marked header area, and retains the standard shadcn styling. Its accessible label uses the existing localized agent-scope string.

Each agent is rendered as a `SelectItem` inside a `SelectGroup`. When there are no available agents, the selector is disabled rather than emitting an invalid selection.

## Data Flow

Selecting an item updates `selectedAgentId`. The existing `loadFiles` callback observes that value and reloads the selected agent's memory files. Save and reload actions continue to receive the selected agent ID.

## Responsive Behavior

The header keeps its existing wrapping behavior. On narrower widths, the selector and action buttons may wrap as a unit without overlapping the file title or each other.

## Verification

- Confirm the native sidebar selector is removed.
- Confirm the shadcn selector appears only on the Soul tab and precedes Refresh.
- Confirm changing the selection reloads the correct agent's files.
- Confirm the empty-agent state is disabled and does not produce an invalid value.
- Run the focused renderer tests, `vp check`, and the desktop test suite.
