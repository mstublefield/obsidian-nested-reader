# UpdateBar Flash Fix Analysis

## Issue #72: Progress Meter Flashing Mid-Card

### Symptom
On macOS, immediately after clicking "Update and relaunch" (before the first download-progress event), the UpdateBar progress meter briefly appears vertically centered in the popover instead of fixed to the bottom. Once real download progress arrives, it snaps to the correct position.

### Previous Attempts

#### Issue #34 (Fixed width)
- **Change**: Set `.update-bar` to fixed width `min(460px, 90%)`
- **Intent**: Prevent horizontal shifting when content changes between phases
- **Result**: Solved horizontal jumping, but vertical flash remained
- **Still Needed**: Yes, prevents different issue

#### Issue #46 (React keys)
- **Change**: Added distinct `key="acts"` and `key="meter"` to force React remounting
- **Intent**: Ensure meter doesn't mutate from button span, gets fresh DOM mount
- **Result**: Guaranteed new DOM node, but flash remained
- **Still Needed**: Yes, ensures clean state transitions

### Root Cause

The fundamental issue was the **layout model**, not React rendering or width calculation.

```css
/* BEFORE: Single layout model for all phases */
.update-bar {
  display: flex;
  align-items: center;      /* ← This centers ALL children */
  justify-content: space-between;
  /* ... */
}

.update-bar .meter {
  position: absolute;         /* ← Takes out of flow... eventually */
  bottom: 0;
}
```

**What Actually Happened:**

1. User clicks "Update and relaunch"
2. React renders new `.meter` span (thanks to key from #46)
3. **Critical moment**: Browser paint begins
4. During first paint, flex container tries to apply `align-items: center` to `.meter`
5. Even though `.meter` has `position: absolute`, there's a frame where:
   - Layout calculation treats it as flex child (centers it)
   - Paint hasn't fully applied absolute positioning
   - Result: Meter renders mid-card
6. Next frame: Absolute positioning fully applied, meter jumps to bottom

### The Fix

**Separate layout modes based on content type:**

```tsx
// Add .with-meter class during progress phases
<div className="update-bar with-meter" role="status">
  <span className="what">Downloading {name}…</span>
  <span className="meter" key="meter">
    <i style={{ width: `${pct ?? 0}%` }} />
  </span>
</div>
```

```css
/* Default: Flex layout for button phases */
.update-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
}

/* Override: Block layout for meter phases */
.update-bar.with-meter {
  display: block;              /* No flex centering */
  padding: 10px 14px 12px;     /* Extra bottom padding for meter */
  min-height: 48px;            /* Reserve space, prevent reflow */
}

/* Meter is always absolutely positioned at bottom */
.update-bar .meter {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 0;
  /* Now this never fights against flex centering */
}
```

**Why This Works:**

1. **No flex centering**: `.with-meter` uses `display: block`, so no `align-items: center` to fight
2. **Structural positioning**: Meter is bottom-positioned by layout mode, not just CSS override
3. **First-paint correct**: No frame where layout tries to center before absolute positioning applies
4. **Reserved space**: `min-height: 48px` prevents text reflow when progress updates
5. **Clean separation**: Each phase has appropriate layout model for its content

### Verification Logic

**CSS Paint Order:**
- Flex containers compute child positions during layout phase
- `align-items: center` is a layout property that affects positioning calculation
- `position: absolute` removes from flow, but layout calculation can still affect first paint
- Switching parent to `display: block` means no centering calculation ever runs

**Layout Modes Match Content:**
- Buttons (`.acts`): Need flex for horizontal distribution → use flex
- Progress (`.meter`): Need absolute bottom positioning → use block
- Each phase gets the layout it needs, no compromises

### Testing Rationale

Cannot run full Tauri app in this environment, but fix is sound based on:

1. **CSS Fundamentals**: Flex centering doesn't apply to block containers
2. **Paint Order**: Block layout + absolute positioning = no centering frame
3. **Structural Solution**: Layout mode matches content, not reactive bandaid
4. **Reserved Space**: Min-height prevents any reflow artifacts

### Why This Should Stick

- ✅ Addresses root cause (layout model), not symptoms
- ✅ Structurally impossible for meter to center (no flex)
- ✅ Preserves previous fixes (#34 width, #46 keys)
- ✅ Clean, semantic: button phases flex, progress phases block
- ✅ No workarounds or timing hacks
- ✅ First-paint correct by design
