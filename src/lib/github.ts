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
export async function getFileSha(filePath: string): Promise<string | null> {
  const config = getRepoConfig();
  if (!config) throw new Error('No repo configured');
  try {
    const res = await ghFetch(
      `/repos/${config.owner}/${config.repo}/contents/${filePath}?ref=${config.branch}`
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
export async function commitTextFile(
  filePath: string,
  content: string,
  message: string
): Promise<void> {
  const config = getRepoConfig();
  if (!config) throw new Error('No repo configured');
  const sha = await getFileSha(filePath);
  const body: Record<string, unknown> = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    branch: config.branch,
  };
  if (sha) body.sha = sha;
  await ghFetch(
    `/repos/${config.owner}/${config.repo}/contents/${filePath}`,
    {
      method: 'PUT',
      body: JSON.stringify(body),
    }
  );
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
  const sha = await getFileSha(filePath);
  const body: Record<string, unknown> = {
    message,
    content: base64Content,
    branch: config.branch,
  };
  if (sha) body.sha = sha;
  await ghFetch(
    `/repos/${config.owner}/${config.repo}/contents/${filePath}`,
    {
      method: 'PUT',
      body: JSON.stringify(body),
    }
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
