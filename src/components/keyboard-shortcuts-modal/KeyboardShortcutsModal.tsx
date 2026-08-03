import { useEffect } from 'react';
import { X, Keyboard } from 'lucide-react';

import { isMac, getShortcutDefinitions } from '../../hooks/useKeyboardShortcuts';
import { Button } from '../../shared/view/ui';

type KeyboardShortcutsModalProps = {
  open: boolean;
  onClose: () => void;
};

/**
 * Modal that lists all keyboard shortcuts with OS-appropriate key symbols.
 * Dismissable via the close button, the Escape key, or a backdrop click.
 */
export default function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  const mac = isMac();
  const shortcuts = getShortcutDefinitions(mac);

  // Dismiss on Escape key.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
      aria-label="Keyboard Shortcuts"
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Keyboard className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Keyboard Shortcuts</h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Shortcut list */}
        <div className="p-5">
          <ul className="space-y-2">
            {shortcuts.map((shortcut) => (
              <li
                key={shortcut.id}
                className="flex items-center justify-between gap-4 rounded-lg py-2"
              >
                <span className="text-sm text-foreground">{shortcut.label}</span>
                <kbd
                  className="shrink-0 rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground"
                  aria-label={shortcut.display}
                >
                  {shortcut.display}
                </kbd>
              </li>
            ))}
          </ul>

          {/* Slash commands section */}
          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Slash commands
            </p>
            <ul className="space-y-2">
              <li className="flex items-center justify-between gap-4 rounded-lg py-2">
                <span className="text-sm text-foreground">Compress conversation history to free context</span>
                <kbd className="shrink-0 rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                  /compact
                </kbd>
              </li>
            </ul>
          </div>
        </div>

        {/* Footer hint */}
        <div className="border-t border-border px-5 py-3">
          <p className="text-center text-xs text-muted-foreground">
            Press <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">Esc</kbd> to close
          </p>
        </div>
      </div>
    </div>
  );
}
