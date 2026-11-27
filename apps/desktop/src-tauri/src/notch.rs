use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};

/// The notch's window label (`tauri.conf.json`).
pub const NOTCH: &str = "notch";

/// The cursor poll's cadence away from the island.
const CURSOR_POLL: Duration = Duration::from_millis(50);
/// The cadence while the cursor is within `NEAR_RECT_REACH` of the drawn rectangle: the window must take the mouse
/// before a press lands on the island, so the hand-over is decided within a frame interval there.
const NEAR_POLL: Duration = Duration::from_millis(16);
/// How far from the drawn rectangle (logical px) the fast cadence starts.
const NEAR_RECT_REACH: f64 = 40.0;
/// Re-read the chosen monitor every 40 polls (2 s): resolution, scale or taskbar changes are picked up.
const MONITOR_REFRESH_TICKS: u32 = 40;
/// The window that was in the foreground when a keyboard open took focus (a raw HWND), handed back by `release_focus`.
#[derive(Default)]
pub struct PrevForeground(Mutex<Option<isize>>);

/// The Screen setting: the id of the monitor the overlay lives on (`None`: the primary), a generation bumped on every
/// change so the poller re-reads its monitor at once, the island's rectangle the webview last sent and the window
/// rectangle last placed.
#[derive(Default)]
pub struct Screen(Mutex<ScreenState>);
#[derive(Default)]
struct ScreenState {
    chosen: Option<String>,
    gen: u64,
    /// The island's rectangle in logical px; `None` at rest (nothing drawn, every click goes through).
    last_frame: Option<(i32, i32, u32, u32)>,
    /// The window rectangle last placed (physical px): the whole work area of the chosen monitor. The window is
    /// placed once and again only when that area changes; the frame only sets its region.
    placed: Option<(i32, i32, u32, u32)>,
}

/// One monitor as the Settings view lists it: logical sizes, the work area's height, whether it is the primary.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MonitorInfo {
    pub id: String,
    pub name: Option<String>,
    pub width: u32,
    pub height: u32,
    #[serde(rename = "workH")]
    pub work_h: u32,
    #[serde(rename = "workW")]
    pub work_w: u32,
    pub primary: bool,
}

/// The chosen monitor in physical px: its work area and its scale factor.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub scale: f64,
}

fn area_of(m: &tauri::window::Monitor) -> Area {
    let wa = m.work_area();
    Area { x: wa.position.x, y: wa.position.y, w: wa.size.width, h: wa.size.height, scale: m.scale_factor() }
}

/// A monitor's stable id: its name (`\\.\DISPLAY1` on Windows), or its index when the OS gives none.
fn monitor_id(m: &tauri::window::Monitor, index: usize) -> String {
    m.name().cloned().unwrap_or_else(|| format!("#{index}"))
}

/// The index of the monitor to use: `chosen` while it is plugged in, otherwise the primary.
pub fn choose(chosen: Option<&str>, ids: &[String], primary: usize) -> usize {
    chosen.and_then(|c| ids.iter().position(|id| id == c)).unwrap_or(primary)
}

/// Every monitor, with the index of the primary one (0 when the OS reports none).
fn monitors(app: &AppHandle) -> (Vec<tauri::window::Monitor>, usize) {
    let all = app.available_monitors().unwrap_or_default();
    let primary = app.primary_monitor().ok().flatten();
    let index = primary.and_then(|p| all.iter().position(|m| m.position() == p.position())).unwrap_or(0);
    (all, index)
}

/// The monitor the overlay lives on: the chosen one when present, else the primary.
fn target_monitor(app: &AppHandle, chosen: Option<&str>) -> Option<tauri::window::Monitor> {
    let (all, primary) = monitors(app);
    if all.is_empty() { return None; }
    let ids: Vec<String> = all.iter().enumerate().map(|(i, m)| monitor_id(m, i)).collect();
    all.into_iter().nth(choose(chosen, &ids, primary))
}

fn chosen_of(screen: &Screen) -> Option<String> {
    screen.0.lock().ok().and_then(|s| s.chosen.clone())
}

fn target_area(app: &AppHandle, screen: &Screen) -> Area {
    target_monitor(app, chosen_of(screen).as_deref()).map(|m| area_of(&m)).unwrap_or(Area { x: 0, y: 0, w: 1920, h: 1080, scale: 1.0 })
}

/// Physical position and size of a frame given in logical px relative to the work area's top-left corner.
pub fn frame_rect(area: Area, left: i32, top: i32, width: u32, height: u32) -> (i32, i32, u32, u32) {
    let s = area.scale;
    (
        area.x + (left as f64 * s).round() as i32,
        area.y + (top as f64 * s).round() as i32,
        (width as f64 * s).round() as u32,
        (height as f64 * s).round() as u32,
    )
}

