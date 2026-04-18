// Vocabulary provider — loads vocabulary.json, seeds from sheets if
// missing, and exposes mutation helpers via context. Writes go through
// the existing commitTextFile path used for sheets.json, so every
// vocabulary change becomes an auditable git commit.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ModelSheet } from '../types/schema';
import {
  Vocabulary,
  VocabularyKind,
  emptyVocabulary,
  seedFromSheets,
  addCanonical as vAddCanonical,
  addAlias as vAddAlias,
  markReviewed as vMarkReviewed,
  lookup,
  LookupResult,
} from '../lib/vocabulary';
import { commitTextFile, getToken } from '../lib/github';

interface VocabularyContextValue {
  vocab: Vocabulary;
  loaded: boolean;
  lookup: (kind: VocabularyKind, input: string) => LookupResult;
  addCanonical: (kind: VocabularyKind, input: string) => Promise<void>;
  addAlias: (
    kind: VocabularyKind,
    canonicalValue: string,
    alias: string
  ) => Promise<void>;
  markReviewed: (kind: VocabularyKind, canonicalValue: string) => Promise<void>;
  // Call once, from App.tsx, after the initial sheets load, to seed
  // vocabulary from existing data if vocabulary.json didn't exist yet.
  seedIfMissing: (sheets: ModelSheet[]) => Promise<void>;
}

const VocabularyContext = createContext<VocabularyContextValue | null>(null);

export function useVocabulary(): VocabularyContextValue {
  const ctx = useContext(VocabularyContext);
  if (!ctx)
    throw new Error('useVocabulary must be used within <VocabularyProvider>');
  return ctx;
}

interface ProviderProps {
  children: React.ReactNode;
  // Base URL where public/data lives — same as what App.tsx uses
  base: string;
}

// ----------------------------- Local cache -----------------------------
//
// Shadow-cache the vocabulary in localStorage so user edits survive
// page refreshes even during the GitHub Pages CDN lag after a commit.
// The cache is cleared once the CDN catches up (i.e., the fetched
// vocabulary.json has an entry as recent as the cache's latest entry).

const CACHE_KEY = 'pma_vocab_cache_v1';

interface CachePayload {
  vocab: Vocabulary;
  latestTime: number; // ms — latest entry mutation time
  savedAt: number; // ms — when we wrote the cache
}

