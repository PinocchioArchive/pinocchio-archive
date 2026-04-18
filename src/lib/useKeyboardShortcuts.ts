import { useEffect } from 'react';

interface Shortcut {
  key: string;
  handler: (e: KeyboardEvent) => void;
  // If true, fires even when focus is in an input. Default false.
  whenTyping?: boolean;
  // Requires cmd (Mac) or ctrl (other). Default false.
  mod?: boolean;
}

// Registers a set of keyboard shortcuts at the window level.
// Skips execution if the user is currently typing in a form field,
// unless `whenTyping` is explicitly true for the shortcut.
export function useKeyboardShortcuts(shortcuts: Shortcut[]): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      for (const s of shortcuts) {
        if (s.key.toLowerCase() !== e.key.toLowerCase()) continue;
        if (s.mod && !(e.metaKey || e.ctrlKey)) continue;
        if (!s.mod && (e.metaKey || e.ctrlKey)) continue;
        if (isTyping && !s.whenTyping) continue;
        s.handler(e);
        break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcuts]);
}
