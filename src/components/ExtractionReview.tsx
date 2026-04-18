import { useState } from 'react';
import type { ModelSheet, DatePrecision } from '../types/schema';
import type {
  ExtractionResult,
  ExtractionConfidence,
} from '../lib/extraction/types';
import { crossCheckSheetNumber } from '../lib/extraction/types';

interface FieldProposal {
  field: string;
  label: string;
  current: string;
  proposed: string;
  confidence: ExtractionConfidence;
  note?: string;
  warning?: string;
}

interface Props {
  sheet: ModelSheet;
  extraction: ExtractionResult;
  filenameGuess?: string | null; // for cross-check on sheet_number
  imageUrl?: string;
  onAccept: (updated: Partial<ModelSheet>) => void;
  onClose: () => void;
}

// Flatten the extraction into a list of field-level proposals, paired with the
// current values from the sheet record. Arrays become joined strings for display
// but get split on commit if the field is naturally multi-value.
function buildProposals(
  sheet: ModelSheet,
  ex: ExtractionResult,
  filenameGuess?: string | null
): FieldProposal[] {
  const out: FieldProposal[] = [];

  if (ex.sheet_number) {
    const crossCheck = crossCheckSheetNumber(
      filenameGuess || null,
      ex.sheet_number
    );
    out.push({
      field: 'id',
      label: 'Sheet Number',
      current: sheet.id || '',
      proposed: ex.sheet_number.value,
      confidence: ex.sheet_number.confidence,
      note: ex.sheet_number.note,
      warning:
        crossCheck === 'disagree'
          ? `Filename suggests ${filenameGuess}, OCR reads ${ex.sheet_number.value}`
          : crossCheck === 'agree'
          ? 'Filename and OCR agree ✓'
          : undefined,
    });
  }

  if (ex.title) {
    out.push({
      field: 'title',
      label: 'Title',
      current: sheet.title || '',
      proposed: ex.title.value,
      confidence: ex.title.confidence,
      note: ex.title.note,
    });
  }

  if (ex.characters) {
    out.push({
      field: 'characters',
      label: 'Characters',
      current: sheet.characters.join(', '),
      proposed: ex.characters.value.join(', '),
      confidence: ex.characters.confidence,
      note: ex.characters.note,
    });
  }

  if (ex.date_on_sheet) {
    out.push({
      field: 'date_on_sheet',
      label: 'Date on Sheet',
      current: sheet.date_on_sheet || '',
      proposed: ex.date_on_sheet.value,
      confidence: ex.date_on_sheet.confidence,
      note: ex.date_on_sheet.note,
    });
  }

  if (ex.approvals) {
    out.push({
      field: 'approvals',
      label: 'Approvals',
      current: sheet.approvals.join(', '),
      proposed: ex.approvals.value.join(', '),
      confidence: ex.approvals.confidence,
      note: ex.approvals.note,
    });
  }

  if (ex.department) {
    out.push({
      field: 'department',
      label: 'Department',
      current: sheet.department || '',
      proposed: ex.department.value,
      confidence: ex.department.confidence,
      note: ex.department.note,
    });
  }

  if (ex.sequence) {
    out.push({
      field: 'sequence_association',
      label: 'Sequence',
      current: sheet.sequence_association || '',
      proposed: ex.sequence.value,
      confidence: ex.sequence.confidence,
      note: ex.sequence.note,
    });
  }

  if (ex.other_markings) {
    out.push({
      field: 'other_markings',
      label: 'Other Markings (→ Notes)',
      current: sheet.notes || '',
      proposed: ex.other_markings.value,
      confidence: ex.other_markings.confidence,
      note: ex.other_markings.note,
    });
  }

  return out;
}

