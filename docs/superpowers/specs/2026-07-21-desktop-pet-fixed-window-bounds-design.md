# Desktop Pet Fixed Window Bounds

## Problem

On Windows with fractional display scaling, repeatedly round-tripping a non-resizable Electron window through `getBounds()` and `setBounds()` can introduce small size changes. The desktop pet drag path currently feeds the returned width and height into the next move, so those changes accumulate and enlarge the transparent window.

## Design

Treat `DESKTOP_PET_WINDOW_SIZE` (`168x144`) as an invariant instead of trusting the native window's current size.

- Dragging continues to derive the target position from the current `x` and `y` plus the renderer-provided delta.
- Edge clamping uses the canonical width and height.
- Every moved bounds object returns the canonical width and height.
- Applying window configuration uses the clamped canonical bounds directly, repairing any window that already drifted in size.
- Transparent mouse pass-through and renderer pointer handling remain unchanged.

Using `setPosition()` alone is intentionally avoided because Electron may still construct the native move from the current rounded size internally. Reasserting the canonical size prevents feedback accumulation.

## Testing

- A move starting from deliberately enlarged bounds must return `168x144`.
- Edge-clamping tests must calculate visibility from the canonical size.
- Repeated moves starting from a simulated size drift must retain `168x144` on every iteration.
- Run the focused desktop pet tests, repository checks, and the available desktop test suite.

## Non-Goals

- Changing the pet sprite layout, drag gesture, or click behavior.
- Changing transparent-window mouse pass-through.
- Upgrading Electron or changing DPI coordinate conversion.
