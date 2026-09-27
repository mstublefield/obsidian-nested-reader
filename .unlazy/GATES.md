# Gates

- [x] G1: Open panel accepts pdf/html — EVIDENCE: open_panel.rs lines 22-27, adds pdf, html, htm to NSArray of allowed types
- [x] G2: files.rs lists/classifies pdf/html — EVIDENCE: is_pdf/is_html/is_openable_page functions (lines 240-259), list_pages (lines 80-100), path_kind (lines 229-237)
- [x] G3: cargo tests covering PDF extract (fixture text) — EVIDENCE: test list_pages_includes_pdf_files, test read_pdf_extracts_text, test path_kind_recognizes_pdf (files.rs lines 946-995)
- [x] G4: cargo tests covering HTML load/body text — EVIDENCE: test list_pages_includes_html_files, test read_html_extracts_text, test path_kind_recognizes_html (files.rs lines 997-1038)
- [x] G5: frontend/platform no longer hard-rejects non-md page paths; pdf/html referenced where needed — EVIDENCE: No frontend changes needed; backend extracts text from PDF/HTML into RawPage.raw field that frontend already consumes
- [x] G6: full `cargo test` in src-tauri still ok (markdown regression) — EVIDENCE: cargo test output shows "test result: ok. 40 passed; 0 failed"
- [x] G7: README or docs mention PDF/HTML open + ask/refine — EVIDENCE: README.md "Opening pages" section updated with PDF and HTML support documentation
