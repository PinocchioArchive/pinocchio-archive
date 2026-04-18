import { useState, useRef } from 'react';
import type { ModelSheet } from '../types/schema';
import { guessSheetNumberFromFilename, makeEmptySheet } from '../lib/sheets';
import { getImageDimensions } from '../lib/image';
import { tesseractExtractor } from '../lib/extraction/tesseract';
import type { ExtractionResult } from '../lib/extraction/types';

interface PendingImage {
  file: File;
  previewUrl: string;
  guessedId: string;
  finalId: string;
  width?: number;
  height?: number;
  extraction?: ExtractionResult;
  extractionStatus: 'pending' | 'running' | 'done' | 'error' | 'skipped';
  error?: string;
}

interface Props {
  existingIds: Set<string>;
  defaults: Partial<ModelSheet>;
  onImport: (
    items: Array<{
      sheet: ModelSheet;
      file: File;
      extraction?: ExtractionResult;
    }>
  ) => Promise<void>;
  onCancel: () => void;
}

export function BulkImport({ existingIds, defaults, onImport, onCancel }: Props) {
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runOcr, setRunOcr] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    const next: PendingImage[] = [];
    for (const file of arr) {
      const guessed = guessSheetNumberFromFilename(file.name) || '';
      let width: number | undefined, height: number | undefined;
      try {
        const dims = await getImageDimensions(file);
        width = dims.width;
        height = dims.height;
      } catch {
        // ignore
      }
      next.push({
        file,
        previewUrl: URL.createObjectURL(file),
        guessedId: guessed,
        finalId: guessed,
        width,
        height,
        extractionStatus: 'pending',
      });
    }
    setPending((p) => [...p, ...next]);

    // If OCR is enabled, kick off extraction in the background.
    if (runOcr) {
      runExtractionForBatch(next);
    }
  };

  const runExtractionForBatch = async (batch: PendingImage[]) => {
    setExtracting(true);
    for (const item of batch) {
      // Skip very small images — OCR won't help and will probably produce garbage.
      if (item.width && item.width < 600) {
        setPending((p) =>
          p.map((x) =>
            x.file === item.file ? { ...x, extractionStatus: 'skipped' } : x
          )
        );
        continue;
      }
      setPending((p) =>
        p.map((x) =>
          x.file === item.file ? { ...x, extractionStatus: 'running' } : x
        )
      );
      try {
        const result = await tesseractExtractor.extract(item.file);
        setPending((p) =>
          p.map((x) =>
            x.file === item.file
              ? {
                  ...x,
                  extraction: result,
                  extractionStatus: result.error ? 'error' : 'done',
                  // If OCR gave a high-confidence sheet number, use it as finalId
                  finalId:
                    !x.finalId && result.sheet_number?.confidence === 'high'
                      ? result.sheet_number.value
                      : x.finalId,
                  error: result.error,
                }
              : x
          )
        );
      } catch (e) {
        setPending((p) =>
          p.map((x) =>
            x.file === item.file
              ? {
                  ...x,
                  extractionStatus: 'error',
                  error: e instanceof Error ? e.message : String(e),
                }
              : x
          )
        );
      }
    }
    setExtracting(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  };

  const updatePending = (idx: number, patch: Partial<PendingImage>) => {
    setPending((p) =>
      p.map((item, i) => (i === idx ? { ...item, ...patch } : item))
    );
  };

  const removePending = (idx: number) => {
    setPending((p) => {
      const removed = p[idx];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return p.filter((_, i) => i !== idx);
    });
  };

  const validate = (): PendingImage[] => {
    const validated = pending.map((p) => {
      let err: string | undefined = p.error;
      if (!p.finalId) err = 'ID required';
      else if (existingIds.has(p.finalId)) err = 'ID already exists';
      else {
        const inBatch = pending.filter((x) => x.finalId === p.finalId).length;
        if (inBatch > 1) err = 'Duplicate within batch';
      }
      return { ...p, error: err };
    });
    setPending(validated);
    return validated;
  };

  const handleImport = async () => {
    setError(null);
    const validated = validate();
    const blockers = validated.filter((v) => v.error && v.error !== undefined);
    if (blockers.some((b) => b.error && !b.error.startsWith('Extraction'))) {
      setError('Fix the errors above before importing');
      return;
    }
    if (validated.length === 0) {
      setError('Nothing to import');
      return;
    }
    setImporting(true);
    try {
      const items = validated.map((p) => {
        // Pre-fill the stub from high-confidence extraction, but the full
        // extraction is passed through so the edit form can surface it for review.
        const extractedDefaults: Partial<ModelSheet> = {};
        if (p.extraction) {
          if (p.extraction.title?.confidence === 'high') {
            extractedDefaults.title = p.extraction.title.value;
          }
          if (p.extraction.date_on_sheet?.confidence === 'high') {
            extractedDefaults.date_on_sheet = p.extraction.date_on_sheet.value;
            extractedDefaults.date_precision = /^\d{4}-\d{2}-\d{2}$/.test(
              p.extraction.date_on_sheet.value
            )
              ? 'exact'
              : /^\d{4}$/.test(p.extraction.date_on_sheet.value)
              ? 'year'
              : 'unknown';
          }
        }
        const sheet = makeEmptySheet(p.finalId, {
          ...defaults,
          ...extractedDefaults,
          image_width: p.width,
          image_height: p.height,
          needs_research: true,
        });
        return { sheet, file: p.file, extraction: p.extraction };
      });
      await onImport(items);
      pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setImporting(false);
    }
  };

  const extractionCounts = {
    done: pending.filter((p) => p.extractionStatus === 'done').length,
    running: pending.filter((p) => p.extractionStatus === 'running').length,
    pending: pending.filter((p) => p.extractionStatus === 'pending').length,
    skipped: pending.filter((p) => p.extractionStatus === 'skipped').length,
    error: pending.filter((p) => p.extractionStatus === 'error').length,
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 900 }}
      >
        <button className="modal-close" onClick={onCancel} aria-label="Close">
          ×
        </button>
        <div style={{ padding: '32px 36px' }}>
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 10,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: 'var(--ink-faded)',
                marginBottom: 4,
              }}
            >
              Bulk Import
            </div>
            <h1
              className="modal-title"
              style={{ margin: 0, paddingBottom: 0, borderBottom: 'none' }}
            >
              Drop images to create stub records
            </h1>
            <p
              style={{
                fontSize: 13,
                color: 'var(--ink-faded)',
                marginTop: 8,
                marginBottom: 0,
              }}
            >
              Each image becomes a record flagged “needs research.” If OCR is on,
              Tesseract runs in the background and auto-fills what it's
              confident about. Review extracted data per-record in the edit
              form.
            </p>
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 14,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={runOcr}
              onChange={(e) => setRunOcr(e.target.checked)}
            />
            <span>
              Run OCR (Tesseract) on import — auto-extracts sheet numbers,
              dates, and approvals from clear printed text
            </span>
          </label>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            style={{
              border: `2px dashed ${dragging ? 'var(--ink)' : 'var(--rule)'}`,
              background: dragging ? 'var(--paper-deep)' : 'var(--paper)',
              padding: '30px 20px',
              textAlign: 'center',
              cursor: 'pointer',
              marginBottom: 16,
              transition: 'all 0.15s',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--serif)',
                fontStyle: 'italic',
                fontSize: 16,
                color: 'var(--ink)',
                marginBottom: 4,
              }}
            >
              Drop images here, or click to choose
            </div>
            <div
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 10,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--ink-faded)',
              }}
            >
              JPG · PNG · WebP · TIFF
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>

          {pending.length > 0 && runOcr && (
            <div
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 11,
                color: 'var(--ink-faded)',
                marginBottom: 10,
                letterSpacing: '0.03em',
              }}
            >
              OCR: {extractionCounts.done} done ·{' '}
              {extractionCounts.running > 0 && (
                <span style={{ color: 'var(--accent)' }}>
                  {extractionCounts.running} running
                </span>
              )}
              {extractionCounts.pending > 0 && (
                <> · {extractionCounts.pending} queued</>
              )}
              {extractionCounts.skipped > 0 && (
                <> · {extractionCounts.skipped} skipped (low-res)</>
              )}
              {extractionCounts.error > 0 && (
                <span style={{ color: 'var(--error)' }}>
                  {' '}
                  · {extractionCounts.error} failed
                </span>
              )}
            </div>
          )}

          {pending.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: 12,
                marginBottom: 16,
                maxHeight: 400,
                overflowY: 'auto',
                padding: 4,
              }}
            >
              {pending.map((p, i) => (
                <div
                  key={i}
                  style={{
                    border: `1px solid ${
                      p.error ? 'var(--accent)' : 'var(--rule)'
                    }`,
                    background: 'var(--paper)',
                    padding: 8,
                    position: 'relative',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => removePending(i)}
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      background: 'var(--paper)',
                      border: '1px solid var(--rule)',
                      width: 20,
                      height: 20,
                      fontFamily: 'var(--mono)',
                      fontSize: 12,
                      cursor: 'pointer',
                      color: 'var(--ink)',
                      zIndex: 1,
                    }}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                  <div
                    style={{
                      aspectRatio: '4/3',
                      background: 'var(--paper-deep)',
                      marginBottom: 8,
                      overflow: 'hidden',
                      position: 'relative',
                    }}
                  >
                    <img
                      src={p.previewUrl}
                      alt=""
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                      }}
                    />
                    {p.extractionStatus === 'running' && (
                      <div
                        style={{
                          position: 'absolute',
                          bottom: 4,
                          left: 4,
                          background: 'rgba(139, 46, 31, 0.85)',
                          color: 'var(--paper)',
                          padding: '1px 5px',
                          fontFamily: 'var(--mono)',
                          fontSize: 8,
                          letterSpacing: '0.1em',
                          textTransform: 'uppercase',
                        }}
                      >
                        OCR…
                      </div>
                    )}
                    {p.extractionStatus === 'done' && (
                      <div
                        style={{
                          position: 'absolute',
                          bottom: 4,
                          left: 4,
                          background: 'rgba(74, 107, 58, 0.85)',
                          color: 'var(--paper)',
                          padding: '1px 5px',
                          fontFamily: 'var(--mono)',
                          fontSize: 8,
                          letterSpacing: '0.1em',
                          textTransform: 'uppercase',
                        }}
                      >
                        ✓ OCR
                      </div>
                    )}
                  </div>
                  <input
                    type="text"
                    className="form-input"
                    value={p.finalId}
                    placeholder="Sheet number"
                    onChange={(e) =>
                      updatePending(i, { finalId: e.target.value.trim() })
                    }
                    style={{
                      fontFamily: 'var(--mono)',
                      fontSize: 11,
                      padding: '4px 6px',
                      width: '100%',
                    }}
                  />
                  <div
                    style={{
                      fontFamily: 'var(--mono)',
                      fontSize: 9,
                      color: p.error ? 'var(--accent)' : 'var(--ink-faded)',
                      marginTop: 4,
                      letterSpacing: '0.05em',
                    }}
                    title={p.file.name}
                  >
                    {p.error
                      ? p.error
                      : p.extraction?.sheet_number
                      ? `OCR: ${p.extraction.sheet_number.value} (${p.extraction.sheet_number.confidence})`
                      : p.width
                      ? `${p.width}×${p.height}`
                      : p.file.name.slice(0, 20)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div
              className="notice"
              style={{
                borderLeftColor: 'var(--accent)',
                color: 'var(--accent)',
                marginBottom: 12,
              }}
            >
              {error}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              gap: 8,
              paddingTop: 16,
              borderTop: '2px solid var(--ink)',
            }}
          >
            <button
              className="btn btn-filled"
              onClick={handleImport}
              disabled={
                importing || extracting || pending.length === 0
              }
            >
              {importing
                ? 'Importing…'
                : extracting
                ? 'Waiting for OCR to finish…'
                : `Import ${pending.length} stub${
                    pending.length === 1 ? '' : 's'
                  }`}
            </button>
            <button className="btn" onClick={onCancel} disabled={importing}>
              Cancel
            </button>
            <div style={{ flex: 1 }} />
            {pending.length > 0 && (
              <button
                className="btn"
                onClick={() => {
                  pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
                  setPending([]);
                }}
                disabled={importing}
              >
                Clear all
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
