import { useState, useEffect, useRef } from 'react';
import type {
  ModelSheet,
  ImageSource,
  PublishedReference,
  ImageSourceType,
  RarityLevel,
  DatePrecision,
  WebOccurrenceReading,
  ProductionStamp,
  SheetMark,
  ArchiveStatus,
} from '../types/schema';
import { parseSheetNumber } from '../lib/sheets';
import { inferSource, normalizeUrl } from '../lib/sourceInference';
import { captureWayback, verifyWayback } from '../lib/archive';
import {
  getImageDimensions,
  formatResolution,
  resolutionTier,
  googleLensUrl,
  tineyeUrl,
  yandexUrl,
  bingVisualUrl,
  googleImagesUrl,
} from '../lib/image';
import { COMMON_CURRENCIES } from '../lib/currency';
import { TagInput } from './TagInput';
import { AutocompleteInput } from './AutocompleteInput';
import { ExtractionReview } from './ExtractionReview';
import { VocabularyLint } from './VocabularyLint';
import { tesseractExtractor } from '../lib/extraction/tesseract';
import { claudeExtractor, claudeUrlExtractor, getApiKey as getAnthropicKey } from '../lib/extraction/claude';
import type { ExtractionResult } from '../lib/extraction/types';

interface Vocabularies {
  characters: { value: string; count: number }[];
  sequences: { value: string; count: number }[];
  departments: { value: string; count: number }[];
  artists: { value: string; count: number }[];
  tags: { value: string; count: number }[];
  approvals: { value: string; count: number }[];
  sourceNames: { value: string; count: number }[];
}

interface Props {
  sheet: ModelSheet;
  imageBase: string;
  publicBaseUrl: string; // e.g. https://user.github.io/pinocchio-archive/
  vocab: Vocabularies;
  isNew: boolean;
  existingIds: Set<string>;
  hasNextIncomplete: boolean;
  onSave: (updated: ModelSheet, newImageFile?: File) => Promise<void>;
  onSaveAndNext: (updated: ModelSheet, newImageFile?: File) => Promise<void>;
  onCancel: () => void;
}

