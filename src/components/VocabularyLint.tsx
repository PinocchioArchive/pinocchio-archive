// Inline lint warnings for character / tag fields. For each user-entered
// value that isn't a canonical vocabulary entry, shows a small row
// underneath with context and quick-fix actions:
//
// - Alias match ("stromboli" is an alias for "Stromboli"): Accept button
//   replaces the value in place with the canonical form.
// - Unknown value ("Frobozz"): "Add as new" (creates canonical entry) or
//   "Mark as alias of…" (picker listing existing canonicals).
//
// Strict mode: every non-exact-canonical entry shows a warning, even if
// it's a known alias. This forces deliberate aliasing — the researcher
// decides explicitly whether each variant is acceptable.

import { useState } from 'react';
import { useVocabulary } from './VocabularyProvider';
import type { VocabularyKind } from '../lib/vocabulary';

interface Props {
  kind: VocabularyKind;
  values: string[];
  onValuesChange: (next: string[]) => void;
}

export function VocabularyLint({ kind, values, onValuesChange }: Props) {
  const { vocab, lookup, addCanonical, addAlias } = useVocabulary();

  // Find every value that isn't exactly a canonical form
  const warnings = values
    .map((v, i) => ({ value: v, index: i, result: lookup(kind, v) }))
    .filter((w) => {
      if (w.result.status === 'canonical') {
        // Strict mode: warn even on exact canonical matches if the CASE
        // differs (e.g. stored as "stromboli" but canonical is "Stromboli").
        return w.result.canonicalValue !== w.value;
      }
      return true; // alias or unknown — always warn
    });

  if (warnings.length === 0) return null;

  return (
    <div className="vocab-lint">
      {warnings.map((w) => (
        <LintRow
          key={w.index}
          kind={kind}
          input={w.value}
          status={w.result.status}
          canonicalValue={w.result.canonicalValue}
          allCanonicals={vocab[kind].map((e) => e.canonical)}
          onReplace={(canonical) => {
            const next = values.slice();
            next[w.index] = canonical;
            onValuesChange(next);
          }}
          onAcceptAsNew={async () => {
            await addCanonical(kind, w.value);
          }}
          onAliasOf={async (canonical) => {
            await addAlias(kind, canonical, w.value);
            // Also replace the value in place with the canonical
            const next = values.slice();
            next[w.index] = canonical;
            onValuesChange(next);
          }}
        />
      ))}
    </div>
  );
}

function LintRow({
  kind,
  input,
  status,
  canonicalValue,
  allCanonicals,
  onReplace,
  onAcceptAsNew,
  onAliasOf,
}: {
  kind: VocabularyKind;
  input: string;
  status: 'canonical' | 'alias' | 'unknown';
  canonicalValue?: string;
  allCanonicals: string[];
  onReplace: (canonical: string) => void;
  onAcceptAsNew: () => Promise<void>;
  onAliasOf: (canonical: string) => Promise<void>;
}) {
  const [picking, setPicking] = useState(false);
  const [pickValue, setPickValue] = useState('');

  // ALIAS: "stromboli" is alias for "Stromboli"
  if (status === 'alias' && canonicalValue) {
    return (
      <div className="vocab-lint-row vocab-lint-alias">
        <span className="vocab-lint-icon" aria-hidden="true">
          ↳
        </span>
        <span className="vocab-lint-text">
          <code className="vocab-lint-input">{input}</code> is an alias for{' '}
          <code className="vocab-lint-canonical">{canonicalValue}</code>
        </span>
        <button
          type="button"
          className="vocab-lint-btn vocab-lint-btn-primary"
          onClick={() => onReplace(canonicalValue)}
          title={`Replace "${input}" with "${canonicalValue}"`}
        >
          Accept
        </button>
      </div>
    );
  }

  // CANONICAL with case difference: just show quiet hint + Fix button
  if (status === 'canonical' && canonicalValue && canonicalValue !== input) {
    return (
      <div className="vocab-lint-row vocab-lint-case">
        <span className="vocab-lint-icon" aria-hidden="true">
          Aa
        </span>
        <span className="vocab-lint-text">
          Case differs from canonical{' '}
          <code className="vocab-lint-canonical">{canonicalValue}</code>
        </span>
        <button
          type="button"
          className="vocab-lint-btn vocab-lint-btn-primary"
          onClick={() => onReplace(canonicalValue)}
        >
          Fix
        </button>
      </div>
    );
  }

  // UNKNOWN: offer "add as new" or "mark as alias of…"
  return (
    <div className="vocab-lint-row vocab-lint-unknown">
      <span className="vocab-lint-icon" aria-hidden="true">
        ?
      </span>
      <span className="vocab-lint-text">
        <code className="vocab-lint-input">{input}</code> not in vocabulary
      </span>
      {!picking && (
        <>
          <button
            type="button"
            className="vocab-lint-btn vocab-lint-btn-primary"
            onClick={() => void onAcceptAsNew()}
            title={`Add "${input}" as a new canonical ${kind.slice(0, -1)}`}
          >
            Add as new
          </button>
          {allCanonicals.length > 0 && (
            <button
              type="button"
              className="vocab-lint-btn"
              onClick={() => setPicking(true)}
              title="Mark this as an alias of an existing canonical name"
            >
              Alias of…
            </button>
          )}
        </>
      )}
      {picking && (
        <>
          <select
            value={pickValue}
            onChange={(e) => setPickValue(e.target.value)}
            autoFocus
            style={{ fontSize: 11, padding: '2px 4px' }}
          >
            <option value="">— pick canonical —</option>
            {allCanonicals.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="vocab-lint-btn vocab-lint-btn-primary"
            disabled={!pickValue}
            onClick={() => {
              if (!pickValue) return;
              void onAliasOf(pickValue);
              setPicking(false);
            }}
          >
            OK
          </button>
          <button
            type="button"
            className="vocab-lint-btn"
            onClick={() => setPicking(false)}
          >
            Cancel
          </button>
        </>
      )}
    </div>
  );
}
