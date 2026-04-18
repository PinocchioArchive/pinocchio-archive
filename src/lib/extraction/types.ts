// Shared types and provider interface for extraction backends.
// Tesseract and Claude implementations both return ExtractionResult.

export type ExtractionConfidence = 'high' | 'medium' | 'low';

// One extracted value with confidence metadata.
export interface ExtractedField<T> {
  value: T;
  confidence: ExtractionConfidence;
  note?: string; // e.g., "letter could be A or 4"
}

// A full extraction result. All fields optional — extractors fill what they can.
// Multi-value fields (characters, approvals) are returned as arrays.
export interface ExtractionResult {
  sheet_number?: ExtractedField<string>;
  title?: ExtractedField<string>;
  characters?: ExtractedField<string[]>;
  date_on_sheet?: ExtractedField<string>;
  approvals?: ExtractedField<string[]>;
  department?: ExtractedField<string>;
  sequence?: ExtractedField<string>;
  other_markings?: ExtractedField<string>;
  raw_text?: string; // full OCR text, for debugging and manual inspection
  extracted_by: 'tesseract' | 'claude' | 'none';
  extracted_at: string; // ISO datetime
  error?: string;
}

export interface Extractor {
  name: 'tesseract' | 'claude';
  available: () => Promise<boolean>;
  extract: (imageFile: File | Blob) => Promise<ExtractionResult>;
}

// Normalizes whitespace and common OCR noise for comparison.
export function normalizeText(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .trim();
}

// Detects cross-check agreement between a filename-guessed sheet number
// and an OCR-extracted sheet number. Used to boost confidence when both agree.
export function crossCheckSheetNumber(
  filenameGuess: string | null,
  extracted: ExtractedField<string> | undefined
): 'agree' | 'disagree' | 'unknown' {
  if (!filenameGuess || !extracted?.value) return 'unknown';
  const norm = (s: string) => s.toUpperCase().replace(/[\s_-]/g, '');
  return norm(filenameGuess) === norm(extracted.value) ? 'agree' : 'disagree';
}
