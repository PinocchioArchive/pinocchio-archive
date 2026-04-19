import { useEffect, useRef, useState } from 'react';
import type { ArchiveData, ModelSheet } from '../types/schema';
import {
  computeDHash,
  loadImageForHashing,
  readCachedHash,
  writeCachedHash,
  trimHashCache,
} from './imageMatching';

// Builds and maintains an in-memory Map<sheetId, hash> of perceptual
// hashes for every sheet that has an image. Hashes are sourced in
// priority order:
//
//   1. sheet.image_hash — if present on the record, trust it
//   2. localStorage cache — if keyed match for this image+updated_at
//   3. Compute fresh, then cache
//
// The hook returns:
//   - `index`: Map<sheetId, hash> usable immediately (empty at first,
//     populated incrementally as background indexing progresses)
//   - `progress`: { done, total } for UI surfacing
//   - `ready`: true once all hashable sheets have been processed
//
// Designed to be non-blocking: doesn't prevent the rest of the app
// from rendering. Starts indexing shortly after mount and yields
// between sheets so the UI stays responsive.

interface IndexProgress {
  done: number;
  total: number;
}

export function useImageHashIndex(
  data: ArchiveData | null,
  imageBase: string
) {
  const [index, setIndex] = useState<Map<string, string>>(new Map());
  const [progress, setProgress] = useState<IndexProgress>({ done: 0, total: 0 });
  const [ready, setReady] = useState(false);
  // Tracks in-flight indexing so re-runs don't race each other.
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!data) return;
    cancelRef.current = false;

    // Collect all sheets that have an image file — those are the
    // candidates for hashing. No image file = nothing to hash.
    const candidates = data.sheets.filter(
      (s) => s.image_file && s.image_file.trim()
    );
    const total = candidates.length;

    // Seed the in-memory index from fields already on the record.
    const next = new Map<string, string>();
    for (const s of candidates) {
      if (s.image_hash) next.set(s.id, s.image_hash);
    }
    setIndex(next);
    setProgress({ done: next.size, total });

    if (next.size === total) {
      setReady(true);
      return;
    }

    // Index missing ones in the background.
    const run = async () => {
      const missing = candidates.filter((s) => !s.image_hash);
      let done = next.size;
      for (const sheet of missing) {
        if (cancelRef.current) return;
        // Check localStorage cache before compute.
        const cached = readCachedHash(sheet.image_file, sheet.updated_at);
        if (cached) {
          next.set(sheet.id, cached);
          done++;
          setIndex(new Map(next));
          setProgress({ done, total });
          continue;
        }
        // Compute fresh.
        const url = `${imageBase}${sheet.image_file}`;
        const img = await loadImageForHashing(url);
        if (cancelRef.current) return;
        if (!img) {
          // Failed to load (404, CORS, etc.) — skip and move on.
          // Don't cache a failure; next session can retry.
          done++;
          setProgress({ done, total });
          continue;
        }
        const hash = await computeDHash(img);
        if (cancelRef.current) return;
        if (hash) {
          next.set(sheet.id, hash);
          writeCachedHash(sheet.image_file, sheet.updated_at, hash);
        }
        done++;
        setIndex(new Map(next));
        setProgress({ done, total });
        // Yield to the event loop so the UI can breathe. ~8ms between
        // hashes keeps the main thread responsive even on slow hardware.
        await new Promise((r) => setTimeout(r, 8));
      }
      trimHashCache();
      setReady(true);
    };
    void run();

    return () => {
      cancelRef.current = true;
    };
    // Re-run whenever the archive shape changes. Only `data` matters;
    // imageBase is stable at the application level.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return { index, progress, ready };
}

// Opportunistic batch persistence: periodically sync freshly-computed
// hashes from the in-memory index back into the ArchiveData so they
// eventually get committed to sheets.json. Not every sheet needs a
// commit — we only trigger a persist if enough new hashes have
// accumulated to be worth a round-trip.
//
// Returns an updated ArchiveData with image_hash populated on sheets
// where a hash exists in the index but not yet on the record. Callers
// can then decide whether to write this back via `writeArchive`.
export function applyHashesToArchive(
  data: ArchiveData,
  index: Map<string, string>
): { data: ArchiveData; addedCount: number } {
  let added = 0;
  const sheets = data.sheets.map((s) => {
    const h = index.get(s.id);
    if (h && !s.image_hash) {
      added++;
      return { ...s, image_hash: h };
    }
    return s;
  });
  if (added === 0) return { data, addedCount: 0 };
  return { data: { ...data, sheets }, addedCount: added };
}

// Helper for the UI: given a sheet, describe its hashing state.
export function sheetHashState(sheet: ModelSheet, index: Map<string, string>):
  'no-image' | 'pending' | 'ready' {
  if (!sheet.image_file || !sheet.image_file.trim()) return 'no-image';
  if (index.has(sheet.id) || sheet.image_hash) return 'ready';
  return 'pending';
}
