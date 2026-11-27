//! Windows' own voice typing (#41, #39), opened in whatever field has the keyboard focus: Ledge synthesizes Win+H, the
//! shortcut Windows gives it. There is no public API that opens it, and Windows never says whether it is listening, so
//! the same call opens and closes it and Ledge shows no listening state. The field keeps the focus: the button that calls
//! this must not take it.

/// Virtual-key codes, as `winuser.h` names them. H is a virtual key, the same on every keyboard layout (AZERTY included).
pub const VK_SHIFT_L: u16 = 0xA0;
pub const VK_SHIFT_R: u16 = 0xA1;
pub const VK_CONTROL_L: u16 = 0xA2;
pub const VK_CONTROL_R: u16 = 0xA3;
pub const VK_ALT_L: u16 = 0xA4;
pub const VK_ALT_R: u16 = 0xA5;
pub const VK_WIN_L: u16 = 0x5B;
pub const VK_WIN_R: u16 = 0x5C;
pub const VK_H: u16 = 0x48;
/// An unassigned virtual key: pressed before a held Alt or Win is let go, so that letting it go alone opens neither the
/// window's menu nor the Start menu.
pub const VK_UNASSIGNED: u16 = 0xE8;

/// The modifiers a person may hold while clicking the button: each one held is let go first, or Windows would read
/// Ctrl+Win+H, Shift+Win+H… instead of Win+H.
pub const MODIFIERS: [u16; 8] = [VK_SHIFT_L, VK_SHIFT_R, VK_CONTROL_L, VK_CONTROL_R, VK_ALT_L, VK_ALT_R, VK_WIN_L, VK_WIN_R];

/// One synthesized key event: the virtual key, and whether it goes up (else down).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Key { pub vk: u16, pub up: bool }

const fn down(vk: u16) -> Key { Key { vk, up: false } }
const fn up(vk: u16) -> Key { Key { vk, up: true } }

/// The events that open (or close) voice typing, given the modifiers held right now: the held ones let go (after an
/// unassigned key when Alt or Win is among them), then Win down, H down and up, Win up.
pub fn win_h_sequence(held: &[u16]) -> Vec<Key> {
    let held: Vec<u16> = MODIFIERS.iter().copied().filter(|m| held.contains(m)).collect();
    let mut keys = Vec::with_capacity(held.len() + 6);
    if held.iter().any(|&m| matches!(m, VK_ALT_L | VK_ALT_R | VK_WIN_L | VK_WIN_R)) {
        keys.push(down(VK_UNASSIGNED));
        keys.push(up(VK_UNASSIGNED));
    }
    keys.extend(held.iter().map(|&m| up(m)));
    keys.extend([down(VK_WIN_L), down(VK_H), up(VK_H), up(VK_WIN_L)]);
    keys
}

/// The modifiers held right now, as Windows sees them.
#[cfg(windows)]
fn held_modifiers() -> Vec<u16> {
    use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    MODIFIERS.iter().copied().filter(|&vk| (unsafe { GetAsyncKeyState(vk as i32) } as u16 & 0x8000) != 0).collect()
}

/// Opens Windows' voice typing in the focused field, or closes it when it is open. True when every key event went out;
/// false outside Windows, or when Windows took fewer of them (another program's input blocked, a secure desktop).
#[cfg(windows)]
pub fn toggle() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY};
    let inputs: Vec<INPUT> = win_h_sequence(&held_modifiers()).into_iter().map(|k| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(k.vk), wScan: 0, dwFlags: if k.up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) }, time: 0, dwExtraInfo: 0 } },
    }).collect();
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    sent as usize == inputs.len()
}

#[cfg(not(windows))]
pub fn toggle() -> bool { false }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_held_is_win_down_h_down_h_up_win_up() {
        assert_eq!(win_h_sequence(&[]), vec![down(VK_WIN_L), down(VK_H), up(VK_H), up(VK_WIN_L)]);
    }

    #[test]
    fn a_held_shift_or_ctrl_is_let_go_first() {
        assert_eq!(win_h_sequence(&[VK_CONTROL_L, VK_SHIFT_R]), vec![up(VK_SHIFT_R), up(VK_CONTROL_L), down(VK_WIN_L), down(VK_H), up(VK_H), up(VK_WIN_L)]);
    }

    #[test]
    fn a_held_alt_or_win_is_let_go_after_an_unassigned_key() {
        assert_eq!(win_h_sequence(&[VK_ALT_L]), vec![down(VK_UNASSIGNED), up(VK_UNASSIGNED), up(VK_ALT_L), down(VK_WIN_L), down(VK_H), up(VK_H), up(VK_WIN_L)]);
        assert_eq!(&win_h_sequence(&[VK_WIN_R])[..3], &[down(VK_UNASSIGNED), up(VK_UNASSIGNED), up(VK_WIN_R)]);
    }

    #[test]
    fn keys_that_are_not_modifiers_are_ignored() {
        assert_eq!(win_h_sequence(&[0x41, VK_H]), win_h_sequence(&[]));
    }

    #[cfg(not(windows))]
    #[test]
    fn outside_windows_nothing_is_sent() {
        assert!(!toggle());
    }
}
