import { useState, useRef, useEffect } from 'react';

interface Suggestion {
  value: string;
  count?: number;
}

interface Props {
  values: string[];
  onChange: (v: string[]) => void;
  suggestions: Suggestion[];
  placeholder?: string;
}

// Chip-style multi-value input. Enter or comma commits a value. Backspace on
// empty input removes the last chip. Arrow keys navigate the suggestion list.
export function TagInput({
  values,
  onChange,
  suggestions,
  placeholder,
}: Props) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const clickAway = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', clickAway);
    return () => document.removeEventListener('mousedown', clickAway);
  }, []);

  // Filter suggestions: exclude values already selected; rank by prefix match.
  const filtered = (() => {
    const q = text.trim().toLowerCase();
    const taken = new Set(values.map((v) => v.toLowerCase()));
    let pool = suggestions.filter((s) => !taken.has(s.value.toLowerCase()));
    if (q) {
      const prefix = pool.filter((s) => s.value.toLowerCase().startsWith(q));
      const sub = pool.filter(
        (s) =>
          !s.value.toLowerCase().startsWith(q) &&
          s.value.toLowerCase().includes(q)
      );
      pool = [...prefix, ...sub];
    }
    return pool.slice(0, 8);
  })();

  const commit = (v: string) => {
    const clean = v.trim();
    if (!clean) return;
    if (values.some((x) => x.toLowerCase() === clean.toLowerCase())) {
      setText('');
      return;
    }
    onChange([...values, clean]);
    setText('');
    setActiveIdx(-1);
  };

  const remove = (i: number) => {
    onChange(values.filter((_, idx) => idx !== i));
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (activeIdx >= 0 && filtered[activeIdx]) {
        commit(filtered[activeIdx].value);
      } else if (text.trim()) {
        commit(text);
      }
    } else if (e.key === 'Backspace' && !text && values.length) {
      e.preventDefault();
      remove(values.length - 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Escape') {
      // Mirror AutocompleteInput: swallow Escape only when the dropdown
      // was actually open, so an Escape in a closed state bubbles up to
      // the enclosing modal for cancel.
      if (open) {
        e.stopPropagation();
        setOpen(false);
      }
    }
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div
        className="form-input"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          minHeight: 36,
          padding: 4,
          cursor: 'text',
          alignItems: 'center',
        }}
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((v, i) => (
          <span
            key={i}
            style={{
              background: 'var(--paper-deep)',
              border: '1px solid var(--rule)',
              padding: '2px 6px 2px 8px',
              fontFamily: 'var(--mono)',
              fontSize: 11,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {v}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(i);
              }}
              style={{
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                color: 'var(--ink-faded)',
                padding: 0,
                marginLeft: 2,
                fontFamily: 'var(--mono)',
                fontSize: 13,
                lineHeight: 1,
              }}
              aria-label={`Remove ${v}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={text}
          placeholder={values.length === 0 ? placeholder : ''}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActiveIdx(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          autoComplete="off"
          style={{
            border: 'none',
            outline: 'none',
            background: 'transparent',
            flex: 1,
            minWidth: 80,
            fontFamily: 'var(--serif)',
            fontSize: 14,
            padding: '4px 6px',
            color: 'var(--ink)',
          }}
        />
      </div>
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
                commit(s.value);
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