// Applies an accepted proposal to a partial sheet update. Handles multi-value
// fields and the special case of id (which also updates sheet_number_* parts).
// The `sheet` argument is the current record — needed so other_markings can
// append to existing notes rather than overwriting them.
function applyProposal(
  update: Partial<ModelSheet>,
  p: FieldProposal,
  editedValue: string,
  sheet: ModelSheet
): Partial<ModelSheet> {
  const v = editedValue;
  switch (p.field) {
    case 'id':
      return { ...update, id: v };
    case 'title':
      return { ...update, title: v };
    case 'characters':
      return {
        ...update,
        characters: v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };
    case 'date_on_sheet': {
      const precision: DatePrecision =
        /^\d{4}-\d{2}-\d{2}$/.test(v)
          ? 'exact'
          : /^\d{4}-\d{2}$/.test(v)
          ? 'month'
          : /^\d{4}$/.test(v)
          ? 'year'
          : 'unknown';
      return { ...update, date_on_sheet: v, date_precision: precision };
    }
    case 'approvals':
      return {
        ...update,
        approvals: v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };
    case 'department':
      return { ...update, department: v };
    case 'sequence_association':
      return { ...update, sequence_association: v };
    case 'other_markings': {
      // Append to existing notes (or to any notes already accrued in
      // this commit), never overwrite. Prior bug: this read only from
      // `update.notes`, ignoring sheet.notes entirely, so accepting an
      // other_markings proposal on a sheet with existing notes would
      // silently erase them.
      const existing = update.notes ?? sheet.notes ?? '';
      return {
        ...update,
        notes: existing ? `${existing}\n\n${v}` : v,
      };
    }
    default:
      return update;
  }
}

function confidenceColor(c: ExtractionConfidence): string {
  return c === 'high'
    ? 'var(--success)'
    : c === 'medium'
    ? 'var(--warn)'
    : 'var(--ink-faded)';
}

