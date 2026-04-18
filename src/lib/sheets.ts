import type {
  ArchiveData,
  ModelSheet,
  DatePrecision,
  Confidence,
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
    in_my_physical_collection: false,
    published_references: [],
    web_occurrences: [],
    rarity: {
      market: 'unknown',
      institutional: 'unknown',
      iconographic: 'unknown',
    },
    confidence: 'unverified' as Confidence,
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
export function migrateArchive(raw: any): ArchiveData {
  const version = raw?.schema_version ?? 1;
  const sheets: ModelSheet[] = (raw?.sheets || []).map((s: any) => {
    // v2 → v3 field rename
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
      })),
      sequence_association: seqAssoc,
      sequence_association_confidence:
        s.sequence_association_confidence ??
        (seqAssoc ? 'medium' : undefined),
      production_stamps: s.production_stamps ?? [],
      // Remove the old field to keep records clean after migration.
      sequence: undefined,
    };
  });
  if (version < 3) {
    console.info(`Migrated archive from v${version} to v3`);
  }
  return { schema_version: 3, sheets };
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
    !sheet.date_on_sheet ||
    sheet.confidence === 'unverified'
  );
}
