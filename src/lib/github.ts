// Minimal GitHub API client for reading and committing files.
// Uses a fine-grained Personal Access Token stored in localStorage.
//
// SECURITY NOTE: The token lives in localStorage. Anyone with access to this
// browser can read it. Scope the token narrowly: only the archive repo,
// only Contents read/write.

const TOKEN_KEY = 'pma_github_token';
const REPO_KEY = 'pma_github_repo'; // "owner/repo"
const BRANCH_KEY = 'pma_github_branch';

export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function getRepoConfig(): RepoConfig | null {
  const repo = localStorage.getItem(REPO_KEY);
  const branch = localStorage.getItem(BRANCH_KEY) || 'main';
  if (!repo || !repo.includes('/')) return null;
  const [owner, name] = repo.split('/');
  return { owner, repo: name, branch };
}

export function setRepoConfig(owner: string, repo: string, branch: string): void {
  localStorage.setItem(REPO_KEY, `${owner}/${repo}`);
  localStorage.setItem(BRANCH_KEY, branch);
}

interface FileResponse {
  content: string; // base64
  sha: string;
}

async function ghFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getToken();
  if (!token) throw new Error('No GitHub token configured');
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status}: ${body}`);
  }
  return res;
}

// Read a file's current SHA (needed for updates).
//
// GitHub's `contents` API is served via their CDN and can return
// stale responses for seconds after a commit lands. For update
// flows, callers need the *current* sha or the PUT will 409. The
// `bustCache` option forces a cache-busting query param so retries
// actually see the latest state rather than hitting the edge cache
// again. First reads can skip this since initial load doesn't care
// about staleness at the sha level.
export async function getFileSha(
  filePath: string,
  bustCache = false
): Promise<string | null> {
  const config = getRepoConfig();
  if (!config) throw new Error('No repo configured');
  try {
    // The `t=` param doesn't mean anything to GitHub's API — it's
    // just a different URL, which defeats any edge-level caching
    // that keys on the full URL. Also send explicit Cache-Control
    // headers for belt-and-braces effect.
    const cacheBust = bustCache ? `&t=${Date.now()}` : '';
    const res = await ghFetch(
      `/repos/${config.owner}/${config.repo}/contents/${filePath}?ref=${config.branch}${cacheBust}`,
      bustCache
        ? {
            headers: {
              'Cache-Control': 'no-cache',
              Pragma: 'no-cache',
            },
          }
        : undefined
    );
    const data: FileResponse = await res.json();
    return data.sha;
  } catch (e) {
    // 404 = file doesn't exist yet, which is fine for new files.
    if (e instanceof Error && e.message.includes('404')) return null;
    throw e;
  }
}

// Commit a text file. If the file exists, pass its current sha.
//
// Handles GitHub's optimistic-lock conflict (409): the PUT requires the
// SHA of the file version we read. If another commit landed between our
// fetch and our PUT (e.g., background vocabulary or Wayback reverify
// writes), we'll get 409. In that case we re-fetch the latest SHA and
// retry — up to a small number of attempts.
//
// The retries preserve the user's content intact. They DO NOT attempt
// to merge with whatever changed on the server — "last write wins" is
// our semantics. For a single-author research archive this is safe;
// the concurrent writes we lose to are our own background effects,
// which are idempotent (they'll re-run on next load).
export async function commitTextFile(
  filePath: string,
  content: string,
  message: string
): Promise<void> {
  const config = getRepoConfig();
  if (!config) throw new Error('No repo configured');
  const encoded = btoa(unescape(encodeURIComponent(content)));
  await commitWithRetry(config, filePath, encoded, message);
}

// Commit a binary file (image) from a base64 string. Caller should strip the
// data:image/jpeg;base64, prefix before calling.
export async function commitBinaryFile(
  filePath: string,
  base64Content: string,
  message: string
): Promise<void> {
  const config = getRepoConfig();
  if (!config) throw new Error('No repo configured');
  await commitWithRetry(config, filePath, base64Content, message);
}

// Shared PUT logic with conflict retry. The 409 conflict on GitHub's
// contents API is typically transient — either a concurrent writer
// (e.g., another tab, a background sync) committed between our sha
// fetch and our PUT, OR the sha we have is stale because GitHub's
// CDN returned an older version.
//
// Strategy:
//   1. First attempt uses the sha we already fetched on load (via
//      app-level caching). Most saves succeed here with no round-trip.
//   2. On 409, refetch the sha with cache-busting so we skip any
//      edge cache that might be holding the stale sha.
//   3. Exponential backoff between attempts gives concurrent writers
//      (or the CDN) time to settle.
//   4. Up to 5 attempts total — beyond this, we treat it as a real
//      conflict the user needs to resolve by reloading.
//
// Last-write-wins semantics apply: we don't attempt to merge with
// changes that landed on the server between reads. For a single-
// author archive this is safe, but it means a reload is required
// after a 409 to pick up whatever the other writer did.
async function commitWithRetry(
  config: RepoConfig,
  filePath: string,
  base64Content: string,
  message: string,
  maxAttempts = 5
): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Attempt 1 uses the cached sha; retries force fresh from GitHub
    // via cache-busting. This matters because the CDN may keep
    // serving a stale sha for several seconds after a commit lands.
    const sha = await getFileSha(filePath, attempt > 1);
    const body: Record<string, unknown> = {
      message,
      content: base64Content,
      branch: config.branch,
    };
    if (sha) body.sha = sha;
    try {
      await ghFetch(
        `/repos/${config.owner}/${config.repo}/contents/${filePath}`,
        {
          method: 'PUT',
          body: JSON.stringify(body),
        }
      );
      return; // success
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      // Only retry on 409 (SHA conflict). All other errors are terminal.
      if (!msg.includes('409')) throw e;
      // Exponential backoff: 250ms, 500ms, 1s, 2s → total ~3.75s of
      // waiting across all retries. Gives the CDN / concurrent
      // writer plenty of time to settle.
      if (attempt < maxAttempts) {
        const delay = 250 * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  // All retries exhausted. Surface a user-friendly message but include
  // the underlying GitHub error for debugging.
  const underlying =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Save conflict: ${filePath} was changed from another source ` +
      `while you were editing. Reload the page to pick up the latest ` +
      `state, then re-apply your changes. ` +
      `(GitHub returned: ${underlying})`
  );
}

export async function verifyToken(): Promise<{
  ok: boolean;
  login?: string;
  error?: string;
}> {
  try {
    const res = await ghFetch('/user');
    const data = await res.json();
    return { ok: true, login: data.login };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Converts a File (from a file input) to a base64 string without the data URL prefix.
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
