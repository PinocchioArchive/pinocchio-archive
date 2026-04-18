// Custom dialog component + context-based hooks that replace native
// window.prompt / window.confirm / window.alert with styled equivalents.
//
// Native browser dialogs are entirely unstyled and break the archival
// aesthetic of the app. These hooks provide a promise-based API that's
// nearly drop-in compatible (you await a Promise<string | null> or
// Promise<boolean> instead of getting the value synchronously).
//
// Usage from any component (after wrapping app in <DialogProvider>):
//
//   const { promptDialog, confirmDialog, alertDialog } = useDialog();
//   const name = await promptDialog({ title: 'Name for new list' });
//   if (!name) return;
//
//   const ok = await confirmDialog({
//     title: 'Delete sheet?',
//     message: 'This cannot be undone.',
//     confirmLabel: 'Delete',
//     destructive: true,
//   });

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

// ----------------------------- Types -----------------------------

interface PromptOptions {
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface AlertOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
}

interface DialogContextValue {
  promptDialog: (opts: PromptOptions) => Promise<string | null>;
  confirmDialog: (opts: ConfirmOptions) => Promise<boolean>;
  alertDialog: (opts: AlertOptions) => Promise<void>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx)
    throw new Error('useDialog must be used within a <DialogProvider>');
  return ctx;
}

// ----------------------------- Provider -----------------------------

type DialogState =
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void }
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'alert'; opts: AlertOptions; resolve: () => void }
  | null;

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DialogState>(null);

  const promptDialog = useCallback((opts: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      setState({ kind: 'prompt', opts, resolve });
    });
  }, []);

  const confirmDialog = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ kind: 'confirm', opts, resolve });
    });
  }, []);

  const alertDialog = useCallback((opts: AlertOptions) => {
    return new Promise<void>((resolve) => {
      setState({ kind: 'alert', opts, resolve });
    });
  }, []);

  const close = useCallback(() => setState(null), []);

  return (
    <DialogContext.Provider value={{ promptDialog, confirmDialog, alertDialog }}>
      {children}
      {state && <DialogHost state={state} close={close} />}
    </DialogContext.Provider>
  );
}

// ----------------------------- Host -----------------------------

function DialogHost({
  state,
  close,
}: {
  state: NonNullable<DialogState>;
  close: () => void;
}) {
  const [value, setValue] = useState(
    state.kind === 'prompt' ? state.opts.defaultValue || '' : ''
  );
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus the input (or the confirm button) when the dialog opens
  useEffect(() => {
    const t = setTimeout(() => {
      if (state.kind === 'prompt') inputRef.current?.focus();
      else inputRef.current?.focus(); // focus "confirm" button for non-prompt
    }, 20);
    return () => clearTimeout(t);
  }, [state.kind]);

  // Escape key closes / cancels
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (state.kind === 'prompt') state.resolve(null);
        else if (state.kind === 'confirm') state.resolve(false);
        else state.resolve();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, close]);

  const onSubmit = () => {
    if (state.kind === 'prompt') {
      state.resolve(value.trim() || null);
    } else if (state.kind === 'confirm') {
      state.resolve(true);
    } else {
      state.resolve();
    }
    close();
  };

  const onCancel = () => {
    if (state.kind === 'prompt') state.resolve(null);
    else if (state.kind === 'confirm') state.resolve(false);
    else state.resolve();
    close();
  };

  const title = state.opts.title;
  const message = 'message' in state.opts ? state.opts.message : undefined;
  const confirmLabel =
    state.opts.confirmLabel ||
    (state.kind === 'alert'
      ? 'OK'
      : state.kind === 'confirm'
      ? 'Confirm'
      : 'Save');
  const cancelLabel =
    (state.kind !== 'alert' && state.opts.cancelLabel) || 'Cancel';
  const destructive =
    state.kind === 'confirm' && !!state.opts.destructive;

  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        // Only dismiss on backdrop click, not content click
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="dialog" role="dialog" aria-labelledby="dialog-title">
        <div className="dialog-header">
          <h2 id="dialog-title" className="dialog-title">
            {title}
          </h2>
        </div>
        <div className="dialog-body">
          {message && <p className="dialog-message">{message}</p>}
          {state.kind === 'prompt' && (
            <input
              ref={inputRef}
              type="text"
              className="dialog-input"
              value={value}
              placeholder={state.opts.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onSubmit();
                }
              }}
            />
          )}
        </div>
        <div className="dialog-actions">
          {state.kind !== 'alert' && (
            <button
              type="button"
              className="dialog-btn dialog-btn-cancel"
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={state.kind !== 'prompt' ? inputRef as any : undefined}
            type="button"
            className={`dialog-btn ${
              destructive ? 'dialog-btn-destructive' : 'dialog-btn-confirm'
            }`}
            onClick={onSubmit}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