export function SheetEdit({
  sheet,
  imageBase,
  publicBaseUrl,
  vocab,
  isNew,
  existingIds,
  hasNextIncomplete,
  onSave,
  onSaveAndNext,
  onCancel,
}: Props) {
  const [draft, setDraft] = useState<ModelSheet>(sheet);
  const [newImage, setNewImage] = useState<File | null>(null);
  const [newImagePreview, setNewImagePreview] = useState<string | null>(null);
  const [newImageDims, setNewImageDims] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWebOccForm, setShowWebOccForm] = useState(false);
  const [imgDragging, setImgDragging] = useState(false);
  const [extracting, setExtracting] = useState<'tesseract' | 'claude' | null>(
    null
  );
  const [extractionToReview, setExtractionToReview] = useState<
    ExtractionResult | null
  >(null);
  // When URL extraction fails, show a "paste page text instead" modal
  // preloaded with the URL that failed. Null when not showing.
  const [pasteFallbackUrl, setPasteFallbackUrl] = useState<string | null>(null);
  const [pasteFallbackText, setPasteFallbackText] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  const runExtraction = async (backend: 'tesseract' | 'claude') => {
    const source = newImage || (draft.image_file
      ? await fetch(`${imageBase}${draft.image_file}`).then((r) => r.blob())
      : null);
    if (!source) {
      setError('No image to extract from. Upload one first.');
      return;
    }
    setExtracting(backend);
    setError(null);
    try {
      const extractor =
        backend === 'tesseract' ? tesseractExtractor : claudeExtractor;
      const result = await extractor.extract(source);
      if (result.error) {
        setError(`${backend} failed: ${result.error}`);
        setExtracting(null);
        return;
      }
      setExtractionToReview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(null);
    }
  };

  // Called from the Quick Add flow when the user pastes a URL and has
  // AI extraction enabled. Fires the URL extraction and opens the review
  // modal if Claude returns structured data. Falls back to a "paste page
  // text" modal on failure.
  const runUrlExtraction = async (url: string) => {
    if (!getAnthropicKey()) return; // silent no-op without a key
    setExtracting('claude');
    setError(null);
    try {
      const result = await claudeUrlExtractor.extract(url);
      if (result.error) {
        // Open the paste-fallback modal so the user can provide the text manually
        setPasteFallbackUrl(url);
        setPasteFallbackText('');
        setError(
          `URL extraction failed: ${result.error}. Try pasting the page text manually.`
        );
        return;
      }
      setExtractionToReview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(null);
    }
  };

  // Pasted-text extraction fallback.
  const runPastedTextExtraction = async () => {
    if (!pasteFallbackText.trim()) return;
    setExtracting('claude');
    setError(null);
    try {
      const result = await claudeUrlExtractor.extractFromText(
        pasteFallbackText
      );
      if (result.error) {
        setError(`Extraction failed: ${result.error}`);
        return;
      }
      setPasteFallbackUrl(null);
      setPasteFallbackText('');
      setExtractionToReview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(null);
    }
  };

  const applyExtraction = (update: Partial<ModelSheet>) => {
    setDraft((d) => {
      // Append this extraction to the audit trail, with the accepted field names.
      const audit =
        extractionToReview &&
        (extractionToReview.extracted_by === 'tesseract' ||
          extractionToReview.extracted_by === 'claude')
          ? [
              ...(d.extractions || []),
              {
                extracted_by: extractionToReview.extracted_by,
                extracted_at: extractionToReview.extracted_at,
                result: extractionToReview as unknown,
                accepted_fields: Object.keys(update),
              },
            ]
          : d.extractions;
      return { ...d, ...update, extractions: audit };
    });
    setExtractionToReview(null);
  };

  // Focus the title on mount so Tab order flows naturally.
  useEffect(() => {
    if (isNew) {
      // For new records, focus the ID field via its autocomplete input.
      // (Focus is handled by AutocompleteInput autoFocus prop.)
    } else {
      titleRef.current?.focus();
    }
  }, [isNew]);

  // Global keyboard shortcuts within the edit form.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd/Ctrl+S = save
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void handleSubmit(false);
      }
      // Cmd/Ctrl+Enter = save and next
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void handleSubmit(true);
      }
      // Esc = cancel
      if (e.key === 'Escape') {
        // Autocomplete and tag inputs stop propagation when their
        // dropdown is open, so Escape there closes the dropdown first
        // and doesn't reach this handler. If we do see Escape here,
        // nothing is intercepting it — cancel the form.
        onCancel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, newImage]);

  const update = <K extends keyof ModelSheet>(key: K, value: ModelSheet[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const updateRarity = (
    key: keyof ModelSheet['rarity'],
    value: RarityLevel
  ) => {
    setDraft((d) => ({ ...d, rarity: { ...d.rarity, [key]: value } }));
  };

  const handleIdChange = (value: string) => {
    const parsed = parseSheetNumber(value);
    // When the parser succeeds, use canonical + parsed parts.
    // When it fails, save the raw value as id and zero out the
    // structural fields (not preserve them — stale prefix/numeric
    // from a previous successful parse would corrupt the sort).
    setDraft((d) => ({
      ...d,
      id: parsed?.canonical || value,
      sheet_number_prefix: parsed?.prefix || '',
      sheet_number_numeric: parsed?.numeric ?? 0,
      sheet_number_suffix: parsed?.suffix || '',
    }));
  };

  const handleImagePick = async (file: File | null) => {
    setNewImage(file);
    if (newImagePreview) URL.revokeObjectURL(newImagePreview);
    if (file) {
      const url = URL.createObjectURL(file);
      setNewImagePreview(url);
      try {
        const dims = await getImageDimensions(file);
        setNewImageDims(dims);
        setDraft((d) => ({
          ...d,
          image_width: dims.width,
          image_height: dims.height,
        }));
      } catch {
        setNewImageDims(null);
      }
    } else {
      setNewImagePreview(null);
      setNewImageDims(null);
    }
  };

  // Paste handler for clipboard images (Cmd/Ctrl+V).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            void handleImagePick(file);
            e.preventDefault();
            return;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Validation
  const duplicateId = !!(
    isNew && draft.id && existingIds.has(draft.id)
  );
  // Previously this also blocked saving if sheet_number_numeric was 0
  // (a proxy for "the parser succeeded"). That silently rejected
  // legitimate IDs the parser couldn't turn into a numeric — like
  // hash-prefix sheets (#5, #104), or any other numbering style that
  // doesn't fit letters-then-digits. Now: non-empty + unique is
  // enough. Unparseable IDs save fine; they just don't participate
  // in numeric sort (they sort to the end) and don't contribute to
  // gap detection.
  const invalidId = !draft.id;

  const handleSubmit = async (andNext: boolean) => {
    if (duplicateId) {
      setError(
        `Record ${draft.id} already exists. Choose a different number.`
      );
      return;
    }
    if (invalidId) {
      setError(
        'Enter a sheet ID (M174-A, PC-23, #5, 347, or any unique identifier)'
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const final = { ...draft, updated_at: new Date().toISOString() };
      if (andNext) {
        await onSaveAndNext(final, newImage || undefined);
      } else {
        await onSave(final, newImage || undefined);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const currentImageSrc = newImagePreview
    ? newImagePreview
    : draft.image_file
    ? `${imageBase}${draft.image_file}`
    : '';

  const publicImageUrl =
    !newImage && draft.image_file
      ? `${publicBaseUrl.replace(/\/$/, '')}/${draft.image_file}`
      : '';

  const onImgDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setImgDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith('image/')) void handleImagePick(f);
  };

  const resTier = resolutionTier(draft.image_width, draft.image_height);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onCancel} aria-label="Close">
          ×
        </button>
        <div className="modal-masthead">
          <span className="modal-masthead-eyebrow">
            {isNew ? 'New sheet' : 'Edit sheet'}
          </span>
          {draft.id && (
            <>
              <span className="modal-masthead-separator">·</span>
              <span className="modal-masthead-id">{draft.id}</span>
            </>
          )}
          {draft.title && (
            <>
              <span className="modal-masthead-separator">·</span>
              <span
                style={{
                  fontFamily: 'var(--serif)',
                  fontStyle: 'italic',
                  fontSize: 14,
                  color: 'var(--cream)',
                  letterSpacing: 0,
                  opacity: 0.9,
                  textTransform: 'none',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 400,
                }}
              >
                {draft.title}
              </span>
            </>
          )}
        </div>
        <div className="modal-body">
          <div
            className="modal-image"
            onDragOver={(e) => {
              e.preventDefault();
              setImgDragging(true);
            }}
            onDragLeave={() => setImgDragging(false)}
            onDrop={onImgDrop}
            style={{
              outline: imgDragging ? '2px dashed var(--ink)' : 'none',
              outlineOffset: '-8px',
            }}
          >
            {currentImageSrc ? (
              <>
                <div className="modal-image-frame">
                  <img src={currentImageSrc} alt="preview" />
                  <span className="pin-dot-bl" aria-hidden="true" />
                  <span className="pin-dot-br" aria-hidden="true" />
                </div>
                {(newImageDims || draft.image_width) && (
                  <div className="image-metadata-row">
                    <span className="res-label">
                      {formatResolution(
                        newImageDims?.width ?? draft.image_width,
                        newImageDims?.height ?? draft.image_height
                      )}
                    </span>
                    {resTier === 'thumbnail' && (
                      <span
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: 10,
                          color: 'var(--warn)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.1em',
                        }}
                      >
                        low-res
                      </span>
                    )}
                    {resTier === 'archival' && (
                      <span
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: 10,
                          color: 'var(--success)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.1em',
                        }}
                      >
                        archival
                      </span>
                    )}
                  </div>
                )}
                <div className="image-action-row">
                  <label style={{ cursor: 'pointer' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        background: 'var(--paper)',
                        border: '1px solid var(--rule)',
                        color: 'var(--ink-soft)',
                        fontFamily: 'var(--mono)',
                        fontSize: 10,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        padding: '6px 10px',
                      }}
                    >
                      Replace
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) =>
                        handleImagePick(e.target.files?.[0] || null)
                      }
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => runExtraction('tesseract')}
                    disabled={!!extracting}
                    title="Extract fields with on-device OCR (free)"
                  >
                    {extracting === 'tesseract' ? 'Extracting…' : 'OCR'}
                  </button>
                  <button
                    type="button"
                    className="btn-ai-extract"
                    onClick={() => runExtraction('claude')}
                    disabled={!!extracting || !getAnthropicKey()}
                    title={
                      getAnthropicKey()
                        ? 'Extract fields with Claude vision (paid, higher accuracy)'
                        : 'Add an Anthropic API key in Settings to enable'
                    }
                  >
                    {extracting === 'claude' ? 'Extracting…' : '✨ AI Extract'}
                  </button>
                </div>
              </>
            ) : (
              <label
                style={{
                  cursor: 'pointer',
                  textAlign: 'center',
                  padding: 40,
                  border: '2px dashed var(--rule)',
                  width: '100%',
                  fontFamily: 'var(--serif)',
                  fontStyle: 'italic',
                  color: 'var(--ink-faded)',
                }}
              >
                <div style={{ fontSize: 16, marginBottom: 6 }}>
                  Drop an image here, paste from clipboard, or click to choose
                </div>
                <div
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                  }}
                >
                  JPG · PNG · WebP · TIFF
                </div>
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) =>
                    handleImagePick(e.target.files?.[0] || null)
                  }
                />
              </label>
            )}
          </div>

          <div className="modal-meta">
            <div className="modal-header">
              <div className="modal-id">
                {isNew ? 'New record' : `Editing ${sheet.id}`}
              </div>
              <h1
                className="modal-title"
                style={{ fontStyle: 'italic', fontWeight: 400 }}
              >
                Sheet record
              </h1>
              {draft.needs_research && (
                <div style={{ marginTop: 8 }}>
                  <span
                    style={{
                      background: 'var(--warn)',
                      color: 'var(--paper)',
                      padding: '3px 8px',
                      fontFamily: 'var(--mono)',
                      fontSize: 10,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                    }}
                  >
                    Needs Research
                  </span>
                </div>
              )}
            </div>

            <div className="form-grid">
              <div className="form-field">
                <label className="form-label">
                  Sheet Number{' '}
                  <span
                    style={{
                      color: 'var(--ink-faded)',
                      textTransform: 'none',
                      letterSpacing: 0,
                    }}
                  >
                    *
                  </span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={draft.id}
                  placeholder="M174-A, PC-23, #5, or 347"
                  onChange={(e) => handleIdChange(e.target.value)}
                  autoFocus={isNew}
                  style={{
                    borderColor: duplicateId
                      ? 'var(--accent)'
                      : undefined,
                  }}
                />
                <span className="form-hint">
                  {duplicateId ? (
                    <span style={{ color: 'var(--accent)' }}>
                      ✗ Already exists
                    </span>
                  ) : draft.sheet_number_numeric ? (
                    <>
                      Parsed: {draft.sheet_number_prefix}
                      {draft.sheet_number_numeric}
                      {draft.sheet_number_suffix &&
                        `-${draft.sheet_number_suffix}`}
                    </>
                  ) : draft.id ? (
                    // User typed something that didn't parse — tell
                    // them it's fine (it'll save) but won't be part
                    // of numeric sort. This should only show for
                    // genuinely unparseable text, not for normal
                    // MXXX-A / PC-X / #X / bare-numeric entries.
                    <span style={{ color: 'var(--ink-faded)' }}>
                      Saved as-is — won't join numeric sort
                    </span>
                  ) : (
                    <>e.g., M174-A, PC-23, #5</>
                  )}
                </span>
              </div>

              <div className="form-field form-field-wide">
                <input
                  ref={titleRef}
                  type="text"
                  className="form-title-prose"
                  value={draft.title}
                  onChange={(e) => update('title', e.target.value)}
                  placeholder="Untitled sheet — add a title"
                />
              </div>

              <div className="form-field form-field-wide">
                <label className="form-label">Characters</label>
                <TagInput
                  values={draft.characters}
                  onChange={(v) => update('characters', v)}
                  suggestions={vocab.characters}
                  placeholder="Type and press Enter"
                />
                <span className="form-hint">
                  Enter to add, Backspace to remove, ↓ to browse
                </span>
                <VocabularyLint
                  kind="characters"
                  values={draft.characters}
                  onValuesChange={(v) => update('characters', v)}
                />
              </div>

              <div className="form-field">
                <label className="form-label">Sequence Association</label>
                <AutocompleteInput
                  value={draft.sequence_association || ''}
                  onChange={(v) =>
                    update('sequence_association', v || undefined)
                  }
                  suggestions={vocab.sequences}
                  placeholder="e.g., 1.5 or 4.2"
                />
              </div>

              <div className="form-field">
                <label className="form-label">Artist</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                  <div style={{ flex: 1 }}>
                    <AutocompleteInput
                      value={draft.artist || ''}
                      onChange={(v) => update('artist', v || undefined)}
                      suggestions={vocab.artists}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn-small"
                    onClick={() =>
                      update(
                        'artist',
                        draft.artist === 'Unknown' ? undefined : 'Unknown'
                      )
                    }
                    title={
                      draft.artist === 'Unknown'
                        ? 'Clear "Unknown" — artist not yet researched'
                        : 'Mark artist as researched but unknown (distinct from blank, which means not yet researched)'
                    }
                    style={{
                      whiteSpace: 'nowrap',
                      background:
                        draft.artist === 'Unknown'
                          ? 'var(--navy)'
                          : undefined,
                      color:
                        draft.artist === 'Unknown'
                          ? 'var(--cream)'
                          : undefined,
                      borderColor:
                        draft.artist === 'Unknown'
                          ? 'var(--navy)'
                          : undefined,
                    }}
                  >
                    {draft.artist === 'Unknown' ? '✓ Unknown' : 'Unknown'}
                  </button>
                </div>
                <span className="form-hint">
                  Leave blank if not yet researched. Mark "Unknown" when
                  researched but unidentifiable from available evidence.
                </span>
              </div>

              <div className="form-field">
                <label className="form-label">Date on Sheet</label>
                <input
                  type="text"
                  className="form-input"
                  value={draft.date_on_sheet || ''}
                  placeholder="1939-02-02 / 1939 / Jun 1938"
                  onChange={(e) =>
                    update('date_on_sheet', e.target.value || undefined)
                  }
                />
              </div>

              <div className="form-field">
                <label className="form-label">Date Precision</label>
                <select
                  className="form-select"
                  value={draft.date_precision}
                  onChange={(e) =>
                    update(
                      'date_precision',
                      e.target.value as DatePrecision
                    )
                  }
                >
                  <option value="exact">Exact (day)</option>
                  <option value="month">Month</option>
                  <option value="year">Year only</option>
                  <option value="range">Range</option>
                  <option value="unknown">Unknown</option>
                </select>
              </div>

              <div className="form-field form-field-wide">
                <label className="form-label">
                  Production Stamps (literally on the artifact)
                </label>
                <RepeatableProductionStamps
                  items={draft.production_stamps}
                  onChange={(v) => update('production_stamps', v)}
                />
                <span className="form-hint">
                  e.g., "PROD 2003 SEQ 4.2 SCENE 50" lower right. Usually on
                  production drawings / cels, rarely on Character Model sheets.
                </span>
              </div>

              <div className="form-field form-field-wide">
                <label className="form-label">Sheet Marks</label>
                <RepeatableSheetMarks
                  items={draft.sheet_marks || []}
                  onChange={(v) => update('sheet_marks', v)}
                />
                <span className="form-hint">
                  Handwritten codes, numbers, or other marks of uncertain
                  meaning — things you see on the sheet but haven't yet
                  identified. Sortable so you can find sheets sharing the
                  same mark and investigate.
                </span>
              </div>

              <div className="form-field">
                <label className="form-label">Needs Research</label>
                <select
                  className="form-select"
                  value={draft.needs_research ? 'yes' : 'no'}
                  onChange={(e) =>
                    update('needs_research', e.target.value === 'yes')
                  }
                >
                  <option value="yes">Yes — come back to this</option>
                  <option value="no">No — complete</option>
                </select>
              </div>

              <div className="form-field">
                <label className="form-label">Rarity: Market</label>
                <select
                  className="form-select"
                  value={draft.rarity.market}
                  onChange={(e) =>
                    updateRarity('market', e.target.value as RarityLevel)
                  }
                >
                  <option value="unknown">Unknown</option>
                  <option value="unique">Unique</option>
                  <option value="rare">Rare</option>
                  <option value="uncommon">Uncommon</option>
                  <option value="common">Common</option>
                </select>
              </div>

              <div className="form-field">
                <label className="form-label">Rarity: Institutional</label>
                <select
                  className="form-select"
                  value={draft.rarity.institutional}
                  onChange={(e) =>
                    updateRarity(
                      'institutional',
                      e.target.value as RarityLevel
                    )
                  }
                >
                  <option value="unknown">Unknown</option>
                  <option value="unique">Unique</option>
                  <option value="rare">Rare</option>
                  <option value="uncommon">Uncommon</option>
                  <option value="common">Common</option>
                </select>
              </div>

              <div className="form-field">
                <label className="form-label">Rarity: Iconographic</label>
                <select
                  className="form-select"
                  value={draft.rarity.iconographic}
                  onChange={(e) =>
                    updateRarity(
                      'iconographic',
                      e.target.value as RarityLevel
                    )
                  }
                >
                  <option value="unknown">Unknown</option>
                  <option value="unique">Unique</option>
                  <option value="rare">Rare</option>
                  <option value="uncommon">Uncommon</option>
                  <option value="common">Common</option>
                </select>
              </div>

              <div className="form-field form-field-wide">
                <label className="form-label">Tags</label>
                <TagInput
                  values={draft.tags}
                  onChange={(v) => update('tags', v)}
                  suggestions={vocab.tags}
                  placeholder="deleted_sequence, approved"
                />
                <VocabularyLint
                  kind="tags"
                  values={draft.tags}
                  onValuesChange={(v) => update('tags', v)}
                />
              </div>

              <div className="form-field form-field-wide">
                <label className="form-label">
                  Image Sources (where you found this image)
                </label>
                <RepeatableImageSources
                  items={draft.image_sources}
                  onChange={(v) => update('image_sources', v)}
                  sourceSuggestions={vocab.sourceNames}
                  sheetImageUrl={publicImageUrl || undefined}
                  onUrlExtract={runUrlExtraction}
                  hasAnthropicKey={!!getAnthropicKey()}
                />
              </div>

              <div className="form-field form-field-wide">
                <label className="form-label">Published References</label>
                <RepeatablePublishedRefs
                  items={draft.published_references}
                  onChange={(v) => update('published_references', v)}
                />
              </div>

              <div className="form-field form-field-wide">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <label className="form-label">Web Occurrences</label>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <a
                      href={
                        publicImageUrl
                          ? googleLensUrl(publicImageUrl)
                          : googleImagesUrl(draft.title || draft.id)
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="btn-small"
                      style={{ textDecoration: 'none', display: 'inline-block' }}
                      title={
                        publicImageUrl
                          ? 'Reverse-image search on Google Lens'
                          : 'Image not committed yet — this will do a text search'
                      }
                    >
                      ↗ Lens
                    </a>
                    <a
                      href={
                        publicImageUrl
                          ? tineyeUrl(publicImageUrl)
                          : 'https://www.tineye.com/'
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="btn-small"
                      style={{ textDecoration: 'none', display: 'inline-block' }}
                      title={
                        publicImageUrl
                          ? 'Reverse-image search on TinEye — best for exact-duplicate detection'
                          : 'Save first to enable reverse search'
                      }
                    >
                      ↗ TinEye
                    </a>
                    <a
                      href={
                        publicImageUrl
                          ? yandexUrl(publicImageUrl)
                          : 'https://yandex.com/images/'
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="btn-small"
                      style={{ textDecoration: 'none', display: 'inline-block' }}
                      title={
                        publicImageUrl
                          ? 'Reverse-image search on Yandex — different index, often catches archival content Google misses'
                          : 'Save first to enable reverse search'
                      }
                    >
                      ↗ Yandex
                    </a>
                    <a
                      href={
                        publicImageUrl
                          ? bingVisualUrl(publicImageUrl)
                          : 'https://www.bing.com/images'
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="btn-small"
                      style={{ textDecoration: 'none', display: 'inline-block' }}
                      title={
                        publicImageUrl
                          ? 'Reverse-image search on Bing Visual Search'
                          : 'Save first to enable reverse search'
                      }
                    >
                      ↗ Bing
                    </a>
                    <button
                      type="button"
                      className="btn-small"
                      onClick={() => setShowWebOccForm(true)}
                    >
                      + Reading
                    </button>
                  </div>
                </div>
                <WebOccurrencesList
                  items={draft.web_occurrences}
                  onChange={(v) => update('web_occurrences', v)}
                />
                {showWebOccForm && (
                  <WebOccurrenceForm
                    onAdd={(reading) => {
                      update('web_occurrences', [
                        ...draft.web_occurrences,
                        reading,
                      ]);
                      setShowWebOccForm(false);
                    }}
                    onCancel={() => setShowWebOccForm(false)}
                  />
                )}
                <span className="form-hint">
                  Click Lens or TinEye, count the hits, record here. Repeat
                  quarterly to track reproduction over time.
                </span>
              </div>

              <div className="form-field form-field-wide">
                <label className="form-label">Notes</label>
                <textarea
                  className="form-notes-prose"
                  value={draft.notes}
                  onChange={(e) => update('notes', e.target.value)}
                  placeholder="Research thoughts, open questions, provenance puzzles…"
                />
              </div>
            </div>

            {error && (
              <div
                className="notice"
                style={{
                  borderLeftColor: 'var(--error)',
                  color: 'var(--error)',
                }}
              >
                <strong>Problem:</strong> {error}
              </div>
            )}

            <div className="modal-actions">
              <button
                className="btn btn-filled"
                onClick={() => handleSubmit(false)}
                disabled={saving || duplicateId}
                title="Cmd/Ctrl + S"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              {hasNextIncomplete && (
                <button
                  className="btn btn-filled"
                  onClick={() => handleSubmit(true)}
                  disabled={saving || duplicateId}
                  title="Cmd/Ctrl + Enter"
                  style={{
                    background: 'var(--accent)',
                    borderColor: 'var(--accent)',
                  }}
                >
                  Save & Next →
                </button>
              )}
              <button
                className="btn"
                onClick={onCancel}
                disabled={saving}
                title="Esc"
              >
                Cancel
              </button>
              <div style={{ flex: 1 }} />
              <span
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 9,
                  color: 'var(--ink-faded)',
                  alignSelf: 'center',
                  letterSpacing: '0.05em',
                }}
              >
                ⌘S save · ⌘↵ next · esc cancel
              </span>
            </div>
          </div>
        </div>
      </div>
      {extractionToReview && (
        <ExtractionReview
          sheet={draft}
          extraction={extractionToReview}
          filenameGuess={newImage ? newImage.name : null}
          imageUrl={currentImageSrc}
          onAccept={applyExtraction}
          onClose={() => setExtractionToReview(null)}
        />
      )}
      {pasteFallbackUrl && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setPasteFallbackUrl(null);
              setPasteFallbackText('');
            }
          }}
        >
          <div
            className="modal"
            style={{ maxWidth: 620 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => {
                setPasteFallbackUrl(null);
                setPasteFallbackText('');
              }}
              aria-label="Close"
            >
              ×
            </button>
            <div className="modal-eyebrow">Extraction fallback</div>
            <h2 className="modal-title">Paste page text</h2>
            <p
              style={{
                fontSize: 13,
                color: 'var(--ink-faded)',
                fontStyle: 'italic',
                margin: '0 0 12px',
              }}
            >
              Claude couldn't fetch{' '}
              <code style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
                {pasteFallbackUrl.slice(0, 80)}
                {pasteFallbackUrl.length > 80 ? '…' : ''}
              </code>{' '}
              directly — often due to bot blocking, paywalls, or required
              JavaScript. Open the page in your browser, select and copy the
              relevant text, and paste it here. Claude will extract the fields
              from your pasted text.
            </p>
            <textarea
              className="form-textarea"
              value={pasteFallbackText}
              onChange={(e) => setPasteFallbackText(e.target.value)}
              placeholder="Paste the page text here…"
              style={{ width: '100%', minHeight: 220, fontSize: 13 }}
              autoFocus
            />
            <div
              style={{
                display: 'flex',
                gap: 8,
                marginTop: 12,
                paddingTop: 10,
                borderTop: '1px solid var(--rule)',
              }}
            >
              <button
                className="btn btn-filled"
                onClick={() => void runPastedTextExtraction()}
                disabled={!pasteFallbackText.trim() || extracting === 'claude'}
              >
                {extracting === 'claude'
                  ? 'Extracting…'
                  : 'Extract from pasted text'}
              </button>
              <button
                className="btn"
                onClick={() => {
                  setPasteFallbackUrl(null);
                  setPasteFallbackText('');
                }}
              >
                Cancel
              </button>
              <div style={{ flex: 1 }} />
              <a
                href={pasteFallbackUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  alignSelf: 'center',
                  fontSize: 12,
                  color: 'var(--accent)',
                }}
              >
                Open page ↗
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RepeatableProductionStamps({
  items,
  onChange,
}: {
  items: ProductionStamp[];
  onChange: (v: ProductionStamp[]) => void;
}) {
  const add = () =>
    onChange([
      ...items,
      {
        prod_number: '',
        sequence_number: '',
        scene_number: '',
        location_on_sheet: '',
        notes: '',
      },
    ]);
  const remove = (i: number) =>
    onChange(items.filter((_, idx) => idx !== i));
  const setItem = (i: number, patch: Partial<ProductionStamp>) =>
    onChange(items.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  return (
    <div className="form-repeatable">
      {items.length === 0 && (
        <span className="form-hint">
          None. Add one below if the object is stamped.
        </span>
      )}
      {items.map((item, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '8px 10px',
            background: 'var(--paper)',
            border: '1px solid var(--rule)',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr auto',
              gap: 6,
              alignItems: 'start',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 9,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-faded)',
                }}
              >
                PROD
              </span>
              <input
                type="text"
                className="form-input"
                value={item.prod_number || ''}
                placeholder="2003"
                onChange={(e) =>
                  setItem(i, { prod_number: e.target.value })
                }
                style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 9,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-faded)',
                }}
              >
                SEQ
              </span>
              <input
                type="text"
                className="form-input"
                value={item.sequence_number || ''}
                placeholder="4.2"
                onChange={(e) =>
                  setItem(i, { sequence_number: e.target.value })
                }
                style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 9,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-faded)',
                }}
              >
                SCENE
              </span>
              <input
                type="text"
                className="form-input"
                value={item.scene_number || ''}
                placeholder="50"
                onChange={(e) =>
                  setItem(i, { scene_number: e.target.value })
                }
                style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
              />
            </div>
            <button
              type="button"
              className="btn-small"
              onClick={() => remove(i)}
              aria-label="Remove stamp"
              style={{ alignSelf: 'flex-end' }}
            >
              ×
            </button>
          </div>
          <input
            type="text"
            className="form-input"
            value={item.location_on_sheet || ''}
            placeholder="Location on sheet (e.g., lower right, verso top)"
            onChange={(e) =>
              setItem(i, { location_on_sheet: e.target.value })
            }
          />
          <input
            type="text"
            className="form-input"
            value={item.notes || ''}
            placeholder="Notes"
            onChange={(e) => setItem(i, { notes: e.target.value })}
          />
        </div>
      ))}
      <button
        type="button"
        className="btn-small"
        onClick={add}
        style={{ alignSelf: 'flex-start' }}
      >
        + Add stamp
      </button>
    </div>
  );
}

