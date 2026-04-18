import { useState } from 'react';
import {
  loadLists,
  createList,
  renameList,
  deleteList,
  exportListsJson,
  parseImportedLists,
  replaceListsWith,
  mergeLists,
  type UserList,
} from '../lib/lists';
import { useDialog } from './Dialog';

interface Props {
  onClose: () => void;
  onChange: () => void; // called after any mutation so parent can refresh
}

type PendingImport =
  | { phase: 'none' }
  | { phase: 'choose'; imported: UserList[]; filename: string }
  | { phase: 'error'; message: string };

export function ManageLists({ onClose, onChange }: Props) {
  // Local re-render trigger — lists come from localStorage directly,
  // and we bump this key after every write.
  const [tick, setTick] = useState(0);
  const data = loadLists();
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [pending, setPending] = useState<PendingImport>({ phase: 'none' });
  const { confirmDialog, alertDialog } = useDialog();

  const bump = () => {
    setTick(tick + 1);
    onChange();
  };

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    createList(name);
    setNewName('');
    bump();
  };

  const startRename = (l: UserList) => {
    setRenamingId(l.id);
    setRenameValue(l.name);
  };
  const commitRename = () => {
    if (renamingId && renameValue.trim()) {
      renameList(renamingId, renameValue.trim());
      bump();
    }
    setRenamingId(null);
    setRenameValue('');
  };

  const handleDelete = async (l: UserList) => {
    const message =
      l.sheet_ids.length > 0
        ? `"${l.name}" contains ${l.sheet_ids.length} sheet${
            l.sheet_ids.length === 1 ? '' : 's'
          }. This only affects your browser, not the archive itself.`
        : undefined;
    const ok = await confirmDialog({
      title: `Delete list "${l.name}"?`,
      message,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    deleteList(l.id);
    bump();
  };

  const handleExport = () => {
    const json = exportListsJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pinocchio-archive-lists-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so same file can be picked again
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = parseImportedLists(reader.result as string);
        setPending({ phase: 'choose', imported, filename: file.name });
      } catch (err) {
        setPending({
          phase: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    };
    reader.readAsText(file);
  };

  const confirmReplace = async () => {
    if (pending.phase !== 'choose') return;
    if (data.lists.length > 0) {
      const ok = await confirmDialog({
        title: 'Replace all existing lists?',
        message: `This will REPLACE all ${data.lists.length} of your current lists with ${pending.imported.length} imported ones. Your current lists will be lost.`,
        confirmLabel: 'Replace',
        destructive: true,
      });
      if (!ok) return;
    }
    replaceListsWith(pending.imported);
    setPending({ phase: 'none' });
    bump();
  };

  const confirmMerge = async () => {
    if (pending.phase !== 'choose') return;
    const summary = mergeLists(pending.imported);
    await alertDialog({
      title: 'Merge complete',
      message: `${summary.added} new list${
        summary.added === 1 ? '' : 's'
      } added, ${summary.merged} existing list${
        summary.merged === 1 ? '' : 's'
      } updated, ${summary.sheetsAdded} new sheet reference${
        summary.sheetsAdded === 1 ? '' : 's'
      } added.`,
    });
    setPending({ phase: 'none' });
    bump();
  };

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        style={{ maxWidth: 620 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="modal-eyebrow">Your lists</div>
        <h2 className="modal-title">Manage lists</h2>
        <p
          style={{
            fontSize: 13,
            color: 'var(--ink-faded)',
            fontStyle: 'italic',
            margin: '0 0 16px',
          }}
        >
          Lists live only in this browser. Export a backup below to move them
          between devices or preserve them if you clear browser data.
        </p>

        {/* Import confirmation */}
        {pending.phase === 'choose' && (
          <div
            style={{
              border: '1px solid var(--rule)',
              background: 'var(--paper-deep)',
              padding: 12,
              marginBottom: 14,
            }}
          >
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              Imported <strong>{pending.imported.length}</strong> list
              {pending.imported.length === 1 ? '' : 's'} from{' '}
              <code>{pending.filename}</code>. How should these be applied?
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-filled" onClick={confirmMerge}>
                Merge into existing
              </button>
              <button className="btn" onClick={confirmReplace}>
                Replace all
              </button>
              <button
                className="btn"
                onClick={() => setPending({ phase: 'none' })}
                style={{ marginLeft: 'auto' }}
              >
                Cancel
              </button>
            </div>
            <div
              style={{
                marginTop: 10,
                fontSize: 12,
                color: 'var(--ink-faded)',
                fontStyle: 'italic',
              }}
            >
              Merge: existing lists with matching IDs get their sheets unioned;
              new lists are added. Replace: all current lists are discarded and
              swapped for the imported ones.
            </div>
          </div>
        )}

        {pending.phase === 'error' && (
          <div
            style={{
              border: '1px solid var(--danger)',
              background: 'var(--paper-deep)',
              color: 'var(--danger)',
              padding: 12,
              marginBottom: 14,
              fontSize: 13,
            }}
          >
            Couldn't import: {pending.message}
            <button
              onClick={() => setPending({ phase: 'none' })}
              style={{
                float: 'right',
                background: 'none',
                border: 'none',
                color: 'var(--danger)',
                cursor: 'pointer',
                fontSize: 16,
              }}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {/* Create new */}
        <div
          style={{
            display: 'flex',
            gap: 6,
            marginBottom: 16,
            paddingBottom: 12,
            borderBottom: '1px solid var(--rule)',
          }}
        >
          <input
            type="text"
            className="form-input"
            placeholder="New list name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
            style={{ flex: 1 }}
          />
          <button
            className="btn btn-filled"
            onClick={handleCreate}
            disabled={!newName.trim()}
          >
            Create
          </button>
        </div>

        {/* List of lists */}
        {data.lists.length === 0 ? (
          <div
            style={{
              padding: '24px 0',
              textAlign: 'center',
              color: 'var(--ink-faded)',
              fontStyle: 'italic',
              fontSize: 14,
            }}
          >
            No lists yet. Create one above, or browse the archive and click the
            bookmark icon on a card.
          </div>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
            }}
          >
            {data.lists.map((l) => (
              <li
                key={l.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 10px',
                  background: 'var(--paper)',
                  border: '1px solid var(--rule)',
                }}
              >
                {renamingId === l.id ? (
                  <>
                    <input
                      type="text"
                      className="form-input"
                      value={renameValue}
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        else if (e.key === 'Escape') {
                          setRenamingId(null);
                          setRenameValue('');
                        }
                      }}
                      onBlur={commitRename}
                      style={{ flex: 1 }}
                    />
                  </>
                ) : (
                  <>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>
                        {l.name}
                      </div>
                      <div
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: 10,
                          color: 'var(--ink-faded)',
                          letterSpacing: '0.05em',
                        }}
                      >
                        {l.sheet_ids.length} sheet
                        {l.sheet_ids.length === 1 ? '' : 's'} · updated{' '}
                        {l.updated_at.slice(0, 10)}
                      </div>
                    </div>
                    <button
                      className="btn-small"
                      onClick={() => startRename(l)}
                      title="Rename"
                    >
                      Rename
                    </button>
                    <button
                      className="btn-small"
                      onClick={() => handleDelete(l)}
                      title="Delete"
                      style={{ color: 'var(--danger)' }}
                    >
                      Delete
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Import/Export */}
        <div
          style={{
            marginTop: 18,
            paddingTop: 12,
            borderTop: '1px solid var(--rule)',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <button
            className="btn"
            onClick={handleExport}
            disabled={data.lists.length === 0}
          >
            Export JSON
          </button>
          <label
            className="btn"
            style={{
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            Import JSON
            <input
              type="file"
              accept="application/json,.json"
              onChange={handleImportFile}
              style={{ display: 'none' }}
            />
          </label>
          <span
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 10,
              color: 'var(--ink-faded)',
              marginLeft: 'auto',
              letterSpacing: '0.05em',
            }}
          >
            {data.lists.length} list{data.lists.length === 1 ? '' : 's'} in
            this browser
          </span>
        </div>
      </div>
    </div>
  );
}
