import type {
  Extractor,
  ExtractionResult,
  ExtractedField,
} from './types';

// Lazy-load Tesseract only when extraction is first triggered.
// The library is ~4MB plus ~2MB for English language data.
let tesseractModule: any = null;
let workerPromise: Promise<any> | null = null;

async function loadTesseract(): Promise<any> {
  if (tesseractModule) return tesseractModule;
  // Dynamic import so Tesseract is code-split out of the main bundle.
  tesseractModule = await import('tesseract.js');
  return tesseractModule;
}

async function getWorker(): Promise<any> {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const tess = await loadTesseract();
    const worker = await tess.createWorker('eng');
    return worker;
  })();
  return workerPromise;
}

// Parses the OCR'd raw text into structured fields. Disney Character Model
// Department sheets have predictable layouts we can pattern-match against.
function parseText(raw: string): Partial<ExtractionResult> {
  const text = raw.replace(/\r/g, '');
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const result: Partial<ExtractionResult> = {};

  // ------ Sheet number ------
  // Look for M-number pattern, ideally near the start of a line.
  // Tesseract sometimes reads "M174-A" as "MI174-A" or "M174 A"; allow slop.
  const sheetRegex = /\bM[\s\-_]?(\d{1,4})[\s\-_]?([A-Z])?\b/;
  for (const line of lines.slice(0, 8)) {
    // Prefer first 8 lines — M-number is typically top-of-sheet.
    const m = line.match(sheetRegex);
    if (m) {
      const num = parseInt(m[1], 10);
      const suf = (m[2] || '').toUpperCase();
      const value = suf ? `M${num}-${suf}` : `M${num}`;
      // High confidence if the line matches exactly or near-exactly.
      const lineStripped = line.replace(/[^A-Z0-9\-]/gi, '');
      const valueStripped = value.replace(/-/g, '');
      const conf: ExtractedField<string>['confidence'] =
        lineStripped.length < 10 && lineStripped.includes(valueStripped)
          ? 'high'
          : 'medium';
      result.sheet_number = { value, confidence: conf };
      break;
    }
  }

  // ------ Department ------
  // Disney stamps vary: "Walt Disney Productions", "Character Model Department",
  // "Walt Disney Studio", etc. Loose matching.
  if (/walt\s+disney/i.test(text)) {
    if (/character\s+model/i.test(text)) {
      result.department = {
        value: 'Character Model Department',
        confidence: 'high',
      };
    } else {
      result.department = {
        value: 'Walt Disney Productions',
        confidence: 'medium',
        note: 'generic Disney stamp — verify specific department',
      };
    }
  }

  // ------ Date ------
  // Common formats on stamps: "2-2-39", "FEB 2 1939", "1939", "2/2/39".
  const datePatterns = [
    // MM-DD-YY or MM/DD/YY, assume 19YY if YY is 30-49 (production years).
    /\b(1?\d)[-\/](\d{1,2})[-\/]([34]\d)\b/,
    // Month name + day + year
    /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s+(\d{1,2}),?\s+(19[34]\d)\b/i,
    // Bare 4-digit year near "19" (weakest signal)
    /\b(193[0-9])\b/,
  ];
  const monthMap: Record<string, string> = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
  };
  for (let i = 0; i < datePatterns.length; i++) {
    const m = text.match(datePatterns[i]);
    if (!m) continue;
    if (i === 0) {
      const month = m[1].padStart(2, '0');
      const day = m[2].padStart(2, '0');
      const year = `19${m[3]}`;
      result.date_on_sheet = {
        value: `${year}-${month}-${day}`,
        confidence: 'high',
      };
    } else if (i === 1) {
      const month = monthMap[m[1].slice(0, 3).toUpperCase()];
      const day = m[2].padStart(2, '0');
      const year = m[3];
      if (month) {
        result.date_on_sheet = {
          value: `${year}-${month}-${day}`,
          confidence: 'high',
        };
      }
    } else {
      result.date_on_sheet = {
        value: m[1],
        confidence: 'low',
        note: 'Only a 4-digit year was detected',
      };
    }
    break;
  }

  // ------ Approvals ------
  // Tesseract rarely reads handwritten signatures reliably, but often picks up
  // printed "APPROVED" or "OK'D BY" text. Flag as low-confidence.
  const approvalHints: string[] = [];
  if (/\bAPPROVED\b/i.test(text)) approvalHints.push('APPROVED stamp present');
  if (/\bOK[' ]?D?\b/i.test(text)) approvalHints.push('OK\'D stamp present');
  // Known Disney figures: Joe Grant, Albert Hurter, Ham Luske, Fred Moore, etc.
  const knownApprovers = [
    'Joe Grant',
    'Albert Hurter',
    'Ham Luske',
    'Fred Moore',
    'Hamilton Luske',
    'Bill Tytla',
    'Vladimir Tytla',
  ];
  const foundApprovers: string[] = [];
  for (const name of knownApprovers) {
    // Match first name near last name loosely
    const [first, last] = name.split(' ');
    const re = new RegExp(`\\b${first}[\\s\\w]{0,3}${last}\\b`, 'i');
    if (re.test(text)) foundApprovers.push(name);
  }
  if (foundApprovers.length > 0) {
    result.approvals = {
      value: foundApprovers,
      confidence: 'medium',
      note:
        approvalHints.length > 0
          ? `${approvalHints.join(', ')}; named approvers detected`
          : 'named approvers detected, signature not verified',
    };
  } else if (approvalHints.length > 0) {
    result.other_markings = {
      value: approvalHints.join('. ') + '. Signatures not resolved.',
      confidence: 'low',
    };
  }

  // ------ Title / character ------
  // Very hard to do reliably with OCR alone — the title could be in any of
  // several places on the sheet. Return the longest non-header line as a guess.
  const nonHeaderLines = lines.filter((l) => {
    if (/walt\s+disney/i.test(l)) return false;
    if (/character\s+model/i.test(l)) return false;
    if (sheetRegex.test(l)) return false;
    if (/\b(APPROVED|OK'?D|BY|DATE)\b/i.test(l)) return false;
    if (l.length < 4) return false;
    return true;
  });
  const titleCandidate = nonHeaderLines.sort((a, b) => b.length - a.length)[0];
  if (titleCandidate && titleCandidate.length < 80) {
    result.title = {
      value: titleCandidate,
      confidence: 'low',
      note: 'Guessed from longest non-header text line',
    };
  }

  return result;
}

export const tesseractExtractor: Extractor = {
  name: 'tesseract',
  available: async () => {
    try {
      await loadTesseract();
      return true;
    } catch {
      return false;
    }
  },
  extract: async (file: File | Blob): Promise<ExtractionResult> => {
    try {
      const worker = await getWorker();
      const { data } = await worker.recognize(file);
      const parsed = parseText(data.text || '');
      return {
        ...parsed,
        raw_text: data.text,
        extracted_by: 'tesseract',
        extracted_at: new Date().toISOString(),
      };
    } catch (e) {
      return {
        extracted_by: 'tesseract',
        extracted_at: new Date().toISOString(),
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};

// Cleanly shuts down the worker. Useful when the user navigates away.
export async function disposeTesseract(): Promise<void> {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}