/// The window rectangle in physical px: the whole work area of the chosen monitor.
pub fn window_rect_of(area: Area) -> (i32, i32, u32, u32) { (area.x, area.y, area.w, area.h) }

/// True when the physical `cursor` is in the rectangle `(x, y, width, height)`; the right and bottom edges are exclusive.
pub fn inside_rect(cursor: (i32, i32), rect: (i32, i32, u32, u32)) -> bool {
    let (x, y, w, h) = rect;
    cursor.0 >= x && cursor.0 < x + w as i32 && cursor.1 >= y && cursor.1 < y + h as i32
}

/// The poller's sleep: `NEAR_POLL` while the physical `cursor` is within `NEAR_RECT_REACH` (logical px, so `scale`d)
/// of the drawn rectangle `rect`, `CURSOR_POLL` otherwise or while nothing is drawn.
pub fn poll_interval(rect: Option<(i32, i32, u32, u32)>, cursor: (i32, i32), scale: f64) -> Duration {
    let Some((x, y, w, h)) = rect else { return CURSOR_POLL };
    let reach = (NEAR_RECT_REACH * scale).round() as i32;
    let grown = (x - reach, y - reach, w + 2 * reach as u32, h + 2 * reach as u32);
    if inside_rect(cursor, grown) { NEAR_POLL } else { CURSOR_POLL }
}

/// Sets the frame: the rectangle of the floating island, `(left, top)` `width` x `height` in logical px from the work
/// area's top-left corner, sent at every step of its movement. A zero width or height is the island at rest: nothing is
/// drawn, so the window takes the mouse nowhere and every click reaches the windows beneath (`frame_of`).
/// The window itself covers the whole work area of the chosen monitor and is placed once (and again only when that area changes), so nothing moves
/// or resizes the webview while the surface animates and the shell and the page can never disagree for a frame (the
/// blink between two shapes when the window moved and the page was presented at its new offset in different compositor
/// frames). The frame only tells the cursor poller where the drawing is: the window takes the mouse inside it and lets
/// it through everywhere else (`set_ignore_cursor_events`), so clicks beside the island reach the windows beneath. It is
/// not a window region: a region makes DWM drop the window's alpha, and everything in it the page leaves clear shows white.
#[tauri::command]
pub async fn set_frame(window: WebviewWindow, left: i32, top: i32, width: u32, height: u32, screen: tauri::State<'_, Screen>) -> Result<(), String> {
    if let Ok(mut s) = screen.0.lock() { s.last_frame = frame_of(left, top, width, height); }
    let area = target_area(window.app_handle(), &screen);
    place_on(&window, area, &screen)
}

/// The frame to keep: `None` when the webview sent an empty rectangle (the island at rest).
pub fn frame_of(left: i32, top: i32, width: u32, height: u32) -> Option<(i32, i32, u32, u32)> {
    if width == 0 || height == 0 { None } else { Some((left, top, width, height)) }
}

/// Places the window on the whole of `area` unless it is already there.
fn place_on(window: &WebviewWindow, area: Area, screen: &Screen) -> Result<(), String> {
    let win = window_rect_of(area);
    let placed = screen.0.lock().ok().and_then(|s| s.placed);
    if placed != Some(win) {
        place_window(window, win.0, win.1, win.2, win.3)?;
        if let Ok(mut s) = screen.0.lock() { s.placed = Some(win); }
    }
    Ok(())
}

/// The monitors the Settings view offers, in the OS order.
#[tauri::command]
pub fn list_monitors(app: AppHandle) -> Vec<MonitorInfo> {
    let (all, primary) = monitors(&app);
    all.iter().enumerate().map(|(i, m)| {
        let s = m.scale_factor();
        let logical = |v: u32| (v as f64 / s).round() as u32;
        MonitorInfo { id: monitor_id(m, i), name: m.name().cloned(), width: logical(m.size().width), height: logical(m.size().height), work_h: logical(m.work_area().size.height), work_w: logical(m.work_area().size.width), primary: i == primary }
    }).collect()
}

/// Applies the Screen setting (`None`: the primary monitor) and moves the window there at once; the page keeps drawing
/// at the frame it last asked for. A monitor that is not plugged in falls back to the primary until it comes back.
#[tauri::command]
pub fn set_monitor(window: WebviewWindow, id: Option<String>, screen: tauri::State<'_, Screen>) -> Result<(), String> {
    let placed = match screen.0.lock() {
        Ok(mut s) => { s.chosen = id; s.gen = s.gen.wrapping_add(1); s.placed.is_some() }
        Err(_) => return Err("screen state poisoned".into()),
    };
    if placed {
        place_on(&window, target_area(window.app_handle(), &screen), &screen)?;
    }
    Ok(())
}

