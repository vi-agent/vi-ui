import { useEffect, useRef } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShortcutDescriptor = {
  /** Modifier key: `meta` = Cmd on Mac / Win key elsewhere, `ctrl` = Ctrl */
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  key: string;
};

export type KeyboardShortcutHandlers = {
  /** Ctrl+Shift+Cmd+T — new session under current project */
  onNewSession?: () => void;
  /** Ctrl+Cmd+Backspace — archive current session (fires even from inputs) */
  onArchiveSession?: () => void;
  /** Ctrl+Cmd+Shift+ArrowUp — navigate to previous sidebar item */
  onNavigatePrev?: () => void;
  /** Ctrl+Cmd+Shift+ArrowDown — navigate to next sidebar item */
  onNavigateNext?: () => void;
  /** Cmd+/ — open shortcuts modal */
  onOpenShortcutsModal?: () => void;
  /** Ctrl+Cmd+Shift+R — start inline rename of the current session title */
  onRenameSession?: () => void;
};

// ---------------------------------------------------------------------------
// OS detection
// ---------------------------------------------------------------------------

/**
 * Returns true when running on a Mac/iOS device.
 * Safe to call at module level (reads navigator.platform).
 */
export const isMac = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform);

// ---------------------------------------------------------------------------
// Pure shortcut matcher (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Returns true when `event` matches the given shortcut descriptor.
 *
 * On Mac:
 *   - `meta`  → Cmd key  (event.metaKey)  — independent of ctrl
 *   - `ctrl`  → Ctrl key (event.ctrlKey)  — independent of meta
 *
 * On non-Mac (Windows / Linux):
 *   - Both `meta` and `ctrl` map to the Ctrl key (event.ctrlKey). A shortcut
 *     that sets either (or both) simply requires ctrlKey = true. This is
 *     because Cmd/Win is not a general shortcut key on those platforms, so
 *     all "Cmd+X" equivalents become "Ctrl+X". Descriptors that combine
 *     meta+ctrl on Mac still collapse to a single ctrlKey=true requirement.
 *   - A stray event.metaKey (Win key) causes rejection to avoid accidental
 *     matches when the user presses the Windows key.
 */
