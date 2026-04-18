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

export function VocabularyProvider({ children, base }: ProviderProps) {
  const [vocab, setVocab] = useState<Vocabulary>(emptyVocabulary());
  const [loaded, setLoaded] = useState(false);
  // Track whether the file existed on disk — if not, seeding is OK
  const [fileExists, setFileExists] = useState<boolean | null>(null);

  // Load vocabulary.json on mount. A 404 is normal (fresh install).
  useEffect(() => {
    const url = `${base}data/vocabulary.json`;
    fetch(url)
      .then((r) => {
        if (r.status === 404) {
          setFileExists(false);
          setLoaded(true);
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((raw) => {
        if (raw) {
          setVocab(raw);
          setFileExists(true);
        }
        setLoaded(true);
      })
      .catch((e) => {
        console.warn('Could not load vocabulary.json:', e);
        setFileExists(false);
        setLoaded(true);
      });
  }, [base]);

  // Persist vocabulary to GitHub. Silent no-op if not authenticated —
  // local state still updates, but the file isn't written. This mirrors
  // the sheets.json write behavior: read-only visitors can't modify,
  // authenticated users commit to the repo.
  const persist = useCallback(
    async (next: Vocabulary, message: string) => {
      setVocab(next);
      setFileExists(true);
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

  const addCanonical = useCallback(
    async (kind: VocabularyKind, input: string) => {
      const next = vAddCanonical(vocab, kind, input);
      await persist(next, `Vocabulary: add ${kind.slice(0, -1)} "${input}"`);
    },
    [vocab, persist]
  );

  const addAlias = useCallback(
    async (kind: VocabularyKind, canonicalValue: string, alias: string) => {
      const next = vAddAlias(vocab, kind, canonicalValue, alias);
      await persist(
        next,
        `Vocabulary: alias "${alias}" → "${canonicalValue}"`
      );
    },
    [vocab, persist]
  );

  const markReviewed = useCallback(
    async (kind: VocabularyKind, canonicalValue: string) => {
      const next = vMarkReviewed(vocab, kind, canonicalValue);
      await persist(
        next,
        `Vocabulary: mark "${canonicalValue}" reviewed`
      );
    },
    [vocab, persist]
  );

  const seedIfMissing = useCallback(
    async (sheets: ModelSheet[]) => {
      // Only seed if (a) file didn't exist AND (b) we have sheets to
      // seed from AND (c) we're authenticated (anon users shouldn't
      // trigger a write). fileExists starts null (indeterminate), so
      // wait until we know.
      if (fileExists !== false) return;
      if (sheets.length === 0) return;
      if (!getToken()) return;
      const seeded = seedFromSheets(sheets);
      await persist(
        seeded,
        `Vocabulary: seed from ${sheets.length} existing records`
      );
    },
    [fileExists, persist]
  );

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