/// The window's HWND for this crate's `windows` version: Tauri's may come from another one, so go through the raw handle.
#[cfg(windows)]
fn hwnd_of(window: &WebviewWindow) -> Result<windows::Win32::Foundation::HWND, String> {
    let raw = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    Ok(windows::Win32::Foundation::HWND(raw as *mut core::ffi::c_void))
}

#[cfg(windows)]
fn place_window(window: &WebviewWindow, x: i32, y: i32, w: u32, h: u32) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};
    let hwnd = hwnd_of(window)?;
    unsafe { SetWindowPos(hwnd, HWND::default(), x, y, w as i32, h as i32, SWP_NOACTIVATE | SWP_NOZORDER) }.map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn place_window(window: &WebviewWindow, x: i32, y: i32, w: u32, h: u32) -> Result<(), String> {
    window.set_position(tauri::PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    window.set_size(tauri::PhysicalSize::new(w, h)).map_err(|e| e.to_string())
}

/// Shows and focuses the overlay so single-letter keys reach the webview (keyboard opens only). The window that had the
/// foreground is remembered first (unless it is the overlay itself), so `release_focus` can give it back.
#[tauri::command]
pub async fn focus_overlay(window: WebviewWindow, prev: tauri::State<'_, PrevForeground>) -> Result<(), String> {
    if let Some(fg) = foreground_other_than(&window) {
        if let Ok(mut p) = prev.0.lock() { *p = Some(fg); }
    }
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

/// Gives the foreground back to the window remembered by `focus_overlay` (a keyboard-opened surface folded away), so
/// typing reaches the terminal again. True when it was restored; false when nothing was remembered or it is gone.
#[tauri::command]
pub fn release_focus(prev: tauri::State<'_, PrevForeground>) -> bool {
    let taken = match prev.0.lock() { Ok(mut p) => p.take(), Err(_) => None };
    match taken { Some(raw) => restore_foreground(raw), None => false }
}

#[cfg(windows)]
fn foreground_other_than(window: &WebviewWindow) -> Option<isize> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    let fg = unsafe { GetForegroundWindow() }.0 as isize;
    if fg == 0 { return None; }
    // Tauri's HWND may come from another `windows` crate version: compare raw values.
    let own = window.hwnd().ok().map(|h| h.0 as isize);
    if own == Some(fg) { None } else { Some(fg) }
}

#[cfg(not(windows))]
fn foreground_other_than(_window: &WebviewWindow) -> Option<isize> { None }

#[cfg(windows)]
fn restore_foreground(raw: isize) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{IsWindow, SetForegroundWindow};
    let hwnd = HWND(raw as *mut core::ffi::c_void);
    // The overlay holds the foreground at this point, so Windows lets it hand the foreground on.
    unsafe { IsWindow(hwnd).as_bool() && SetForegroundWindow(hwnd).as_bool() }
}

#[cfg(not(windows))]
fn restore_foreground(_raw: isize) -> bool { false }

#[cfg(windows)]
fn cursor_position() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p) }.ok()?;
    Some((p.x, p.y))
}

#[cfg(not(windows))]
fn cursor_position() -> Option<(i32, i32)> { None }

/// The rectangle the overlay draws in physical px: the last frame, on `area`; `None` at rest. The window itself covers the
/// whole work area, so it takes the mouse inside this rectangle only.
fn drawn_rect(app: &AppHandle, area: Area) -> Option<(i32, i32, u32, u32)> {
    let (left, top, width, height) = app.state::<Screen>().0.lock().ok()?.last_frame?;
    Some(frame_rect(area, left, top, width, height))
}

/// Polls the cursor every 50 ms (16 ms within reach of the island): hands the window the mouse while the cursor is on
/// the island and lets it through to the windows beneath everywhere else, and always while the island is at rest.
fn spawn_cursor_poller(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut seen_screen: u64 = 0;
        let mut area: Option<Area> = None;
        let mut tick: u32 = 0;
        // Whether the window takes the mouse; `None` until the first tick decides it.
        let mut takes_mouse: Option<bool> = None;
        let mut sleep = CURSOR_POLL;
        loop {
            std::thread::sleep(sleep);
            let (chosen, screen_gen) = match app.state::<Screen>().0.lock() { Ok(s) => (s.chosen.clone(), s.gen), Err(_) => continue };
            if tick % MONITOR_REFRESH_TICKS == 0 || screen_gen != seen_screen {
                seen_screen = screen_gen;
                if let Some(m) = target_monitor(&app, chosen.as_deref()) { area = Some(area_of(&m)); }
            }
            tick = tick.wrapping_add(1);
            let (Some(a), Some(c)) = (area, cursor_position()) else { continue };
            let rect = drawn_rect(&app, a);
            let on_island = rect.is_some_and(|r| inside_rect(c, r));
            if takes_mouse != Some(on_island) {
                if let Some(w) = app.get_webview_window(NOTCH) {
                    if w.set_ignore_cursor_events(!on_island).is_ok() { takes_mouse = Some(on_island); }
                }
            }
            sleep = poll_interval(rect, c, a.scale);
        }
    });
}

