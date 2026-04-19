// Semantic image matching via CLIP embeddings.
//
// This is Phase B of the image search feature. Where pHash (Phase A)
// catches exact and near-exact duplicates well, CLIP catches
// stylistic/semantic similarity — "this is the same shark even though
// the merch artist redrew it" — which is the primary merch-check use
// case that pHash misses.
//
// Implementation notes:
//
// 1. Transformers.js is imported dynamically. The library + model
//    together weigh ~90MB on first load. We don't want every user
//    paying that cost just to open the app. The library only loads
//    when the user actually runs a deep search.
//
// 2. Model: Xenova/clip-vit-base-patch32 — a ONNX-ported CLIP base
//    model. 512-dim embeddings, good quality/size tradeoff. Browser
//    caches the weights after first download, so subsequent sessions
//    are fast.
//
// 3. Embeddings stored as base64-encoded Float32Array. 512 × 4 bytes
//    = 2KB per image raw, ~2.7KB base64. For a few hundred sheets
//    this adds ~1MB to sheets.json which is acceptable.
//
// 4. Similarity: cosine similarity between query and archive
//    embeddings. Since all embeddings produced by CLIP are already
//    L2-normalized, cosine sim reduces to a simple dot product.
//    Threshold tuning is empirical — values are in a wide range
//    roughly 0.5 (unrelated) to 0.95+ (very close), with the useful
//    band for "derivative/related" being 0.70–0.90.
//
// 5. No Node dependencies — this file is browser-only. The sharp
//    dependency that Transformers.js pulls in is Node-only (used
//    during model conversion); the browser bundle uses WebGL/WASM.

// Runtime-imported types (we import the library dynamically).
type Pipeline = (text: unknown, options?: unknown) => Promise<{ data: Float32Array }>;

// ─────────────────────── Lazy library loading ───────────────────────

let pipelinePromise: Promise<Pipeline> | null = null;
let loadingProgressCallback: ((progress: LoadProgress) => void) | null = null;

export interface LoadProgress {
  // Human-readable status — "Downloading model", "Loading weights", etc.
  status: string;
  // 0-100 if the stage has a progress bar; null for indeterminate.
  percent: number | null;
  // What file is being fetched (for diagnostics / user reassurance).
  file?: string;
}

// Registers a progress callback for the (one-time) model download.
// Pass null to clear. Callback fires multiple times during download.
export function onModelLoadProgress(
  cb: ((progress: LoadProgress) => void) | null
) {
  loadingProgressCallback = cb;
}

// Returns the image-feature-extraction pipeline. The first call
// triggers the download of the Transformers.js runtime and the
// CLIP-ViT-B/32 model (~90MB). Subsequent calls return the cached
// pipeline. Browser caches weights across sessions in IndexedDB, so
// the cold-start cost is paid only on first use per browser.
export async function getClipPipeline(): Promise<Pipeline> {
  if (pipelinePromise) return pipelinePromise;

  pipelinePromise = (async () => {
    // Dynamic import keeps the library out of the initial bundle.
    const transformers = await import('@xenova/transformers');
    // Configure the runtime. `allowLocalModels: false` means it
    // fetches from the HuggingFace CDN rather than looking for
    // local files (which don't exist in our deploy).
    (transformers as unknown as { env: Record<string, unknown> }).env.allowLocalModels = false;
    (transformers as unknown as { env: Record<string, unknown> }).env.useBrowserCache = true;

    // Wire progress events through to our callback.
    const pipe = await (transformers as unknown as {
      pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<Pipeline>;
    }).pipeline(
      'image-feature-extraction',
      'Xenova/clip-vit-base-patch32',
      {
        progress_callback: (data: {
          status: string;
          progress?: number;
          file?: string;
        }) => {
          if (!loadingProgressCallback) return;
          const percent = typeof data.progress === 'number' ? Math.round(data.progress) : null;
          loadingProgressCallback({
            status: data.status,
            percent,
            file: data.file,
          });
        },
      }
    );
    return pipe;
  })();

  return pipelinePromise;
}

// True once the pipeline has loaded successfully. Callers can poll
// this to decide whether a search will be instant or will take a
// while (because of the model download).
export function isClipReady(): boolean {
  // The promise being non-null means a load is either in progress or
  // complete. We can't tell the difference synchronously without
  // awaiting, so `isReady` here really means "loading has been
  // triggered." For the UI, the promise resolution is what matters.
  return pipelinePromise !== null;
}

// ─────────────────────── Embedding computation ───────────────────────