// Repeatable {value, notes} rows for sheet_marks — unidentified codes
// handwritten or stamped on the sheet. Intentionally spare: the whole
// point of this field is to log uncertain things without committing to
// what they mean.
function RepeatableSheetMarks({
  items,
  onChange,
}: {
  items: SheetMark[];
  onChange: (v: SheetMark[]) => void;
}) {
  const add = () =>
    onChange([...items, { value: '', notes: '' }]);
  const remove = (i: number) =>
    onChange(items.filter((_, idx) => idx !== i));
  const setItem = (i: number, patch: Partial<SheetMark>) =>
    onChange(items.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  return (
    <div className="form-repeatable">
      {items.length === 0 && (
        <span className="form-hint">
          None. Add one below if you see unidentified marks on the sheet.
        </span>
      )}
      {items.map((item, i) => (
        <div
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 2fr auto',
            gap: 6,
            padding: '8px 10px',
            background: 'var(--paper)',
            border: '1px solid var(--rule)',
            alignItems: 'start',
          }}
        >
          <input
            type="text"
            className="form-input"
            value={item.value}
            placeholder="19-347"
            onChange={(e) => setItem(i, { value: e.target.value })}
            style={{ fontFamily: 'var(--mono)', fontSize: 13 }}
          />
          <input
            type="text"
            className="form-input"
            value={item.notes || ''}
            placeholder="Location / medium / theories (optional)"
            onChange={(e) => setItem(i, { notes: e.target.value })}
          />
          <button
            type="button"
            className="btn-small"
            onClick={() => remove(i)}
            aria-label="Remove this mark"
            title="Remove"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn-small"
        onClick={add}
        style={{ alignSelf: 'flex-start' }}
      >
        + Add mark
      </button>
    </div>
  );
}

function RepeatableImageSources({
  items,
  onChange,
  sourceSuggestions,
  sheetImageUrl,
  onUrlExtract,
  hasAnthropicKey,
}: {
  items: ImageSource[];
  onChange: (v: ImageSource[]) => void;
  sourceSuggestions: { value: string; count: number }[];
  sheetImageUrl?: string;
  onUrlExtract?: (url: string) => void | Promise<void>;
  hasAnthropicKey?: boolean;
}) {
  const add = () =>
    onChange([
      ...items,
      {
        source_type: 'unknown' as ImageSourceType,
        source_name: '',
        url: '',
        retrieved: new Date().toISOString().slice(0, 10),
        notes: '',
        archive_status: 'not_attempted',
      },
    ]);
  const remove = (i: number) =>
    onChange(items.filter((_, idx) => idx !== i));
  const setItem = (i: number, patch: Partial<ImageSource>) =>
    onChange(items.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  // "Quick add" flow: user pastes a URL, app auto-populates source_name/type
  // from domain inference, fires Wayback capture in background, and if
  // AI extraction is enabled also asks Claude to read the page and
  // populate the sheet's own fields.
  const [quickUrl, setQuickUrl] = useState('');
  const [extractOnAdd, setExtractOnAdd] = useState(true);
  const [busy, setBusy] = useState(false);

  // Keep a ref to the latest items so background verify callbacks can
  // read them without stale closure — onChange isn't a functional setter,
  // so we can't call onChange(prev => ...).
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const doQuickAdd = async () => {
    const url = quickUrl.trim();
    if (!url) return;
    setBusy(true);
    try {
      const normalized = normalizeUrl(url);
      const inference = inferSource(normalized);
      const newSource: ImageSource = {
        url: normalized,
        source_type: inference?.source_type ?? 'unknown',
        source_name: inference?.source_name ?? '',
        retrieved: new Date().toISOString().slice(0, 10),
        notes: '',
        source_name_inferred: inference?.confident,
        source_type_inferred: inference?.confident,
        archive_status: 'pending',
        archive_captured_at: new Date().toISOString(),
        archive_url: `https://web.archive.org/web/${normalized}`,
      };
      const updated = [...items, newSource];
      onChange(updated);
      setQuickUrl('');

      // Kick off AI extraction in parallel with Wayback capture. The parent
      // handles showing the review modal; we just fire-and-forget here.
      if (extractOnAdd && hasAnthropicKey && onUrlExtract) {
        void onUrlExtract(normalized);
      }

      // Fire capture + verify in background. Uses itemsRef to read the
      // latest state at verify time — the user may have added or removed
      // other rows before this resolves.
      void (async () => {
        try {
          await captureWayback(normalized);
          await new Promise((r) => setTimeout(r, 30000));
          const result = await verifyWayback(normalized);
          const current = itemsRef.current;
          onChange(
            current.map((s) =>
              s.url === normalized
                ? {
                    ...s,
                    archive_status: result.status,
                    archive_url: result.archive_url || s.archive_url,
                  }
                : s
            )
          );
        } catch (e) {
          console.warn('Wayback flow error:', e);
        }
      })();
    } finally {
      setBusy(false);
    }
  };

  const recapture = async (i: number) => {
    const item = items[i];
    if (!item.url) return;
    setItem(i, {
      archive_status: 'pending',
      archive_captured_at: new Date().toISOString(),
    });
    try {
      await captureWayback(item.url);
      await new Promise((r) => setTimeout(r, 30000));
      const result = await verifyWayback(item.url);
      setItem(i, {
        archive_status: result.status,
        archive_url: result.archive_url || item.archive_url,
      });
    } catch {
      setItem(i, { archive_status: 'failed' });
    }
  };

  // Recheck hits only the Availability API — no new Save Page Now request.
  // Useful when you suspect the API is lagging (Wayback says "unavailable"
  // but the snapshot actually exists, which happens often enough to matter).
  const recheck = async (i: number) => {
    const item = items[i];
    if (!item.url) return;
    try {
      const result = await verifyWayback(item.url);
      setItem(i, {
        archive_status: result.status,
        archive_url: result.archive_url || item.archive_url,
      });
    } catch (e) {
      console.warn('Recheck failed:', e);
    }
  };

  return (
    <div className="form-repeatable">
      {/* Quick add from URL */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '8px 10px',
          background: 'var(--paper-deep)',
          border: '1px dashed var(--rule)',
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
          }}
        >
          <input
            type="text"
            className="form-input"
            value={quickUrl}
            placeholder="Paste URL to add a source (auto-fills + archives to Wayback)"
            onChange={(e) => setQuickUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void doQuickAdd();
              }
            }}
            style={{ flex: 1, minWidth: 0 }}
            disabled={busy}
          />
          <button
            type="button"
            className="btn-small"
            onClick={() => void doQuickAdd()}
            disabled={busy || !quickUrl.trim()}
            title="Add source, auto-fill fields, capture to Wayback"
          >
            {busy ? 'Adding…' : '+ Add'}
          </button>
          {sheetImageUrl && (
            <button
              type="button"
              className="btn-small"
              onClick={() =>
                window.open(
                  `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(
                    sheetImageUrl
                  )}`,
                  '_blank',
                  'noopener,noreferrer'
                )
              }
              title="Open Google Lens in new tab — paste a result URL above to add"
              style={{ whiteSpace: 'nowrap' }}
            >
              ↗ Lens
            </button>
          )}
        </div>
        {hasAnthropicKey && (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              color: 'var(--ink-faded)',
              fontFamily: 'var(--mono)',
              letterSpacing: '0.03em',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={extractOnAdd}
              onChange={(e) => setExtractOnAdd(e.target.checked)}
              style={{ margin: 0 }}
            />
            Also extract sheet fields from this page (Claude reads the URL, you
            review proposed field values)
          </label>
        )}
      </div>

      {items.length === 0 && (
        <span className="form-hint">None yet.</span>
      )}
      {items.map((item, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '8px 10px',
            background: 'var(--paper)',
            border: '1px solid var(--rule)',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr auto',
              gap: 6,
              alignItems: 'start',
            }}
          >
            <div>
              <select
                className="form-select"
                value={item.source_type}
                onChange={(e) =>
                  setItem(i, {
                    source_type: e.target.value as ImageSourceType,
                    source_type_inferred: false,
                  })
                }
                style={{ width: '100%' }}
              >
                <option value="unknown">Unknown source</option>
                <option value="auction_listing">Auction listing</option>
                <option value="published_book">Published book</option>
                <option value="archive_website">Archive website</option>
                <option value="fan_site">Fan site</option>
                <option value="social_media">Social media</option>
                <option value="personal_photograph">Personal photograph</option>
                <option value="disney_archives">Disney Archives</option>
                <option value="other">Other</option>
              </select>
              {item.source_type_inferred && (
                <BestGuessBadge
                  onConfirm={() =>
                    setItem(i, { source_type_inferred: false })
                  }
                />
              )}
            </div>
            <div>
              <AutocompleteInput
                value={item.source_name || ''}
                onChange={(v) =>
                  setItem(i, {
                    source_name: v,
                    source_name_inferred: false,
                  })
                }
                suggestions={sourceSuggestions}
                placeholder="Source name (e.g. Heritage)"
              />
              {item.source_name_inferred && (
                <BestGuessBadge
                  onConfirm={() =>
                    setItem(i, { source_name_inferred: false })
                  }
                />
              )}
            </div>
            <button
              type="button"
              className="btn-small"
              onClick={() => remove(i)}
              aria-label="Remove source"
            >
              ×
            </button>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 120px',
              gap: 6,
            }}
          >
            <input
              type="text"
              className="form-input"
              value={item.url || ''}
              placeholder="URL"
              onChange={(e) => setItem(i, { url: e.target.value })}
            />
            <input
              type="text"
              className="form-input"
              value={item.retrieved || ''}
              placeholder="Retrieved"
              onChange={(e) => setItem(i, { retrieved: e.target.value })}
            />
          </div>
          {/* Archive status row */}
          {item.url && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 11,
                fontFamily: 'var(--mono)',
                color: 'var(--ink-faded)',
                letterSpacing: '0.05em',
              }}
            >
              <ArchiveStatusPill status={item.archive_status} />
              {item.archive_url && (
                <a
                  href={item.archive_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: 'var(--accent)',
                    opacity: item.archive_status === 'failed' ? 0.7 : 1,
                    textDecoration:
                      item.archive_status === 'failed'
                        ? 'underline dotted'
                        : 'underline',
                  }}
                  title={
                    item.archive_status === 'failed'
                      ? "Availability API reports no snapshot, but the API lags sometimes — click to check manually"
                      : 'View Wayback snapshot'
                  }
                >
                  View on Wayback ↗
                </a>
              )}
              {(item.archive_status === 'not_attempted' ||
                item.archive_status === 'failed') && (
                <button
                  type="button"
                  className="btn-small"
                  onClick={() => void recapture(i)}
                  style={{ fontSize: 10, padding: '2px 6px' }}
                  title={
                    item.archive_status === 'failed'
                      ? 'Fire a fresh Wayback Save Page Now request (takes ~30s)'
                      : 'Submit this URL to the Wayback Machine'
                  }
                >
                  {item.archive_status === 'failed'
                    ? 'Retry capture'
                    : 'Capture to Wayback'}
                </button>
              )}
              {(item.archive_status === 'failed' ||
                item.archive_status === 'pending') && (
                <button
                  type="button"
                  className="btn-small"
                  onClick={() => void recheck(i)}
                  style={{ fontSize: 10, padding: '2px 6px' }}
                  title="Re-query the Wayback Availability API without firing a new capture. Useful when the API is lagging and you suspect the snapshot already exists."
                >
                  Recheck
                </button>
              )}
              {item.archive_captured_at && (
                <span>
                  captured {item.archive_captured_at.slice(0, 10)}
                </span>
              )}
            </div>
          )}
          {/* Auction / sale details — expanded when the source_type
              suggests this is an auction listing, OR when any
              auction field has data. Collapsed otherwise to avoid
              cluttering image sources that aren't sales (fan
              sites, magazine scans, social media posts). */}
          <AuctionDetailsBlock
            item={item}
            onChange={(patch) => setItem(i, patch)}
          />
          <input
            type="text"
            className="form-input"
            value={item.notes || ''}
            placeholder="Notes"
            onChange={(e) => setItem(i, { notes: e.target.value })}
          />
        </div>
      ))}
      <button
        type="button"
        className="btn-small"
        onClick={add}
        style={{ alignSelf: 'flex-start' }}
      >
        + Add blank source
      </button>
    </div>
  );
}

