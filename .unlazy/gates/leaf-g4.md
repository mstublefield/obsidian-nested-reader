# Gate 4: cargo tests covering HTML load/body text

## Evidence
Location: `src-tauri/src/files.rs` lines 997-1038

### Tests added:
1. `test list_pages_includes_html_files` - verifies HTML files appear in page list
2. `test read_html_extracts_text` - verifies text extraction from HTML
3. `test write_page_rejects_html` - verifies HTML files are read-only
4. `test path_kind_recognizes_html` - verifies .html and .htm classification

### Fixture
HTML document created in `.unlazy/fixtures/sample.html` with structured content

### Text extraction
HTML parser strips tags, removes script/style blocks, decodes entities, normalizes whitespace

## Test output
```
test files::tests::list_pages_includes_html_files ... ok
test files::tests::read_html_extracts_text ... ok
test files::tests::write_page_rejects_html ... ok
test files::tests::path_kind_recognizes_html ... ok
```

## Status
✅ PASS