/// Readies the notch window: on top of everything, letting the mouse through until the poller finds the cursor on the
/// island, and the poller itself. Runs whatever the launch shows, so the notch is there even from the tray.
pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(NOTCH) {
        let _ = w.set_always_on_top(true);
        let _ = w.set_ignore_cursor_events(true);
    }
    spawn_cursor_poller(app.handle().clone());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{choose, frame_of, frame_rect, inside_rect, poll_interval, window_rect_of, Area, CURSOR_POLL, NEAR_POLL};

    #[test] fn the_window_takes_the_mouse_inside_the_drawn_rectangle_only() {
        let rect = (100, 0, 200, 60);
        assert!(inside_rect((100, 0), rect));
        assert!(inside_rect((299, 59), rect));
        assert!(!inside_rect((300, 0), rect)); // the right edge is exclusive
        assert!(!inside_rect((150, 60), rect)); // so is the bottom one
        assert!(!inside_rect((99, 30), rect));
    }

    #[test] fn the_poll_quickens_within_reach_of_the_drawn_rectangle() {
        let rect = Some((100, 0, 200, 60));
        assert_eq!(poll_interval(rect, (150, 30), 1.0), NEAR_POLL); // inside
        assert_eq!(poll_interval(rect, (60, 30), 1.0), NEAR_POLL); // 40 px to the left
        assert_eq!(poll_interval(rect, (59, 30), 1.0), CURSOR_POLL);
        assert_eq!(poll_interval(rect, (150, 99), 1.0), NEAR_POLL); // 40 px below: the rectangle grown by the reach keeps exclusive edges
        assert_eq!(poll_interval(rect, (150, 100), 1.0), CURSOR_POLL);
        assert_eq!(poll_interval(rect, (150, 139), 2.0), NEAR_POLL); // the reach is in logical px: 80 physical at 200%
        assert_eq!(poll_interval(rect, (150, 140), 2.0), CURSOR_POLL);
        assert_eq!(poll_interval(None, (0, 0), 1.0), CURSOR_POLL); // nothing drawn yet
    }

    #[test] fn the_chosen_monitor_is_used_while_plugged_in_else_the_primary() {
        let ids: Vec<String> = ["\\\\.\\DISPLAY1", "\\\\.\\DISPLAY2"].iter().map(|s| s.to_string()).collect();
        assert_eq!(choose(None, &ids, 0), 0);
        assert_eq!(choose(Some("\\\\.\\DISPLAY2"), &ids, 0), 1);
        assert_eq!(choose(Some("\\\\.\\DISPLAY3"), &ids, 0), 0); // unplugged: back to the primary
        assert_eq!(choose(Some("#1"), &["#0".to_string(), "#1".to_string()], 0), 1); // unnamed monitors go by index
    }

    const AREA: Area = Area { x: 0, y: 0, w: 2880, h: 1548, scale: 1.5 };
    const LEFT_TASKBAR: Area = Area { x: 72, y: 0, w: 1848, h: 1080, scale: 1.0 };
    const TOP_TASKBAR: Area = Area { x: 0, y: 48, w: 1920, h: 1032, scale: 1.0 };

    #[test] fn frame_is_placed_on_the_work_area_in_physical_px() {
        assert_eq!(frame_rect(AREA, 770, 0, 380, 400), (1155, 0, 570, 600));
        assert_eq!(frame_rect(LEFT_TASKBAR, 100, 0, 117, 38), (172, 0, 117, 38));
        assert_eq!(frame_rect(TOP_TASKBAR, 900, 0, 117, 38), (900, 48, 117, 38));
    }

    #[test] fn the_window_is_the_whole_work_area() {
        assert_eq!(window_rect_of(AREA), (0, 0, 2880, 1548));
        assert_eq!(window_rect_of(LEFT_TASKBAR), (72, 0, 1848, 1080));
        assert_eq!(window_rect_of(TOP_TASKBAR), (0, 48, 1920, 1032));
    }

    #[test] fn an_empty_frame_is_the_island_at_rest_and_every_click_goes_through() {
        assert_eq!(frame_of(0, 0, 0, 0), None);
        assert_eq!(frame_of(924, 8, 0, 36), None); // no width: nothing drawn
        assert_eq!(frame_of(924, 8, 72, 0), None); // no height either
        assert_eq!(frame_of(924, 8, 72, 36), Some((924, 8, 72, 36))); // the pill, 8 px under the edge
    }
}
