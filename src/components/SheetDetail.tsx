import type { ModelSheet } from '../types/schema';
import {
  formatResolution,
  resolutionTier,
  googleLensUrl,
  tineyeUrl,
} from '../lib/image';
import { formatSequenceParts } from '../lib/sheets';
import {
  toggleSheetInList,
  createList,
  type UserList,
} from '../lib/lists';

interface Props {
  sheet: ModelSheet;
  imageBase: string;
  publicBaseUrl: string;
  canEdit: boolean; // hides Edit/Delete when false
  userLists: UserList[];
  onListsChanged: () => void;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function Field({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`modal-field ${wide ? 'modal-field-wide' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function SheetDetail({
  sheet,
  imageBase,
  publicBaseUrl,
  canEdit,
  userLists,
  onListsChanged,
  onClose,
  onEdit,
  onDelete,
}: Props) {
  const imageSrc = sheet.image_file ? `${imageBase}${sheet.image_file}` : '';
  const publicImageUrl = sheet.image_file
    ? `${publicBaseUrl.replace(/\/$/, '')}/${sheet.image_file}`
    : '';
  const tier = resolutionTier(sheet.image_width, sheet.image_height);
  const sortedOccurrences = [...sheet.web_occurrences].sort((a, b) =>
    b.checked_on.localeCompare(a.checked_on)
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="modal-body">
          <div className="modal-image">
            <div style={{ width: '100%', textAlign: 'center' }}>
              {imageSrc ? (
                <img src={imageSrc} alt={sheet.title || sheet.id} />
              ) : (
                <div
                  style={{
                    color: 'var(--ink-faded)',
                    fontFamily: 'var(--mono)',
                  }}
                >
                  No image attached
                </div>
              )}
              {sheet.image_width && sheet.image_height && (
                <div
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 10,
                    letterSpacing: '0.05em',
                    color: 'var(--ink-faded)',
                    marginTop: 12,
                  }}
                >
                  {formatResolution(sheet.image_width, sheet.image_height)}
                  {tier === 'thumbnail' && (
                    <span
                      style={{
                        color: 'var(--warn)',
                        marginLeft: 8,
                        textTransform: 'uppercase',
                      }}
                    >
                      · low-res
                    </span>
                  )}
                  {tier === 'archival' && (
                    <span
                      style={{
                        color: 'var(--success)',
                        marginLeft: 8,
                        textTransform: 'uppercase',
                      }}
                    >
                      · archival
                    </span>
                  )}
                </div>
              )}
              {publicImageUrl && (
                <div
                  style={{
                    marginTop: 16,
                    display: 'flex',
                    gap: 6,
                    justifyContent: 'center',
                  }}
                >
                  <a
                    href={googleLensUrl(publicImageUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-small"
                    style={{ textDecoration: 'none' }}
                  >
                    ↗ Google Lens
                  </a>
                  <a
                    href={tineyeUrl(publicImageUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-small"
                    style={{ textDecoration: 'none' }}
                  >
                    ↗ TinEye
                  </a>
                </div>
              )}
            </div>
          </div>
          <div className="modal-meta">
            <div className="modal-header">
              <div className="modal-id">{sheet.id}</div>
              <h1 className="modal-title">
                {sheet.title || (
                  <span
                    style={{
                      fontStyle: 'italic',
                      color: 'var(--ink-faded)',
                    }}
                  >
                    Untitled
                  </span>
                )}
              </h1>
              {sheet.needs_research && (
                <div style={{ marginTop: 10 }}>
                  <span
                    style={{
                      background: 'rgba(168, 122, 58, 0.15)',
                      color: 'var(--warn)',
                      padding: '3px 10px',
                      fontFamily: 'var(--mono)',
                      fontSize: 10,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      borderRadius: 999,
                    }}
                  >
                    Needs Research
                  </span>
                </div>
              )}
            </div>

            <div className="modal-section">
              <div className="modal-section-label">Content</div>
              <dl>
                <Field
                  label="Characters"
                  value={
                    sheet.characters.length ? (
                      <div className="tag-list">
                        {sheet.characters.map((c) => (
                          <span key={c} className="tag">
                            {c}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <em style={{ color: 'var(--ink-faded)' }}>
                        none recorded
                      </em>
                    )
                  }
                />
                {sheet.sequence_association && (
                  <Field
                    label="Sequence"
                    value={(() => {
                      const parts = formatSequenceParts(
                        sheet.sequence_association
                      );
                      return (
                        <>
                          {parts.number && (
                            <span
                              style={{
                                fontFamily: 'var(--mono)',
                                letterSpacing: '0.02em',
                              }}
                            >
                              [SQ {parts.number}]
                            </span>
                          )}
                          {parts.rest && (
                            <span
                              style={{ fontStyle: 'italic', marginLeft: 6 }}
                            >
                              ({parts.rest})
                            </span>
                          )}
                          {!parts.number && !parts.rest && (
                            <em style={{ color: 'var(--ink-faded)' }}>
                              empty
                            </em>
                          )}
                          {sheet.sequence_association_confidence && (
                            <span
                              style={{
                                fontFamily: 'var(--mono)',
                                fontSize: 9,
                                letterSpacing: '0.1em',
                                textTransform: 'uppercase',
                                color:
                                  sheet.sequence_association_confidence ===
                                  'high'
                                    ? 'var(--success)'
                                    : sheet.sequence_association_confidence ===
                                      'low'
                                    ? 'var(--ink-faded)'
                                    : 'var(--warn)',
                                marginLeft: 8,
                                padding: '1px 6px',
                                border: `1px solid currentColor`,
                              }}
                              title="Scholarly confidence in this sequence identification"
                            >
                              {sheet.sequence_association_confidence}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  />
                )}
                {sheet.artist && <Field label="Artist" value={sheet.artist} />}
              </dl>
            </div>

            <div className="modal-section">
              <div className="modal-section-label">Date</div>
              <dl>
                <Field
                  label="Date on sheet"
                  value={
                    sheet.date_on_sheet ? (
                      <>
                        {sheet.date_on_sheet}{' '}
                        <span
                          style={{
                            fontFamily: 'var(--mono)',
                            fontSize: 10,
                            color: 'var(--ink-faded)',
                            marginLeft: 6,
                          }}
                        >
                          ({sheet.date_precision})
                        </span>
                      </>
                    ) : (
                      <em style={{ color: 'var(--ink-faded)' }}>none</em>
                    )
                  }
                />
              </dl>
            </div>

            {sheet.production_stamps.length > 0 && (
              <div className="modal-section">
                <div className="modal-section-label">Production Stamps</div>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 18,
                    fontSize: 13,
                    lineHeight: 1.5,
                    fontFamily: 'var(--mono)',
                  }}
                >
                  {sheet.production_stamps.map((p, i) => {
                    const parts: string[] = [];
                    if (p.prod_number) parts.push(`PROD ${p.prod_number}`);
                    if (p.sequence_number) parts.push(`SEQ ${p.sequence_number}`);
                    if (p.scene_number) parts.push(`SCENE ${p.scene_number}`);
                    return (
                      <li key={i}>
                        <span style={{ color: 'var(--accent)', fontWeight: 600 }}>
                          {parts.join(' ') || '(empty stamp)'}
                        </span>
                        {p.location_on_sheet && (
                          <span
                            style={{
                              color: 'var(--ink-faded)',
                              fontFamily: 'var(--serif)',
                              fontStyle: 'italic',
                              marginLeft: 8,
                            }}
                          >
                            — {p.location_on_sheet}
                          </span>
                        )}
                        {p.notes && (
                          <div
                            style={{
                              color: 'var(--ink-faded)',
                              fontFamily: 'var(--serif)',
                              fontSize: 13,
                            }}
                          >
                            {p.notes}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="modal-section">
              <div
                className="modal-section-label"
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8,
                  justifyContent: 'space-between',
                }}
              >
                <span>In your lists</span>
                <span
                  style={{
                    fontFamily: 'var(--serif)',
                    fontStyle: 'italic',
                    fontSize: 11,
                    textTransform: 'none',
                    letterSpacing: 0,
                    color: 'var(--ink-faded)',
                  }}
                >
                  stored in this browser only
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 4,
                  alignItems: 'center',
                }}
              >
                {userLists.length === 0 ? (
                  <>
                    <span
                      style={{
                        fontSize: 12,
                        fontStyle: 'italic',
                        color: 'var(--ink-faded)',
                      }}
                    >
                      No lists yet.
                    </span>
                    <button
                      className="chip"
                      style={{ fontSize: 11 }}
                      onClick={() => {
                        const name = prompt(
                          'Name for your first list (e.g., "In my collection", "For thesis")'
                        );
                        if (!name || !name.trim()) return;
                        const l = createList(name.trim());
                        toggleSheetInList(l.id, sheet.id);
                        onListsChanged();
                      }}
                    >
                      + Create list and add
                    </button>
                  </>
                ) : (
                  <>
                    {userLists.map((l) => {
                      const inList = l.sheet_ids.includes(sheet.id);
                      return (
                        <button
                          key={l.id}
                          className={`chip ${inList ? 'active' : ''}`}
                          onClick={() => {
                            toggleSheetInList(l.id, sheet.id);
                            onListsChanged();
                          }}
                          title={
                            inList
                              ? `Remove from "${l.name}"`
                              : `Add to "${l.name}"`
                          }
                        >
                          {inList ? '✓ ' : '+ '}
                          {l.name}
                        </button>
                      );
                    })}
                    <button
                      className="chip"
                      style={{ fontSize: 11, fontStyle: 'italic' }}
                      onClick={() => {
                        const name = prompt('Name for new list');
                        if (!name || !name.trim()) return;
                        const l = createList(name.trim());
                        toggleSheetInList(l.id, sheet.id);
                        onListsChanged();
                      }}
                    >
                      + New list
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="modal-section">
              <div className="modal-section-label">Provenance</div>
              {sheet.image_sources.length > 0 && (
                <>
                  <div
                    style={{
                      fontFamily: 'var(--mono)',
                      fontSize: 10,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: 'var(--ink-faded)',
                      marginTop: 10,
                      marginBottom: 6,
                    }}
                  >
                    Image sources
                  </div>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: 18,
                      fontSize: 13,
                      lineHeight: 1.5,
                    }}
                  >
                    {sheet.image_sources.map((s, i) => (
                      <li key={i}>
                        <strong>{s.source_name || s.source_type}</strong>
                        {(s.archive_url || s.url) && ' — '}
                        {s.archive_url && (
                          <>
                            <a
                              href={s.archive_url}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                color: 'var(--accent)',
                                // Failed status = de-emphasize but still show the link.
                                // The API may be wrong about availability; let the user
                                // verify by clicking through.
                                opacity:
                                  s.archive_status === 'failed' ? 0.75 : 1,
                                textDecoration:
                                  s.archive_status === 'failed'
                                    ? 'underline dotted'
                                    : 'underline',
                              }}
                              title={
                                s.archive_status === 'verified'
                                  ? 'Wayback Machine snapshot — verification confirms it resolves'
                                  : s.archive_status === 'pending'
                                  ? 'Wayback capture submitted; verification still pending. Click to check manually.'
                                  : s.archive_status === 'failed'
                                  ? 'Availability API reports no snapshot, but try clicking — the API is sometimes wrong. Recheck or retry capture in edit mode.'
                                  : 'Wayback Machine snapshot'
                              }
                            >
                              Wayback ↗
                            </a>
                            {/* Trust indicator — small icon next to the link */}
                            <span
                              style={{
                                fontFamily: 'var(--mono)',
                                fontSize: 10,
                                marginLeft: 4,
                                color:
                                  s.archive_status === 'verified'
                                    ? 'var(--success)'
                                    : s.archive_status === 'failed'
                                    ? 'var(--danger)'
                                    : s.archive_status === 'pending'
                                    ? 'var(--warn)'
                                    : 'var(--ink-faded)',
                              }}
                              title={
                                s.archive_status === 'verified'
                                  ? 'Verified'
                                  : s.archive_status === 'pending'
                                  ? 'Pending'
                                  : s.archive_status === 'failed'
                                  ? 'API reports unavailable (may be wrong)'
                                  : 'Not verified'
                              }
                            >
                              {s.archive_status === 'verified'
                                ? '✓'
                                : s.archive_status === 'failed'
                                ? '?'
                                : s.archive_status === 'pending'
                                ? '…'
                                : ''}
                            </span>
                          </>
                        )}
                        {s.url && (
                          <>
                            {s.archive_url ? ' · ' : ''}
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                color: s.archive_url
                                  ? 'var(--ink-faded)'
                                  : 'var(--accent)',
                                fontSize: s.archive_url ? 11 : 'inherit',
                              }}
                              title={
                                s.archive_url
                                  ? 'Original source (may have changed or disappeared)'
                                  : 'Original source'
                              }
                            >
                              {s.archive_url ? 'original' : 'link'}
                            </a>
                          </>
                        )}
                        {s.retrieved && (
                          <span
                            style={{
                              color: 'var(--ink-faded)',
                              fontFamily: 'var(--mono)',
                              fontSize: 11,
                              marginLeft: 6,
                            }}
                          >
                            ret. {s.retrieved}
                          </span>
                        )}
                        {s.watermark && (
                          <div
                            style={{
                              color: 'var(--ink-faded)',
                              fontStyle: 'italic',
                            }}
                          >
                            Mark: {s.watermark}
                          </div>
                        )}
                        {s.notes && (
                          <div style={{ color: 'var(--ink-faded)' }}>
                            {s.notes}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {sheet.published_references.length > 0 && (
                <>
                  <div
                    style={{
                      fontFamily: 'var(--mono)',
                      fontSize: 10,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: 'var(--ink-faded)',
                      marginTop: 10,
                      marginBottom: 6,
                    }}
                  >
                    Published references
                  </div>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: 18,
                      fontSize: 13,
                      lineHeight: 1.5,
                    }}
                  >
                    {sheet.published_references.map((r, i) => (
                      <li key={i}>
                        <strong>{r.source}</strong>
                        {r.page && <>, p. {r.page}</>}
                        {r.notes && (
                          <span style={{ color: 'var(--ink-faded)' }}>
                            {' '}
                            — {r.notes}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <div className="modal-section">
              <div className="modal-section-label">Rarity</div>
              <div className="rarity-grid">
                <div className="rarity-cell">
                  <div className="rarity-cell-label">Market</div>
                  <div className="rarity-cell-value">{sheet.rarity.market}</div>
                </div>
                <div className="rarity-cell">
                  <div className="rarity-cell-label">Institutional</div>
                  <div className="rarity-cell-value">
                    {sheet.rarity.institutional}
                  </div>
                </div>
                <div className="rarity-cell">
                  <div className="rarity-cell-label">Iconographic</div>
                  <div className="rarity-cell-value">
                    {sheet.rarity.iconographic}
                  </div>
                </div>
              </div>
            </div>

            {sortedOccurrences.length > 0 && (
              <div className="modal-section">
                <div className="modal-section-label">
                  Web Occurrences (reverse-image-search readings)
                </div>
                <table
                  style={{
                    width: '100%',
                    fontSize: 12,
                    fontFamily: 'var(--mono)',
                    borderCollapse: 'collapse',
                    marginTop: 4,
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        borderBottom: '1px solid var(--rule)',
                        color: 'var(--ink-faded)',
                        fontSize: 10,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                      }}
                    >
                      <th style={{ textAlign: 'left', padding: '4px 4px' }}>
                        Checked
                      </th>
                      <th style={{ textAlign: 'left', padding: '4px 4px' }}>
                        Source
                      </th>
                      <th style={{ textAlign: 'right', padding: '4px 4px' }}>
                        Hits
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedOccurrences.map((r, i) => (
                      <tr
                        key={i}
                        style={{ borderBottom: '1px solid var(--rule)' }}
                      >
                        <td style={{ padding: '3px 4px' }}>{r.checked_on}</td>
                        <td style={{ padding: '3px 4px' }}>{r.source}</td>
                        <td
                          style={{ padding: '3px 4px', textAlign: 'right' }}
                        >
                          {r.count.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {sheet.tags.length > 0 && (
              <div className="modal-section">
                <div className="modal-section-label">Tags</div>
                <div className="tag-list">
                  {sheet.tags.map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {sheet.notes && (
              <div className="modal-section">
                <div className="modal-section-label">Notes</div>
                <div
                  style={{
                    fontSize: 14,
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {sheet.notes}
                </div>
              </div>
            )}

            <div className="modal-actions">
              {canEdit && (
                <>
                  <button
                    className="btn btn-filled"
                    onClick={onEdit}
                    title="E"
                  >
                    Edit
                  </button>
                  <button className="btn btn-danger" onClick={onDelete}>
                    Delete
                  </button>
                </>
              )}
              <div style={{ flex: 1 }} />
              <div
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 10,
                  color: 'var(--ink-faded)',
                  alignSelf: 'center',
                }}
              >
                Updated {sheet.updated_at.slice(0, 10)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
