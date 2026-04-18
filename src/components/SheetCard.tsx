import { useState, useRef, useEffect } from 'react';
import type { ModelSheet } from '../types/schema';
import { resolutionTier } from '../lib/image';
import { toggleSheetInList, createList, type UserList } from '../lib/lists';

interface Props {
  sheet: ModelSheet;
  imageBase: string;
  onClick: () => void;
  focused?: boolean;
  userLists: UserList[];
  onListsChanged: () => void;
  selectMode?: boolean;
  selected?: boolean;
  onSelectToggle?: () => void;
}

export function SheetCard({
  sheet,
  imageBase,
  onClick,
  focused,
  userLists,
  onListsChanged,
  selectMode,
  selected,
  onSelectToggle,
}: Props) {
  const imageSrc = sheet.image_file ? `${imageBase}${sheet.image_file}` : '';
  const year = sheet.date_on_sheet?.slice(0, 4);
  const characterSummary =
    sheet.characters.length === 0
      ? '—'
      : sheet.characters.length === 1
      ? sheet.characters[0]
      : `${sheet.characters[0]} +${sheet.characters.length - 1}`;
  const tier = resolutionTier(sheet.image_width, sheet.image_height);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const memberCount = userLists.reduce(
    (n, l) => (l.sheet_ids.includes(sheet.id) ? n + 1 : n),
    0
  );

  const handleActivation = () => {
    if (selectMode) onSelectToggle?.();
    else onClick();
  };

  return (
    <div
      className="card"
      role="button"
      tabIndex={0}
      onClick={handleActivation}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleActivation();
        }
      }}
      aria-label={`${selectMode ? 'Toggle selection' : 'View'} ${sheet.id}`}
      style={{
        position: 'relative',
        cursor: 'pointer',
        ...(focused
          ? { outline: '2px solid var(--ink)', outlineOffset: '-2px' }
          : {}),
        ...(selected
          ? { outline: '2px solid var(--accent)', outlineOffset: '-2px' }
          : {}),
      }}
    >
      {selectMode && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            zIndex: 2,
            width: 20,
            height: 20,
            borderRadius: 3,
            border: '1.5px solid var(--ink)',
            background: selected ? 'var(--ink)' : 'var(--paper)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
          aria-hidden="true"
        >
          {selected && (
            <span
              style={{ color: 'var(--paper)', fontSize: 14, lineHeight: 1 }}
            >
              ✓
            </span>
          )}
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          display: 'flex',
          gap: 4,
          zIndex: 2,
          alignItems: 'flex-start',
        }}
      >
        {sheet.needs_research && (
          <span
            style={{
              background: 'var(--warn)',
              color: 'var(--paper)',
              padding: '2px 6px',
              fontFamily: 'var(--mono)',
              fontSize: 8,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
            title="Flagged for more research"
          >
            Research
          </span>
        )}
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            title={
              memberCount > 0
                ? `In ${memberCount} list${memberCount === 1 ? '' : 's'}`
                : 'Add to a list'
            }
            style={{
              width: 24,
              height: 24,
              padding: 0,
              border: '1px solid var(--rule)',
              background: memberCount > 0 ? 'var(--ink)' : 'var(--paper)',
              color: memberCount > 0 ? 'var(--paper)' : 'var(--ink)',
              cursor: 'pointer',
              fontSize: 12,
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label="Add to list"
            aria-expanded={menuOpen}
          >
            <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
              <path
                d="M1 1h8v10l-4-3-4 3V1z"
                stroke="currentColor"
                strokeWidth="1.2"
                fill={memberCount > 0 ? 'currentColor' : 'none'}
              />
            </svg>
          </button>
          {menuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                top: 28,
                right: 0,
                minWidth: 180,
                background: 'var(--paper)',
                border: '1px solid var(--ink)',
                padding: 4,
                zIndex: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                maxHeight: 260,
                overflowY: 'auto',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 9,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-faded)',
                  padding: '4px 6px',
                  borderBottom: '1px solid var(--rule)',
                }}
              >
                Add to list
              </div>
              {userLists.length === 0 && (
                <div
                  style={{
                    fontSize: 11,
                    fontStyle: 'italic',
                    color: 'var(--ink-faded)',
                    padding: '6px',
                  }}
                >
                  No lists yet.
                </div>
              )}
              {userLists.map((l) => {
                const inList = l.sheet_ids.includes(sheet.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => {
                      toggleSheetInList(l.id, sheet.id);
                      onListsChanged();
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 6px',
                      fontSize: 12,
                      textAlign: 'left',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--ink)',
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = 'var(--paper-deep)')
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = 'transparent')
                    }
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        width: 12,
                        fontFamily: 'var(--mono)',
                        color: inList ? 'var(--accent)' : 'transparent',
                      }}
                    >
                      ✓
                    </span>
                    <span style={{ flex: 1 }}>{l.name}</span>
                    <span
                      style={{
                        fontFamily: 'var(--mono)',
                        fontSize: 9,
                        color: 'var(--ink-faded)',
                      }}
                    >
                      {l.sheet_ids.length}
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  const name = prompt('Name for new list');
                  if (!name || !name.trim()) return;
                  const l = createList(name.trim());
                  toggleSheetInList(l.id, sheet.id);
                  onListsChanged();
                  setMenuOpen(false);
                }}
                style={{
                  padding: '4px 6px',
                  fontSize: 11,
                  fontStyle: 'italic',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--ink-soft)',
                  borderTop: '1px solid var(--rule)',
                  marginTop: 2,
                }}
              >
                + New list
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="card-image">
        {imageSrc ? (
          <img src={imageSrc} alt={sheet.title || sheet.id} loading="lazy" />
        ) : (
          <span className="card-image-placeholder">No Image</span>
        )}
        {tier === 'thumbnail' && imageSrc && (
          <span
            style={{
              position: 'absolute',
              bottom: 6,
              right: 6,
              background: 'rgba(168, 122, 58, 0.9)',
              color: 'var(--paper)',
              padding: '1px 5px',
              fontFamily: 'var(--mono)',
              fontSize: 8,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
            title="Low-resolution image — may need better source"
          >
            Low-res
          </span>
        )}
      </div>
      <div className="card-body">
        <div className="card-id">{sheet.id}</div>
        <h3 className="card-title">
          {sheet.title || (
            <em style={{ color: 'var(--ink-faded)' }}>Untitled</em>
          )}
        </h3>
        <div className="card-meta">
          {year && <span>{year}</span>}
          <span>{characterSummary}</span>
          {sheet.sequence_association && (
            <span>· {sheet.sequence_association}</span>
          )}
        </div>
      </div>
    </div>
  );
}
