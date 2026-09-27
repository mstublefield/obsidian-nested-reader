# Gate 5: frontend/platform no longer hard-rejects non-md page paths

## Evidence
No frontend changes required!

### Why it works
The frontend consumes `RawPage { path, raw, modified, created }` from the backend. The backend now:
1. Extracts text from PDF/HTML into the `raw` field
2. Sets proper `path` (e.g. "docs/guide.pdf")
3. Returns the same structure frontend already expects

### Frontend flow (unchanged)
- `Page.tsx` receives `body` text from state
- Markdown lexer processes the text into blocks
- Ask/Refine work on text selections (any source)
- New Page creates `.md` from any source

### Path handling
- Session state uses relative paths as keys
- Tree sidebar displays all file types
- Trail/history work with any path
- No extension checks in frontend

## Verification
Backend IPC commands already typed correctly:
- `list_pages` returns `Vec<RawPage>`
- `read_page` returns `RawPage`
- Frontend never filters by extension

## Status
✅ PASS - Zero frontend changes needed
