# PDF & HTML Support - Implementation Summary

## ✅ Completed

Kevin can now open `.pdf`, `.html`, and `.htm` files the same ways he opens markdown:
- ⌘O / ⌘⇧O / drop into window
- Files appear in tree sidebar
- Text is extracted and displayed
- Ask / Refine / New Page / Deep Dive all work

## What was built

### Backend (Rust)
1. **Open panel** (`src-tauri/src/open_panel.rs`)
   - Added pdf, html, htm to allowed file types

2. **File handling** (`src-tauri/src/files.rs`)
   - `extract_pdf_text()` - Parses PDF text streams (BT...ET operators)
   - `extract_html_text()` - Strips HTML tags, decodes entities, normalizes whitespace
   - `is_pdf()`, `is_html()`, `is_openable_page()` - File type detection
   - Updated `list_pages()` to include and extract PDF/HTML
   - Updated `read_page()` to extract based on file type
   - Updated `path_kind()` to classify PDF/HTML as openable
   - Added write protection: `write_page()` rejects PDF/HTML with clear error

3. **Tests** - 8 new tests covering:
   - PDF/HTML appear in page list
   - Text extraction works
   - Files are classified correctly
   - Write protection enforced

### Frontend
**No changes needed** - already consumes text from `RawPage.raw` field regardless of source.

### Documentation
- README updated with PDF/HTML support section
- `.unlazy/` directory with gates, evidence, plan

## Read-only behavior

PDF and HTML files are never modified:
- Original file stays untouched on disk
- Refine creates new `.md` files with extracted/refined content
- Same pattern as existing markdown versioning

## Test results
```
cargo test: 40 passed, 0 failed
```

All existing markdown tests pass - **zero regressions**.

## PR
[#68](https://github.com/truefrontier/nested-reader/pull/68) - Ready for review

## Known limitations

### PDF extraction
- Simple text stream parser (BT...ET operators)
- Works for basic PDFs with embedded text
- Complex PDFs (images, tables, multi-column) may not extract cleanly
- Binary PDFs show fallback message

**Future improvement**: Add `pdf-extract` or `lopdf` crate when Rust environment supports it (currently blocked by edition2024 dependency conflict).

### HTML extraction
- Tag stripping with entity decoding
- Removes `<script>` and `<style>` blocks
- Works for content-focused HTML
- Complex layouts/CSS may lose structure

**Both approaches prioritize content readability over perfect formatting**, which aligns with Nested's research reader use case.

## Architecture notes

The design extends the existing `RawPage` model cleanly:
- PDF/HTML text → `RawPage.raw` field
- Frontend renders as markdown-parsed blocks
- Ask/Refine work on text selections
- File path stored in `RawPage.path` (e.g. "docs/guide.pdf")

This means:
- Session state uses any file path as key
- Trail/history work with any file type
- Tree sidebar displays all types
- No special cases in UI layer

The only backend-specific logic is:
1. File type detection
2. Text extraction
3. Write protection

Everything else reuses existing markdown infrastructure.
