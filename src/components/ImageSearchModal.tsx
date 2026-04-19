import { useEffect, useRef, useState } from 'react';
import type { ModelSheet } from '../types/schema';
import {
  computeDHash,
  loadImageFromFile,
  rankMatches,
  type HashMatch,
  type MatchTier,
} from '../lib/imageMatching';
import {
  computeClipEmbedding,
  rankClipMatches,
  hasClipConsent,
  setClipConsent,
  type ClipMatch,
  type ClipMatchTier,
  type LoadProgress,
} from '../lib/clipMatching';
import type { ClipIndexStatus } from '../lib/useClipIndex';

interface Props {
  sheets: ModelSheet[];
  hashIndex: Map<string, string>;
  indexReady: boolean;
  indexProgress: { done: number; total: number };
  imageBase: string;
  onClose: () => void;
  onSelectMatch: (sheetId: string) => void;
  // CLIP (Phase B) — semantic similarity for stylized / partial-match
  // cases that pHash misses. Caller-owned; hook is in App.tsx.
  clipIndex: Map<string, Float32Array>;
  clipStatus: ClipIndexStatus;
  clipProgress: { done: number; total: number };
  clipLoadProgress: LoadProgress | null;
  clipError: string | null;
  clipModelReady: boolean;
  onStartClipIndex: () => void;
}

// Search the archive by image similarity. The user drops, pastes, or
// picks an image; the modal computes a perceptual hash, ranks the
// archive against it, and shows matches tiered by confidence.
//
// Two-stage search:
//   - Primary: pHash (fast, catches exact and near-exact duplicates)
//   - Fallback: CLIP embeddings (slower, catches stylized / semantic
//     similarity — the merch-check case where a figure has been
//     redrawn for a lunchbox or book illustration)
//
// The fallback is offered as a "Try deeper search" button when pHash
// returns nothing, or can be invoked directly if the user knows the
// query image is stylized.

