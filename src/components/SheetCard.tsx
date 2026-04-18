import { useState, useRef, useEffect } from 'react';
import type { ModelSheet } from '../types/schema';
import { resolutionTier } from '../lib/image';
import { computeResearchStatus } from '../lib/sheets';
import { toggleSheetInList, createList, type UserList } from '../lib/lists';
import { useDialog } from './Dialog';
import { NoImagePlaceholder } from './NoImagePlaceholder';

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
  const tier = resolutionTier(sheet.image_width, sheet.image_height);
  const researchStatus = computeResearchStatus(sheet);
  const { promptDialog } = useDialog();

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

  // Badges (list-membership bookmark + its menu) render inline next to the
  // sheet ID at the top of the card body. Extracted as a fragment to keep
  // the return JSX readable. (Needs-research now lives in the tag rail,
  // not as a separate badge here.)
  const badges = (
    <div className="card-badges-inline">
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
              : 'View / add to lists'
          }
          style={{
            width: 22,
            height: 22,
            padding: 0,
            border: '1px solid var(--rule)',
            borderRadius: 'var(--radius-sm)',
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
              top: 26,
              right: 0,
              minWidth: 180,
              background: 'var(--paper)',
              border: '1px solid var(--ink)',
              borderRadius: 'var(--radius-sm)',
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
                    padding: '6px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'var(--serif)',
                    fontSize: 12,
                    color: 'var(--ink)',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1px solid var(--ink)',
                      background: inList ? 'var(--ink)' : 'transparent',
                      color: 'var(--paper)',
                      fontSize: 10,
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                    aria-hidden="true"
                  >
                    {inList ? '✓' : ''}
                  </span>
                  {l.name}
                </button>
              );
            })}
            <button
              type="button"
              onClick={async () => {
                const name = await promptDialog({
                  title: 'New list',
                  message: 'Create a new list and add this sheet to it.',
                  placeholder: 'List name',
                });
                if (!name) return;
                const l = createList(name);
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
  );

  return (
    <div
      className="card"
      data-sheet-id={sheet.id}
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
          ? {
              outline: '2px solid var(--accent)',
              outlineOffset: '2px',
              borderColor: 'var(--accent)',
            }
          : {}),
        ...(selected
          ? {
              outline: '2px solid var(--accent)',
              outlineOffset: '2px',
            }
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

      <div className="card-image">
        {imageSrc ? (
          <img src={imageSrc} alt={sheet.title || sheet.id} loading="lazy" />
        ) : (
          <>
            <NoImagePlaceholder sheetId={sheet.id} compact />
            <span
              className="card-no-image-badge"
              title="This record has no image attached yet"
            >
              No image
            </span>
          </>
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
        <div className="card-id-row">
          <span className="card-id">{sheet.id}</span>
          {badges}
        </div>
        <h3 className="card-title">
          {sheet.title || (
            <em style={{ color: 'var(--ink-faded)', fontSize: '0.85em', fontWeight: 400 }}>Untitled</em>
          )}
        </h3>
        <TagPile sheet={sheet} />
      </div>
      <span
        className={`research-dot research-dot-${researchStatus}`}
        title={
          researchStatus === 'complete'
            ? 'Record complete — key scholarly fields populated'
            : researchStatus === 'some'
            ? 'Research pending — flagged or partial info'
            : 'Stub record — minimal info, needs significant research'
        }
        role="status"
      />
    </div>
  );
}

// Format a date_on_sheet string based on its precision. Returns a
// human-readable string suitable for display in the date chip, plus
// an optional precision hint shown in italic.
function formatDateChip(
  dateOnSheet: string | undefined,
  precision: string
): { display: string; hint?: string } | null {
  if (!dateOnSheet) return null;
  const d = dateOnSheet;
  // Year-only precision
  if (precision === 'year' || d.length === 4) {
    return { display: d.slice(0, 4), hint: '(year)' };
  }
  // Month-level precision — "1939-06" → "Jun 1939"
  if (precision === 'month' || d.length === 7) {
    const [y, m] = d.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const mi = parseInt(m, 10) - 1;
    if (mi >= 0 && mi < 12)
      return { display: `${months[mi]} ${y}`, hint: '(month)' };
    return { display: d.slice(0, 7) };
  }
  // Full date — "1939-06-30" → "Jun 30 1939"
  if (d.length >= 10) {
    const [y, m, day] = d.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const mi = parseInt(m, 10) - 1;
    if (mi >= 0 && mi < 12) {
      const dayNum = parseInt(day, 10);
      return { display: `${months[mi]} ${dayNum} ${y}` };
    }
  }
  // Fallback: show raw string, no precision hint
  return { display: d };
}

// Bottom-of-card tag rail. Characters, sequence, date, free-form tags,
// and needs-research flag get rendered as color-coded pills with prefix
// symbols. Clicking a chip dispatches a `filter:set` CustomEvent that
// App.tsx listens for and applies to the archive view — keeps the
// component decoupled from the filter state.
function TagPile({ sheet }: { sheet: ModelSheet }) {
  const dateInfo = formatDateChip(sheet.date_on_sheet, sheet.date_precision);
  const seqValue = sheet.sequence_association?.trim() || null;

  const apply = (e: React.MouseEvent, key: string, value: string) => {
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent('filter:set', { detail: { key, value } })
    );
  };

  // Nothing to show — skip the row entirely
  if (
    !dateInfo &&
    sheet.characters.length === 0 &&
    !seqValue &&
    sheet.tags.length === 0
  ) {
    return null;
  }

  const hasIdentityRow =
    sheet.characters.length > 0 || !!seqValue || !!dateInfo;

  return (
    <>
      {hasIdentityRow && (
        <div className="card-tagpile">
          {sheet.characters.map((c) => (
            <button
              key={`char-${c}`}
              className="tagchip tagchip-char"
              onClick={(e) => apply(e, 'character', c)}
              title={`Filter by character: ${c}`}
            >
              <span className="tagchip-icon">@</span>
              {c}
            </button>
          ))}
          {seqValue && (
            <button
              className="tagchip tagchip-seq"
              onClick={(e) =>
                apply(e, 'sequence_association', sheet.sequence_association!)
              }
              title="Filter by sequence"
            >
              <span className="tagchip-icon">§</span>
              {seqValue}
            </button>
          )}
          {dateInfo && (
            <button
              className="tagchip tagchip-date"
              onClick={(e) =>
                apply(e, 'year', dateInfo.display.match(/\d{4}/)?.[0] || '')
              }
              title={`Filter by date: ${dateInfo.display}`}
            >
              <span className="tagchip-icon tagchip-icon-svg" aria-hidden="true">
                <svg width="8" height="8" viewBox="0 0 8 8">
                  <rect x="0" y="0" width="3" height="3" />
                  <rect x="5" y="0" width="3" height="3" />
                  <rect x="0" y="5" width="3" height="3" />
                  <rect x="5" y="5" width="3" height="3" />
                </svg>
              </span>
              {dateInfo.display}
              {dateInfo.hint && (
                <span className="tagchip-hint"> {dateInfo.hint}</span>
              )}
            </button>
          )}
        </div>
      )}
      {sheet.tags.length > 0 && (
        <div className="card-tagpile card-tagzone">
          {sheet.tags.map((t) => (
            <button
              key={`tag-${t}`}
              className="tagchip tagchip-tag"
              onClick={(e) => apply(e, 'tag', t)}
              title={`Filter by tag: ${t}`}
            >
              <span className="tagchip-icon">#</span>
              {t}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
