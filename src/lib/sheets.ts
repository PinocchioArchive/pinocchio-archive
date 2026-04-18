import type {
  ArchiveData,
  ModelSheet,
  DatePrecision,
} from '../types/schema';

// Parses "M174-A" into { prefix: "M", numeric: 174, suffix: "A" }.
// Also handles loose input like "m19a", "M 231 - A", "231-A", "M174".
export function parseSheetNumber(input: string): {
  prefix: string;
  numeric: number;
  suffix: string;
  canonical: string;
} | null {
  if (!input) return null;
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, '');
  const match = cleaned.match(/^([A-Z]*?)(\d+)[-_]?([A-Z]*)$/);
  if (!match) return null;
  const prefix = match[1] || 'M';
  const numeric = parseInt(match[2], 10);
  const suffix = match[3] || '';
  if (isNaN(numeric)) return null;
  const canonical = suffix
    ? `${prefix}${numeric}-${suffix}`
    : `${prefix}${numeric}`;
  return { prefix, numeric, suffix, canonical };
}

// Tries to extract a sheet number from a filename like "M174-A dutch girl.jpg"
// or "pinocchio_m036a_ubangi.png". Returns null if no number-looking substring is found.
export function guessSheetNumberFromFilename(filename: string): string | null {
  const base = filename.replace(/\.[^.]+$/, '');
  // Look for M-prefixed patterns first (most reliable).
  const mMatch = base.match(/\bM[-_\s]?(\d{1,4})[-_\s]?([A-Za-z])?\b/i);
  if (mMatch) {
    const num = parseInt(mMatch[1], 10);
    const suffix = (mMatch[2] || '').toUpperCase();
    return suffix ? `M${num}-${suffix}` : `M${num}`;
  }
  // Fall back to just numbers that look sheet-like (3-4 digits).
  const numMatch = base.match(/\b(\d{2,4})[-_\s]?([A-Za-z])?\b/);
  if (numMatch) {
    const num = parseInt(numMatch[1], 10);
    const suffix = (numMatch[2] || '').toUpperCase();
    return suffix ? `M${num}-${suffix}` : `M${num}`;
  }
  return null;
}

// Sorts sheets by numeric part first, then by suffix.
// Ensures M19-A < M23-A < M174-A < M231-A rather than lexical ordering.
// Splits a free-text sequence_association into its leading number part and
// any descriptive text after it. Used by UI components that want to render
// the number in monospace and the descriptive text in italics to signal
// their different epistemic status (number = confirmed, name = inference).
//
//   "4.2"              → { number: "4.2", rest: "" }
//   "4.2 Stromboli"    → { number: "4.2", rest: "Stromboli" }
//   "4.2 - Stromboli"  → { number: "4.2", rest: "Stromboli" }
//   "Stromboli"        → { number: "",    rest: "Stromboli" }
//   ""                 → { number: "",    rest: "" }
export function formatSequenceParts(s: string | undefined): {
  number: string;
  rest: string;
} {
  if (!s) return { number: '', rest: '' };
  const trimmed = s.trim();
  const m = trimmed.match(/^(\d+(?:\.\d+)?)\s*[-—:]?\s*(.*)$/);
  if (!m || !m[1]) return { number: '', rest: trimmed };
  return { number: m[1], rest: (m[2] || '').trim() };
}

// Parses the leading sequence number from a free-text sequence_association
// field. Disney sequence numbers look like "1.5", "4.2", "4.10". Returns
// a tuple of [major, minor] integers for safe numeric comparison (so that
// 4.10 sorts after 4.2, unlike naive float parsing). Returns null if no
// leading number is detectable.
//
// Accepts:
//   "4.2"                    → [4, 2]
//   "4.10"                   → [4, 10]
//   "1.5 Give a Little..."   → [1, 5]  (ignores trailing text)
//   "Stromboli"              → null
//   ""                       → null
export function parseSequenceNumber(
  s: string | undefined
): [number, number] | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const major = parseInt(m[1], 10);
  const minor = m[2] ? parseInt(m[2], 10) : 0;
  if (isNaN(major)) return null;
  return [major, minor];
}

