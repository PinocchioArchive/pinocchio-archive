import type { ModelSheet } from '../types/schema';
import { resolutionTier } from '../lib/image';

interface Props {
  sheet: ModelSheet;
  imageBase: string;
  onClick: () => void;
  focused?: boolean;
}

export function SheetCard({ sheet, imageBase, onClick, focused }: Props) {
  const imageSrc = sheet.image_file ? `${imageBase}${sheet.image_file}` : '';
  const year = sheet.date_on_sheet?.slice(0, 4);
  const characterSummary =
    sheet.characters.length === 0
      ? '—'
      : sheet.characters.length === 1
      ? sheet.characters[0]
      : `${sheet.characters[0]} +${sheet.characters.length - 1}`;
  const tier = resolutionTier(sheet.image_width, sheet.image_height);

  return (
    <button
      className="card"
      onClick={onClick}
      aria-label={`View ${sheet.id}`}
      style={
        focused
          ? { outline: '2px solid var(--ink)', outlineOffset: '-2px' }
          : undefined
      }
    >
      <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4, zIndex: 1 }}>
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
        {sheet.in_my_physical_collection && (
          <span className="card-badge" style={{ position: 'static' }}>
            Owned
          </span>
        )}
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
    </button>
  );
}