export function matchesShortcut(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  shortcut: ShortcutDescriptor,
  mac: boolean = isMac(),
): boolean {
  const eventKey = event.key.toLowerCase();
  const shortcutKey = shortcut.key.toLowerCase();

  if (eventKey !== shortcutKey) {
    return false;
  }

  if (Boolean(shortcut.shift) !== event.shiftKey) return false;
  if (Boolean(shortcut.alt) !== event.altKey) return false;

  if (mac) {
    // Mac: meta = Cmd (metaKey) and ctrl = Ctrl (ctrlKey) are independent.
    if (Boolean(shortcut.meta) !== event.metaKey) return false;
    if (Boolean(shortcut.ctrl) !== event.ctrlKey) return false;
  } else {
    // Non-Mac: both meta and ctrl collapse onto ctrlKey.
    // The shortcut requires ctrlKey iff meta OR ctrl is set in the descriptor.
    const shortcutNeedsCtrl = Boolean(shortcut.meta) || Boolean(shortcut.ctrl);
    if (shortcutNeedsCtrl !== event.ctrlKey) return false;
    // Reject spurious Win-key presses.
    if (event.metaKey) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Focus detection helper (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Returns true when keyboard focus is inside an interactive text input,
 * which should suppress most shortcuts (but not the archive shortcut).
 */
export function isTextInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;

  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return true;
  if ((el as HTMLElement).isContentEditable) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Shortcut definitions (canonical single source of truth)
// ---------------------------------------------------------------------------

/**
 * Returns shortcut definitions with OS-aware modifier labels.
 * Used by both the hook and the KeyboardShortcutsModal.
 */
export function getShortcutDefinitions(mac: boolean = isMac()): Array<{
  id: string;
  label: string;
  descriptor: ShortcutDescriptor;
  /** Human-readable key combo string, e.g. "⌘⌃⇧T" or "Ctrl+Ctrl+Shift+T" */
  display: string;
  /** Whether the shortcut fires even when focus is inside a text input */
  alwaysFires?: boolean;
}> {
  const mod = mac ? '⌘' : 'Ctrl';
  const ctrl = mac ? '⌃' : 'Ctrl';
  const shift = mac ? '⇧' : 'Shift';
  const backspace = mac ? '⌫' : 'Backspace';
  const sep = mac ? '' : '+';

  return [
    {
      id: 'new-session',
      label: 'New session (same project)',
      descriptor: { meta: true, ctrl: true, shift: true, key: 't' },
      display: mac
        ? `${ctrl}${shift}${mod}T`
        : `Ctrl${sep}Shift${sep}Ctrl${sep}T`,
    },
    {
      id: 'archive-session',
      label: 'Archive current session',
      descriptor: { meta: true, ctrl: true, key: 'backspace' },
      display: mac ? `${ctrl}${mod}${backspace}` : `Ctrl${sep}Ctrl${sep}${backspace}`,
      alwaysFires: true,
    },
    {
      id: 'navigate-prev',
      label: 'Navigate to previous session',
      descriptor: { meta: true, ctrl: true, shift: true, key: 'arrowup' },
      display: mac ? `${ctrl}${mod}${shift}↑` : `Ctrl${sep}Ctrl${sep}Shift${sep}↑`,
    },
    {
      id: 'navigate-next',
      label: 'Navigate to next session',
      descriptor: { meta: true, ctrl: true, shift: true, key: 'arrowdown' },
      display: mac ? `${ctrl}${mod}${shift}↓` : `Ctrl${sep}Ctrl${sep}Shift${sep}↓`,
    },
    {
      id: 'open-shortcuts-modal',
      label: 'Open keyboard shortcuts',
      descriptor: { meta: true, key: '/' },
      display: mac ? `${mod}/` : `Ctrl${sep}/`,
    },
    {
      id: 'rename-session',
      label: 'Rename current session',
      descriptor: { meta: true, ctrl: true, shift: true, key: 'r' },
      display: mac
        ? `${ctrl}${shift}${mod}R`
        : `Ctrl${sep}Shift${sep}Ctrl${sep}R`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Registers a single global `keydown` listener for all app keyboard shortcuts.
 *
 * Rules:
 * - Most shortcuts are suppressed when focus is inside a text input/textarea/
 *   contenteditable.
 * - The archive shortcut (`Ctrl+Cmd+Backspace`) always fires regardless of
 *   focus, since a user might want to archive while typing.
 * - The handlers object is read through a ref so callers can pass inline
 *   callbacks without causing the effect to re-run on every render.
 */
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  const handlersRef = useRef<KeyboardShortcutHandlers>(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const mac = isMac();
    const defs = getShortcutDefinitions(mac);

    const onKeyDown = (event: KeyboardEvent) => {
      const inputFocused = isTextInputFocused();

      for (const def of defs) {
        if (!matchesShortcut(event, def.descriptor, mac)) {
          continue;
        }

        // Suppress if inside a text input (unless the shortcut always fires).
        if (inputFocused && !def.alwaysFires) {
          continue;
        }

        event.preventDefault();

        switch (def.id) {
          case 'new-session':
            handlersRef.current.onNewSession?.();
            break;
          case 'archive-session':
            handlersRef.current.onArchiveSession?.();
            break;
          case 'navigate-prev':
            handlersRef.current.onNavigatePrev?.();
            break;
          case 'navigate-next':
            handlersRef.current.onNavigateNext?.();
            break;
          case 'open-shortcuts-modal':
            handlersRef.current.onOpenShortcutsModal?.();
            break;
          case 'rename-session':
            handlersRef.current.onRenameSession?.();
            break;
        }
        break; // Only fire the first matching shortcut.
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, []); // Empty deps — handlers are read via ref.
}