// Small clickable "best guess" badge shown next to auto-filled fields.
// Clicking it confirms the value (clears the inferred flag), removing the
// badge. Editing the field directly also implicitly clears the flag.
function BestGuessBadge({ onConfirm }: { onConfirm: () => void }) {
  return (
    <button
      type="button"
      onClick={onConfirm}
      title="Click to confirm (removes this badge)"
      style={{
        marginTop: 2,
        padding: '1px 6px',
        fontSize: 9,
        fontFamily: 'var(--mono)',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        background: 'var(--paper-deep)',
        border: '1px solid var(--warn)',
        color: 'var(--warn)',
        cursor: 'pointer',
      }}
    >
      best guess · confirm?
    </button>
  );
}

function ArchiveStatusPill({ status }: { status?: ArchiveStatus }) {
  const s = status || 'not_attempted';
  const colors: Record<ArchiveStatus, { bg: string; fg: string; text: string }> = {
    verified: {
      bg: 'var(--paper-deep)',
      fg: 'var(--success)',
      text: 'Wayback: verified',
    },
    pending: {
      bg: 'var(--paper-deep)',
      fg: 'var(--warn)',
      text: 'Wayback: pending…',
    },
    failed: {
      bg: 'var(--paper-deep)',
      fg: 'var(--danger)',
      text: 'Wayback: failed',
    },
    not_attempted: {
      bg: 'var(--paper-deep)',
      fg: 'var(--ink-faded)',
      text: 'Wayback: not captured',
    },
  };
  const c = colors[s];
  return (
    <span
      style={{
        padding: '1px 6px',
        border: `1px solid ${c.fg}`,
        color: c.fg,
        background: c.bg,
        fontSize: 10,
        letterSpacing: '0.05em',
      }}
      title={
        s === 'failed'
          ? "Wayback couldn't capture this URL. The site may block archiving via robots.txt, require JavaScript, or have other restrictions. Click 'Retry capture' to try again."
          : s === 'pending'
          ? 'Capture fired, waiting for verification. Status auto-updates on next page load.'
          : s === 'verified'
          ? 'Snapshot exists and resolves on Wayback Machine'
          : 'URL has not been submitted to Wayback Machine'
      }
    >
      {c.text}
    </span>
  );
}

