# Gates

- [x] G1: Open panel accepts pdf/html — EVIDENCE: open_panel.rs lines 22-28, adds pdf, html, htm to NSArray; CHECK: grep -n "pdf\|html\|htm" src-tauri/src/open_panel.rs
- [x] G2: files.rs lists/classifies pdf/html — EVIDENCE: is_pdf/is_html/is_openable_page functions, list_pages/read_page updated; CHECK: grep -n "is_pdf\|is_html\|is_openable_page" src-tauri/src/files.rs
- [x] G3: cargo tests covering PDF extract (fixture text) — EVIDENCE: test nested_pdf_fixture_extracted extracts "Nested PDF Fixture" from .unlazy/fixtures/sample.pdf; CHECK: cd src-tauri && cargo test nested_pdf -- --nocapture 2>&1 | grep "Nested PDF Fixture"
- [x] G4: cargo tests covering HTML load/body text — EVIDENCE: test nested_html_fixture_extracted extracts "Nested HTML Fixture" from .unlazy/fixtures/sample.html; CHECK: cd src-tauri && cargo test nested_html -- --nocapture 2>&1 | grep "Nested HTML Fixture"
- [x] G5: frontend/platform no longer hard-rejects non-md page paths; pdf/html referenced where needed — EVIDENCE: Backend `path_kind()` in files.rs (lines 246-256) returns "file" for is_openable_page (md/pdf/html); frontend store.ts openPath accepts kind="file" for any openable page type; CHECK: grep -n "is_openable_page\|path_kind" src-tauri/src/files.rs | head -10 && grep -n 'kind === "file"' src/state/store.ts
- [x] G6: full `cargo test` in src-tauri still ok (markdown regression) — EVIDENCE: cargo test output shows "test result: ok. 42 passed; 0 failed"; CHECK: cd src-tauri && cargo test 2>&1 | grep "test result:"
- [x] G7: README or docs mention PDF/HTML open + ask/refine — EVIDENCE: README.md "Opening pages" section updated; CHECK: grep -n "PDF and HTML support" README.md
