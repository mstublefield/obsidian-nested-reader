# Gate 2: files.rs lists/classifies pdf/html

## Evidence
Location: `src-tauri/src/files.rs`

### New helper functions (lines 240-259)
- `is_pdf()` - detects .pdf extension
- `is_html()` - detects .html and .htm extensions  
- `is_openable_page()` - unified check for md/pdf/html

### Updated functions
- `list_pages()` (lines 80-100) - now includes PDF/HTML files, extracts text content
- `read_page()` (lines 108-126) - extracts text based on file type
- `path_kind()` (lines 229-237) - uses `is_openable_page()` to classify files

### Text extraction
- `extract_pdf_text()` - parses PDF text streams
- `extract_html_text()` - strips HTML tags, decodes entities

## Verification
- `list_pages()` returns PDF and HTML files alongside markdown
- Content is extracted to RawPage.raw field
- Existing markdown behavior unchanged

## Status
✅ PASS
