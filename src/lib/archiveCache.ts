// Shadow cache for the main archive (data/sheets.json) in localStorage.
// Mirrors the pattern used by VocabularyProvider for vocabulary.json.
//
// Problem this solves:
// GitHub Pages serves the static sheets.json via a CDN that can lag
// 1–2 minutes behind a fresh commit. During that window, a page
// refresh fetches the STALE cached version — the user's most recent
// edits appear reverted. They re-edit, refresh, hit the same window,
// and conclude their changes "aren't sticking." The commit actually
// landed; only the read path is stale.
//
// Fix:
// After every successful write, also write the fresh archive to
// localStorage with a timestamp. On mount, fetch the CDN copy AND
// read the cache; use whichever is newer. Once the CDN catches up
// (fetched copy has timestamp >= cached copy), clear the cache so
// we stop comparing.
//
// Freshness comparison uses the max `updated_at` across all sheets
// as a proxy for "when was this archive last changed."

import type { ArchiveData, ModelSheet } from '../types/schema';

const CACHE_KEY = 'pma_archive_cache_v1';

interface CachePayload {
  archive: ArchiveData;
  latestTime: number; // ms — max updated_at across sheets, for freshness comparison
  savedAt: number; // ms — when we wrote the cache
}

// Max updated_at time across the archive. Used as a timestamp proxy
// for deciding whether the local cache is newer than the CDN's copy.
export function latestArchiveTime(archive: ArchiveData): number {
  let latest = 0;
  for (const s of archive.sheets) {
    if (s.updated_at) {
      const t = Date.parse(s.updated_at);
      if (!isNaN(t) && t > latest) latest = t;
    }
  }
  return latest;
}

export function readArchiveCache(): CachePayload | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachePayload;
    if (
      !parsed?.archive ||
      !Array.isArray(parsed.archive.sheets) ||
      typeof parsed.latestTime !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeArchiveCache(archive: ArchiveData): void {
  try {
    const payload: CachePayload = {
      archive,
      latestTime: latestArchiveTime(archive),
      savedAt: Date.now(),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch (e) {
    // Most likely a quota error — the archive may be large. Log but
    // don't throw; the commit itself succeeded and the user just won't
    // have the CDN-lag protection on this refresh.
    console.warn('[Archive] Could not write local cache:', e);
  }
}

export function clearArchiveCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}

// Merge helper: given the CDN-fetched archive and the local cache,
// return whichever has the more recent content. When the fetched copy
// is at least as fresh as the cache, return the fetched copy (and
// signal the caller to clear the cache).
export function pickFreshestArchive(
  fetched: ArchiveData,
  cache: CachePayload | null
): { archive: ArchiveData; shouldClearCache: boolean; usedCache: boolean } {
  if (!cache) return { archive: fetched, shouldClearCache: false, usedCache: false };
  const fetchedLatest = latestArchiveTime(fetched);
  if (cache.latestTime > fetchedLatest) {
    return { archive: cache.archive, shouldClearCache: false, usedCache: true };
  }
  return { archive: fetched, shouldClearCache: true, usedCache: false };
}

// Small narrowing: the cache may contain a record that's fresher per-sheet
// than the fetched copy even if the overall `latestTime` isn't higher. A
// realistic case: two rapid edits where the second edit's updated_at is
// ahead of CDN propagation. We already handle that via latestTime, so
// this function is just a check that the cache contains expected fields.
export function cacheIsValid(cache: CachePayload | null): cache is CachePayload {
  if (!cache) return false;
  return Array.isArray(cache.archive.sheets) && typeof cache.latestTime === 'number';
}

// For debugging / display: how old is the cache, in minutes? Returns -1
// if no cache exists.
export function archiveCacheAgeMinutes(): number {
  const cache = readArchiveCache();
  if (!cache) return -1;
  return Math.floor((Date.now() - cache.savedAt) / 60000);
}

// Convenience re-export of ModelSheet for callers that need the type
// without pulling from the schema module directly.
export type { ModelSheet };
