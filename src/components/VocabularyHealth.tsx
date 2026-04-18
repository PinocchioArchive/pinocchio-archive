// Vocabulary health check panel — lists all canonical character and tag
// entries with their review status. Unreviewed entries (typically from the
// initial seed) get a "Mark reviewed" action. This is the scholarly audit
// surface: the researcher walks through each entry confirming "yes this
// is the correct canonical form" as they build confidence in their
// taxonomy.

import { useMemo, useState } from 'react';
import { useVocabulary } from './VocabularyProvider';
import type { VocabularyEntry, VocabularyKind } from '../lib/vocabulary';

interface Props {
  onClose: () => void;
}

export function VocabularyHealth({ onClose }: Props) {
  const { vocab, markReviewed } = useVocabulary();
  const [filter, setFilter] = useState<'all' | 'unreviewed' | 'reviewed'>(
    'unreviewed'
  );
  const [kind, setKind] = useState<VocabularyKind>('characters');
  const [search, setSearch] = useState('');

  const entries = useMemo(() => {
    let list = vocab[kind].slice();
    if (filter === 'unreviewed') list = list.filter((e) => !e.reviewed);
    else if (filter === 'reviewed') list = list.filter((e) => e.reviewed);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (e) =>
          e.canonical.toLowerCase().includes(q) ||
          e.aliases.some((a) => a.toLowerCase().includes(q))
      );
    }
    return list.sort((a, b) => a.canonical.localeCompare(b.canonical));
  }, [vocab, kind, filter, search]);

  const counts = {
    characters: {
      total: vocab.characters.length,
      unreviewed: vocab.characters.filter((e) => !e.reviewed).length,
    },
    tags: {
      total: vocab.tags.length,
      unreviewed: vocab.tags.filter((e) => !e.reviewed).length,
    },
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 760 }}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className="modal-masthead">
          <span className="modal-masthead-eyebrow">Vocabulary</span>
          <span className="modal-masthead-separator">·</span>
          <span className="modal-masthead-title">Health check</span>
        </div>

        <div
          style={{
            padding: '20px 28px',
            overflowY: 'auto',
            flex: 1,
            minHeight: 0,
          }}
        >
          <p
            style={{
              fontFamily: 'var(--serif)',
              fontSize: 14,
              color: 'var(--ink-soft)',
              lineHeight: 1.5,
              marginTop: 0,
            }}
          >
            Canonical names and their aliases. Entries marked "unreviewed"
            were auto-seeded from existing records — walk through and
            confirm each reads correctly, or add aliases to fold variants
            into the right canonical form.
          </p>

          {/* Kind + filter row */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
              margin: '16px 0 12px',
            }}
          >
            <div style={{ display: 'flex', gap: 2 }}>
              <button
                className={`vocab-tab ${kind === 'characters' ? 'active' : ''}`}
                onClick={() => setKind('characters')}
              >
                Characters ({counts.characters.total})
                {counts.characters.unreviewed > 0 && (
                  <span className="vocab-tab-badge">
                    {counts.characters.unreviewed}
                  </span>
                )}
              </button>
              <button
                className={`vocab-tab ${kind === 'tags' ? 'active' : ''}`}
                onClick={() => setKind('tags')}
              >
                Tags ({counts.tags.total})
                {counts.tags.unreviewed > 0 && (
                  <span className="vocab-tab-badge">
                    {counts.tags.unreviewed}
                  </span>
                )}
              </button>
            </div>
            <div style={{ flex: 1 }} />
            <select
              value={filter}
              onChange={(e) =>
                setFilter(e.target.value as 'all' | 'unreviewed' | 'reviewed')
              }
              style={{ fontSize: 12, padding: '4px 8px' }}
            >
              <option value="unreviewed">Unreviewed only</option>
              <option value="reviewed">Reviewed only</option>
              <option value="all">All</option>
            </select>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter…"
              style={{
                fontSize: 13,
                padding: '6px 10px',
                border: '1px solid var(--rule)',
                borderRadius: 'var(--radius-sm)',
                fontFamily: 'var(--serif)',
                background: 'var(--paper)',
                color: 'var(--ink)',
                width: 160,
              }}
            />
          </div>

          {/* Entries list */}
          {entries.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 0',
                color: 'var(--ink-faded)',
                fontStyle: 'italic',
                fontFamily: 'var(--serif)',
              }}
            >
              {search
                ? `No ${kind} match "${search}"`
                : filter === 'unreviewed'
                ? `No unreviewed ${kind} — everything's confirmed.`
                : `No ${kind} in the vocabulary yet.`}
            </div>
          ) : (
            <div className="vocab-entries">
              {entries.map((e) => (
                <VocabRow
                  key={e.canonical}
                  entry={e}
                  kind={kind}
                  onMarkReviewed={() => void markReviewed(kind, e.canonical)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VocabRow({
  entry,
  onMarkReviewed,
}: {
  entry: VocabularyEntry;
  kind: VocabularyKind;
  onMarkReviewed: () => void;
}) {
  return (
    <div className={`vocab-row ${entry.reviewed ? 'reviewed' : 'unreviewed'}`}>
      <div className="vocab-row-main">
        <div className="vocab-row-canonical">{entry.canonical}</div>
        {entry.aliases.length > 0 && (
          <div className="vocab-row-aliases">
            {entry.aliases.map((a, i) => (
              <span key={i} className="vocab-alias">
                {a}
              </span>
            ))}
          </div>
        )}
        {entry.notes && (
          <div className="vocab-row-notes">{entry.notes}</div>
        )}
      </div>
      <div className="vocab-row-actions">
        {entry.reviewed ? (
          <span className="vocab-status reviewed" title={entry.reviewed_at}>
            ✓ reviewed
          </span>
        ) : (
          <button
            className="btn-small vocab-review-btn"
            onClick={onMarkReviewed}
            title="Confirm this canonical name is correct"
          >
            Mark reviewed
          </button>
        )}
      </div>
    </div>
  );
}