function RepeatablePublishedRefs({
  items,
  onChange,
}: {
  items: PublishedReference[];
  onChange: (v: PublishedReference[]) => void;
}) {
  const add = () =>
    onChange([...items, { source: '', page: '', notes: '' }]);
  const remove = (i: number) =>
    onChange(items.filter((_, idx) => idx !== i));
  const setItem = (i: number, patch: Partial<PublishedReference>) =>
    onChange(items.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  return (
    <div className="form-repeatable">
      {items.length === 0 && (
        <span className="form-hint">None yet.</span>
      )}
      {items.map((item, i) => (
        <div
          key={i}
          className="form-repeatable-item"
          style={{ alignItems: 'start' }}
        >
          <input
            type="text"
            className="form-input"
            value={item.source}
            placeholder="Kaufman 2012"
            onChange={(e) => setItem(i, { source: e.target.value })}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              type="text"
              className="form-input"
              value={item.page?.toString() || ''}
              placeholder="Page"
              onChange={(e) => setItem(i, { page: e.target.value })}
            />
            <input
              type="text"
              className="form-input"
              value={item.notes || ''}
              placeholder="Notes"
              onChange={(e) => setItem(i, { notes: e.target.value })}
            />
          </div>
          <button
            type="button"
            className="btn-small"
            onClick={() => remove(i)}
            aria-label="Remove reference"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn-small"
        onClick={add}
        style={{ alignSelf: 'flex-start' }}
      >
        + Add reference
      </button>
    </div>
  );
}

function WebOccurrencesList({
  items,
  onChange,
}: {
  items: WebOccurrenceReading[];
  onChange: (v: WebOccurrenceReading[]) => void;
}) {
  if (items.length === 0)
    return (
      <div className="form-hint" style={{ marginTop: 4 }}>
        No readings yet.
      </div>
    );
  const sorted = [...items].sort((a, b) =>
    b.checked_on.localeCompare(a.checked_on)
  );
  return (
    <div style={{ marginTop: 6 }}>
      <table
        style={{
          width: '100%',
          fontSize: 12,
          fontFamily: 'var(--mono)',
          borderCollapse: 'collapse',
        }}
      >
        <thead>
          <tr
            style={{
              borderBottom: '1px solid var(--rule)',
              color: 'var(--ink-faded)',
              fontSize: 10,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            <th style={{ textAlign: 'left', padding: '4px 4px' }}>Date</th>
            <th style={{ textAlign: 'left', padding: '4px 4px' }}>Source</th>
            <th style={{ textAlign: 'right', padding: '4px 4px' }}>Count</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr
              key={i}
              style={{ borderBottom: '1px solid var(--rule)' }}
            >
              <td style={{ padding: '3px 4px' }}>{r.checked_on}</td>
              <td style={{ padding: '3px 4px' }}>{r.source}</td>
              <td style={{ padding: '3px 4px', textAlign: 'right' }}>
                {r.count.toLocaleString()}
              </td>
              <td
                style={{
                  padding: '3px 4px',
                  textAlign: 'right',
                  width: 24,
                }}
              >
                <button
                  type="button"
                  className="btn-small"
                  onClick={() =>
                    onChange(items.filter((x) => x !== r))
                  }
                  aria-label="Delete reading"
                  style={{ padding: '0 6px' }}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WebOccurrenceForm({
  onAdd,
  onCancel,
}: {
  onAdd: (r: WebOccurrenceReading) => void;
  onCancel: () => void;
}) {
  const [count, setCount] = useState('');
  const [source, setSource] =
    useState<WebOccurrenceReading['source']>('google_lens');
  const [notes, setNotes] = useState('');

  const submit = () => {
    const n = parseInt(count.replace(/,/g, ''), 10);
    if (isNaN(n) || n < 0) return;
    onAdd({
      count: n,
      checked_on: new Date().toISOString().slice(0, 10),
      source,
      notes: notes || undefined,
    });
  };

  return (
    <div
      className="form-repeatable"
      style={{ marginTop: 8, background: 'var(--paper)' }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr auto',
          gap: 6,
        }}
      >
        <input
          type="text"
          className="form-input"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          placeholder="Count (e.g., 47)"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <select
          className="form-select"
          value={source}
          onChange={(e) =>
            setSource(
              e.target.value as WebOccurrenceReading['source']
            )
          }
        >
          <option value="google_lens">Google Lens</option>
          <option value="tineye">TinEye</option>
          <option value="google_images">Google Images (text)</option>
          <option value="other">Other</option>
        </select>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            className="btn-small"
            onClick={submit}
          >
            Add
          </button>
          <button
            type="button"
            className="btn-small"
            onClick={onCancel}
          >
            ×
          </button>
        </div>
      </div>
      <input
        type="text"
        className="form-input"
        value={notes}
        placeholder="Notes (optional)"
        onChange={(e) => setNotes(e.target.value)}
      />
    </div>
  );
}

// Editor sub-block for the optional auction/sale fields on an
// ImageSource. Collapsed by default unless the item already has
// auction data OR the source_type strongly suggests a sale event.
// The block handles: auction house, lot number, SKU, sale date &
// precision, hammer price & currency, estimate range, sold/unsold
// flag.
//
// Design choices:
// - Numeric inputs use type="number" with step="0.01" so cents can
//   be entered but aren't required. Empty string → undefined, not 0.
// - Currency is a small dropdown of common codes. Default USD.
// - The "did it sell" flag is a tri-state select (unknown/sold/unsold)
//   rather than a checkbox, so we can preserve the distinction
//   between "undocumented" and "confirmed unsold."
// - All fields are optional. No validation — a messy record is still
//   better than no record.
function AuctionDetailsBlock({
  item,
  onChange,
}: {
  item: ImageSource;
  onChange: (patch: Partial<ImageSource>) => void;
}) {
  // Is the block currently showing any auction data?
  const hasAuctionData =
    item.auction_house ||
    item.lot_number ||
    item.sku ||
    item.sale_date ||
    item.price_sold !== undefined ||
    item.price_estimate_low !== undefined ||
    item.price_estimate_high !== undefined ||
    item.sold !== undefined;

  // Auto-expand when source_type is auction_listing OR when data exists.
  const shouldAutoShow =
    item.source_type === 'auction_listing' || hasAuctionData;

  const [showBlock, setShowBlock] = useState(shouldAutoShow);

  // Keep open if data appears (e.g., after a source_type change).
  useEffect(() => {
    if (shouldAutoShow && !showBlock) setShowBlock(true);
  }, [shouldAutoShow, showBlock]);

  // Helper to parse a number input. Empty → undefined. Invalid → keep old.
  const parseNum = (s: string): number | undefined => {
    if (s.trim() === '') return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  };

  if (!showBlock) {
    return (
      <button
        type="button"
        onClick={() => setShowBlock(true)}
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 10,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--ink-faded)',
          background: 'transparent',
          border: 'none',
          padding: '2px 0',
          cursor: 'pointer',
          textAlign: 'left',
          textDecoration: 'underline dotted',
          textUnderlineOffset: 3,
        }}
        title="Add sale/auction details: lot #, price, date, etc."
      >
        + Sale details
      </button>
    );
  }

  return (
    <div
      style={{
        background: 'var(--paper-deep)',
        border: '1px solid var(--rule)',
        borderRadius: 'var(--radius-sm)',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 2,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 10,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--ink-faded)',
          }}
        >
          Sale details
        </span>
        {!hasAuctionData && (
          <button
            type="button"
            onClick={() => setShowBlock(false)}
            style={{
              fontSize: 10,
              color: 'var(--ink-faded)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
            title="Hide (no data to keep)"
          >
            Hide
          </button>
        )}
      </div>

      {/* Row 1: auction house + lot number */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr',
          gap: 6,
        }}
      >
        <input
          type="text"
          className="form-input"
          value={item.auction_house || ''}
          placeholder="Auction house (e.g. Van Eaton)"
          onChange={(e) => onChange({ auction_house: e.target.value })}
        />
        <input
          type="text"
          className="form-input"
          value={item.lot_number || ''}
          placeholder="Lot #"
          onChange={(e) => onChange({ lot_number: e.target.value })}
        />
      </div>

      {/* Row 2: SKU + sale date + precision */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1.2fr 1fr',
          gap: 6,
        }}
      >
        <input
          type="text"
          className="form-input"
          value={item.sku || ''}
          placeholder="SKU / item #"
          onChange={(e) => onChange({ sku: e.target.value })}
        />
        <input
          type="text"
          className="form-input"
          value={item.sale_date || ''}
          placeholder="Sale date"
          onChange={(e) => onChange({ sale_date: e.target.value })}
        />
        <select
          className="form-select"
          value={item.sale_date_precision || ''}
          onChange={(e) => {
            const v = e.target.value;
            onChange({
              sale_date_precision: (v || undefined) as DatePrecision | undefined,
            });
          }}
          style={{ fontSize: 12 }}
          title="How specific the sale date is"
        >
          <option value="">Precision…</option>
          <option value="exact">Exact day</option>
          <option value="month">Month</option>
          <option value="year">Year</option>
          <option value="range">Range</option>
          <option value="unknown">Unknown</option>
        </select>
      </div>

      {/* Row 3: hammer price + currency + sold flag */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.2fr 0.8fr 1fr',
          gap: 6,
        }}
      >
        <input
          type="number"
          step="0.01"
          className="form-input"
          value={item.price_sold ?? ''}
          placeholder="Hammer price"
          onChange={(e) => onChange({ price_sold: parseNum(e.target.value) })}
        />
        <select
          className="form-select"
          value={item.currency || 'USD'}
          onChange={(e) => onChange({ currency: e.target.value })}
          style={{ fontSize: 12 }}
        >
          {COMMON_CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code}
            </option>
          ))}
        </select>
        <select
          className="form-select"
          value={
            item.sold === true
              ? 'sold'
              : item.sold === false
              ? 'unsold'
              : ''
          }
          onChange={(e) => {
            const v = e.target.value;
            onChange({
              sold:
                v === 'sold'
                  ? true
                  : v === 'unsold'
                  ? false
                  : undefined,
            });
          }}
          style={{ fontSize: 12 }}
          title="Did the item actually sell?"
        >
          <option value="">Outcome…</option>
          <option value="sold">Sold</option>
          <option value="unsold">Unsold / passed</option>
        </select>
      </div>

      {/* Row 4: estimate range */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 6,
        }}
      >
        <input
          type="number"
          step="0.01"
          className="form-input"
          value={item.price_estimate_low ?? ''}
          placeholder="Estimate low"
          onChange={(e) =>
            onChange({ price_estimate_low: parseNum(e.target.value) })
          }
        />
        <input
          type="number"
          step="0.01"
          className="form-input"
          value={item.price_estimate_high ?? ''}
          placeholder="Estimate high"
          onChange={(e) =>
            onChange({ price_estimate_high: parseNum(e.target.value) })
          }
        />
      </div>
    </div>
  );
}
