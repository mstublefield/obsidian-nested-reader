# Gate 1: Open panel accepts pdf/html

## Evidence
Location: `src-tauri/src/open_panel.rs` lines 22-27

The open panel now accepts multiple file types including PDF and HTML:

```rust
let types = NSArray::from_retained_slice(&[
    NSString::from_str("md"),
    NSString::from_str("markdown"),
    NSString::from_str("pdf"),
    NSString::from_str("html"),
    NSString::from_str("htm"),
]);
```

## Verification
- ⌘O opens panel that accepts .pdf, .html, .htm files
- ⌘⇧O (Add to Session) accepts same file types
- Folders remain selectable (unchanged behavior)

## Status
✅ PASS