function readLocalCache(): CachePayload | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachePayload;
    if (!parsed?.vocab || typeof parsed.latestTime !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalCache(vocab: Vocabulary): void {
  try {
    const payload: CachePayload = {
      vocab,
      latestTime: latestEntryTime(vocab),
      savedAt: Date.now(),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn('[Vocabulary] Could not write local cache:', e);
  }
}

function clearLocalCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}

// Returns the most recent entry mutation time across the vocabulary
// (looking at reviewed_at and added_at). Used to compare freshness
// between the local cache and the fetched remote file.
function latestEntryTime(vocab: Vocabulary): number {
  let latest = 0;
  for (const kind of ['characters', 'tags'] as const) {
    for (const e of vocab[kind]) {
      if (e.reviewed_at) {
        const t = Date.parse(e.reviewed_at);
        if (!isNaN(t) && t > latest) latest = t;
      }
      if (e.added_at) {
        const t = Date.parse(e.added_at);
        if (!isNaN(t) && t > latest) latest = t;
      }
    }
  }
  return latest;
}

export function VocabularyProvider({ children, base }: ProviderProps) {
  const [vocab, setVocab] = useState<Vocabulary>(emptyVocabulary());
  const [loaded, setLoaded] = useState(false);
  // Track whether the file existed on disk — if not, seeding is OK
  const [fileExists, setFileExists] = useState<boolean | null>(null);

  // Load vocabulary.json on mount. A 404 is normal (fresh install).
  //
  // LOCAL-FIRST CACHING: GitHub Pages serves cached static files via CDN.
  // After we commit a new vocabulary.json, there's a 1–2 minute window
  // where the CDN still serves the OLD version. During that window, a
  // page refresh would show stale data — the reviewed flag the user
  // just set would appear unset, they'd mark it again, refresh, same
  // problem. Classic "loop" symptom even though the commit did land.
  //
  // Solution: shadow-cache every write in localStorage with a timestamp.
  // On mount, fetch the static file AND read the cache; whichever is
  // newer wins. Once the CDN catches up, the fetched file will be newer
  // than the cache and normal flow resumes. If the cache ever contains
  // data older than the fetched file, we discard it.
  useEffect(() => {
    const url = `${base}data/vocabulary.json`;
    const cache = readLocalCache();

    fetch(url)
      .then((r) => {
        if (r.status === 404) {
          // No remote file. If we have a local cache, use it — this
          // happens if the user seeded in this browser but the Pages
          // deploy hasn't finished yet.
          if (cache) {
            setVocab(cache.vocab);
            setFileExists(true); // treat as existing from the user's POV
            setLoaded(true);
            return null;
          }
          setFileExists(false);
          setLoaded(true);
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json().then((raw) => ({ raw, headerDate: r.headers.get('last-modified') }));
      })
      .then((result) => {
        if (!result) return;
        const { raw } = result as { raw: Vocabulary };
        // Compare cache vs. fetched. Prefer whichever has the most
        // recently-written entry overall (most recent `reviewed_at`
        // or `added_at` across entries). This picks "latest content"
        // regardless of HTTP timestamps.
        const fetchedLatest = latestEntryTime(raw);
        if (cache && cache.latestTime > fetchedLatest) {
          // Cache is newer than the CDN — the user's recent edits
          // haven't propagated yet. Use the cache for now.
          console.info(
            '[Vocabulary] Using local cache — CDN has not caught up yet'
          );
          setVocab(cache.vocab);
        } else {
          setVocab(raw);
          // CDN has caught up with (or is newer than) the cache.
          // Clear the shadow cache so we don't keep comparing forever.
          if (cache) clearLocalCache();
        }
        setFileExists(true);
        setLoaded(true);
      })
      .catch((e) => {
        console.warn('Could not load vocabulary.json:', e);
        if (cache) {
          setVocab(cache.vocab);
          setFileExists(true);
        } else {
          setFileExists(false);
        }
        setLoaded(true);
      });
  }, [base]);

  // Commit-to-GitHub helper. State is already updated by the caller via
  // setVocab's functional form — this just persists the resulting value.
  const persist = useCallback(
    async (next: Vocabulary, message: string) => {
      if (!getToken()) return; // read-only mode; don't attempt commit
      try {
        await commitTextFile(
          'data/vocabulary.json',
          JSON.stringify(next, null, 2),
          message
        );
      } catch (e) {
        console.warn('Vocabulary commit failed:', e);
      }
    },
    []
  );

  // Mutation helpers. Each one uses setVocab's functional form to compute
  // the next state from the current state, avoiding stale-closure races
  // when two mutations fire in rapid succession (e.g., user accepting two
  // lint warnings back-to-back).
  const addCanonical = useCallback(
    async (kind: VocabularyKind, input: string) => {
      let next: Vocabulary = emptyVocabulary();
      setVocab((prev) => {
        next = vAddCanonical(prev, kind, input);
        return next;
      });
      setFileExists(true);
      writeLocalCache(next);
      await persist(next, `Vocabulary: add ${kind.slice(0, -1)} "${input}"`);
    },
    [persist]
  );

  const addAlias = useCallback(
    async (kind: VocabularyKind, canonicalValue: string, alias: string) => {
      let next: Vocabulary = emptyVocabulary();
      setVocab((prev) => {
        next = vAddAlias(prev, kind, canonicalValue, alias);
        return next;
      });
      setFileExists(true);
      writeLocalCache(next);
      await persist(
        next,
        `Vocabulary: alias "${alias}" → "${canonicalValue}"`
      );
    },
    [persist]
  );

  const markReviewed = useCallback(
    async (kind: VocabularyKind, canonicalValue: string) => {
      let next: Vocabulary = emptyVocabulary();
      setVocab((prev) => {
        next = vMarkReviewed(prev, kind, canonicalValue);
        return next;
      });
      setFileExists(true);
      writeLocalCache(next);
      await persist(next, `Vocabulary: mark "${canonicalValue}" reviewed`);
    },
    [persist]
  );

  // seedIfMissing is called by App.tsx right after its initial data fetch.
  // But the vocabulary.json fetch is still in flight at that point, so
  // `fileExists` is indeterminate (null). We buffer the sheets in a ref
  // and run the actual seed when we know the file's absence.
  const pendingSeedRef = useRef<ModelSheet[] | null>(null);

  const seedIfMissing = useCallback(async (sheets: ModelSheet[]) => {
    pendingSeedRef.current = sheets;
  }, []);

  // When fileExists settles to `false`, run any buffered seed.
  useEffect(() => {
    if (fileExists !== false) return;
    const sheets = pendingSeedRef.current;
    if (!sheets || sheets.length === 0) return;
    if (!getToken()) return;
    pendingSeedRef.current = null; // consume so we don't re-seed
    const seeded = seedFromSheets(sheets);
    setVocab(seeded);
    setFileExists(true);
    writeLocalCache(seeded);
    void persist(
      seeded,
      `Vocabulary: seed from ${sheets.length} existing records`
    );
  }, [fileExists, persist]);

  const value = useMemo<VocabularyContextValue>(
    () => ({
      vocab,
      loaded,
      lookup: (kind, input) => lookup(vocab, kind, input),
      addCanonical,
      addAlias,
      markReviewed,
      seedIfMissing,
    }),
    [vocab, loaded, addCanonical, addAlias, markReviewed, seedIfMissing]
  );

  return (
    <VocabularyContext.Provider value={value}>
      {children}
    </VocabularyContext.Provider>
  );
}
