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
// field. Disney sequence numbers historically appear in several notations:
//   - Dotted: "4.2", "4.10"  (the common modern form)
//   - Dashed: "9-1", "4-2"   (how they appear on some 1939 sheets)
// Returns a tuple of [major, minor] integers for safe numeric comparison
// (so that 4.10 sorts after 4.2, unlike naive float parsing). Returns null
// if no leading number is detectable.
//
// Accepts:
//   "4.2"                    → [4, 2]
//   "4.10"                   → [4, 10]
//   "9-1"                    → [9, 1]
//   "1.5 Give a Little..."   → [1, 5]  (ignores trailing text)
//   "Stromboli"              → null
//   ""                       → null
export function parseSequenceNumber(
  s: string | undefined
): [number, number] | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d+)(?:[.\-](\d+))?/);
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

// Sorts sheets by their first sheet mark's value. Sheets with no
// marks sort last. Uses a natural / numeric-aware compare so "19-47"
// comes before "19-347" rather than "19-347" coming first (which is
// how straight localeCompare would sort them).
export function compareSheetsBySheetMark(
  a: ModelSheet,
  b: ModelSheet
): number {
  const aMark = a.sheet_marks?.[0]?.value || '';
  const bMark = b.sheet_marks?.[0]?.value || '';
  if (!aMark && !bMark) return compareSheets(a, b);
  if (!aMark) return 1;
  if (!bMark) return -1;
  const cmp = aMark.localeCompare(bMark, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
  if (cmp !== 0) return cmp;
  return compareSheets(a, b);
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
    sheet_marks: defaults.sheet_marks || [],
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
      image_sources: (s.image_sources || []).map((src: any) => {
        // Clean break on watermark: the field is no longer part of the
        // schema. Any value present in older records is stripped out
        // here so JSON round-trips don't keep re-introducing it. Any
        // information the user had there should be captured in
        // sheet_marks (the new field) or moved to the source's notes.
        const { watermark: _discarded, ...rest } = src;
        return {
          ...rest,
          // v4 → v5: add archive_status default for existing sources.
          archive_status: src.archive_status ?? 'not_attempted',
        };
      }),
      sequence_association: seqAssoc,
      sequence_association_confidence:
        s.sequence_association_confidence ??
        (seqAssoc ? 'medium' : undefined),
      production_stamps: s.production_stamps ?? [],
      // v5 → v5+: sheet_marks holds unidentified handwritten/stamped
      // codes. Older records won't have this field; default to empty.
      sheet_marks: Array.isArray(s.sheet_marks) ? s.sheet_marks : [],
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
// - 'stub':     minimal info — barely-started record
//
// Calibrated for Character Model Department sheets specifically. These
// sheets often deliberately lack "characters" (they predate character
// design lock) and predate formal sequence stamping, so the heuristic
// treats tags, notes, and general content as real scholarly signals
// rather than only counting the rigid production-metadata fields.
export type ResearchStatus = 'complete' | 'some' | 'stub';

export function computeResearchStatus(sheet: ModelSheet): ResearchStatus {
  // Eight signals — each present adds one point. Chosen so that a
  // typical Character Model Department sheet with title + date +
  // sequence + some tags counts comfortably in the "some" band even
  // without characters or archive verification.
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
  if (sheet.image_sources.some((s) => s.archive_status === 'verified')) signals++;
  if ((sheet.artist && sheet.artist.trim()) || sheet.approvals.length >= 1)
    signals++;
  if (sheet.published_references.length >= 1) signals++;
  if ((sheet.notes && sheet.notes.trim()) || sheet.tags.length >= 1) signals++;

  // Explicit override: if needs_research is flagged, never show green.
  if (sheet.needs_research) {
    return signals <= 1 ? 'stub' : 'some';
  }

  // Thresholds tuned so:
  //   - A record with title + sequence + date + tags (4 signals) → 'some'
  //   - A record with just a title and nothing else (1 signal) → 'stub'
  //   - A truly empty record → 'stub'
  //   - A record with most fields populated (5+) → 'complete'
  if (signals >= 5) return 'complete';
  if (signals >= 2) return 'some';
  return 'stub';
}

// Returns all sheets in the same numbered series as `sheet` — i.e., sheets
// sharing the same prefix+numeric base but possibly different suffixes.
// M217, M217-A, M217-B are all one series; M218 is a different series.
//
// Used by the detail view to show "also in this series" so researchers
// can quickly page between physically-related artifacts (alternate
// takes, continuations, revisions) that share a Character Model
// Department intake number.
//
// The current sheet is INCLUDED in the result; callers can decide
// whether to filter it out for display. Results are sorted by suffix
// (empty suffix first, then A, B, C…) via the existing compareSheets.
//
// Returns an empty array for sheets with no numeric base (numeric === 0).
export function findSeriesMembers(
  sheet: ModelSheet,
  allSheets: ModelSheet[]
): ModelSheet[] {
  if (!sheet.sheet_number_numeric) return [];
  const members = allSheets.filter(
    (s) =>
      s.sheet_number_prefix === sheet.sheet_number_prefix &&
      s.sheet_number_numeric === sheet.sheet_number_numeric
  );
  // Only return a "series" if there's more than one member. A lone sheet
  // has no series to speak of.
  if (members.length <= 1) return [];
  return members.slice().sort(compareSheets);
}

// A placeholder for a sheet that's expected to exist in a series (based on
// the alphabet sequence of its siblings) but isn't present in the archive.
// Shown as a ghost slot in the series strip so researchers can see gaps in
// their record of a physical series.
export interface SeriesGap {
  kind: 'gap';
  // The ID that would fill this slot, e.g., "M217-B" when M217-A and
  // M217-C are present. Constructed from the shared prefix + numeric
  // base + the missing suffix letter.
  id: string;
  prefix: string;
  numeric: number;
  suffix: string;
}

// Discriminated union: present sheet OR missing-slot placeholder.
export type SeriesSlot =
  | { kind: 'sheet'; sheet: ModelSheet }
  | SeriesGap;

// Like findSeriesMembers but interleaves ghost gap placeholders for
// missing suffix letters in the alphabetic range covered by the series.
//
// Example: given M217, M217-A, M217-C in the archive, returns
//   [sheet M217, sheet M217-A, gap M217-B, sheet M217-C]
//
// Does NOT speculate past the highest known suffix (so M217-D is not
// shown). Does NOT insert a placeholder for the bare numeric base if
// it's missing (M217 without suffix — some series genuinely skip this
// and we don't want to invent ghosts there).
//
// Returns an empty array if the sheet has no series to speak of.
export function findSeriesWithGaps(
  sheet: ModelSheet,
  allSheets: ModelSheet[]
): SeriesSlot[] {
  const members = findSeriesMembers(sheet, allSheets);
  if (members.length === 0) return [];

  // Pull out the ones with alphabetic suffixes (A, B, C…) separately
  // from any bare-base member (empty suffix). Gap detection only
  // applies inside the alphabet range.
  const withSuffix = members.filter((m) => m.sheet_number_suffix !== '');
  const bareBase = members.filter((m) => m.sheet_number_suffix === '');

  const slots: SeriesSlot[] = [];
  // Bare base (if present) comes first in the strip.
  for (const m of bareBase) {
    slots.push({ kind: 'sheet', sheet: m });
  }

  if (withSuffix.length === 0) return slots;

  // Build a lookup by suffix (uppercase for comparison safety) so we
  // can detect gaps without quadratic scanning.
  const bySuffix = new Map<string, ModelSheet>();
  for (const m of withSuffix) {
    bySuffix.set(m.sheet_number_suffix.toUpperCase(), m);
  }

  // Find the alphabet range. We use character codes on the first
  // letter of the suffix — works for the typical single-letter case
  // (A–Z) and degrades gracefully for anything weird (returns just
  // the members we have with no invented gaps between them).
  const suffixCodes = withSuffix
    .map((m) => m.sheet_number_suffix.toUpperCase().charCodeAt(0))
    .filter((c) => c >= 65 && c <= 90); // A–Z
  if (suffixCodes.length === 0) {
    // Non-alphabetic suffixes — can't reliably detect gaps, so just
    // return the members as-is.
    for (const m of withSuffix) slots.push({ kind: 'sheet', sheet: m });
    return slots;
  }
  const minCode = Math.min(...suffixCodes);
  const maxCode = Math.max(...suffixCodes);

  // Walk the alphabet from lowest to highest suffix, emitting either
  // the real sheet or a gap placeholder for each slot in between.
  for (let code = minCode; code <= maxCode; code++) {
    const letter = String.fromCharCode(code);
    const found = bySuffix.get(letter);
    if (found) {
      slots.push({ kind: 'sheet', sheet: found });
    } else {
      slots.push({
        kind: 'gap',
        id: `${sheet.sheet_number_prefix}${sheet.sheet_number_numeric}-${letter}`,
        prefix: sheet.sheet_number_prefix,
        numeric: sheet.sheet_number_numeric,
        suffix: letter,
      });
    }
  }

  return slots;
}

// Finds gaps in the numeric base sequence across the entire archive.
// Returns ranges of missing numeric bases, bounded by the lowest and
// highest numeric present. Scope = a single prefix (usually "M"); if
// your collection mixes prefixes, call this once per prefix.
//
// Example: given sheets M215, M217, M218, M220, returns
//   [ { prefix: "M", from: 216, to: 216 },
//     { prefix: "M", from: 219, to: 219 } ]
//
// Consecutive missing numbers collapse into a single range so a huge
// unexplored territory (M100–M150) shows as one entry instead of 50.
//
// Scholarly premise: for this collection, the researcher states that
// the numeric sequence is known to be contiguous — every missing
// number represents a physical sheet that existed in the Character
// Model Department's numbering, not an intentional skip.
export interface NumericRangeGap {
  prefix: string;
  from: number; // inclusive
  to: number;   // inclusive
}

export function findNumericGaps(
  allSheets: ModelSheet[],
  prefix: string = 'M'
): NumericRangeGap[] {
  const numerics = allSheets
    .filter((s) => s.sheet_number_prefix === prefix && s.sheet_number_numeric > 0)
    .map((s) => s.sheet_number_numeric);
  if (numerics.length === 0) return [];
  const present = new Set(numerics);
  const lo = Math.min(...numerics);
  const hi = Math.max(...numerics);

  const gaps: NumericRangeGap[] = [];
  let runStart: number | null = null;
  for (let n = lo; n <= hi; n++) {
    if (!present.has(n)) {
      if (runStart === null) runStart = n;
    } else if (runStart !== null) {
      gaps.push({ prefix, from: runStart, to: n - 1 });
      runStart = null;
    }
  }
  if (runStart !== null) {
    // Shouldn't happen since `hi` is present, but belt-and-suspenders.
    gaps.push({ prefix, from: runStart, to: hi });
  }
  return gaps;
}

// Returns records that exist in the archive but lack an attached image
// file. These are "type C" gaps — different from series gaps: the
// scholarly record is logged, but no visual reference is attached yet.
export function findRecordsWithoutImages(
  allSheets: ModelSheet[]
): ModelSheet[] {
  return allSheets.filter((s) => !s.image_file || !s.image_file.trim());
}
