# Unlazy Poteto Mode — Nested Reader: PDF & HTML Support

## Goal
Add support to OPEN, ASK, and REFINE on PDFs and HTML in addition to markdown.

Kevin can open a `.pdf`, `.html`, or `.htm` file (or a folder that contains them) the same ways he opens markdown today (⌘O / ⌘⇧O / drop), read the content in the page view, select text, and use Ask / Refine / New Page / Deep Dive. Markdown must keep working.

## Contract (honored)
- Open panel: folders still selectable; allowed types include md, markdown, pdf, html, htm.
- list_pages / drop classify: pdf/html/htm are openable pages alongside markdown.
- `raw` for PDF = extracted text (readable). `raw` for HTML = sanitized HTML or text the existing reader can show and select.
- Ask/Refine use the same popovers; prompts get selected text + surrounding page text.
- Do not corrupt binary PDFs when refining: Refine will create a companion `.md` page (existing New Page / Refine patterns) instead of rewriting the binary source.
- Keep session path keys and IPC camelCase; migrate gracefully if schema must change.

## Architecture
1. **Open panel** (src-tauri/src/open_panel.rs): extend allowed types to include pdf, html, htm
2. **File classification** (src-tauri/src/files.rs): extend `is_markdown` to `is_openable_page`, add helpers for pdf/html detection
3. **Content extraction**:
   - PDF: use `pdf-extract` crate to extract text
   - HTML: use `html2text` or `scraper` to extract/sanitize content
4. **Read-only enforcement**: PDF/HTML pages are read-only; Refine creates companion `.md` files
5. **Frontend**: No changes needed — already uses `body` text from backend

## Refine-on-binary rule
When Refine is invoked on a PDF or HTML file:
- The source file is never modified (read-only)
- A companion `.md` file is created in the same directory with the refined content
- The companion follows the pattern: `{original-name}.refined.md`
- The companion's frontmatter includes `source: {original-path}` to maintain lineage

## Implementation steps
1. Add dependencies to Cargo.toml (pdf-extract, html2text)
2. Update open_panel.rs to accept pdf/html/htm
3. Extend files.rs with is_pdf, is_html, is_openable_page helpers
4. Add extract_pdf_text and extract_html_text functions
5. Update list_pages to include pdf/html files
6. Update read_page to extract content based on file type
7. Add logic to prevent write/delete on pdf/html (or create companion .md)
8. Write tests for PDF and HTML extraction
9. Update README/docs
