# Gate 4: cargo tests covering HTML load/body text

## Evidence
Test: `nested_html_fixture_extracted` in `src-tauri/src/files.rs`

### What it does:
1. Loads fixture from `.unlazy/fixtures/sample.html`
2. Extracts text using `extract_html_text()`
3. Asserts extracted text contains "Nested HTML Fixture"
4. Prints extracted text for verification

### Fixture content
`.unlazy/fixtures/sample.html` contains:
```html
<h1>Nested HTML Fixture</h1>
<p>This is the required test content for HTML file support verification.</p>
```

### Text extraction
HTML parser:
- Strips all HTML tags
- Removes script/style blocks
- Decodes HTML entities
- Normalizes whitespace

## Verification command
```bash
cd src-tauri && cargo test nested_html -- --nocapture 2>&1 | grep "Nested HTML Fixture"
```

## Test output
```
Extracted HTML text: Nested HTML Fixture Nested HTML Fixture This is the required test content...
test files::tests::nested_html_fixture_extracted ... ok
```

## Status
✅ PASS - Required phrase "Nested HTML Fixture" appears in test output
