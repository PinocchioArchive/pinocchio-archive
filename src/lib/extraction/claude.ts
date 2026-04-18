import type {
  Extractor,
  ExtractionResult,
  ExtractionConfidence,
} from './types';

const API_KEY_STORAGE = 'pma_anthropic_key';
const MODEL_STORAGE = 'pma_anthropic_model';

export function getApiKey(): string | null {
  return localStorage.getItem(API_KEY_STORAGE);
}

export function setApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE, key);
}

export function clearApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE);
}

export function getModel(): string {
  return (
    localStorage.getItem(MODEL_STORAGE) || 'claude-sonnet-4-5-20250929'
  );
}

export function setModel(model: string): void {
  localStorage.setItem(MODEL_STORAGE, model);
}

// Converts a File/Blob to a base64 string (no data URL prefix).
function toBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const SYSTEM_PROMPT = `You are a specialist assistant extracting structured data from scanned Walt Disney Studios Character Model Department sheets from the late 1930s, specifically from the production of Pinocchio (1940).

You are looking at one model sheet image. Extract what you can observe, and do NOT infer or guess beyond what is visibly printed, stamped, or handwritten on the sheet itself.

Return ONLY a JSON object with this exact shape, no prose, no markdown fences:

{
  "sheet_number": { "value": "M174-A", "confidence": "high|medium|low", "note": "optional" },
  "title": { "value": "Dutch Girl Puppet and Dachshund", "confidence": "high|medium|low" },
  "characters": { "value": ["Dutch Girl Puppet", "Dachshund"], "confidence": "medium" },
  "date_on_sheet": { "value": "1939-02-02", "confidence": "high" },
  "approvals": { "value": ["Joe Grant"], "confidence": "medium", "note": "signature partially illegible" },
  "department": { "value": "Character Model Department", "confidence": "high" },
  "sequence": { "value": "4-2", "confidence": "low", "note": "only if visible on sheet" },
  "other_markings": { "value": "Handwritten 'do not use' in red pencil, upper right", "confidence": "high" }
}

Rules:
- Omit any field you cannot read at all. Do not hallucinate empty strings.
- Confidence "high" = you can clearly read the text. "medium" = readable but ambiguous characters. "low" = guess based on partial visibility.
- Sheet numbers follow the pattern M[number]-[letter], e.g. M19-A, M174-A. Never return a sheet number without at least seeing the M and the digits.
- Dates on these sheets are typically in format "2-2-39" (month-day-year) or "FEB 2 1939". Convert to ISO "YYYY-MM-DD" in the output.
- Characters = figures actually depicted on the sheet (a Dutch girl, a dachshund). Title = the printed title/caption of the sheet if visible.
- Approvals = named individuals whose signatures or printed names appear next to approval stamps. Do not invent signatures.
- "other_markings" is a free-text field for anything interesting that doesn't fit above: handwritten annotations, stamps, perforations, damage, studio numbers, cross-reference notes.

If you cannot read anything, return {}.`;

function parseResponse(text: string): Partial<ExtractionResult> {
  // Strip markdown fences if the model emitted any despite instructions.
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    // Validate shape lightly — each field should be { value, confidence }.
    const out: Partial<ExtractionResult> = {};
    const copyField = <K extends keyof ExtractionResult>(key: K) => {
      const v = parsed[key];
      if (
        v &&
        typeof v === 'object' &&
        'value' in v &&
        'confidence' in v &&
        ['high', 'medium', 'low'].includes(v.confidence)
      ) {
        (out as any)[key] = {
          value: v.value,
          confidence: v.confidence as ExtractionConfidence,
          note: typeof v.note === 'string' ? v.note : undefined,
        };
      }
    };
    copyField('sheet_number');
    copyField('title');
    copyField('characters');
    copyField('date_on_sheet');
    copyField('approvals');
    copyField('department');
    copyField('sequence');
    copyField('other_markings');
    return out;
  } catch (e) {
    console.warn('Claude returned non-JSON:', cleaned);
    return {};
  }
}

export const claudeExtractor: Extractor = {
  name: 'claude',
  available: async () => !!getApiKey(),
  extract: async (file: File | Blob): Promise<ExtractionResult> => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return {
        extracted_by: 'claude',
        extracted_at: new Date().toISOString(),
        error: 'No Anthropic API key configured',
      };
    }
    try {
      const base64 = await toBase64(file);
      const mediaType =
        file.type && file.type.startsWith('image/')
          ? file.type
          : 'image/jpeg';
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: getModel(),
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: mediaType,
                    data: base64,
                  },
                },
                {
                  type: 'text',
                  text: 'Extract the structured data from this model sheet. Return only the JSON described in your instructions.',
                },
              ],
            },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        return {
          extracted_by: 'claude',
          extracted_at: new Date().toISOString(),
          error: `API ${res.status}: ${body.slice(0, 200)}`,
        };
      }
      const data = await res.json();
      const textBlock = (data.content || []).find(
        (b: any) => b.type === 'text'
      );
      const rawText = textBlock?.text || '';
      const parsed = parseResponse(rawText);
      return {
        ...parsed,
        raw_text: rawText,
        extracted_by: 'claude',
        extracted_at: new Date().toISOString(),
      };
    } catch (e) {
      return {
        extracted_by: 'claude',
        extracted_at: new Date().toISOString(),
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};