export function ExtractionReview({
  sheet,
  extraction,
  filenameGuess,
  imageUrl,
  onAccept,
  onClose,
}: Props) {
  const [proposals] = useState(() =>
    buildProposals(sheet, extraction, filenameGuess)
  );
  const [editedValues, setEditedValues] = useState<Record<string, string>>(
    Object.fromEntries(proposals.map((p) => [p.field, p.proposed]))
  );
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});

  const toggleAccept = (field: string) => {
    setAccepted((a) => ({ ...a, [field]: !a[field] }));
  };

  const acceptAllHighConfidence = () => {
    const next: Record<string, boolean> = { ...accepted };
    for (const p of proposals) {
      if (p.confidence === 'high' && !p.warning) {
        next[p.field] = true;
      }
    }
    setAccepted(next);
  };

  const commit = () => {
    let update: Partial<ModelSheet> = {};
    for (const p of proposals) {
      if (accepted[p.field]) {
        update = applyProposal(update, p, editedValues[p.field], sheet);
      }
    }
    onAccept(update);
  };

  const acceptedCount = Object.values(accepted).filter(Boolean).length;

  if (extraction.error) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div
          className="modal"
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: 600 }}
        >
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
          <div style={{ padding: '32px 36px' }}>
            <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 500 }}>
              Extraction failed
            </h2>
            <div className="notice" style={{ borderLeftColor: 'var(--error)' }}>
              {extraction.error}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (proposals.length === 0) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div
          className="modal"
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: 600 }}
        >
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
          <div style={{ padding: '32px 36px' }}>
            <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 500 }}>
              Nothing extracted
            </h2>
            <p style={{ fontSize: 14 }}>
              The extractor ({extraction.extracted_by}) couldn't read any
              structured fields from this image. This often happens with
              low-resolution images or unusual layouts.
            </p>
            {extraction.raw_text && (
              <details style={{ marginTop: 16 }}>
                <summary
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  Raw text (for debugging)
                </summary>
                <pre
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 11,
                    background: 'var(--paper-deep)',
                    padding: 10,
                    whiteSpace: 'pre-wrap',
                    maxHeight: 200,
                    overflowY: 'auto',
                  }}
                >
                  {extraction.raw_text}
                </pre>
              </details>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 1100 }}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="modal-body">
          <div className="modal-image" style={{ minHeight: 300 }}>
            {imageUrl ? (
              <img
                src={imageUrl}
                alt=""
                style={{ maxWidth: '100%', maxHeight: '60vh' }}
              />
            ) : (
              <div
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 11,
                  color: 'var(--ink-faded)',
                }}
              >
                No image preview
              </div>
            )}
          </div>
          <div className="modal-meta">
            <div className="modal-header">
              <div className="modal-id">
                Extracted via {extraction.extracted_by}
              </div>
              <h1
                className="modal-title"
                style={{ fontStyle: 'italic', fontWeight: 400 }}
              >
                Review extracted data
              </h1>
              <p
                style={{
                  fontSize: 13,
                  color: 'var(--ink-faded)',
                  margin: '8px 0 0',
                }}
              >
                Accept each field individually. Edit proposed values before
                accepting if needed. Unchecked fields stay as the current record.
              </p>
              <div style={{ marginTop: 10 }}>
                <button
                  className="btn-small"
                  onClick={acceptAllHighConfidence}
                >
                  ✓ Accept all high-confidence
                </button>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {proposals.map((p) => {
                const isAccepted = !!accepted[p.field];
                const changed = editedValues[p.field] !== p.current;
                return (
                  <div
                    key={p.field}
                    style={{
                      border: `1px solid ${
                        isAccepted ? 'var(--ink)' : 'var(--rule)'
                      }`,
                      background: isAccepted
                        ? 'var(--paper-deep)'
                        : 'var(--paper)',
                      padding: '10px 12px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 6,
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <label className="form-label">{p.label}</label>
                        <span
                          style={{
                            fontFamily: 'var(--mono)',
                            fontSize: 9,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            color: confidenceColor(p.confidence),
                            padding: '1px 6px',
                            border: `1px solid ${confidenceColor(p.confidence)}`,
                          }}
                        >
                          {p.confidence}
                        </span>
                      </div>
                      <button
                        type="button"
                        className={isAccepted ? 'btn btn-filled' : 'btn'}
                        style={{ padding: '4px 10px', fontSize: 10 }}
                        onClick={() => toggleAccept(p.field)}
                      >
                        {isAccepted ? '✓ Accepted' : 'Accept'}
                      </button>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 8,
                        fontSize: 12,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontFamily: 'var(--mono)',
                            fontSize: 9,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            color: 'var(--ink-faded)',
                            marginBottom: 2,
                          }}
                        >
                          Current
                        </div>
                        <div
                          style={{
                            minHeight: 24,
                            padding: '4px 6px',
                            background: 'var(--paper)',
                            border: '1px solid var(--rule)',
                            fontFamily: p.field === 'id' ? 'var(--mono)' : 'var(--serif)',
                            fontSize: 13,
                            color: p.current ? 'var(--ink)' : 'var(--ink-faded)',
                            fontStyle: p.current ? 'normal' : 'italic',
                          }}
                        >
                          {p.current || '—'}
                        </div>
                      </div>
                      <div>
                        <div
                          style={{
                            fontFamily: 'var(--mono)',
                            fontSize: 9,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            color: 'var(--accent)',
                            marginBottom: 2,
                          }}
                        >
                          Proposed {changed && '(edit below)'}
                        </div>
                        <input
                          type="text"
                          className="form-input"
                          value={editedValues[p.field]}
                          onChange={(e) =>
                            setEditedValues((ev) => ({
                              ...ev,
                              [p.field]: e.target.value,
                            }))
                          }
                          style={{
                            padding: '4px 6px',
                            fontSize: 13,
                            fontFamily: p.field === 'id' ? 'var(--mono)' : 'var(--serif)',
                            width: '100%',
                          }}
                        />
                      </div>
                    </div>

                    {(p.note || p.warning) && (
                      <div
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: 10,
                          color: p.warning ? 'var(--error)' : 'var(--ink-faded)',
                          marginTop: 6,
                        }}
                      >
                        {p.warning || p.note}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {extraction.raw_text && (
              <details style={{ marginTop: 10 }}>
                <summary
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-faded)',
                    cursor: 'pointer',
                  }}
                >
                  Raw extractor output
                </summary>
                <pre
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 10,
                    background: 'var(--paper-deep)',
                    padding: 10,
                    whiteSpace: 'pre-wrap',
                    maxHeight: 200,
                    overflowY: 'auto',
                    marginTop: 6,
                  }}
                >
                  {extraction.raw_text}
                </pre>
              </details>
            )}

            <div className="modal-actions">
              <button
                className="btn btn-filled"
                onClick={commit}
                disabled={acceptedCount === 0}
              >
                Apply {acceptedCount} {acceptedCount === 1 ? 'field' : 'fields'}
              </button>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
