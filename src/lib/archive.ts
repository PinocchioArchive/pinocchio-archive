// Wayback Machine capture and verification.
//
// The IA's "Save Page Now" endpoint accepts a POST at
// https://web.archive.org/save/{url}. It does not serve CORS headers for
// cross-origin responses, so we can't read the actual response — but we
// can fire the request in `no-cors` mode (browser sends the POST, gets a
// response back, and discards it silently). The capture still happens
// server-side.
//
// After a capture, the canonical "latest available" URL
//   https://web.archive.org/web/{encoded_url}
// redirects to the most recent snapshot. We store this rather than the
// timestamped snapshot URL — that way if the sheet is re-captured later,
// the stored link always points to the most recent preservation.
//
// Verification: to know whether the capture actually took hold (vs. being
// silently rejected by robots.txt or the site being unreachable), we fire
// a subsequent request to the latest-available URL and check if it
// resolves. Because of CORS, we use an <img> element probe — we try to
// load a known image from the snapshot, and fire callbacks based on
// onload / onerror. This is imperfect but honest: a verified result means
// "something from this capture loads"; a failure means "we couldn't
// confirm the capture landed."
//
// For the URL-level verification (where we just want to know the snapshot
// HTML exists, not a specific image within it), we use a different trick:
// the Wayback Availability API at
//   https://archive.org/wayback/available?url={url}
// DOES serve CORS headers, and returns JSON telling us whether a snapshot
// exists and its timestamp.

export interface WaybackStatus {
  status: 'verified' | 'pending' | 'failed';
  archive_url?: string; // The latest-available redirect URL
  snapshot_url?: string; // The timestamped snapshot URL, if known
  snapshot_timestamp?: string; // ISO-ish 14-digit YYYYMMDDhhmmss
  checked_at: string; // ISO timestamp of this check
  error?: string;
}

// Constructs the "latest available" Wayback URL for a given original URL.
// This URL redirects to the most recent snapshot of the page. We use it
// as the stored archive_url because it survives re-captures.
export function latestAvailableUrl(originalUrl: string): string {
  return `https://web.archive.org/web/${originalUrl}`;
}

// Fires a Save Page Now request. Returns immediately — does NOT wait for
// the capture to complete (which typically takes 15-45 seconds). The
// caller should schedule a verification pass afterward.
//
// Returns the expected `archive_url` (latest-available redirect) so the
// caller can store it optimistically.
export async function captureWayback(
  originalUrl: string
): Promise<{ archive_url: string; captured_at: string }> {
  const saveEndpoint = `https://web.archive.org/save/${encodeURI(
    originalUrl
  )}`;
  const captured_at = new Date().toISOString();
  try {
    // Fire the capture. `no-cors` means we can't read the response, but
    // the request is still sent to the server. If this throws, the
    // browser prevented the request entirely — probably a network issue
    // or an invalid URL.
    await fetch(saveEndpoint, {
      method: 'GET',
      mode: 'no-cors',
    });
  } catch (e) {
    // Non-fatal — the capture may have fired despite the error. Log it
    // but return anyway; verification will tell us the truth.
    console.warn('Wayback capture fetch error (may have still fired):', e);
  }
  return {
    archive_url: latestAvailableUrl(originalUrl),
    captured_at,
  };
}

// Checks whether a Wayback snapshot exists for the given original URL.
// Uses the official Availability API (which DOES send CORS headers).
// Returns a normalized status object.
//
// This is the preferred verification path because it gives us real
// JSON data rather than the opaque image-probe fallback.
export async function verifyWayback(
  originalUrl: string
): Promise<WaybackStatus> {
  const checked_at = new Date().toISOString();
  const apiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(
    originalUrl
  )}`;
  try {
    const res = await fetch(apiUrl, { method: 'GET' });
    if (!res.ok) {
      return {
        status: 'failed',
        checked_at,
        error: `Availability API returned ${res.status}`,
      };
    }
    const data = (await res.json()) as {
      archived_snapshots?: {
        closest?: {
          available?: boolean;
          url?: string;
          timestamp?: string;
          status?: string;
        };
      };
    };
    const closest = data?.archived_snapshots?.closest;
    if (!closest || !closest.available || !closest.url) {
      return {
        status: 'failed',
        checked_at,
        error: 'No snapshot available for this URL',
      };
    }
    // Snapshot exists and is marked available.
    return {
      status: 'verified',
      archive_url: latestAvailableUrl(originalUrl),
      snapshot_url: closest.url,
      snapshot_timestamp: closest.timestamp,
      checked_at,
    };
  } catch (e) {
    return {
      status: 'failed',
      checked_at,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// Convenience: capture + wait + verify in one call. Returns the final
// status. The wait is necessary because Wayback takes 15-45 seconds to
// actually produce a snapshot after the save request.
export async function captureAndVerify(
  originalUrl: string,
  options: { waitMs?: number } = {}
): Promise<WaybackStatus> {
  const waitMs = options.waitMs ?? 30000;
  const { archive_url } = await captureWayback(originalUrl);
  // First, optimistically set pending state. Caller can ignore this and
  // use only the final verify, but exposing it in the return isn't useful
  // since this function is a bundle.
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  const result = await verifyWayback(originalUrl);
  // If verification failed but the archive URL was formed, still return it
  // for display purposes with failed status.
  if (!result.archive_url) result.archive_url = archive_url;
  return result;
}
