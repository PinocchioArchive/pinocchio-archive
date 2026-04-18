import { useState, useRef, useEffect } from 'react';

interface Suggestion {
  value: string;
  count?: number;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  suggestions: Suggestion[];
  placeholder?: string;
  className?: string;
  onBlur?: () => void;
  onEnter?: () => void;
  autoFocus?: boolean;
}

export function AutocompleteInput({
  value,
  onChange,
  suggestions,
  placeholder,
  className = 'form-input',
  onBlur,
  onEnter,
  autoFocus,
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter suggestions by current input; exact-match case-insensitive
  // prefix hit first, then substring.
  const filtered = (() => {
    const q = value.trim().toLowerCase();
    if (!q) return suggestions.slice(0, 8);
    const prefix = suggestions.filter((s) =>
      s.value.toLowerCase().startsWith(q)
    );
    const substring = suggestions.filter(
      (s) =>
        !s.value.toLowerCase().startsWith(q) &&
        s.value.toLowerCase().includes(q)
    );
    return [...prefix, ...substring].slice(0, 8);
  })();

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const clickAway = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', clickAway);
    return () => document.removeEventListener('mousedown', clickAway);
  }, []);

  const select = (v: string) => {
    onChange(v);
    setOpen(false);
    setActiveIdx(-1);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      e.preventDefault();
      return;
    }
    if (!open) {
      if (e.key === 'Enter' && onEnter) {
        e.preventDefault();
        onEnter();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      if (activeIdx >= 0 && filtered[activeIdx]) {
        e.preventDefault();
        select(filtered[activeIdx].value);
      } else if (onEnter) {
        e.preventDefault();
        onEnter();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIdx(-1);
    }
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="text"
        className={className}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActiveIdx(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Defer blur so click on suggestion lands first.
          setTimeout(() => {
            setOpen(false);
            onBlur?.();
          }, 150);
        }}
        onKeyDown={handleKey}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <ul
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            background: 'var(--paper)',
            border: '1px solid var(--ink)',
            borderTop: 'none',
            margin: 0,
            padding: 0,
            listStyle: 'none',
            zIndex: 50,
            maxHeight: 220,
            overflowY: 'auto',
            boxShadow: '0 4px 12px rgba(26, 23, 19, 0.12)',
          }}
        >
          {filtered.map((s, i) => (
            <li
              key={s.value}
              onMouseDown={(e) => {
                e.preventDefault();
                select(s.value);
              }}
              onMouseEnter={() => setActiveIdx(i)}
              style={{
                padding: '6px 10px',
                fontFamily: 'var(--serif)',
                fontSize: 13,
                cursor: 'pointer',
                background:
                  i === activeIdx ? 'var(--paper-deep)' : 'transparent',
                borderBottom:
                  i < filtered.length - 1 ? '1px solid var(--rule)' : 'none',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span>{s.value}</span>
              {s.count !== undefined && (
                <span
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 10,
                    color: 'var(--ink-faded)',
                  }}
                >
                  {s.count}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
