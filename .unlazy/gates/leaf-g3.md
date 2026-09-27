# Gate 3: cargo tests covering PDF extract

## Evidence
Test: `nested_pdf_fixture_extracted` in `src-tauri/src/files.rs`

### What it does:
1. Loads fixture from `.unlazy/fixtures/sample.pdf`
2. Extracts text using `extract_pdf_text()`
3. Asserts extracted text contains "Nested PDF Fixture"
4. Prints extracted text for verification

### Fixture content
`.unlazy/fixtures/sample.pdf` contains:
```
Nested PDF Fixture
This is the required test content.
```

## Verification command
```bash
cd src-tauri && cargo test nested_pdf -- --nocapture 2>&1 | grep "Nested PDF Fixture"
```

## Test output
```
Extracted PDF text: Nested PDF Fixture This is the required test content. 
test files::tests::nested_pdf_fixture_extracted ... ok
```

## Status
✅ PASS - Required phrase "Nested PDF Fixture" appears in test output
