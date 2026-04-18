import { useState, useEffect } from 'react';
import {
  getToken,
  setToken,
  clearToken,
  getRepoConfig,
  setRepoConfig,
  verifyToken,
} from '../lib/github';
import {
  getApiKey as getAnthropicKey,
  setApiKey as setAnthropicKey,
  clearApiKey as clearAnthropicKey,
  getModel as getAnthropicModel,
  setModel as setAnthropicModel,
} from '../lib/extraction/claude';

interface Props {
  onClose: () => void;
}

export function Settings({ onClose }: Props) {
  const [token, setTokenInput] = useState('');
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('main');
  const [anthropicKey, setAnthropicKeyInput] = useState('');
  const [anthropicModel, setAnthropicModelInput] = useState('');
  const [verified, setVerified] = useState<{
    ok: boolean;
    login?: string;
    error?: string;
  } | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const existing = getToken();
    if (existing) setTokenInput(existing);
    const rc = getRepoConfig();
    if (rc) {
      setOwner(rc.owner);
      setRepo(rc.repo);
      setBranch(rc.branch);
    }
    const anth = getAnthropicKey();
    if (anth) setAnthropicKeyInput(anth);
    setAnthropicModelInput(getAnthropicModel());

    // Auto-verify on open if a token is already saved. Settings reveals
    // the full configuration surface only when the token actually works
    // against GitHub — a saved-but-invalid token should not unlock the
    // rest of the UI. This runs silently in the background; the status
    // pill updates when the check returns.
    if (existing) {
      setChecking(true);
      void verifyToken().then((result) => {
        setVerified(result);
        setChecking(false);
      });
    }
  }, []);

  const save = async () => {
    setToken(token);
    // Only persist repo/anthropic config if already verified, since these
    // are the gated fields. On an unverified save, we only commit the token
    // and attempt verification.
    if (verified?.ok) {
      setRepoConfig(owner, repo, branch);
      if (anthropicKey) setAnthropicKey(anthropicKey);
      else clearAnthropicKey();
      if (anthropicModel) setAnthropicModel(anthropicModel);
    }
    setChecking(true);
    const result = await verifyToken();
    setVerified(result);
    setChecking(false);
    // If verification succeeded and repo config wasn't saved above (first
    // successful auth), save it now so the next open has everything.
    if (result.ok && !verified?.ok) {
      setRepoConfig(owner, repo, branch);
      if (anthropicKey) setAnthropicKey(anthropicKey);
      if (anthropicModel) setAnthropicModel(anthropicModel);
    }
  };

  const disconnect = () => {
    clearToken();
    setTokenInput('');
    setVerified(null);
  };

  const disconnectAnthropic = () => {
    clearAnthropicKey();
    setAnthropicKeyInput('');
  };

  const isAuthed = !!(verified && verified.ok);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 700 }}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="settings-body">
          <h2>Settings</h2>

          <div className="notice">
            <strong>One-time setup.</strong> Tokens are stored in your browser's
            localStorage. Scope them narrowly: the GitHub PAT to this one repo,
            the Anthropic key with a spending limit set in the console.
          </div>

          <div className="form-field">
            <label className="form-label">GitHub Fine-grained PAT</label>
            <input
              type="password"
              className="form-input"
              value={token}
              placeholder="github_pat_..."
              onChange={(e) => setTokenInput(e.target.value)}
            />
            <span className="form-hint">
              Create at github.com/settings/personal-access-tokens → Fine-grained
              → Contents: Read and write on this repo only.
            </span>
          </div>

          {!isAuthed && (
            <div
              className="notice"
              style={{
                fontStyle: 'italic',
                color: 'var(--ink-faded)',
                fontSize: 13,
              }}
            >
              Additional configuration (repository details, AI extraction key)
              will unlock once your GitHub token is verified.
            </div>
          )}

          {isAuthed && (
            <>
              <h3>GitHub Repository</h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr auto',
                  gap: 10,
                }}
              >
                <div className="form-field">
                  <label className="form-label">Owner</label>
                  <input
                    type="text"
                    className="form-input"
                    value={owner}
                    placeholder="your-github-username"
                    onChange={(e) => setOwner(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">Repository</label>
                  <input
                    type="text"
                    className="form-input"
                    value={repo}
                    placeholder="pinocchio-archive"
                    onChange={(e) => setRepo(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">Branch</label>
                  <input
                    type="text"
                    className="form-input"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    style={{ width: 100 }}
                  />
                </div>
              </div>

              <h3>AI Extraction (Claude API)</h3>
              <div className="form-field">
                <label className="form-label">Anthropic API Key</label>
                <input
                  type="password"
                  className="form-input"
                  value={anthropicKey}
                  placeholder="sk-ant-api03-..."
                  onChange={(e) => setAnthropicKeyInput(e.target.value)}
                />
                <span className="form-hint">
                  Create at console.anthropic.com → API Keys. Set a monthly
                  spending limit. Leave blank to use only free Tesseract
                  extraction.
                </span>
              </div>
              <div className="form-field">
                <label className="form-label">Model</label>
                <input
                  type="text"
                  className="form-input"
                  value={anthropicModel}
                  placeholder="claude-sonnet-4-5-20250929"
                  onChange={(e) => setAnthropicModelInput(e.target.value)}
                />
                <span className="form-hint">
                  Sonnet is a good balance of cost and accuracy. Opus models
                  are more accurate but more expensive. See
                  docs.anthropic.com/en/docs/about-claude/models for current
                  model IDs.
                </span>
              </div>
            </>
          )}

          <div
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <button className="btn btn-filled" onClick={save} disabled={checking}>
              {checking
                ? 'Verifying…'
                : isAuthed
                ? 'Save & Verify'
                : 'Verify token'}
            </button>
            {getToken() && (
              <button className="btn btn-danger" onClick={disconnect}>
                Disconnect GitHub
              </button>
            )}
            {isAuthed && getAnthropicKey() && (
              <button className="btn btn-danger" onClick={disconnectAnthropic}>
                Clear API Key
              </button>
            )}
            {verified && (
              <span
                className={`status-pill ${
                  verified.ok ? 'status-ok' : 'status-err'
                }`}
              >
                {verified.ok
                  ? `GitHub: ${verified.login}`
                  : 'GitHub: not authenticated'}
              </span>
            )}
            {isAuthed && getAnthropicKey() && (
              <span className="status-pill status-ok">Anthropic key set</span>
            )}
          </div>
          {verified && !verified.ok && (
            <div
              className="notice"
              style={{
                borderLeftColor: 'var(--error)',
                color: 'var(--error)',
              }}
            >
              {verified.error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
