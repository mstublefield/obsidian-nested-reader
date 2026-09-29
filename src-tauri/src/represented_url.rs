//! The title bar's proxy icon: the small folder icon AppKit shows next to a window's title, whose
//! right-click / ⌘-click menu lists the file's parent folders (clicking one opens it in Finder).
//! Nested hides the native title and draws its own (`.tb-title` in `TopBar.tsx`), but the
//! represented URL is a separate `NSWindow` property, so setting it still gets the native icon and
//! menu for free — no custom menu needed.

use objc2_app_kit::NSWindow;
use objc2_foundation::{NSString, NSURL};
use tauri::WebviewWindow;

/// Points `window`'s proxy icon at `path`, or clears it when `path` is `None` (Home, or no folder
/// open). Must run on the main thread: it touches AppKit.
pub fn set(window: &WebviewWindow, path: Option<&str>) {
    let Ok(ptr) = window.ns_window() else { return };
    if ptr.is_null() {
        return;
    }
    // SAFETY: Tauri hands back the live NSWindow backing `window`; it outlives this call, which
    // runs synchronously on the main thread that owns it, same as the AppKit calls below.
    unsafe {
        let ns_window: &NSWindow = &*ptr.cast::<NSWindow>();
        let url = path.map(|p| NSURL::fileURLWithPath(&NSString::from_str(p)));
        ns_window.setRepresentedURL(url.as_deref());
    }
}