// Computes a CLIP embedding for an image. Input can be a URL, a File,
// a Blob, or an HTMLImageElement. Transformers.js handles the
// preprocessing (resize to 224×224, normalize per the model's
// training distribution).
export async function computeClipEmbedding(
  input: string | Blob | HTMLImageElement
): Promise<Float32Array | null> {
  try {
    const pipe = await getClipPipeline();
    let arg: unknown = input;
    // The library wants a URL/string or a RawImage. For File/Blob we
    // convert to an object URL first. For HTMLImageElement we pull
    // the src.
    if (input instanceof Blob) {
      arg = URL.createObjectURL(input);
    } else if (input instanceof HTMLImageElement) {
      arg = input.src;
    }
    const output = await pipe(arg);
    // Output is a Tensor with .data: Float32Array. Copy to detach
    // from any shared buffer the library might reuse.
    return new Float32Array(output.data);
  } catch (e) {
    console.error('[CLIP] Embedding failed:', e);
    return null;
  }
}

// ─────────────────────── Storage: base64 round-trip ───────────────

// Encodes a Float32Array as a base64 string for storage in JSON.
export function embeddingToBase64(vec: Float32Array): string {
  const bytes = new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
  // btoa can't handle raw bytes > 255 in one call — feed it in
  // chunks to stay under any string-length ceilings.
  let bin = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function embeddingFromBase64(b64: string): Float32Array | null {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Float32Array(bytes.buffer);
  } catch {
    return null;
  }
}

// ─────────────────────── Similarity + ranking ───────────────

// Cosine similarity. CLIP outputs are L2-normalized by default, so
// this reduces to a dot product — but we defensively compute the
// full form so we're not silently wrong if the library changes its
// normalization behavior.
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

export type ClipMatchTier = 'very-high' | 'high' | 'moderate' | 'weak';

// Thresholds calibrated conservatively. Real CLIP similarities for
// related-but-not-identical images tend to land in the 0.70–0.88
// range; identical images 0.95+; unrelated images 0.4–0.65.
export function clipTier(similarity: number): ClipMatchTier {
  if (similarity >= 0.92) return 'very-high';
  if (similarity >= 0.82) return 'high';
  if (similarity >= 0.72) return 'moderate';
  return 'weak';
}

export interface ClipMatch {
  sheetId: string;
  similarity: number; // 0-1
  tier: ClipMatchTier;
}

export function rankClipMatches(
  queryEmbedding: Float32Array,
  index: Map<string, Float32Array>,
  minSimilarity: number = 0.65
): ClipMatch[] {
  const out: ClipMatch[] = [];
  for (const [sheetId, emb] of index.entries()) {
    const sim = cosineSimilarity(queryEmbedding, emb);
    if (sim < minSimilarity) continue;
    out.push({
      sheetId,
      similarity: sim,
      tier: clipTier(sim),
    });
  }
  out.sort((a, b) => b.similarity - a.similarity);
  return out;
}

// ─────────────────────── localStorage cache ───────────────

const CACHE_KEY = 'pma_clip_embeddings_v1';

interface EmbeddingCacheEntry {
  b64: string;
  cachedAt: number;
}

type EmbeddingCache = Record<string, EmbeddingCacheEntry>;

function readCache(): EmbeddingCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function writeCache(c: EmbeddingCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch (e) {
    // Quota exceeded. Embeddings are bulky — 300 sheets ≈ 800KB.
    // If we're tight, drop the oldest half and retry.
    console.warn('[CLIP] Cache write failed; trimming and retrying:', e);
    const entries = Object.entries(c).sort(
      (a, b) => b[1].cachedAt - a[1].cachedAt
    );
    const trimmed: EmbeddingCache = {};
    for (let i = 0; i < Math.floor(entries.length / 2); i++) {
      const [k, v] = entries[i];
      trimmed[k] = v;
    }
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(trimmed));
    } catch {
      // still failing — give up, log once, don't throw
      console.warn('[CLIP] Could not cache embeddings at all (quota full).');
    }
  }
}

function cacheKey(imageFile: string, updatedAt: string): string {
  return `${imageFile}::${updatedAt}`;
}

export function readCachedEmbedding(
  imageFile: string,
  updatedAt: string
): Float32Array | null {
  const cache = readCache();
  const entry = cache[cacheKey(imageFile, updatedAt)];
  if (!entry) return null;
  return embeddingFromBase64(entry.b64);
}

export function writeCachedEmbedding(
  imageFile: string,
  updatedAt: string,
  vec: Float32Array
): void {
  const cache = readCache();
  cache[cacheKey(imageFile, updatedAt)] = {
    b64: embeddingToBase64(vec),
    cachedAt: Date.now(),
  };
  writeCache(cache);
}

// User-facing consent key. We set this to "1" after the user
// explicitly agrees to the first-time model download, and check it
// before auto-triggering the download elsewhere.
const CONSENT_KEY = 'pma_clip_consent_v1';

export function hasClipConsent(): boolean {
  return localStorage.getItem(CONSENT_KEY) === '1';
}

export function setClipConsent(consented: boolean): void {
  if (consented) localStorage.setItem(CONSENT_KEY, '1');
  else localStorage.removeItem(CONSENT_KEY);
}
