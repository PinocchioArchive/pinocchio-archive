// Controlled vocabulary system for characters and tags.
//
// The archive treats characters and tags as free-text strings in the
// underlying schema, but layers a vocabulary on top: canonical names
// plus aliases, with a strict lint step that flags non-canonical
// entries when they're introduced. This gives the scholarly archivist
// a soft enforcement mechanism without locking the schema itself.
//
// Vocabulary lives in public/data/vocabulary.json alongside sheets.json
// so it's version-controlled, publicly auditable, and readable without
// the app. Edits are made exclusively through the in-app lint workflow —
// there's no separate vocabulary management CRUD, just "accept" /
// "treat as alias" actions that surface from lint warnings.
//
// Capitalization rules (applied on canonical entry, not to user input):
//   - Characters: Title Case ("The Blue Fairy", "Orchestra Musicians")
//   - Tags: sentence case, first letter only ("Undersea", "Puppet theater")

export interface VocabularyEntry {
  canonical: string; // normalized canonical form
  aliases: string[]; // other forms that resolve to canonical
  reviewed: boolean; // has a human confirmed this is correct?
  notes?: string;    // optional scholarly note
  added_at: string;  // ISO date
  reviewed_at?: string; // ISO date of promotion to reviewed
}

export interface Vocabulary {
  schema_version: number;
  characters: VocabularyEntry[];
  tags: VocabularyEntry[];
}

export type VocabularyKind = 'characters' | 'tags';

export function emptyVocabulary(): Vocabulary {
  return { schema_version: 1, characters: [], tags: [] };
}

// ----------------------------- Capitalization -----------------------------

// Title Case: capitalize first letter of each word, lowercase the rest.
// Exception: small connector words (of, the, and, in, on) stay lowercase
// unless they're the first word. This matches editorial style guides and
// reads as scholarly rather than aggressive-looking.
const LOWERCASE_CONNECTORS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'if', 'in',
  'of', 'on', 'or', 'the', 'to', 'vs', 'with',
]);

export function titleCase(input: string): string {
  const words = input.trim().split(/\s+/);
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      // Preserve mid-word punctuation like hyphens and apostrophes while
      // capitalizing each piece. "o'hara" → "O'Hara", "jean-luc" → "Jean-Luc"
      const parts = lower.split(/([-'])/);
      const cased = parts
        .map((p, pi) => {
          if (p === '-' || p === "'") return p;
          // First word always cased; subsequent words check connector list
          if (i === 0 || pi > 0 || !LOWERCASE_CONNECTORS.has(p)) {
            return p.charAt(0).toUpperCase() + p.slice(1);
          }
          return p;
        })
        .join('');
      return cased;
    })
    .join(' ');
}

// Sentence case: capitalize only the first letter of the whole string,
// leaving everything else untouched (so "undersea" → "Undersea",
// "Monstro whale" → "Monstro whale", "DCDisney stamp" → "DCDisney stamp").
// Preserves any internal casing the user deliberately wrote.
export function sentenceCase(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function normalize(input: string, kind: VocabularyKind): string {
  return kind === 'characters' ? titleCase(input) : sentenceCase(input);
}

// Normalize for comparison: lowercase + collapse whitespace. Used when
// checking whether a new entry matches an existing canonical/alias.
export function compareKey(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ----------------------------- Lookup -----------------------------

export interface LookupResult {
  status: 'canonical' | 'alias' | 'unknown';
  entry?: VocabularyEntry;
  canonicalValue?: string; // what the input resolves to (if alias or canonical)
}

// Look up a single input value in the vocabulary. Returns:
// - 'canonical' if input matches a canonical name (exact, case-insensitive)
// - 'alias' if input matches one of the aliases
// - 'unknown' if no match at all
export function lookup(
  vocab: Vocabulary,
  kind: VocabularyKind,
  input: string
): LookupResult {
  const key = compareKey(input);
  if (!key) return { status: 'unknown' };
  const entries = vocab[kind];
  for (const e of entries) {
    if (compareKey(e.canonical) === key) {
      return { status: 'canonical', entry: e, canonicalValue: e.canonical };
    }
    for (const alias of e.aliases) {
      if (compareKey(alias) === key) {
        return { status: 'alias', entry: e, canonicalValue: e.canonical };
      }
    }
  }
  return { status: 'unknown' };
}

// ----------------------------- Mutations -----------------------------

// Add a brand-new canonical entry. Input is normalized per kind's rules
// before being stored. Returns the new vocabulary (immutably).
export function addCanonical(
  vocab: Vocabulary,
  kind: VocabularyKind,
  input: string,
  opts: { notes?: string } = {}
): Vocabulary {
  const canonical = normalize(input, kind);
  // Dedupe: if a canonical already exists with this compareKey, return as-is
  const existing = lookup(vocab, kind, canonical);
  if (existing.status === 'canonical') return vocab;
  const now = new Date().toISOString();
  const newEntry: VocabularyEntry = {
    canonical,
    aliases: [],
    reviewed: false,
    added_at: now,
    ...(opts.notes ? { notes: opts.notes } : {}),
  };
  return {
    ...vocab,
    [kind]: [...vocab[kind], newEntry],
  };
}

// Add an alias to an existing canonical entry.
export function addAlias(
  vocab: Vocabulary,
  kind: VocabularyKind,
  canonicalValue: string,
  alias: string
): Vocabulary {
  const key = compareKey(canonicalValue);
  const aliasKey = compareKey(alias);
  return {
    ...vocab,
    [kind]: vocab[kind].map((e) => {
      if (compareKey(e.canonical) !== key) return e;
      // Don't duplicate existing aliases or matches to the canonical itself
      if (compareKey(e.canonical) === aliasKey) return e;
      if (e.aliases.some((a) => compareKey(a) === aliasKey)) return e;
      return { ...e, aliases: [...e.aliases, alias.trim()] };
    }),
  };
}

// Mark an entry as reviewed (promoted from auto-seeded to confirmed).
export function markReviewed(
  vocab: Vocabulary,
  kind: VocabularyKind,
  canonicalValue: string
): Vocabulary {
  const key = compareKey(canonicalValue);
  const now = new Date().toISOString();
  return {
    ...vocab,
    [kind]: vocab[kind].map((e) =>
      compareKey(e.canonical) === key
        ? { ...e, reviewed: true, reviewed_at: now }
        : e
    ),
  };
}

// ----------------------------- Seeding -----------------------------

// Build an initial vocabulary from existing sheet records. Every unique
// character and tag becomes a canonical entry with reviewed: false.
// Called once, on first load, if vocabulary.json doesn't exist.
export function seedFromSheets(
  sheets: { characters: string[]; tags: string[] }[]
): Vocabulary {
  const charSet = new Map<string, string>(); // compareKey → first-seen form
  const tagSet = new Map<string, string>();
  for (const s of sheets) {
    for (const c of s.characters) {
      const k = compareKey(c);
      if (k && !charSet.has(k)) charSet.set(k, c);
    }
    for (const t of s.tags) {
      const k = compareKey(t);
      if (k && !tagSet.has(k)) tagSet.set(k, t);
    }
  }
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    characters: Array.from(charSet.values())
      .map((c) => ({
        canonical: normalize(c, 'characters'),
        aliases: [],
        reviewed: false,
        added_at: now,
      }))
      .sort((a, b) => a.canonical.localeCompare(b.canonical)),
    tags: Array.from(tagSet.values())
      .map((t) => ({
        canonical: normalize(t, 'tags'),
        aliases: [],
        reviewed: false,
        added_at: now,
      }))
      .sort((a, b) => a.canonical.localeCompare(b.canonical)),
  };
}