// Sorts sheets by the leading number in their sequence_association field.
// Sheets with no sequence number sort to the end, preserving numerical
// ordering for everything else. Tiebreaker: sheet number.
export function compareSheetsBySequence(
  a: ModelSheet,
  b: ModelSheet
): number {
  const aSeq = parseSequenceNumber(a.sequence_association);
  const bSeq = parseSequenceNumber(b.sequence_association);
  if (!aSeq && !bSeq) return compareSheets(a, b);
  if (!aSeq) return 1; // no-seq sorts last
  if (!bSeq) return -1;
  if (aSeq[0] !== bSeq[0]) return aSeq[0] - bSeq[0];
  if (aSeq[1] !== bSeq[1]) return aSeq[1] - bSeq[1];
  return compareSheets(a, b);
}

export function compareSheets(a: ModelSheet, b: ModelSheet): number {
  if (a.sheet_number_numeric !== b.sheet_number_numeric) {
    return a.sheet_number_numeric - b.sheet_number_numeric;
  }
  return a.sheet_number_suffix.localeCompare(b.sheet_number_suffix);
}

// Sorts sheets by their character list, alphabetically.
// Compares the full sorted list element-by-element: a sheet with
// ["Ballerina"] comes before one with ["Dutch Girl", "Dachshund"]
// because "Ballerina" < "Dutch Girl". Empty character lists sort last.
export function compareSheetsByCharacter(
  a: ModelSheet,
  b: ModelSheet
): number {
  const aChars = [...a.characters].sort((x, y) => x.localeCompare(y));
  const bChars = [...b.characters].sort((x, y) => x.localeCompare(y));
  if (aChars.length === 0 && bChars.length === 0) return 0;
  if (aChars.length === 0) return 1;
  if (bChars.length === 0) return -1;
  const len = Math.min(aChars.length, bChars.length);
  for (let i = 0; i < len; i++) {
    const cmp = aChars[i].localeCompare(bChars[i]);
    if (cmp !== 0) return cmp;
  }
  // Same first N characters — shorter list sorts first.
  return aChars.length - bChars.length;
}

export function makeEmptySheet(
  id: string,
  defaults: Partial<ModelSheet> = {}
): ModelSheet {
  const parsed = parseSheetNumber(id);
  const now = new Date().toISOString();
  return {
    id: parsed?.canonical || id,
    sheet_number_prefix: parsed?.prefix || 'M',
    sheet_number_numeric: parsed?.numeric || 0,
    sheet_number_suffix: parsed?.suffix || '',
    title: '',
    characters: [],
    sequence_association: defaults.sequence_association,
    sequence_association_confidence: defaults.sequence_association_confidence,
    production_stamps: defaults.production_stamps || [],
    department: defaults.department || 'Character Model Department',
    artist: defaults.artist,
    date_on_sheet: undefined,
    date_precision: 'unknown' as DatePrecision,
    approvals: defaults.approvals || [],
    image_file: '',
    image_sources: [],
    published_references: [],
    web_occurrences: [],
    rarity: {
      market: 'unknown',
      institutional: 'unknown',
      iconographic: 'unknown',
    },
    needs_research: true, // default so new records go onto the research queue
    tags: [],
    notes: '',
    created_at: now,
    updated_at: now,
    ...defaults,
  };
}

// Migrate older schema versions up to the current one.
// v1 → v2: add needs_research, web_occurrences
// v2 → v3: rename sequence → sequence_association, add production_stamps
// v3 → v4: strip in_my_physical_collection — ownership now lives in per-visitor
//          local lists (see lib/lists.ts), not in the public archive.
export function migrateArchive(raw: any): ArchiveData {
  const version = raw?.schema_version ?? 1;
  const sheets: ModelSheet[] = (raw?.sheets || []).map((s: any) => {
    const seqAssoc =
      s.sequence_association !== undefined
        ? s.sequence_association
        : s.sequence;
    return {
      ...s,
      needs_research: s.needs_research ?? false,
      web_occurrences: s.web_occurrences ?? [],
      image_width: s.image_width,
      image_height: s.image_height,
      image_sources: (s.image_sources || []).map((src: any) => ({
        ...src,
        watermark: src.watermark,
        // v4 → v5: add archive_status default for existing sources.
        // Old records had no capture attempt, so flag them explicitly.
        archive_status: src.archive_status ?? 'not_attempted',
      })),
      sequence_association: seqAssoc,
      sequence_association_confidence:
        s.sequence_association_confidence ??
        (seqAssoc ? 'medium' : undefined),
      production_stamps: s.production_stamps ?? [],
      // Fields removed across migrations — set to undefined so they don't
      // accidentally survive a partial migration and confuse downstream code.
      sequence: undefined,
      in_my_physical_collection: undefined,
    };
  });
  if (version < 5) {
    console.info(`Migrated archive from v${version} to v5`);
  }
  return { schema_version: 5, sheets };
}

