// Image similarity matching for the archive.
//
// Goal: given a query image, rank every sheet in the archive by visual
// similarity so researchers can ask "is this merch derived from one of my
// model sheets?" or "is this sheet image already in the archive?"
//
// Current implementation (Phase A): dHash perceptual hashing.
//   - Works entirely in-browser, no external services
//   - 64-bit hash per image, stored as 16 hex chars
//   - Compared via Hamming distance
//   - Good at: exact duplicates, near-duplicates, scaled copies, minor crops
//   - Bad at: partial matches (one figure from a multi-figure sheet),
//     stylized redrawings (common in merch)
//
// Phase B (planned): CLIP/DINO neural embeddings via Transformers.js
// for the partial-match and style-transfer cases. Stored in a separate
// field so the two systems can coexist.
//
// Design decisions worth naming:
//
// 1. dHash over pHash. dHash (difference hash) compares adjacent pixel
//    brightnesses; pHash uses DCT frequency analysis. dHash is faster,
//    doesn't need a DCT library, and performs comparably for our use
//    case (archive images are generally photographic scans of drawings,
//    not compressed images where DCT-domain matching helps). Simpler
//    code, easier to debug.
//
// 2. 8×9 resample grid → 8×8 differences → 64 bits. Standard dHash
//    sizing. Good tradeoff of speed vs. discrimination.
//
// 3. Grayscale-weighted average. Image is converted to grayscale using
//    ITU-R BT.709 luma coefficients (0.2126 R + 0.7152 G + 0.0722 B).
//    This handles colored merchandise derived from grayscale drawings
//    reasonably well.
//
// 4. Storage format is 16 hex chars rather than a raw integer/bigint.
//    Hex survives JSON round-tripping without precision loss and is
//    readable when inspecting the data file.

export const DHASH_SIZE = 8; // produces 8×9 grid → 8×8 gradient → 64 bits

// Computes a dHash for an image element. The image must already have
// its pixel data accessible — that is, either a same-origin image or
// one with appropriate CORS headers. On failure (CORS, tainted canvas,
// decode error), returns null rather than throwing.
export async function computeDHash(
  img: HTMLImageElement | ImageBitmap
): Promise<string | null> {
  const w = DHASH_SIZE + 1; // 9 — one extra column for gradient
  const h = DHASH_SIZE; // 8
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    // Draw scaled down. The browser handles bilinear resampling.
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    // Convert to grayscale using BT.709 luma.
    const gray = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      gray[i] = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    }
    // Difference hash: bit is 1 if left pixel brighter than right neighbor.
    let hash = 0n;
    let bit = 0n;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w - 1; x++) {
        if (gray[y * w + x] > gray[y * w + x + 1]) {
          hash |= 1n << bit;
        }
        bit++;
      }
    }
    // Format as 16 hex chars, zero-padded.
    return hash.toString(16).padStart(16, '0');
  } catch (e) {
    console.warn('[imageMatching] dHash failed:', e);
    return null;
  }
}

// Loads an image from a URL into an HTMLImageElement with crossOrigin
// set, suitable for canvas pixel reads. Returns null on failure.
export function loadImageForHashing(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Loads an image from a File (local user upload). No CORS concerns —
// the browser just decodes the file.
export function loadImageFromFile(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = reader.result as string;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

// Computes the Hamming distance between two hex hashes. Returns the
// number of differing bits (0 = identical, 64 = maximally different).
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return 64; // incomparable → maximally different
  const aBig = BigInt('0x' + a);
  const bBig = BigInt('0x' + b);
  let diff = aBig ^ bBig;
  let count = 0;
  while (diff > 0n) {
    if (diff & 1n) count++;
    diff >>= 1n;
  }
  return count;
}

// Similarity as a 0–100 percentage. 64 bits differing = 0%; 0 bits = 100%.
export function similarityPct(distance: number): number {
  return Math.round(((64 - distance) / 64) * 100);
}

// Rough quality tiers for UI labeling. Hamming thresholds chosen
// empirically for dHash on typical archival image pairs:
//   ≤5  → essentially identical (same image, minor re-encoding)
//   ≤10 → near-duplicate (cropped, scaled, or light edit)
//   ≤18 → related (same composition, possibly recolored or redrawn)
//   >18 → probably unrelated; only show if no better matches exist
export type MatchTier = 'identical' | 'near' | 'related' | 'distant';

export function matchTier(distance: number): MatchTier {
  if (distance <= 5) return 'identical';
  if (distance <= 10) return 'near';
  if (distance <= 18) return 'related';
  return 'distant';
}

export interface HashMatch {
  sheetId: string;
  hash: string;
  distance: number;
  similarity: number; // 0-100
  tier: MatchTier;
}

// Given a query hash and an index of (sheetId → hash), returns
// matches ranked by ascending Hamming distance. Results filtered to
// distance ≤ maxDistance (default 24; sheets beyond that are rarely
// informative even as "you might want to look").
export function rankMatches(
  queryHash: string,
  index: Map<string, string>,
  maxDistance: number = 24
): HashMatch[] {
  const matches: HashMatch[] = [];
  for (const [sheetId, hash] of index.entries()) {
    const distance = hammingDistance(queryHash, hash);
    if (distance > maxDistance) continue;
    matches.push({
      sheetId,
      hash,
      distance,
      similarity: similarityPct(distance),
      tier: matchTier(distance),
    });
  }
  matches.sort((a, b) => a.distance - b.distance);
  return matches;
}

// ─────────────────────── localStorage cache ───────────────────────
//
// Hashes for the archive's own images are cached in localStorage keyed
// by image_file path + a content-freshness marker. The marker is the
// sheet's `updated_at` timestamp — if the sheet is edited (potentially
// replacing the image), the cache entry invalidates naturally because
// the key changes.

const CACHE_KEY = 'pma_image_hashes_v1';

interface HashCacheEntry {
  hash: string;
  cachedAt: number;
}

type HashCache = Record<string, HashCacheEntry>;
// Key: `${image_file}::${updated_at}` — so a sheet's hash is re-used
// only as long as nothing about the sheet has changed since it was
// cached.

export function readHashCache(): HashCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function writeHashCache(cache: HashCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    // Quota error — cache is advisory; non-fatal.
    console.warn('[imageMatching] Could not write hash cache:', e);
  }
}

export function cacheKey(imageFile: string, updatedAt: string): string {
  return `${imageFile}::${updatedAt}`;
}

export function readCachedHash(
  imageFile: string,
  updatedAt: string
): string | null {
  const cache = readHashCache();
  const entry = cache[cacheKey(imageFile, updatedAt)];
  return entry?.hash || null;
}

export function writeCachedHash(
  imageFile: string,
  updatedAt: string,
  hash: string
): void {
  const cache = readHashCache();
  cache[cacheKey(imageFile, updatedAt)] = {
    hash,
    cachedAt: Date.now(),
  };
  writeHashCache(cache);
}

// Periodic cache trim — keep only the most-recent N entries so the
// cache doesn't grow unbounded if the archive shrinks or image files
// get renamed. Called opportunistically during indexing.
export function trimHashCache(maxEntries: number = 500): void {
  const cache = readHashCache();
  const entries = Object.entries(cache);
  if (entries.length <= maxEntries) return;
  entries.sort((a, b) => b[1].cachedAt - a[1].cachedAt);
  const trimmed: HashCache = {};
  for (let i = 0; i < maxEntries; i++) {
    const [k, v] = entries[i];
    trimmed[k] = v;
  }
  writeHashCache(trimmed);
}
