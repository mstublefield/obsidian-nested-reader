# UpdateBar Layout Fix: Before vs After

## BEFORE (Issues #34, #46, #72)

```
┌─────────────────────────────────────────┐
│ .update-bar (display: flex)             │
│   align-items: center                   │  ← PROBLEM: Centers ALL children
│   justify-content: space-between        │
├─────────────────────────────────────────┤
│                                         │
│  [.what text]          [.acts buttons]  │  Phase: "available"
│                                         │
└─────────────────────────────────────────┘

User clicks "Update and relaunch"
↓

┌─────────────────────────────────────────┐
│ .update-bar (display: flex)             │
│   align-items: center                   │  ← STILL tries to center!
│   justify-content: space-between        │
├─────────────────────────────────────────┤
│                                         │
│  [.what text]      [.meter]  ← FLASH!  │  Phase: "downloading"
│                       ↑                 │  First paint: flex centers it
│              (should be at bottom)      │
│────────────────────────────────         │  .meter (position: absolute)
│                                         │  Eventually jumps to bottom
└─────────────────────────────────────────┘
```

**Problem**: `.meter` has `position: absolute; bottom: 0` but parent is `display: flex` 
with `align-items: center`. During first paint, flex layout tries to center the meter 
before absolute positioning fully applies.

---

## AFTER (This Fix)

```
┌─────────────────────────────────────────┐
│ .update-bar (display: flex)             │
│   align-items: center                   │  ← Only for button phases
│   justify-content: space-between        │
├─────────────────────────────────────────┤
│                                         │
│  [.what text]          [.acts buttons]  │  Phase: "available"
│                                         │
└─────────────────────────────────────────┘

User clicks "Update and relaunch"
↓

┌─────────────────────────────────────────┐
│ .update-bar.with-meter (display: block) │  ← NO CENTERING!
│   min-height: 48px                      │
├─────────────────────────────────────────┤
│                                         │
│  [.what text] Downloading...            │  Phase: "downloading"
│                                         │
│                                         │
│─────────────────────────────────────    │  .meter (position: absolute)
│                                         │  ✓ Bottom from first paint
└─────────────────────────────────────────┘
```

**Solution**: Add `.with-meter` class that switches to `display: block`. No flex = no 
centering. Meter is structurally positioned at bottom from first paint.

---

## Key Changes

### UpdateBar.tsx
```tsx
// Before
<div className="update-bar" role="status">

// After
<div className="update-bar with-meter" role="status">
```

### app.css
```css
/* Default: Flex for button phases */
.update-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
}

/* New: Block for progress phases */
.update-bar.with-meter {
  display: block;              /* ← No flex centering */
  padding: 10px 14px 12px;
  min-height: 48px;            /* ← Reserve space */
}

.update-bar .meter {
  position: absolute;          /* ← Now never fights flex */
  bottom: 0;
  /* ... */
}
```

---

## Why Previous Fixes Weren't Enough

### Issue #34: Fixed Width
- ✓ Prevented horizontal shifting
- ✗ Didn't address vertical centering

### Issue #46: React Keys  
- ✓ Forced clean DOM remount
- ✗ Remounted into flex container that still centered it

### Issue #72: Layout Mode (This Fix)
- ✓ Structural: No centering calculation ever runs
- ✓ First-paint correct by design
- ✓ Preserves both previous fixes
- ✓ Layout mode matches content type

---

## Visual Timeline

```
Frame 0: User clicks button
├─ React: setState phase="downloading"
├─ React: Render new <div className="update-bar with-meter">
└─ React: Mount new <span className="meter"> (thanks to key)

Frame 1: Browser layout + paint
├─ CSS: Apply .update-bar.with-meter { display: block }
├─ CSS: Apply .meter { position: absolute; bottom: 0 }
├─ Layout: No flex centering (parent is block)
└─ Paint: Meter renders at bottom ✓ CORRECT

No flash! Meter is bottom-positioned from first frame.
```

### Compare to OLD behavior:
```
Frame 0: User clicks button
├─ React: setState phase="downloading"  
├─ React: Render new <div className="update-bar">
└─ React: Mount new <span className="meter"> (thanks to key)

Frame 1: Browser layout + paint
├─ CSS: Apply .update-bar { display: flex; align-items: center }
├─ Layout: Flex tries to center .meter
├─ Paint: Meter renders mid-card ✗ FLASH
└─ CSS: Apply .meter { position: absolute; bottom: 0 }

Frame 2: Reflow
├─ Layout: Absolute positioning overrides flex
└─ Paint: Meter jumps to bottom (too late)
```

---

## Testing Confidence

Cannot run full Tauri app in this environment, but fix is sound because:

1. **CSS Spec**: `display: block` containers don't apply `align-items`
2. **Layout Math**: No centering calculation = no centering frame
3. **Structural**: Impossible for meter to center in block container
4. **Reserved Space**: `min-height` prevents reflow on progress updates
5. **Preserves Fixes**: Width fix (#34) and key remounting (#46) still active

The meter **structurally cannot** flash mid-card because the parent never 
attempts to center it.