// Extracts unique values from an array of sheets for autocomplete / facet UIs.
// Returns values sorted by frequency (most common first).
export function extractVocabulary(
  sheets: ModelSheet[],
  key:
    | 'characters'
    | 'sequence_association'
    | 'department'
    | 'artist'
    | 'tags'
    | 'approvals'
): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of sheets) {
    const v = s[key];
    if (Array.isArray(v)) {
      v.forEach((x) => {
        if (x) counts.set(x, (counts.get(x) || 0) + 1);
      });
    } else if (typeof v === 'string' && v) {
      counts.set(v, (counts.get(v) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count }));
}

// Same but for source_name on image sources, which lives nested.
export function extractSourceVocabulary(
  sheets: ModelSheet[]
): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of sheets) {
    for (const src of s.image_sources) {
      if (src.source_name) {
        counts.set(src.source_name, (counts.get(src.source_name) || 0) + 1);
      }
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count }));
}

// Returns defaults pulled from the most recent sheet, useful for pre-filling
// new-record forms when working through a batch from the same source.
export function getRecentDefaults(
  sheets: ModelSheet[]
): Partial<ModelSheet> {
  if (!sheets.length) return {};
  const mostRecent = [...sheets].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at)
  )[0];
  return {
    sequence_association: mostRecent.sequence_association,
    sequence_association_confidence:
      mostRecent.sequence_association_confidence,
    department: mostRecent.department,
    approvals: mostRecent.approvals,
    // Copy the last image source as a template (user can edit or remove).
    image_sources: mostRecent.image_sources.slice(0, 1).map((s) => ({
      ...s,
      retrieved: new Date().toISOString().slice(0, 10),
    })),
  };
}

// Checks if a sheet looks incomplete enough to auto-flag needs_research.
export function looksIncomplete(sheet: ModelSheet): boolean {
  return (
    !sheet.title ||
    sheet.characters.length === 0 ||
    !sheet.date_on_sheet
  );
}

// ResearchStatus represents how complete a sheet's scholarly record is.
// - 'complete': most scholarly fields populated AND not flagged for research
// - 'some':     partial info, OR explicitly flagged for more research
// - 'stub':     minimal info, very few fields populated
//
// Used to drive the colored status dot on cards and in the detail view.
// Green (complete) means "I'm satisfied with this record." Yellow (some)
// means "more work to do, either because fields are missing or because
// I've flagged this for deeper investigation." Red (stub) means "this
// record is barely started — minimal signals present."
export type ResearchStatus = 'complete' | 'some' | 'stub';

export function computeResearchStatus(sheet: ModelSheet): ResearchStatus {
  // Count key scholarly signals present. Each contributes one point.
  // We deliberately don't weight these — a simple count is easier to
  // reason about and tune. The signals are chosen because each one
  // represents a distinct scholarly contribution: identification
  // (title/characters), dating, production context (sequence), physical
  // provenance (verified archive), attribution (artist/approvals),
  // and scholarly context (references/notes).
  let signals = 0;
  if (sheet.title && sheet.title.trim()) signals++;
  if (sheet.characters.length >= 1) signals++;
  if (
    sheet.date_on_sheet &&
    sheet.date_on_sheet.trim() &&
    sheet.date_precision !== 'unknown'
  )
    signals++;
  if (sheet.sequence_association && sheet.sequence_association.trim()) signals++;
  if (
    sheet.image_sources.some((s) => s.archive_status === 'verified')
  )
    signals++;
  if (
    (sheet.artist && sheet.artist.trim()) ||
    sheet.approvals.length >= 1
  )
    signals++;
  if (sheet.published_references.length >= 1 || (sheet.notes && sheet.notes.trim()))
    signals++;

  // Explicit override: if needs_research is set, never show green. Still
  // allow red if the record is genuinely bare.
  if (sheet.needs_research) {
    return signals <= 3 ? 'stub' : 'some';
  }

  if (signals >= 6) return 'complete';
  if (signals >= 3) return 'some';
  return 'stub';
}
