import type { ModelSheet } from '../types/schema';

interface Props {
  sheet: ModelSheet;
  imageBase: string;
  onClick: () => void;
  focused?: boolean;
}

export function SheetListRow({ sheet, imageBase, onClick, focused }: Props) {
  const imageSrc = sheet.image_file ? `${imageBase}${sheet.image_file}` : '';
  const latestWebOcc =
    sheet.web_occurrences.length > 0
      ? [...sheet.web_occurrences].sort((a, b) =>
          b.checked_on.localeCompare(a.checked_on)
        )[0]
      : null;

  return (
    <button
      onClick={onClick}
      className="list-row"
      aria-label={`View ${sheet.id}`}
      style={
        focused
          ? { outline: '2px solid var(--ink)', outlineOffset: '-2px' }
          : undefined
      }
    >
      <div className="list-row-thumb">
        {imageSrc ? (
          <img src={imageSrc} alt="" loading="lazy" />
        ) : (
          <span
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 9,
              color: 'var(--ink-faded)',
            }}
          >
            —
          </span>
        )}
      </div>
      <div className="list-row-id">{sheet.id}</div>
      <div className="list-row-title">
        {sheet.title || (
          <em style={{ color: 'var(--ink-faded)' }}>Untitled</em>
        )}
      </div>
      <div className="list-row-chars">
        {sheet.characters.slice(0, 2).join(', ') +
          (sheet.characters.length > 2
            ? ` +${sheet.characters.length - 2}`
            : '')}
      </div>
      <div className="list-row-date">{sheet.date_on_sheet || '—'}</div>
      <div className="list-row-webocc">
        {latestWebOcc ? latestWebOcc.count.toLocaleString() : '—'}
      </div>
      <div className="list-row-flags">
        {sheet.in_my_physical_collection && (
          <span
            className="card-badge"
            style={{ position: 'static', fontSize: 8 }}
          >
            Owned
          </span>
        )}
        {sheet.needs_research && (
          <span
            style={{
              background: 'var(--warn)',
              color: 'var(--paper)',
              padding: '1px 5px',
              fontFamily: 'var(--mono)',
              fontSize: 8,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            Research
          </span>
        )}
      </div>
    </button>
  );
}
