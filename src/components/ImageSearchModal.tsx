import { useEffect, useRef, useState } from 'react';
import type { ModelSheet } from '../types/schema';
import {
  computeDHash,
  loadImageFromFile,
  rankMatches,
  type HashMatch,
  type MatchTier,
} from '../lib/imageMatching';

interface Props {
  sheets: ModelSheet[];
  hashIndex: Map<string, string>;
  indexReady: boolean;
  indexProgress: { done: number; total: number };
  imageBase: string;
  onClose: () => void;
  onSelectMatch: (sheetId: string) => void;
}

// Search the archive by image similarity. The user drops, pastes, or
// picks an image; the modal computes its perceptual hash, ranks the
// archive against it, and shows matches tiered by confidence.
//
// This is Phase A (pHash only). The "Deep match" control is wired as
// a disabled-with-coming-soon placeholder for Phase B (CLIP
// embeddings), which ship in a subsequent session.

export function ImageSearchModal({
  sheets,
  hashIndex,
  indexReady,
  indexProgress,
  imageBase,
  onClose,
  onSelectMatch,
}: Props) {
  const [queryFile, setQueryFile] = useState<File | null>(null);
  const [queryPreview, setQueryPreview] = useState<string | null>(null);
  const [queryHash, setQueryHash] = useState<string | null>(null);
  const [matches, setMatches] = useState<HashMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);
  const [dragging, setDragging] = useState(false);
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
        <div style={{ padding: '24px 32px' }}>
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
              archive. Matching is based on a perceptual hash of the whole
              image — it catches duplicates, scaled copies, and
              close variants well. For merchandise that adapts a single
              figure from a multi-figure sheet, the matches may be thin —
              a deeper neural-embedding search is planned for a future
              version.
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
    identical: 'Essentially identical',
    near: 'Near-duplicate (cropped, scaled, or light edit)',
    related: 'Related (similar composition)',
    distant: 'Weak match — probably unrelated',
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
