# Gate 7: README mentions PDF/HTML open + ask/refine

## Evidence
Location: `README.md` "Opening pages" section

### Added documentation
New paragraph after "From Finder" section:

> **PDF and HTML support.** Nested can also open `.pdf`, `.html`, and `.htm` files alongside Markdown files. Text content is extracted from PDFs and HTML for reading, asking, and searching. PDF and HTML files are read-only: **Refine**, **New Page**, and **Deep Dive** work normally and create new `.md` files, but the original PDF or HTML file is never modified. Use ⌘O or ⌘⇧O to add PDF/HTML files to your session, or drop them into the window.

### Coverage
- ✅ Supported file types listed
- ✅ Text extraction mentioned
- ✅ Read-only nature explained
- ✅ Refine behavior documented (creates .md companions)
- ✅ How to open (⌘O, ⌘⇧O, drop)
- ✅ Ask/search work normally (implicit in "reading, asking, and searching")

## Status
✅ PASS - User-facing documentation complete