export function ImageSearchModal({
  sheets,
  hashIndex,
  indexReady,
  indexProgress,
  imageBase,
  onClose,
  onSelectMatch,
  clipIndex,
  clipStatus,
  clipProgress,
  clipLoadProgress,
  clipError,
  clipModelReady: _clipModelReady,
  onStartClipIndex,
}: Props) {
  const [queryFile, setQueryFile] = useState<File | null>(null);
  const [queryPreview, setQueryPreview] = useState<string | null>(null);
  const [queryHash, setQueryHash] = useState<string | null>(null);
  const [matches, setMatches] = useState<HashMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);
  const [dragging, setDragging] = useState(false);
  // CLIP state — embedding of the current query, matches, and a flag
  // for "the user asked for deep search, do it now."
  const [clipMatches, setClipMatches] = useState<ClipMatch[] | null>(null);
  const [clipComputing, setClipComputing] = useState(false);
  const [showConsentPrompt, setShowConsentPrompt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Revoke blob URL on unmount / replacement.
  useEffect(() => {
    return () => {
      if (queryPreview && queryPreview.startsWith('blob:')) {
        URL.revokeObjectURL(queryPreview);
      }
    };
  }, [queryPreview]);

  // Paste handler — a pasted image from clipboard lands here.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      for (const item of e.clipboardData.items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            void handleFile(file);
            e.preventDefault();
            return;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFile = async (file: File) => {
    setError(null);
    setMatches(null);
    setClipMatches(null);
    setQueryFile(file);
    if (queryPreview && queryPreview.startsWith('blob:')) {
      URL.revokeObjectURL(queryPreview);
    }
    const preview = URL.createObjectURL(file);
    setQueryPreview(preview);

    setComputing(true);
    try {
      const img = await loadImageFromFile(file);
      if (!img) {
        setError('Could not decode image. Try a different file.');
        setComputing(false);
        return;
      }
      const hash = await computeDHash(img);
      if (!hash) {
        setError(
          'Could not compute image fingerprint. The browser may have blocked canvas access.'
        );
        setComputing(false);
        return;
      }
      setQueryHash(hash);
      const ranked = rankMatches(hash, hashIndex);
      setMatches(ranked);
      setComputing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setComputing(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      void handleFile(file);
    } else {
      setError('Drop an image file to search.');
    }
  };

  // Run a CLIP deep-search for the current query image.
  // Assumes the model/index is either ready or will load when asked.
  const runDeepSearch = async () => {
    if (!queryFile) return;
    setClipComputing(true);
    setError(null);
    try {
      // If the user hasn't consented and indexing hasn't started,
      // surface the consent prompt instead of silently triggering a
      // ~90MB download.
      if (
        clipStatus === 'idle' &&
        !hasClipConsent() &&
        !showConsentPrompt
      ) {
        setShowConsentPrompt(true);
        setClipComputing(false);
        return;
      }
      const vec = await computeClipEmbedding(queryFile);
      if (!vec) {
        setError('Deep search could not embed the query image.');
        setClipComputing(false);
        return;
      }
      const ranked = rankClipMatches(vec, clipIndex);
      setClipMatches(ranked);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClipComputing(false);
    }
  };

  // User accepts the consent prompt → persist consent, kick off
  // indexing (which triggers the model download), then run deep
  // search for the current query as soon as possible.
  const acceptConsentAndIndex = async () => {
    setClipConsent(true);
    setShowConsentPrompt(false);
    onStartClipIndex();
    // The model load + indexing is non-blocking; we poll the query
    // once the pipeline is ready. Simpler: just retry runDeepSearch
    // after a short wait; if the model still isn't ready, the user
    // sees the loading state and can retry.
    setTimeout(() => {
      void runDeepSearch();
    }, 100);
  };

  // Should we automatically offer "Try deeper search"? Yes when
  // pHash returned nothing useful for the query (no matches, or only
  // weak ones below the "related" tier).
  const phashInsufficient =
    matches !== null &&
    (matches.length === 0 ||
      matches.every((m) => m.tier === 'distant'));

  const sheetById = new Map(sheets.map((s) => [s.id, s]));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 960 }}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="modal-masthead modal-masthead-minimal">
          <span className="modal-masthead-eyebrow">Image search</span>
        </div>
        <div
          style={{
            padding: '24px 32px',
            // The modal itself is overflow:hidden to clip rounded
            // corners and keep the navy masthead locked at the top.
            // Without an explicit scroll on this inner body, content
            // that exceeds viewport height (Deep Search section,
            // large result grids) gets silently clipped — which is
            // what was happening and making Deep Search invisible.
            // flex:1 + min-height:0 lets this div consume the
            // remaining vertical space inside the flex-column modal
            // and scroll its overflow.
            flex: '1 1 auto',
            minHeight: 0,
            overflowY: 'auto',
          }}
        >
          <div style={{ marginBottom: 20 }}>
            <h1
              style={{
                fontFamily: 'var(--serif)',
                fontSize: 22,
                fontWeight: 400,
                fontStyle: 'italic',
                margin: '0 0 8px',
              }}
            >
              Search the archive by image
            </h1>
            <p
              style={{
                fontSize: 13,
                color: 'var(--ink-faded)',
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              Drop, paste, or pick an image to find visually similar sheets.
              Useful for checking if a piece of merchandise derives from a
              known model sheet, or whether an image is already in the
              archive. A fast fingerprint search runs first to catch
              duplicates and close variants. If that's not enough — for
              partial crops or stylized redrawings common in merchandise
              — a deeper neural-embedding search is available below the
              initial results.
            </p>
            {!indexReady && (
              <div
                style={{
                  marginTop: 10,
                  fontFamily: 'var(--mono)',
                  fontSize: 11,
                  color: 'var(--warn)',
                  letterSpacing: '0.05em',
                }}
              >
                Indexing archive images: {indexProgress.done}/
                {indexProgress.total}. Search will improve as more sheets
                finish hashing.
              </div>
            )}
          </div>

          <div
            className={`image-search-drop ${dragging ? 'image-search-drop-active' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = '';
              }}
            />
            {queryPreview ? (
              <div
                style={{
                  display: 'flex',
                  gap: 16,
                  alignItems: 'center',
                }}
              >
                <img
                  src={queryPreview}
                  alt="Query"
                  style={{
                    maxWidth: 160,
                    maxHeight: 160,
                    border: '1px solid var(--rule)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                />
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--ink-faded)',
                    fontFamily: 'var(--mono)',
                    letterSpacing: '0.04em',
                  }}
                >
                  {queryFile?.name}
                  {queryHash && (
                    <div style={{ marginTop: 6 }}>
                      Fingerprint: {queryHash}
                    </div>
                  )}
                  <div
                    style={{
                      marginTop: 10,
                      fontFamily: 'var(--serif)',
                      fontStyle: 'italic',
                      fontSize: 11,
                      color: 'var(--ink-faded)',
                    }}
                  >
                    Click the drop zone or drag a new image to replace.
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div
                  style={{
                    fontFamily: 'var(--serif)',
                    fontSize: 15,
                    fontStyle: 'italic',
                    color: 'var(--ink-soft)',
                    marginBottom: 8,
                  }}
                >
                  Drop an image here, paste from clipboard, or click to pick
                </div>
                <div
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-faded)',
                  }}
                >
                  JPG, PNG, WEBP, GIF
                </div>
              </>
            )}
          </div>

          {error && (
            <div
              className="notice"
              style={{
                borderLeftColor: 'var(--danger)',
                color: 'var(--danger)',
                marginTop: 16,
              }}
            >
              {error}
            </div>
          )}

          {computing && (
            <div
              style={{
                marginTop: 20,
                fontFamily: 'var(--mono)',
                fontSize: 11,
                letterSpacing: '0.05em',
                color: 'var(--ink-faded)',
              }}
            >
              Computing fingerprint and searching…
            </div>
          )}

          {matches !== null && !computing && (
            <MatchResults
              matches={matches}
              sheetById={sheetById}
              imageBase={imageBase}
              onSelect={onSelectMatch}
            />
          )}

          {/* Deep search (CLIP) — offered as a fallback when pHash
              returns nothing, or as an explicit opt-in for stylized
              queries like merchandise. The button always appears
              once a query has been analyzed, not just when pHash
              is insufficient, because sometimes the user wants to
              verify a suspicious match or find stylized variations
              that pHash did surface at "related" tier. */}
          {queryFile && !computing && matches !== null && (
            <div
              style={{
                marginTop: 24,
                paddingTop: 20,
                borderTop: '1px solid var(--rule)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <h2
                    style={{
                      fontFamily: 'var(--serif)',
                      fontWeight: 400,
                      fontStyle: 'italic',
                      fontSize: 18,
                      margin: '0 0 4px',
                    }}
                  >
                    Deep search
                  </h2>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--ink-faded)',
                      lineHeight: 1.5,
                      maxWidth: 560,
                    }}
                  >
                    {phashInsufficient
                      ? 'Fingerprint search found nothing useful. A neural-embedding search can catch partial crops and stylized redrawings — useful for checking merchandise derived from a sheet.'
                      : 'Uses a neural model to find sheets similar to the query by visual concept rather than pixel match. Catches stylized merchandise and partial figure use that fingerprint search misses.'}
                  </div>
                </div>
                <button
                  className="btn btn-filled"
                  onClick={runDeepSearch}
                  disabled={clipComputing || clipStatus === 'loading-model'}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {clipComputing || clipStatus === 'loading-model'
                    ? 'Searching…'
                    : clipStatus === 'ready' || clipStatus === 'indexing'
                    ? 'Run deep search'
                    : 'Try deeper search'}
                </button>
              </div>

              {/* First-use consent prompt — download warning. */}
              {showConsentPrompt && (
                <div
                  className="notice"
                  style={{
                    marginTop: 12,
                    borderLeftColor: 'var(--warn)',
                    background: 'rgba(168, 122, 58, 0.05)',
                    padding: '12px 14px',
                  }}
                >
                  <div
                    style={{
                      fontFamily: 'var(--serif)',
                      fontWeight: 600,
                      marginBottom: 6,
                    }}
                  >
                    Enable deep search? This downloads a ~90MB neural model.
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--ink-soft)',
                      lineHeight: 1.5,
                      marginBottom: 10,
                    }}
                  >
                    The model runs entirely in your browser — no images are
                    uploaded anywhere. Your browser caches the weights so the
                    download only happens once. Re-indexing the archive takes
                    a few minutes on first use; subsequent searches are fast.
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-filled"
                      onClick={acceptConsentAndIndex}
                    >
                      Download model and index
                    </button>
                    <button
                      className="btn"
                      onClick={() => setShowConsentPrompt(false)}
                    >
                      Not now
                    </button>
                  </div>
                </div>
              )}

              {/* Model loading progress (after consent or on return visits) */}
              {clipStatus === 'loading-model' && clipLoadProgress && (
                <div
                  style={{
                    marginTop: 10,
                    fontFamily: 'var(--mono)',
                    fontSize: 11,
                    color: 'var(--ink-faded)',
                    letterSpacing: '0.05em',
                  }}
                >
                  Loading model: {clipLoadProgress.status}
                  {clipLoadProgress.percent !== null &&
                    ` (${clipLoadProgress.percent}%)`}
                  {clipLoadProgress.file && (
                    <span
                      style={{ color: 'var(--ink-faded)', marginLeft: 6 }}
                    >
                      · {clipLoadProgress.file}
                    </span>
                  )}
                </div>
              )}

              {/* Embedding-indexing progress */}
              {clipStatus === 'indexing' && (
                <div
                  style={{
                    marginTop: 10,
                    fontFamily: 'var(--mono)',
                    fontSize: 11,
                    color: 'var(--ink-faded)',
                    letterSpacing: '0.05em',
                  }}
                >
                  Embedding archive images: {clipProgress.done}/
                  {clipProgress.total}. Search improves as more sheets
                  finish embedding.
                </div>
              )}

              {/* Error during CLIP */}
              {clipError && clipStatus === 'error' && (
                <div
                  className="notice"
                  style={{
                    marginTop: 10,
                    borderLeftColor: 'var(--danger)',
                    color: 'var(--danger)',
                    fontSize: 12,
                  }}
                >
                  Deep search failed: {clipError}
                </div>
              )}

              {/* CLIP match results */}
              {clipMatches !== null && !clipComputing && (
                <ClipMatchResults
                  matches={clipMatches}
                  sheetById={sheetById}
                  imageBase={imageBase}
                  onSelect={onSelectMatch}
                  indexSize={clipIndex.size}
                  totalSheets={sheets.filter(
                    (s) => s.image_file && s.image_file.trim()
                  ).length}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MatchResults({
  matches,
  sheetById,
  imageBase,
  onSelect,
}: {
  matches: HashMatch[];
  sheetById: Map<string, ModelSheet>;
  imageBase: string;
  onSelect: (id: string) => void;
}) {
  if (matches.length === 0) {
    return (
      <div
        style={{
          marginTop: 24,
          padding: '24px 0',
          textAlign: 'center',
          color: 'var(--ink-faded)',
          fontStyle: 'italic',
          fontSize: 14,
        }}
      >
        No visually similar sheets in the archive.
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            color: 'var(--ink-faded)',
            fontStyle: 'normal',
          }}
        >
          This is only a whole-image fingerprint search. If you're checking
          merchandise that uses a single figure from a larger sheet, or a
          stylized redrawing, no match here does not mean no relationship.
        </div>
      </div>
    );
  }

  // Group matches by tier for clearer presentation.
  const byTier: Record<MatchTier, HashMatch[]> = {
    identical: [],
    near: [],
    related: [],
    distant: [],
  };
  for (const m of matches) byTier[m.tier].push(m);

  const tierLabel: Record<MatchTier, string> = {
    identical: 'Strong match — almost certainly the same image',
    near: 'Close match — cropped, scaled, or lightly edited',
    related: 'Partial match — similar composition',
    // The "distant" tier is the noisiest. Rather than "probably
    // unrelated" (dismissive, and wrong when the only match is
    // genuinely related like your shark-crop case), frame it as
    // "worth looking at but verify manually." Low-confidence signal
    // is still signal.
    distant: 'Distant match — low confidence, verify manually',
  };

  return (
    <div style={{ marginTop: 24 }}>
      <h2
        style={{
          fontFamily: 'var(--serif)',
          fontWeight: 400,
          fontStyle: 'italic',
          fontSize: 18,
          margin: '0 0 12px',
        }}
      >
        {matches.length} match{matches.length === 1 ? '' : 'es'}
      </h2>
      {/* Explain the "%" semantics, because they're not intuitive.
          A dHash Hamming-distance-based percentage doesn't map to
          human "similarity" the way most users expect — 50% is random
          noise, 65-70% is low but real signal, 85%+ is a solid match.
          Without this note, a user seeing "67%" might dismiss a
          genuinely useful partial match as "only 67% similar." */}
      <div
        style={{
          fontSize: 11,
          color: 'var(--ink-faded)',
          fontStyle: 'italic',
          marginTop: -4,
          marginBottom: 14,
          lineHeight: 1.5,
        }}
      >
        Fingerprint similarity % is derived from bit-level hash
        difference, not visual similarity. A score around 50% is
        noise; 65–75% indicates real signal worth examining; 85%+
        means a close match. Low-scoring top-ranked results are
        still worth looking at.
      </div>
      {(['identical', 'near', 'related', 'distant'] as MatchTier[]).map(
        (tier) => {
          const items = byTier[tier];
          if (items.length === 0) return null;
          return (
            <div key={tier} style={{ marginBottom: 18 }}>
              <div
                className="modal-section-label"
                style={{ marginBottom: 8 }}
              >
                {tierLabel[tier]}{' '}
                <span
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 10,
                    color: 'var(--ink-faded)',
                    fontWeight: 400,
                    marginLeft: 4,
                  }}
                >
                  ({items.length})
                </span>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                  gap: 10,
                }}
              >
                {items.map((m) => {
                  const s = sheetById.get(m.sheetId);
                  if (!s) return null;
                  const thumb = s.image_file
                    ? `${imageBase}${s.image_file}`
                    : '';
                  return (
                    <button
                      key={m.sheetId}
                      className="image-search-result"
                      onClick={() => onSelect(m.sheetId)}
                      title={`${m.similarity}% similar · Hamming distance ${m.distance}`}
                    >
                      <div className="image-search-result-thumb">
                        {thumb ? (
                          <img src={thumb} alt="" loading="lazy" />
                        ) : (
                          <span style={{ fontFamily: 'var(--mono)' }}>—</span>
                        )}
                      </div>
                      <div className="image-search-result-meta">
                        <div className="image-search-result-id">{s.id}</div>
                        <div className="image-search-result-title">
                          {s.title || (
                            <em style={{ color: 'var(--ink-faded)' }}>
                              Untitled
                            </em>
                          )}
                        </div>
                        <div className="image-search-result-sim">
                          {m.similarity}%
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        }
      )}
    </div>
  );
}

function ClipMatchResults({
  matches,
  sheetById,
  imageBase,
  onSelect,
  indexSize,
  totalSheets,
}: {
  matches: ClipMatch[];
  sheetById: Map<string, ModelSheet>;
  imageBase: string;
  onSelect: (id: string) => void;
  indexSize: number;
  totalSheets: number;
}) {
  // Tier labeling is distinct from pHash — CLIP similarities are
  // cosine-based floats 0-1, not Hamming distances. Labels describe
  // what each band typically means for this use case.
  const tierLabel: Record<ClipMatchTier, string> = {
    'very-high': 'Very high similarity — probable direct match',
    high: 'High similarity — likely derivative or variant',
    moderate: 'Moderate similarity — related composition or figure',
    weak: 'Weak similarity — thin connection, browse with care',
  };

  if (matches.length === 0) {
    return (
      <div
        style={{
          marginTop: 16,
          padding: '18px 0',
          textAlign: 'center',
          color: 'var(--ink-faded)',
          fontStyle: 'italic',
          fontSize: 14,
        }}
      >
        No semantically similar sheets in the archive.
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            fontFamily: 'var(--mono)',
            letterSpacing: '0.05em',
            fontStyle: 'normal',
          }}
        >
          Searched {indexSize} of {totalSheets} indexed sheets.
        </div>
      </div>
    );
  }

  const byTier: Record<ClipMatchTier, ClipMatch[]> = {
    'very-high': [],
    high: [],
    moderate: [],
    weak: [],
  };
  for (const m of matches) byTier[m.tier].push(m);

  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 10,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--ink-faded)',
          }}
        >
          Deep search · {matches.length} result{matches.length === 1 ? '' : 's'}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--ink-faded)',
            fontFamily: 'var(--mono)',
          }}
        >
          ({indexSize}/{totalSheets} indexed)
        </div>
      </div>
      {(['very-high', 'high', 'moderate', 'weak'] as ClipMatchTier[]).map(
        (tier) => {
          const items = byTier[tier];
          if (items.length === 0) return null;
          return (
            <div key={tier} style={{ marginBottom: 18 }}>
              <div className="modal-section-label" style={{ marginBottom: 8 }}>
                {tierLabel[tier]}{' '}
                <span
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 10,
                    color: 'var(--ink-faded)',
                    fontWeight: 400,
                    marginLeft: 4,
                  }}
                >
                  ({items.length})
                </span>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                  gap: 10,
                }}
              >
                {items.map((m) => {
                  const s = sheetById.get(m.sheetId);
                  if (!s) return null;
                  const thumb = s.image_file
                    ? `${imageBase}${s.image_file}`
                    : '';
                  const pct = Math.round(m.similarity * 100);
                  return (
                    <button
                      key={m.sheetId}
                      className="image-search-result"
                      onClick={() => onSelect(m.sheetId)}
                      title={`Cosine similarity: ${m.similarity.toFixed(3)}`}
                    >
                      <div className="image-search-result-thumb">
                        {thumb ? (
                          <img src={thumb} alt="" loading="lazy" />
                        ) : (
                          <span style={{ fontFamily: 'var(--mono)' }}>—</span>
                        )}
                      </div>
                      <div className="image-search-result-meta">
                        <div className="image-search-result-id">{s.id}</div>
                        <div className="image-search-result-title">
                          {s.title || (
                            <em style={{ color: 'var(--ink-faded)' }}>
                              Untitled
                            </em>
                          )}
                        </div>
                        <div className="image-search-result-sim">{pct}%</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        }
      )}
    </div>
  );
}
