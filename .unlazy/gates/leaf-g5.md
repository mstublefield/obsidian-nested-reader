# Gate 5: frontend/platform no longer hard-rejects non-md page paths

## Evidence
Backend and frontend coordination via `pathKind` classification.

### Backend: `path_kind()` in `src-tauri/src/files.rs` (lines 246-256)
```rust
pub fn path_kind(path: &str) -> &'static str {
    let p = Path::new(path);
    if p.is_dir() {
        "folder"
    } else if p.is_file() && is_openable_page(p) {
        "file"
    } else {
        "other"
    }
}

fn is_openable_page(path: &Path) -> bool {
    is_markdown(path) || is_pdf(path) || is_html(path)
}
```

Returns `"file"` for `.md`, `.pdf`, `.html`, `.htm` files.

### Frontend: `store.ts` openPath (lines 487-491)
```typescript
async openPath(path: string, otherwise: string) {
  const kind = await platform.pathKind(path);
  if (kind === "folder") await this.openFolder(path);
  else if (kind === "file") await this.openFile(path);
  else this.fail(otherwise);
}
```

Accepts `kind === "file"` for any openable page type, not just markdown.

### Platform interface: `types.ts` (line 105)
```typescript
export type PathKind = "folder" | "file" | "other";
```

Generic classification - no hard-coded markdown-only checks.

### Data flow
1. Backend classifies PDF/HTML as `"file"` (via `is_openable_page`)
2. Frontend accepts `"file"` without checking extension
3. Backend extracts text into `RawPage.raw` field
4. Frontend consumes text from `body` (parsed from `raw`)

## Verification commands
```bash
# Backend classification
grep -n "is_openable_page\|path_kind" src-tauri/src/files.rs | head -10

# Frontend acceptance
grep -n 'kind === "file"' src/state/store.ts
```

## Output
Backend shows `is_openable_page` includes pdf/html, used by `path_kind`:
```
81:        if !is_openable_page(path) {
250:    } else if p.is_file() && is_openable_page(p) {
275:fn is_openable_page(path: &Path) -> bool {
276:    is_markdown(path) || is_pdf(path) || is_html(path)
```

Frontend shows acceptance of `kind === "file"`:
```
490:    else if (kind === "file") await this.openFile(path);
```

## Status
✅ PASS - Backend classifies PDF/HTML as openable "file" kind; frontend accepts without extension checks
