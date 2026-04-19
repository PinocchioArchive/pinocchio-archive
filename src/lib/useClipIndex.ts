import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArchiveData } from '../types/schema';
import {
  computeClipEmbedding,
  embeddingFromBase64,
  readCachedEmbedding,
  writeCachedEmbedding,
  getClipPipeline,
  isClipReady,
  onModelLoadProgress,
  hasClipConsent,
  type LoadProgress,
} from './clipMatching';

// Manages a Map<sheetId, Float32Array> of CLIP embeddings for the
// archive. Unlike the pHash index which indexes automatically,
// CLIP indexing is OPT-IN because it requires a 90MB model
// download. The caller controls when indexing starts via the
// returned `startIndex` function.
//
// Flow:
//   1. Hook loads any already-stored embeddings from the schema
//      (sheet.image_embedding) and localStorage cache.
//   2. User clicks "Enable deep search" in the UI.
//   3. Caller invokes startIndex().
//   4. Pipeline loads (model download on first use; cached after).
//      Progress reported via `loadProgress`.
//   5. Sheets without embeddings get embedded one at a time,
//      yielding between each so the UI stays responsive.
//   6. Resulting embeddings populate the in-memory index,
//      localStorage cache, and eventually the schema.

export type ClipIndexStatus =
  | 'idle' // not started
  | 'loading-model'
  | 'indexing'
  | 'ready'
  | 'error';

interface IndexProgress {
  done: number;
  total: number;
}

export function useClipIndex(data: ArchiveData | null, imageBase: string) {
  const [index, setIndex] = useState<Map<string, Float32Array>>(new Map());
  const [status, setStatus] = useState<ClipIndexStatus>('idle');
  const [progress, setProgress] = useState<IndexProgress>({ done: 0, total: 0 });
  const [loadProgress, setLoadProgress] = useState<LoadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  // Seed from existing data whenever the archive changes.
  // This is cheap — just a pass through sheets looking for stored
  // embeddings. Doesn't trigger any heavy work.
  useEffect(() => {
    if (!data) return;
    const next = new Map<string, Float32Array>();
    for (const s of data.sheets) {
      if (s.image_embedding) {
        const vec = embeddingFromBase64(s.image_embedding);
        if (vec) next.set(s.id, vec);
      }
    }
    setIndex(next);
  }, [data]);

  const startIndex = useCallback(async () => {
    if (!data) return;
    if (status === 'indexing' || status === 'loading-model') return;
    cancelRef.current = false;
    setError(null);

    // If the pipeline is already loaded from a previous indexing
    // run, skip the loading-model status and its progress UI —
    // re-showing "Loading model" after the user already waited
    // through it once would be confusing.
    const modelAlreadyLoaded = isClipReady();
    if (!modelAlreadyLoaded) {
      setStatus('loading-model');
      onModelLoadProgress((p) => {
        setLoadProgress(p);
      });
    }

    try {
      await getClipPipeline();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
      onModelLoadProgress(null);
      return;
    }
    setLoadProgress(null);
    onModelLoadProgress(null);

    if (cancelRef.current) return;
    setStatus('indexing');

    // Identify sheets that still need embedding.
    const candidates = data.sheets.filter(
      (s) => s.image_file && s.image_file.trim()
    );
    const total = candidates.length;

    const next = new Map(index); // start from whatever's already indexed
    let done = next.size;
    setProgress({ done, total });

    for (const sheet of candidates) {
      if (cancelRef.current) {
        setStatus('idle');
        return;
      }
      if (next.has(sheet.id)) continue;
      // Check cache before computing fresh.
      const cached = readCachedEmbedding(sheet.image_file, sheet.updated_at);
      if (cached) {
        next.set(sheet.id, cached);
        done++;
        setIndex(new Map(next));
        setProgress({ done, total });
        continue;
      }
      // Compute embedding from the image URL.
      const url = `${imageBase}${sheet.image_file}`;
      try {
        const vec = await computeClipEmbedding(url);
        if (cancelRef.current) return;
        if (vec) {
          next.set(sheet.id, vec);
          writeCachedEmbedding(sheet.image_file, sheet.updated_at, vec);
        }
      } catch (e) {
        console.warn('[CLIP] Failed to embed sheet', sheet.id, e);
        // Continue — one failed sheet shouldn't break the batch.
      }
      done++;
      setIndex(new Map(next));
      setProgress({ done, total });
      // Yield so the UI can breathe. CLIP inference takes longer than
      // pHash so a bigger yield is fine here.
      await new Promise((r) => setTimeout(r, 16));
    }
    setStatus('ready');
  }, [data, imageBase, index, status]);

  // Allow callers to cancel in-flight indexing (e.g., user closes
  // the modal).
  const cancelIndex = useCallback(() => {
    cancelRef.current = true;
  }, []);

  // Convenience: is the pipeline "ready" in the sense that a query
  // can execute without further model-loading delay?
  const modelReady = status === 'ready' || status === 'indexing';

  // Auto-start and continuous re-indexing.
  //
  // We want three behaviors wrapped into one effect:
  //   1. First-ever run for a consented user: index everything.
  //   2. Return visit: if new sheets have appeared since the last
  //      session, embed the newcomers (older sheets come from cache).
  //   3. Live re-indexing: if the user adds a sheet while the app
  //      is open and status is already 'ready', notice the new
  //      sheet and kick off another indexing pass.
  //
  // The predicate `hasUnindexed` is the shared core: any sheet that
  // has an image file but no embedding (neither on the record nor in
  // the in-memory index) is a candidate for indexing. When that's
  // true AND the user has consented AND we're not already indexing
  // or loading, we trigger a run.
  //
  // Note: loading-model and indexing are in-flight states — we leave
  // them alone. 'error' is also left alone so we don't auto-retry a
  // broken pipeline on every data change; user can manually retry.
  useEffect(() => {
    if (!data) return;
    if (!hasClipConsent()) return;
    if (status === 'loading-model' || status === 'indexing') return;
    if (status === 'error') return;

    // Are there any hashable sheets without an embedding?
    const hasUnindexed = data.sheets.some(
      (s) =>
        s.image_file &&
        s.image_file.trim() &&
        !index.has(s.id) &&
        !s.image_embedding
    );
    if (!hasUnindexed) return;

    // Delay so we don't thrash during rapid state churn (e.g., a
    // batch import that fires many `setData` calls in quick
    // succession). 1.5s on initial mount, 600ms on subsequent
    // re-triggers — enough to coalesce bursts.
    const delay = status === 'idle' ? 1500 : 600;
    const t = setTimeout(() => {
      void startIndex();
    }, delay);
    return () => clearTimeout(t);
    // We deliberately list `data` (not `data.sheets`) so the effect
    // re-runs whenever the archive object is replaced — including
    // after edits, additions, and reloads. `index` is included so
    // the hasUnindexed predicate re-evaluates when embeddings finish
    // populating.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, status, index.size]);

  return {
    index,
    status,
    progress,
    loadProgress,
    error,
    modelReady,
    startIndex,
    cancelIndex,
  };
}
