import type { ModelSheet, ImageSource } from '../types/schema';
import {
  formatResolution,
  resolutionTier,
  googleLensUrl,
  tineyeUrl,
  yandexUrl,
  bingVisualUrl,
} from '../lib/image';
import { formatPrice, formatEstimateRange } from '../lib/currency';
import { computeResearchStatus, type SeriesSlot } from '../lib/sheets';
import { NoImagePlaceholder } from './NoImagePlaceholder';
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
  // Other slots in the same numbered series (e.g., M217, M217-A, M217-B
  // are all one series). A "slot" is either a real sheet or a ghost
  // placeholder for a missing suffix letter. When empty, the strip is
  // hidden entirely. Parent supplies this so the detail view doesn't
  // need access to the full archive.
  seriesSlots?: SeriesSlot[];
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
  seriesSlots,
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
        <div className="modal-masthead modal-masthead-minimal">
          <span className="modal-masthead-eyebrow">View sheet</span>
        </div>
        <div className="modal-body">
          <div className="modal-image">
            <div style={{ width: '100%', textAlign: 'center' }}>
              {imageSrc ? (
                <img src={imageSrc} alt={sheet.title || sheet.id} />
              ) : (
                <NoImagePlaceholder sheetId={sheet.id} />
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
                    // With four buttons in the row, narrow viewports
                    // would truncate without wrap. Wrap lets them
                    // flow onto a second line cleanly.
                    flexWrap: 'wrap',
                  }}
                >
                  <a
                    href={googleLensUrl(publicImageUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-small"
                    style={{ textDecoration: 'none' }}
                    title="Reverse-image search on Google Lens"
                  >
                    ↗ Google Lens
                  </a>
                  <a
                    href={tineyeUrl(publicImageUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-small"
                    style={{ textDecoration: 'none' }}
                    title="Reverse-image search on TinEye — best for exact-duplicate detection"
                  >
                    ↗ TinEye
                  </a>
                  <a
                    href={yandexUrl(publicImageUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-small"
                    style={{ textDecoration: 'none' }}
                    title="Reverse-image search on Yandex — different index, catches older/archival content Google and TinEye often miss"
                  >
                    ↗ Yandex
                  </a>
                  <a
                    href={bingVisualUrl(publicImageUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-small"
                    style={{ textDecoration: 'none' }}
                    title="Reverse-image search on Bing Visual Search"
                  >
                    ↗ Bing
                  </a>
                </div>
              )}
              {seriesSlots && seriesSlots.length > 0 && (
                <div className="series-strip">
                  <div className="series-strip-label">
                    Also in this series
                  </div>
                  <div className="series-strip-scroll">
                    {seriesSlots.map((slot) => {
                      if (slot.kind === 'gap') {
                        return (
                          <div
                            key={`gap-${slot.id}`}
                            className="series-strip-item series-strip-item-gap"
                            title={`${slot.id} — not in archive. This suffix is between sheets that are present, so the sheet likely exists but hasn't been added.`}
                          >
                            <div className="series-strip-thumb series-strip-thumb-gap">
                              <span className="series-strip-thumb-gap-mark">
                                ?
                              </span>
                            </div>
                            <div className="series-strip-id series-strip-id-gap">
                              {slot.id}
                            </div>
                          </div>
                        );
                      }
                      const m = slot.sheet;
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
            <div className="modal-header modal-header-tight">
              {(() => {
                const status = computeResearchStatus(sheet);
                const noImage =
                  !sheet.image_file || !sheet.image_file.trim();
                const label =
                  status === 'complete'
                    ? 'Record complete'
                    : status === 'some'
                    ? 'Research pending'
                    : noImage
                    ? 'Image not yet attached'
                    : 'Needs significant research';
                return (
                  <div className="modal-header-credit">
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
                    <div
                      className="research-status-inline"
                      title={
                        noImage && status === 'stub'
                          ? 'The archive is a visual record; without an attached image, this record is incomplete regardless of its metadata.'
                          : undefined
                      }
                    >
                      <span
                        className={`research-dot research-dot-${status} research-dot-inline`}
                        aria-hidden="true"
                      />
                      <span className="research-status-label-compact">
                        {label}
                      </span>
                    </div>
                  </div>
                );
              })()}
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
            </div>

            {(sheet.characters.length > 0 ||
              sheet.sequence_association ||
              sheet.artist ||
              sheet.date_on_sheet) && (
              <div className="modal-section">
                <div className="modal-section-label">Details</div>
                <dl className="modal-details">
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
                  {sheet.date_on_sheet && (
                    <Field
                      label="Date"
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
                  )}
                  {sheet.artist && (
                    <Field
                      label="Artist"
                      value={
                        sheet.artist === 'Unknown' ? (
                          <em style={{ color: 'var(--ink-faded)' }}>
                            Unknown
                          </em>
                        ) : (
                          sheet.artist
                        )
                      }
                    />
                  )}
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
                    {(() => {
                      // Group sources that share the same underlying URL.
                      // Rationale: two source entries pointing at the same
                      // vegalleries.com URL are redundant on display —
                      // they should render as one block crediting both
                      // source names, not as two stacked entries with
                      // identical links. Underlying data is unchanged;
                      // this is a display-only consolidation.
                      //
                      // Normalization: strip protocol, strip trailing
                      // slash, lowercase. Two URLs that differ only in
                      // case or http/https prefix are treated as the
                      // same source.
                      const normalize = (u?: string) =>
                        (u || '')
                          .trim()
                          .toLowerCase()
                          .replace(/^https?:\/\//, '')
                          .replace(/\/$/, '');
                      type Group = {
                        key: string;
                        sources: typeof sheet.image_sources;
                      };
                      const groups: Group[] = [];
                      const keyToIdx = new Map<string, number>();
                      for (const src of sheet.image_sources) {
                        // Group on the best available URL; entries
                        // with no URL at all each get their own group
                        // keyed by their index so they stay distinct.
                        const u = normalize(src.url || src.archive_url);
                        const key =
                          u || `__no-url-${groups.length}`;
                        const existing = keyToIdx.get(key);
                        if (existing !== undefined) {
                          groups[existing].sources.push(src);
                        } else {
                          keyToIdx.set(key, groups.length);
                          groups.push({ key, sources: [src] });
                        }
                      }
                      return groups.map((group, gi) => {
                        // Merge the group's metadata for display:
                        // - source_name: join all unique names
                        // - primary URL: first non-empty s.url, else
                        //   first archive_url
                        // - archive_url: first s.archive_url present
                        // - retrieved: most recent retrieved date
                        // - notes: concatenate any notes with a
                        //   separator so neither is lost
                        // - archive_status: most-confident status
                        //   (verified > pending > failed > not_attempted)
                        const names = Array.from(
                          new Set(
                            group.sources
                              .map((s) => s.source_name || s.source_type)
                              .filter(Boolean)
                          )
                        );
                        const primary = group.sources.find((s) => s.url);
                        const archived = group.sources.find(
                          (s) => s.archive_url
                        );
                        // Pick the most confident archive status across
                        // the group. Only used to compose the Wayback
                        // chip's hover tooltip — the status is no longer
                        // shown visually on the chip itself (the "?" for
                        // failed-API reads as a problem signal even
                        // though the link almost always works).
                        const statusRank: Record<string, number> = {
                          verified: 4,
                          pending: 3,
                          failed: 2,
                          not_attempted: 1,
                        };
                        const bestStatus = group.sources.reduce(
                          (best, s) => {
                            const cur = s.archive_status || 'not_attempted';
                            return (statusRank[cur] || 0) >
                              (statusRank[best] || 0)
                              ? cur
                              : best;
                          },
                          'not_attempted' as string
                        );
                        const statusTitle =
                          bestStatus === 'verified'
                            ? 'verified'
                            : bestStatus === 'pending'
                            ? 'capture pending verification'
                            : bestStatus === 'failed'
                            ? 'API reports unavailable (link may still work)'
                            : 'not yet archived';
                        // Most recent retrieval date across the group.
                        const retrieved = group.sources
                          .map((s) => s.retrieved)
                          .filter((r): r is string => !!r)
                          .sort()
                          .pop();
                        const allNotes = group.sources
                          .map((s) => s.notes)
                          .filter((n): n is string => !!n && !!n.trim())
                          .join(' · ');
                        const hasArchive = !!archived?.archive_url;
                        const hasOriginal = !!primary?.url;
                        return (
                          <li
                            key={group.key + gi}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 2,
                            }}
                          >
                            <div style={{ fontWeight: 600, fontSize: 14 }}>
                              {names.join(' / ')}
                              {group.sources.length > 1 && (
                                <span
                                  style={{
                                    fontFamily: 'var(--mono)',
                                    fontSize: 9,
                                    letterSpacing: '0.1em',
                                    textTransform: 'uppercase',
                                    color: 'var(--ink-faded)',
                                    marginLeft: 8,
                                    fontWeight: 400,
                                  }}
                                  title={`${group.sources.length} source entries point to this URL`}
                                >
                                  ×{group.sources.length}
                                </span>
                              )}
                            </div>
                            {(hasOriginal || hasArchive) && (
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  flexWrap: 'wrap',
                                  gap: 6,
                                  fontSize: 12,
                                  marginTop: 2,
                                }}
                              >
                                {hasOriginal && (
                                  <a
                                    href={primary!.url!}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="provenance-link-chip"
                                    title={primary!.url}
                                  >
                                    <span className="provenance-link-icon">↗</span>
                                    Live
                                  </a>
                                )}
                                {hasArchive && (
                                  // Always present the Wayback link when an
                                  // archive_url exists. The Wayback
                                  // Availability API returns false negatives
                                  // often enough that treating its "failed"
                                  // verdict as definitive would hide working
                                  // links. The deterministic archive_url
                                  // (web.archive.org/web/{original}) resolves
                                  // to the latest snapshot when clicked.
                                  //
                                  // We used to show an inline ?/…/✓ status
                                  // indicator on the chip; removed because
                                  // the "?" was reading as a problem signal
                                  // even though the link almost always works.
                                  // Status is still preserved in the data
                                  // and visible via the chip's hover tooltip
                                  // for anyone who wants to audit.
                                  <a
                                    href={archived!.archive_url!}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="provenance-link-chip provenance-link-chip-wayback"
                                    title={`Wayback Machine snapshot — ${statusTitle}`}
                                  >
                                    <span className="provenance-link-icon">↗</span>
                                    Wayback
                                  </a>
                                )}
                                {retrieved && (
                                  <span
                                    style={{
                                      color: 'var(--ink-faded)',
                                      fontFamily: 'var(--mono)',
                                      fontSize: 11,
                                      marginLeft: 4,
                                    }}
                                  >
                                    ret. {retrieved}
                                  </span>
                                )}
                              </div>
                            )}
                            {/* Per-source auction/sale details.
                                Renders only for sources that have at
                                least one auction field populated.
                                When a group has multiple sources
                                sharing a URL, each one gets its own
                                block if applicable — different
                                sources observing the same item could
                                legitimately record different sale
                                events (e.g., Worthpoint snapshot vs.
                                archived auction-house listing). */}
                            {group.sources
                              .filter(sourceHasAuctionData)
                              .map((src, si) => (
                                <AuctionDetailsDisplay
                                  key={si}
                                  source={src}
                                />
                              ))}
                            {allNotes && (
                              <div
                                style={{
                                  color: 'var(--ink-faded)',
                                  fontSize: 12,
                                  fontStyle: 'italic',
                                  marginTop: 2,
                                }}
                              >
                                {allNotes}
                              </div>
                            )}
                          </li>
                        );
                      });
                    })()}
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

// Predicate: does this source have any auction/sale data to show?
// Matches the fields added to ImageSource for price/date tracking.
// A source with any single field populated is worth rendering.
function sourceHasAuctionData(s: ImageSource): boolean {
  return Boolean(
    s.auction_house ||
      s.lot_number ||
      s.sku ||
      s.sale_date ||
      s.price_sold !== undefined ||
      s.price_estimate_low !== undefined ||
      s.price_estimate_high !== undefined ||
      s.sold !== undefined
  );
}

// Renders an ImageSource's auction/sale data as a compact inline
// block in the provenance pane. Meant to sit between the source's
// link chips and any notes. All fields optional — we compose a
// "header line" (house + lot) and a "sale line" (outcome, date,
// price) dynamically based on what's populated.
//
// Visual style matches the existing "small fact" panels elsewhere
// in SheetDetail — paper-deep background, subtle rule border, mono
// caps label. Price and house get slightly more emphasis (ink
// color, serif for price) since those are usually the scholarly-
// relevant facts.
function AuctionDetailsDisplay({ source: s }: { source: ImageSource }) {
  const currency = s.currency || 'USD';
  const priceStr = formatPrice(s.price_sold, currency);
  const estimateStr = formatEstimateRange(
    s.price_estimate_low,
    s.price_estimate_high,
    currency
  );

  // Outcome label — explicit about "unsold" vs. "sold" vs. unstated.
  const outcomeLabel =
    s.sold === true
      ? 'Sold'
      : s.sold === false
      ? 'Unsold'
      : s.price_sold !== undefined
      ? 'Sold' // implied by having a price even if `sold` flag absent
      : '';

  // Header line: auction house + lot number.
  // Fall back to source_name if auction_house isn't filled in — most
  // of the time the auction source IS the house.
  const houseLabel = s.auction_house || s.source_name || '';
  const lotLabel = s.lot_number ? `Lot ${s.lot_number}` : '';

  return (
    <div
      style={{
        marginTop: 6,
        padding: '8px 10px',
        background: 'var(--paper-deep)',
        border: '1px solid var(--rule)',
        borderRadius: 'var(--radius-sm)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {/* Label strip so this block reads as "sale record" at a glance */}
      <div
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 10,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--ink-faded)',
          marginBottom: 2,
        }}
      >
        Sale record
      </div>

      {/* Header: house + lot */}
      {(houseLabel || lotLabel) && (
        <div
          style={{
            fontFamily: 'var(--serif)',
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--ink)',
          }}
        >
          {houseLabel}
          {houseLabel && lotLabel && (
            <span style={{ color: 'var(--ink-faded)' }}> · </span>
          )}
          {lotLabel && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
              {lotLabel}
            </span>
          )}
        </div>
      )}

      {/* Sale line: outcome + date + price */}
      {(outcomeLabel || s.sale_date || priceStr) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            flexWrap: 'wrap',
            gap: 6,
            fontSize: 13,
          }}
        >
          {outcomeLabel && (
            <span
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 10,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color:
                  s.sold === false
                    ? 'var(--warn)'
                    : 'var(--success)',
                padding: '1px 6px',
                background:
                  s.sold === false
                    ? 'rgba(168, 122, 58, 0.12)'
                    : 'rgba(74, 107, 58, 0.12)',
                borderRadius: 999,
              }}
            >
              {outcomeLabel}
            </span>
          )}
          {s.sale_date && (
            <span
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 12,
                color: 'var(--ink-soft)',
              }}
            >
              {s.sale_date}
              {s.sale_date_precision &&
                s.sale_date_precision !== 'exact' && (
                  <span
                    style={{
                      color: 'var(--ink-faded)',
                      marginLeft: 4,
                      fontStyle: 'italic',
                    }}
                  >
                    ({s.sale_date_precision})
                  </span>
                )}
            </span>
          )}
          {priceStr && (
            <span
              style={{
                fontFamily: 'var(--serif)',
                fontSize: 15,
                fontWeight: 600,
                color: 'var(--ink)',
              }}
            >
              {priceStr}
            </span>
          )}
        </div>
      )}

      {/* Secondary facts: estimate range + SKU */}
      {(estimateStr || s.sku) && (
        <div
          style={{
            display: 'flex',
            gap: 10,
            fontSize: 11,
            color: 'var(--ink-faded)',
            fontFamily: 'var(--mono)',
            letterSpacing: '0.02em',
          }}
        >
          {estimateStr && <span>Est. {estimateStr}</span>}
          {s.sku && <span>SKU: {s.sku}</span>}
        </div>
      )}
    </div>
  );
}
