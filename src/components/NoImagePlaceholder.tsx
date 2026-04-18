// Aesthetic placeholder shown in place of a missing image. Rendered
// inline as SVG so it inherits the ink/paper color palette via CSS
// variables and scales cleanly at any size.
//
// Design: a "filing card waiting for its photograph" — an archival
// paper rectangle with a faint monogram M, the sheet's ID across the
// top like a caption slip, and a small centered camera-aperture glyph
// that quietly says "visual pending." No cartoons, no error iconography.
// Meant to read as "the record exists and we're waiting on the image."

interface Props {
  sheetId?: string;
  // When true (card context), render a compact variant with the ID
  // not shown (the card's own ID pill already displays it). When
  // false (detail context, standalone), render the full variant
  // with the ID caption at the top.
  compact?: boolean;
}

export function NoImagePlaceholder({ sheetId, compact = false }: Props) {
  return (
    <div
      className={`no-image-placeholder ${
        compact ? 'no-image-placeholder-compact' : ''
      }`}
      aria-label="No image attached"
    >
      <svg
        viewBox="0 0 200 260"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {/* Faint paper rectangle with subtle double border to suggest a
            mounted archival photograph that is currently absent. */}
        <rect
          x="8"
          y="8"
          width="184"
          height="244"
          fill="var(--paper)"
          stroke="var(--rule)"
          strokeWidth="1"
        />
        <rect
          x="16"
          y="16"
          width="168"
          height="228"
          fill="none"
          stroke="var(--rule)"
          strokeWidth="0.5"
        />

        {/* Caption slip at top — horizontal line where a typed label
            would go. Shows the sheet ID if provided (full variant). */}
        {!compact && sheetId && (
          <text
            x="100"
            y="40"
            textAnchor="middle"
            fontFamily="var(--mono), ui-monospace, monospace"
            fontSize="10"
            letterSpacing="2"
            fill="var(--ink-faded)"
            style={{ textTransform: 'uppercase' }}
          >
            {sheetId}
          </text>
        )}
        <line
          x1="30"
          y1={compact ? 50 : 54}
          x2="170"
          y2={compact ? 50 : 54}
          stroke="var(--rule)"
          strokeWidth="0.5"
        />

        {/* Centered aperture / lens glyph — concentric arcs suggesting a
            camera iris. Reads as "photograph pending" without being
            literal. */}
        <g
          transform="translate(100 140)"
          fill="none"
          stroke="var(--ink-faded)"
          strokeWidth="1"
          opacity="0.55"
        >
          <circle cx="0" cy="0" r="36" />
          <circle cx="0" cy="0" r="24" strokeWidth="0.75" />
          {/* Six aperture blades — simplified as short tangent strokes. */}
          {[0, 60, 120, 180, 240, 300].map((deg) => {
            const rad = (deg * Math.PI) / 180;
            const x1 = Math.cos(rad) * 24;
            const y1 = Math.sin(rad) * 24;
            const x2 = Math.cos(rad) * 36;
            const y2 = Math.sin(rad) * 36;
            return (
              <line
                key={deg}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                strokeWidth="0.75"
              />
            );
          })}
          <circle cx="0" cy="0" r="4" fill="var(--ink-faded)" stroke="none" />
        </g>

        {/* Footer caption — a small italic hint. Compact variant
            skips this to leave room for the card's own meta area. */}
        {!compact && (
          <text
            x="100"
            y="220"
            textAnchor="middle"
            fontFamily="var(--serif), serif"
            fontSize="10"
            fontStyle="italic"
            fill="var(--ink-faded)"
            opacity="0.7"
          >
            no image attached
          </text>
        )}
      </svg>
    </div>
  );
}
