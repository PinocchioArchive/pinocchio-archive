import type { NumericRangeGap } from '../lib/sheets';

// Renders a ghost card in place of a missing numeric range in the grid.
// Deliberately plain: no thumbnail, no metadata, no hover action. These
// are informational scholarly markers — "something that should be here
// isn't" — not clickable objects.
//
// Single-number gaps render as "M216 · 1 missing" (with "M216" prominent).
// Multi-number ranges render as "M45–M62 · 18 missing."

export function GapCard({ gap }: { gap: NumericRangeGap }) {
  const { prefix, from, to } = gap;
  const count = to - from + 1;
  const idLabel =
    count === 1 ? `${prefix}${from}` : `${prefix}${from}–${prefix}${to}`;

  return (
    <div
      className="card card-gap"
      role="presentation"
      aria-label={`Gap: ${idLabel}, ${count} missing`}
      title={
        count === 1
          ? `${prefix}${from} is not in the archive. The numeric sequence is continuous around it, so this sheet existed and is either lost or not yet acquired.`
          : `${count} consecutive missing sheets: ${prefix}${from} through ${prefix}${to}. None are in the archive but the sequence is continuous around them.`
      }
    >
      <div className="card-gap-inner">
        <div className="card-gap-id">{idLabel}</div>
        <div className="card-gap-meta">
          {count === 1 ? '1 missing' : `${count} missing`}
        </div>
        <svg
          className="card-gap-glyph"
          viewBox="0 0 48 32"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* A minimal "empty slot" glyph — dashed rectangle like an
              archivist's ghost, with a subtle diagonal line suggesting
              "nothing filed here." All strokes use currentColor so they
              pick up the card-gap-glyph color (ink-faded). */}
          <rect
            x="1"
            y="1"
            width="46"
            height="30"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
          <line
            x1="8"
            y1="8"
            x2="40"
            y2="24"
            stroke="currentColor"
            strokeWidth="0.75"
            opacity="0.4"
          />
        </svg>
      </div>
    </div>
  );
}
