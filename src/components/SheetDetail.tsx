import type { ModelSheet } from '../types/schema';
import {
  formatResolution,
  resolutionTier,
  googleLensUrl,
  tineyeUrl,
} from '../lib/image';
import { computeResearchStatus } from '../lib/sheets';
import {
  toggleSheetInList,
  createList,
  type UserList,
} from '../lib/lists';
import { useDialog } from './Dialog';

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
  // Close the modal and scroll to this sheet's card in the grid,
  // switching sort to "Sheet Number" so neighboring sheets are visible.
  onFocusInContext?: () => void;
  // Other sheets in the same numbered series (e.g., M217, M217-A, M217-B
  // are all one series). Does NOT include the current sheet. When empty,
  // the "Also in this series" strip is hidden entirely. Parent supplies
  // this so the detail view doesn't need access to the full archive.
  seriesMembers?: ModelSheet[];
  // Called when the user clicks a sibling in the series strip. Parent
  // typically swaps the selected sheet to that sibling's id, causing
  // this modal to re-render with the new sheet.
  onSelectSibling?: (id: string) => void;
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
  onFocusInContext,
  seriesMembers,
  onSelectSibling,
}: Props) {
  const imageSrc = sheet.image_file ? `${imageBase}${sheet.image_file}` : '';
  const publicImageUrl = sheet.image_file
    ? `${publicBaseUrl.replace(/\/$/, '')}/${sheet.image_file}`
    : '';
  const tier = resolutionTier(sheet.image_width, sheet.image_height);
  const sortedOccurrences = [...sheet.web_occurrences].sort((a, b) =>
    b.checked_on.localeCompare(a.checked_on)
  );
  const { promptDialog } = useDialog();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="modal-masthead">
          <span className="modal-masthead-eyebrow">View sheet</span>
          <span className="modal-masthead-separator">·</span>
          {onFocusInContext ? (
            <button
              type="button"
              className="modal-masthead-id modal-masthead-id-button"
              onClick={onFocusInContext}
              title="See this sheet in context among its neighbors"
            >
              {sheet.id}
            </button>
          ) : (
            <span className="modal-masthead-id">{sheet.id}</span>
          )}
          {sheet.title && (
            <>
              <span className="modal-masthead-separator">·</span>
              <span
                style={{
                  fontFamily: 'var(--serif)',
                  fontStyle: 'italic',
                  fontSize: 14,
                  color: 'var(--cream)',
                  letterSpacing: 0,
                  opacity: 0.9,
                  textTransform: 'none',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 400,
                }}
              >
                {sheet.title}
              </span>
            </>
          )}
        </div>
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
              {seriesMembers && seriesMembers.length > 0 && (
                <div className="series-strip">
                  <div className="series-strip-label">
                    Also in this series
                  </div>
                  <div className="series-strip-scroll">
                    {seriesMembers.map((m) => {
                      const isCurrent = m.id === sheet.id;
                      const thumbSrc = m.image_file
                        ? `${imageBase}${m.image_file}`
                        : '';
                      return (
                        <button
                          key={m.id}
                          type="button"
                          className={`series-strip-item ${
                            isCurrent ? 'series-strip-item-current' : ''
                          }`}
                          onClick={() => {
                            if (!isCurrent && onSelectSibling) {
                              onSelectSibling(m.id);
                            }
                          }}
                          disabled={isCurrent}
                          title={
                            isCurrent
                              ? `${m.id} — current`
                              : `${m.id}${m.title ? ' · ' + m.title : ''}`
                          }
                        >
                          <div className="series-strip-thumb">
                            {thumbSrc ? (
                              <img
                                src={thumbSrc}
                                alt=""
                                loading="lazy"
                              />
                            ) : (
                              <span className="series-strip-thumb-empty">
                                —
                              </span>
                            )}
                          </div>
                          <div className="series-strip-id">{m.id}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="modal-meta">
            <div className="modal-header">
              {onFocusInContext ? (
                <button
                  type="button"
                  className="modal-id modal-id-button"
                  onClick={onFocusInContext}
                  title="See this sheet in context among its neighbors"
                >
                  {sheet.id}
                </button>
              ) : (
                <div className="modal-id">{sheet.id}</div>
              )}
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
              {(() => {
                const status = computeResearchStatus(sheet);
                const label =
                  status === 'complete'
                    ? 'Record complete'
                    : status === 'some'
                    ? 'Research pending'
                    : 'Stub record — needs significant research';
                return (
                  <div className="research-status-row">
                    <span
                      className={`research-dot research-dot-${status} research-dot-inline`}
                      aria-hidden="true"
                    />
                    <span className="research-status-label">{label}</span>
                  </div>
                );
              })()}
            </div>

            {(sheet.characters.length > 0 ||
              sheet.sequence_association ||
              sheet.artist) && (
              <div className="modal-section">
                <div className="modal-section-label">Content</div>
                <dl>
                  {sheet.characters.length > 0 && (
                    <Field
                      label="Characters"
                      value={
                        <div className="tag-list">
                          {sheet.characters.map((c) => (
                            <span key={c} className="tag">
                              {c}
                            </span>
                          ))}
                        </div>
                      }
                    />
                  )}
                  {sheet.sequence_association && (
                    <Field
                      label="Sequence"
                      value={
                        <span
                          style={{
                            fontFamily: 'var(--mono)',
                            letterSpacing: '0.02em',
                          }}
                        >
                          {sheet.sequence_association}
                        </span>
                      }
                    />
                  )}
                  {sheet.artist && (
                    <Field label="Artist" value={sheet.artist} />
                  )}
                </dl>
              </div>
            )}

            {sheet.date_on_sheet && (
              <div className="modal-section">
                <div className="modal-section-label">Date</div>
                <dl>
                  <Field
                    label="Date on sheet"
                    value={
                      <>
                        {sheet.date_on_sheet}
                        {sheet.date_precision !== 'unknown' && (
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
                        )}
                      </>
                    }
                  />
                </dl>
              </div>
            )}

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

            {(sheet.sheet_marks && sheet.sheet_marks.length > 0) && (
              <div className="modal-section">
                <div className="modal-section-label">Sheet Marks</div>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 0,
                    listStyle: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  {sheet.sheet_marks.map((m, i) => (
                    <li
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 10,
                        flexWrap: 'wrap',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent('filter:set', {
                              detail: { key: 'sheet_mark', value: m.value },
                            })
                          )
                        }
                        className="sheet-mark-chip"
                        title={`Show all sheets with the mark "${m.value}"`}
                      >
                        {m.value || <em>(empty)</em>}
                      </button>
                      {m.notes && (
                        <span
                          style={{
                            color: 'var(--ink-faded)',
                            fontStyle: 'italic',
                            fontSize: 13,
                          }}
                        >
                          {m.notes}
                        </span>
                      )}
                    </li>
                  ))}
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
                      onClick={async () => {
                        const name = await promptDialog({
                          title: 'Create your first list',
                          message:
                            'e.g. "In my collection", "For thesis", "Wishlist"',
                          placeholder: 'List name',
                        });
                        if (!name) return;
                        const l = createList(name);
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
                      onClick={async () => {
                        const name = await promptDialog({
                          title: 'New list',
                          placeholder: 'List name',
                        });
                        if (!name) return;
                        const l = createList(name);
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

            {(sheet.image_sources.length > 0 ||
              sheet.published_references.length > 0) && (
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
                      padding: 0,
                      listStyle: 'none',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    {sheet.image_sources.map((s, i) => {
                      // Prefer showing the original URL as the primary link.
                      // Wayback is a preservation badge attached to it, not a
                      // separate equal link. If there's no original URL but
                      // there is an archive_url, the Wayback URL becomes the
                      // primary link.
                      const primaryHref = s.url || s.archive_url;
                      const displayUrl = s.url || s.archive_url || '';
                      // Trim to something readable — full URLs on list items
                      // hurt scanability. Show protocol-less, path-clipped.
                      const displayShort = displayUrl
                        .replace(/^https?:\/\//, '')
                        .replace(/^www\./, '')
                        .slice(0, 60) + (displayUrl.length > 60 ? '…' : '');
                      const statusIcon =
                        s.archive_status === 'verified'
                          ? '✓'
                          : s.archive_status === 'pending'
                          ? '…'
                          : s.archive_status === 'failed'
                          ? '?'
                          : null;
                      const statusColor =
                        s.archive_status === 'verified'
                          ? 'var(--success)'
                          : s.archive_status === 'pending'
                          ? 'var(--warn)'
                          : s.archive_status === 'failed'
                          ? 'var(--danger)'
                          : 'var(--ink-faded)';
                      const statusTitle =
                        s.archive_status === 'verified'
                          ? 'Wayback snapshot verified'
                          : s.archive_status === 'pending'
                          ? 'Wayback capture pending verification'
                          : s.archive_status === 'failed'
                          ? 'Wayback API reports unavailable (may be wrong)'
                          : 'Not yet archived';
                      return (
                        <li
                          key={i}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 600,
                              fontSize: 14,
                            }}
                          >
                            {s.source_name || s.source_type}
                          </div>
                          {primaryHref && (
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'baseline',
                                flexWrap: 'wrap',
                                gap: 8,
                                fontSize: 12,
                              }}
                            >
                              <a
                                href={primaryHref}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                  color: 'var(--accent)',
                                  fontFamily: 'var(--mono)',
                                  textDecoration: 'underline',
                                }}
                                title={displayUrl}
                              >
                                {displayShort}
                              </a>
                              {s.archive_url && s.url && (
                                // Small Wayback badge — secondary access
                                // point to the preserved snapshot of the
                                // same URL.
                                <a
                                  href={s.archive_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="provenance-wayback-badge"
                                  title={statusTitle}
                                >
                                  Wayback
                                  {statusIcon && (
                                    <span
                                      style={{
                                        color: statusColor,
                                        marginLeft: 4,
                                        fontFamily: 'var(--mono)',
                                      }}
                                    >
                                      {statusIcon}
                                    </span>
                                  )}
                                </a>
                              )}
                              {!s.url && s.archive_url && statusIcon && (
                                // Primary link is already Wayback; show
                                // just the verification icon next to it.
                                <span
                                  style={{
                                    color: statusColor,
                                    fontFamily: 'var(--mono)',
                                    fontSize: 10,
                                  }}
                                  title={statusTitle}
                                >
                                  {statusIcon}
                                </span>
                              )}
                              {s.retrieved && (
                                <span
                                  style={{
                                    color: 'var(--ink-faded)',
                                    fontFamily: 'var(--mono)',
                                    fontSize: 11,
                                  }}
                                >
                                  ret. {s.retrieved}
                                </span>
                              )}
                            </div>
                          )}
                          {s.notes && (
                            <div
                              style={{
                                color: 'var(--ink-faded)',
                                fontSize: 12,
                                fontStyle: 'italic',
                                marginTop: 2,
                              }}
                            >
                              {s.notes}
                            </div>
                          )}
                        </li>
                      );
                    })}
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
            )}

            {(() => {
              // Hide rarity cells that haven't been explicitly set.
              // 'unknown' is the default/unset state — only show cells the
              // user has actually chosen a level for. Hide the section
              // entirely if all three dimensions are unset.
              const rarityEntries: {
                label: string;
                value: string;
              }[] = [];
              if (sheet.rarity.market !== 'unknown')
                rarityEntries.push({
                  label: 'Market',
                  value: sheet.rarity.market,
                });
              if (sheet.rarity.institutional !== 'unknown')
                rarityEntries.push({
                  label: 'Institutional',
                  value: sheet.rarity.institutional,
                });
              if (sheet.rarity.iconographic !== 'unknown')
                rarityEntries.push({
                  label: 'Iconographic',
                  value: sheet.rarity.iconographic,
                });
              if (rarityEntries.length === 0) return null;
              return (
                <div className="modal-section">
                  <div className="modal-section-label">Rarity</div>
                  <div className="rarity-grid">
                    {rarityEntries.map((e) => (
                      <div key={e.label} className="rarity-cell">
                        <div className="rarity-cell-label">{e.label}</div>
                        <div className="rarity-cell-value">{e.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

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
                <button
                  className="btn btn-filled"
                  onClick={onEdit}
                  title="E"
                >
                  Edit
                </button>
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
              {canEdit && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="btn-delete-muted"
                  title="Delete this record"
                >
                  Delete record…
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
