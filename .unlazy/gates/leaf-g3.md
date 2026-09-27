# Gate 3: cargo tests covering PDF extract

## Evidence
Location: `src-tauri/src/files.rs` lines 946-995

### Tests added:
1. `test list_pages_includes_pdf_files` - verifies PDFs appear in page list
2. `test read_pdf_extracts_text` - verifies text extraction from PDF
3. `test write_page_rejects_pdf` - verifies PDF files are read-only
4. `test path_kind_recognizes_pdf` - verifies path classification

### Fixture
Minimal valid PDF created in `.unlazy/fixtures/sample.pdf` with embedded text "Sample PDF Document"

## Test output
```
test files::tests::list_pages_includes_pdf_files ... ok
test files::tests::read_pdf_extracts_text ... ok
test files::tests::write_page_rejects_pdf ... ok
test files::tests::path_kind_recognizes_pdf ... ok
```

## Status
✅ PASS
