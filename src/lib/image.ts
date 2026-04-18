// Reads an image file and returns its pixel dimensions.
// Useful for warning the user when they upload a low-res thumbnail.
export function getImageDimensions(
  file: File
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const result = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(result);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load image for dimension check'));
    };
    img.src = url;
  });
}

// Builds a Google Lens search URL for a given image URL.
// The image URL must be publicly reachable (which ours will be, once deployed).
export function googleLensUrl(imageUrl: string): string {
  return `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}`;
}

// Builds a TinEye reverse image search URL.
export function tineyeUrl(imageUrl: string): string {
  return `https://www.tineye.com/search/?url=${encodeURIComponent(imageUrl)}`;
}

// Builds a Google Images text search URL — useful for searching by sheet number
// or character name when an image-based search fails.
export function googleImagesUrl(query: string): string {
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
}

// Formats bytes or pixel counts concisely.
export function formatResolution(width?: number, height?: number): string {
  if (!width || !height) return 'unknown';
  const mp = (width * height) / 1_000_000;
  const mpStr = mp >= 1 ? `${mp.toFixed(1)} MP` : `${(mp * 1000).toFixed(0)} kpx`;
  return `${width}×${height} (${mpStr})`;
}

// Rough quality heuristic based on long edge.
// <800px = web thumbnail, 800-1500 = decent, 1500+ = archival.
export function resolutionTier(
  width?: number,
  height?: number
): 'thumbnail' | 'decent' | 'archival' | 'unknown' {
  if (!width || !height) return 'unknown';
  const longEdge = Math.max(width, height);
  if (longEdge < 800) return 'thumbnail';
  if (longEdge < 1500) return 'decent';
  return 'archival';
}
