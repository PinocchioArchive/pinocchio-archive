import { useEffect, useMemo, useState, useCallback } from 'react';
import type { ArchiveData, ModelSheet } from './types/schema';
import {
  compareSheets,
  compareSheetsByCharacter,
  extractVocabulary,
  extractSourceVocabulary,
  getRecentDefaults,
  makeEmptySheet,
  migrateArchive,
} from './lib/sheets';
import {
  commitBinaryFile,
  commitTextFile,
  fileToBase64,
  getRepoConfig,
  getToken,
} from './lib/github';
import { useKeyboardShortcuts } from './lib/useKeyboardShortcuts';
import { SheetCard } from './components/SheetCard';
import { SheetListRow } from './components/SheetListRow';
import { SheetDetail } from './components/SheetDetail';
import { SheetEdit } from './components/SheetEdit';
import { Settings } from './components/Settings';
import { BulkImport } from './components/BulkImport';

type SortMode =
  | 'number'
  | 'date'
  | 'title'
  | 'updated'
  | 'created'
  | 'character';
type ViewMode = 'grid' | 'list' | 'by_character';

const BASE = import.meta.env.BASE_URL || '/';

// Filters kept in the URL so you can bookmark views.
interface FilterState {
  search: string;
  sequence_association: string | null;
  character: string | null;
  tag: string | null;
  needsResearch: boolean;
  inCollection: boolean;
  sort: SortMode;
  view: ViewMode;
}

function readFiltersFromUrl(): FilterState {
  const params = new URLSearchParams(window.location.search);
  return {
    search: params.get('q') || '',
    sequence_association: params.get('seq'),
    character: params.get('char'),
    tag: params.get('tag'),
    needsResearch: params.get('research') === '1',
    inCollection: params.get('owned') === '1',
    sort: (params.get('sort') as SortMode) || 'number',
    view: (params.get('view') as ViewMode) || 'grid',
  };
}

function writeFiltersToUrl(f: FilterState) {
  const params = new URLSearchParams();
  if (f.search) params.set('q', f.search);
  if (f.sequence_association) params.set('seq', f.sequence_association);
  if (f.character) params.set('char', f.character);
  if (f.tag) params.set('tag', f.tag);
  if (f.needsResearch) params.set('research', '1');
  if (f.inCollection) params.set('owned', '1');
  if (f.sort !== 'number') params.set('sort', f.sort);
  if (f.view !== 'grid') params.set('view', f.view);
  const qs = params.toString();
  const url = `${window.location.pathname}${qs ? '?' + qs : ''}`;
  window.history.replaceState(null, '', url);
}

export default function App() {
  const [data, setData] = useState<ArchiveData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(readFiltersFromUrl());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  // Persist filters to URL whenever they change.
  useEffect(() => {
    writeFiltersToUrl(filters);
  }, [filters]);

  // Build the public base URL for reverse-image-search.
  const publicBaseUrl = useMemo(() => {
    const cfg = getRepoConfig();
    if (cfg && cfg.owner) {
      return `https://${cfg.owner}.github.io${BASE}`;
    }
    return window.location.origin + BASE;
  }, []);

  useEffect(() => {
    fetch(`${BASE}data/sheets.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((raw) => setData(migrateArchive(raw)))
      .catch((e) => {
        console.warn('Could not load sheets.json, starting empty:', e);
        setData({ schema_version: 3, sheets: [] });
        setLoadError(e.message);
      });
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.sheets.slice();
    if (filters.sequence_association)
      list = list.filter(
        (s) => s.sequence_association === filters.sequence_association
      );
    if (filters.character)
      list = list.filter((s) => s.characters.includes(filters.character!));
    if (filters.tag) list = list.filter((s) => s.tags.includes(filters.tag!));
    if (filters.inCollection)
      list = list.filter((s) => s.in_my_physical_collection);
    if (filters.needsResearch) list = list.filter((s) => s.needs_research);
    if (filters.search.trim()) {
      const q = filters.search.toLowerCase();
      list = list.filter((s) => {
        return (
          s.id.toLowerCase().includes(q) ||
          s.id.toLowerCase().replace(/-/g, '').includes(q.replace(/-/g, '')) ||
          s.title.toLowerCase().includes(q) ||
          s.characters.some((c) => c.toLowerCase().includes(q)) ||
          (s.sequence_association || '').toLowerCase().includes(q) ||
          (s.notes || '').toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q)) ||
          s.approvals.some((a) => a.toLowerCase().includes(q))
        );
      });
    }
    switch (filters.sort) {
      case 'number':
        list.sort(compareSheets);
        break;
      case 'date':
        list.sort((a, b) =>
          (a.date_on_sheet || '').localeCompare(b.date_on_sheet || '')
        );
        break;
      case 'title':
        list.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'updated':
        list.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        break;
      case 'created':
        list.sort((a, b) => b.created_at.localeCompare(a.created_at));
        break;
      case 'character':
        list.sort(compareSheetsByCharacter);
        break;
    }
    return list;
  }, [data, filters]);

  // For the "Group by character" view: each character gets a group, and
  // each sheet that lists that character appears in that group. A sheet with
  // multiple characters appears in multiple groups.
  const groupedByCharacter = useMemo(() => {
    if (!data) return [];
    const groups = new Map<string, typeof filtered>();
    for (const s of filtered) {
      if (s.characters.length === 0) {
        const arr = groups.get('(uncharacterized)') || [];
        arr.push(s);
        groups.set('(uncharacterized)', arr);
      } else {
        for (const c of s.characters) {
          const arr = groups.get(c) || [];
          arr.push(s);
          groups.set(c, arr);
        }
      }
    }
    // Sort groups alphabetically, with (uncharacterized) at end.
    return Array.from(groups.entries())
      .sort(([a], [b]) => {
        if (a === '(uncharacterized)') return 1;
        if (b === '(uncharacterized)') return -1;
        return a.localeCompare(b);
      })
      .map(([character, sheets]) => ({
        character,
        sheets: [...sheets].sort(compareSheets),
      }));
  }, [data, filtered]);

  const vocab = useMemo(() => {
    if (!data)
      return {
        characters: [],
        sequences: [],
        departments: [],
        artists: [],
        tags: [],
        approvals: [],
        sourceNames: [],
      };
    return {
      characters: extractVocabulary(data.sheets, 'characters'),
      sequences: extractVocabulary(data.sheets, 'sequence_association'),
      departments: extractVocabulary(data.sheets, 'department'),
      artists: extractVocabulary(data.sheets, 'artist'),
      tags: extractVocabulary(data.sheets, 'tags'),
      approvals: extractVocabulary(data.sheets, 'approvals'),
      sourceNames: extractSourceVocabulary(data.sheets),
    };
  }, [data]);

  const existingIds = useMemo(
    () => new Set((data?.sheets || []).map((s) => s.id)),
    [data]
  );

  // "Needs research" queue, sorted most-recently-created first.
  const incompleteQueue = useMemo(() => {
    if (!data) return [];
    return data.sheets
      .filter((s) => s.needs_research)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [data]);

  const selected = selectedId
    ? data?.sheets.find((s) => s.id === selectedId) || null
    : null;
  const editing = editingId
    ? data?.sheets.find((s) => s.id === editingId) || null
    : null;

  const flashToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  // Writes an updated archive. Commits via GitHub API if token present,
  // otherwise returns a downloadable JSON blob.
  const writeArchive = async (
    nextData: ArchiveData,
    message: string,
    newImageFile?: { path: string; file: File }
  ) => {
    const hasToken = !!getToken();
    if (hasToken) {
      if (newImageFile) {
        const base64 = await fileToBase64(newImageFile.file);
        await commitBinaryFile(
          newImageFile.path,
          base64,
          `Add image for ${message}`
        );
      }
      await commitTextFile(
        'data/sheets.json',
        JSON.stringify(nextData, null, 2),
        message
      );
    } else {
      if (newImageFile) {
        throw new Error(
          'Cannot save new image without a GitHub token. Configure one in Settings.'
        );
      }
      const blob = new Blob([JSON.stringify(nextData, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sheets.json';
      a.click();
      URL.revokeObjectURL(url);
    }
    setData(nextData);
  };

  const findNextIncomplete = (
    excludingId: string | null
  ): ModelSheet | null => {
    if (!data) return null;
    const queue = data.sheets
      .filter((s) => s.needs_research && s.id !== excludingId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return queue[0] || null;
  };

  const handleSave = async (updated: ModelSheet, newImageFile?: File) => {
    if (!data) return;
    let finalImageFile = updated.image_file;
    let imageCommit: { path: string; file: File } | undefined;
    if (newImageFile) {
      const ext = newImageFile.name.split('.').pop() || 'jpg';
      const safeId = updated.id.replace(/[^A-Za-z0-9-]/g, '_');
      finalImageFile = `images/${safeId}.${ext.toLowerCase()}`;
      imageCommit = { path: finalImageFile, file: newImageFile };
    }
    const finalSheet = { ...updated, image_file: finalImageFile };
    const idx = data.sheets.findIndex((s) => s.id === finalSheet.id);
    const nextSheets =
      idx >= 0
        ? data.sheets.map((s, i) => (i === idx ? finalSheet : s))
        : [...data.sheets, finalSheet];
    const nextData: ArchiveData = { ...data, sheets: nextSheets };
    await writeArchive(nextData, `Update ${finalSheet.id}`, imageCommit);
    flashToast(
      `Saved ${finalSheet.id}${getToken() ? ' to repo' : ' — downloaded JSON'}`
    );
    setEditingId(null);
    setCreatingNew(false);
    setSelectedId(finalSheet.id);
  };

  const handleSaveAndNext = async (
    updated: ModelSheet,
    newImageFile?: File
  ) => {
    await handleSave(updated, newImageFile);
    // Use the data state *after* save by reading from the updated array.
    // Since setData was called inside writeArchive, we compute the next
    // incomplete from the just-saved state.
    const next = findNextIncomplete(updated.id);
    if (next) {
      setSelectedId(null);
      setEditingId(next.id);
      flashToast(`Next: ${next.id}`);
    } else {
      flashToast('All caught up — no more records flagged for research');
    }
  };

  const handleDelete = async (id: string) => {
    if (!data) return;
    if (
      !confirm(
        `Delete record ${id}? The image file will remain in the repo.`
      )
    )
      return;
    const nextData: ArchiveData = {
      ...data,
      sheets: data.sheets.filter((s) => s.id !== id),
    };
    await writeArchive(nextData, `Delete ${id}`);
    flashToast(`Deleted ${id}`);
    setSelectedId(null);
  };

  const handleBulkImport = async (
    items: Array<{ sheet: ModelSheet; file: File; extraction?: unknown }>
  ) => {
    if (!data) return;
    if (!getToken()) {
      throw new Error(
        'Bulk import needs a GitHub token — set one in Settings.'
      );
    }
    // Commit images sequentially to avoid hammering the API / race conditions.
    let nextSheets = data.sheets.slice();
    for (const item of items) {
      const ext = item.file.name.split('.').pop() || 'jpg';
      const safeId = item.sheet.id.replace(/[^A-Za-z0-9-]/g, '_');
      const imagePath = `images/${safeId}.${ext.toLowerCase()}`;
      const base64 = await fileToBase64(item.file);
      await commitBinaryFile(
        imagePath,
        base64,
        `Add image for ${item.sheet.id}`
      );
      // If OCR ran during import, persist its result as an audit entry.
      const ex = item.extraction as
        | { extracted_by: 'tesseract' | 'claude'; extracted_at: string }
        | undefined;
      const extractions = ex
        ? [
            {
              extracted_by: ex.extracted_by,
              extracted_at: ex.extracted_at,
              result: ex,
              // On bulk import, fields with high confidence were auto-accepted
              // into defaults. We leave accepted_fields undefined here to
              // mean "automatic import pre-fill" rather than a user decision.
            },
          ]
        : undefined;
      nextSheets.push({
        ...item.sheet,
        image_file: imagePath,
        ...(extractions ? { extractions } : {}),
      });
    }
    const nextData: ArchiveData = { ...data, sheets: nextSheets };
    await commitTextFile(
      'data/sheets.json',
      JSON.stringify(nextData, null, 2),
      `Bulk import ${items.length} sheets`
    );
    setData(nextData);
    flashToast(`Imported ${items.length} stub records`);
    setShowBulk(false);
  };

  const handleExportCSV = () => {
    if (!data) return;
    const header = [
      'id',
      'title',
      'characters',
      'sequence_association',
      'sequence_association_confidence',
      'production_stamps',
      'date_on_sheet',
      'date_precision',
      'approvals',
      'in_collection',
      'confidence',
      'needs_research',
      'rarity_market',
      'rarity_institutional',
      'rarity_iconographic',
      'latest_web_count',
      'tags',
    ];
    const esc = (v: string) =>
      v.includes(',') || v.includes('"') || v.includes('\n')
        ? `"${v.replace(/"/g, '""')}"`
        : v;
    const rows = filtered.map((s) => {
      const latest =
        s.web_occurrences.length > 0
          ? [...s.web_occurrences].sort((a, b) =>
              b.checked_on.localeCompare(a.checked_on)
            )[0].count
          : '';
      const stampsStr = s.production_stamps
        .map((p) => {
          const parts: string[] = [];
          if (p.prod_number) parts.push(`PROD ${p.prod_number}`);
          if (p.sequence_number) parts.push(`SEQ ${p.sequence_number}`);
          if (p.scene_number) parts.push(`SCENE ${p.scene_number}`);
          return parts.join(' ');
        })
        .filter(Boolean)
        .join('; ');
      return [
        s.id,
        s.title,
        s.characters.join('; '),
        s.sequence_association || '',
        s.sequence_association_confidence || '',
        stampsStr,
        s.date_on_sheet || '',
        s.date_precision,
        s.approvals.join('; '),
        s.in_my_physical_collection ? 'yes' : 'no',
        s.confidence,
        s.needs_research ? 'yes' : 'no',
        s.rarity.market,
        s.rarity.institutional,
        s.rarity.iconographic,
        latest.toString(),
        s.tags.join('; '),
      ]
        .map(esc)
        .join(',');
    });
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pinocchio-archive-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Keyboard shortcuts
  const openNewSheet = useCallback(() => {
    if (editing || creatingNew || selected) return;
    setCreatingNew(true);
  }, [editing, creatingNew, selected]);

  const focusSearch = useCallback(() => {
    const el = document.querySelector(
      '.toolbar-search'
    ) as HTMLInputElement | null;
    el?.focus();
    el?.select();
  }, []);

  useKeyboardShortcuts([
    { key: 'n', handler: openNewSheet },
    { key: '/', handler: (e) => { e.preventDefault(); focusSearch(); } },
    {
      key: 'b',
      handler: () => {
        if (!editing && !creatingNew && !selected) setShowBulk(true);
      },
    },
    {
      key: 'e',
      handler: () => {
        if (selected && !editing) setEditingId(selected.id);
      },
    },
    {
      key: 'j',
      handler: () => {
        if (!editing && !selected)
          setFocusedIdx((i) => Math.min(i + 1, filtered.length - 1));
      },
    },
    {
      key: 'k',
      handler: () => {
        if (!editing && !selected) setFocusedIdx((i) => Math.max(i - 1, 0));
      },
    },
    {
      key: 'Enter',
      handler: () => {
        if (!editing && !selected && filtered[focusedIdx]) {
          setSelectedId(filtered[focusedIdx].id);
        }
      },
    },
    {
      key: 'Escape',
      handler: () => {
        if (editing) return; // edit form handles its own Esc
        if (selected) setSelectedId(null);
        else if (creatingNew) setCreatingNew(false);
        else if (showSettings) setShowSettings(false);
        else if (showBulk) setShowBulk(false);
      },
    },
  ]);

  // Keep focused index in bounds
  useEffect(() => {
    if (focusedIdx >= filtered.length) setFocusedIdx(Math.max(0, filtered.length - 1));
  }, [filtered.length, focusedIdx]);

  if (!data) {
    return (
      <div className="empty">
        <h2>Loading archive…</h2>
      </div>
    );
  }

  const anyFiltersActive =
    filters.search ||
    filters.sequence_association ||
    filters.character ||
    filters.tag ||
    filters.needsResearch ||
    filters.inCollection;

  const clearFilters = () =>
    setFilters((f) => ({
      ...f,
      search: '',
      sequence_association: null,
      character: null,
      tag: null,
      needsResearch: false,
      inCollection: false,
    }));

  const recentDefaults = getRecentDefaults(data.sheets);
  const hasNextIncomplete = incompleteQueue.length > 1 ||
    (incompleteQueue.length === 1 && incompleteQueue[0].id !== editing?.id);

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <h1 className="masthead-title">
            Pinocchio <em>Model Sheet</em> Archive
          </h1>
          <div className="masthead-subtitle">
            Character Model Department · Research Finding Aid
          </div>
        </div>
        <div className="masthead-meta">
          <div>
            {data.sheets.length} records · {filtered.length} shown
            {filters.view === 'by_character' &&
              groupedByCharacter.length > 0 && (
                <>
                  {' '}·{' '}
                  {groupedByCharacter.reduce(
                    (sum, g) => sum + g.sheets.length,
                    0
                  )}{' '}
                  appearances across {groupedByCharacter.length} characters
                </>
              )}
            {incompleteQueue.length > 0 && (
              <>
                {' '}·{' '}
                <span style={{ color: 'var(--warn)' }}>
                  {incompleteQueue.length} need research
                </span>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={handleExportCSV} title="Export filtered CSV">
              Export CSV
            </button>
            <button onClick={() => setShowSettings(true)} title="Settings">
              Settings
            </button>
          </div>
        </div>
      </header>

      <div className="toolbar">
        <input
          type="text"
          className="toolbar-search"
          placeholder="Search… (press / to focus)"
          value={filters.search}
          onChange={(e) =>
            setFilters((f) => ({ ...f, search: e.target.value }))
          }
        />
        <select
          value={filters.sort}
          onChange={(e) =>
            setFilters((f) => ({ ...f, sort: e.target.value as SortMode }))
          }
        >
          <option value="number">Sort: Sheet Number</option>
          <option value="date">Sort: Date on Sheet</option>
          <option value="title">Sort: Title</option>
          <option value="character">Sort: Character</option>
          <option value="updated">Sort: Recently Updated</option>
          <option value="created">Sort: Recently Added</option>
        </select>
        <select
          value={filters.view}
          onChange={(e) =>
            setFilters((f) => ({ ...f, view: e.target.value as ViewMode }))
          }
        >
          <option value="grid">View: Grid</option>
          <option value="list">View: List</option>
          <option value="by_character">View: Group by Character</option>
        </select>
        <button
          className="btn-primary"
          onClick={() => setShowBulk(true)}
          title="Bulk import (b)"
        >
          ⬒ Bulk
        </button>
        <button
          className="btn-primary"
          onClick={() => setCreatingNew(true)}
          title="New (n)"
        >
          + Add
        </button>
      </div>

      <div className="facet-bar">
        <span className="facet-label">Toggles</span>
        <button
          className={`chip ${filters.inCollection ? 'active' : ''}`}
          onClick={() =>
            setFilters((f) => ({ ...f, inCollection: !f.inCollection }))
          }
        >
          Owned only
        </button>
        <button
          className={`chip ${filters.needsResearch ? 'active' : ''}`}
          onClick={() =>
            setFilters((f) => ({ ...f, needsResearch: !f.needsResearch }))
          }
        >
          Needs research ({incompleteQueue.length})
        </button>

        {vocab.sequences.length > 0 && (
          <>
            <span className="facet-label" style={{ marginLeft: 12 }}>
              Sequence
            </span>
            {vocab.sequences.slice(0, 6).map((s) => (
              <button
                key={s.value}
                className={`chip ${
                  filters.sequence_association === s.value ? 'active' : ''
                }`}
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    sequence_association:
                      f.sequence_association === s.value ? null : s.value,
                  }))
                }
              >
                {s.value} ({s.count})
              </button>
            ))}
          </>
        )}

        {vocab.characters.length > 0 && (
          <>
            <span className="facet-label" style={{ marginLeft: 12 }}>
              Characters
            </span>
            {vocab.characters.slice(0, 10).map((c) => (
              <button
                key={c.value}
                className={`chip ${
                  filters.character === c.value ? 'active' : ''
                }`}
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    character: f.character === c.value ? null : c.value,
                  }))
                }
              >
                {c.value} ({c.count})
              </button>
            ))}
          </>
        )}

        {anyFiltersActive && (
          <button
            className="chip"
            onClick={clearFilters}
            style={{
              marginLeft: 'auto',
              borderColor: 'var(--accent)',
              color: 'var(--accent)',
            }}
          >
            Clear filters ×
          </button>
        )}
      </div>

      {loadError && data.sheets.length === 0 && (
        <div
          className="notice"
          style={{ margin: 32, borderLeftColor: 'var(--warn)' }}
        >
          <strong>No data file found.</strong> This is expected for a fresh
          install. Use <em>+ Add</em> or <em>⬒ Bulk</em> to begin.
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="empty">
          <h2>No sheets match.</h2>
          <p>Clear filters, or add your first record.</p>
        </div>
      ) : filters.view === 'by_character' ? (
        <div style={{ padding: '20px 32px 32px' }}>
          {groupedByCharacter.map((group) => (
            <section
              key={group.character}
              style={{ marginBottom: 40 }}
              id={`char-${encodeURIComponent(group.character)}`}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 12,
                  borderBottom: '2px solid var(--ink)',
                  paddingBottom: 6,
                  marginBottom: 16,
                }}
              >
                <h2
                  style={{
                    fontFamily: 'var(--serif)',
                    fontWeight: 500,
                    fontSize: 22,
                    margin: 0,
                    color:
                      group.character === '(uncharacterized)'
                        ? 'var(--ink-faded)'
                        : 'var(--ink)',
                    fontStyle:
                      group.character === '(uncharacterized)'
                        ? 'italic'
                        : 'normal',
                  }}
                >
                  {group.character}
                </h2>
                <span
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 11,
                    color: 'var(--ink-faded)',
                    letterSpacing: '0.05em',
                  }}
                >
                  {group.sheets.length}{' '}
                  {group.sheets.length === 1 ? 'sheet' : 'sheets'}
                </span>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fill, minmax(240px, 1fr))',
                  gap: 24,
                }}
              >
                {group.sheets.map((s) => (
                  <SheetCard
                    key={`${group.character}-${s.id}`}
                    sheet={s}
                    imageBase={BASE}
                    onClick={() => setSelectedId(s.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : filters.view === 'grid' ? (
        <div className="grid">
          {filtered.map((s, i) => (
            <SheetCard
              key={s.id}
              sheet={s}
              imageBase={BASE}
              onClick={() => setSelectedId(s.id)}
              focused={i === focusedIdx}
            />
          ))}
        </div>
      ) : (
        <div className="list">
          <div className="list-header">
            <div style={{ width: 60 }}></div>
            <div className="list-row-id">ID</div>
            <div className="list-row-title">Title</div>
            <div className="list-row-chars">Characters</div>
            <div className="list-row-date">Date</div>
            <div className="list-row-webocc">Hits</div>
            <div className="list-row-flags">Flags</div>
          </div>
          {filtered.map((s, i) => (
            <SheetListRow
              key={s.id}
              sheet={s}
              imageBase={BASE}
              onClick={() => setSelectedId(s.id)}
              focused={i === focusedIdx}
            />
          ))}
        </div>
      )}

      {selected && !editing && !creatingNew && (
        <SheetDetail
          sheet={selected}
          imageBase={BASE}
          publicBaseUrl={publicBaseUrl}
          onClose={() => setSelectedId(null)}
          onEdit={() => setEditingId(selected.id)}
          onDelete={() => handleDelete(selected.id)}
        />
      )}

      {editing && (
        <SheetEdit
          sheet={editing}
          imageBase={BASE}
          publicBaseUrl={publicBaseUrl}
          vocab={vocab}
          isNew={false}
          existingIds={existingIds}
          hasNextIncomplete={hasNextIncomplete}
          onSave={handleSave}
          onSaveAndNext={handleSaveAndNext}
          onCancel={() => setEditingId(null)}
        />
      )}

      {creatingNew && (
        <SheetEdit
          sheet={makeEmptySheet('', recentDefaults)}
          imageBase={BASE}
          publicBaseUrl={publicBaseUrl}
          vocab={vocab}
          isNew={true}
          existingIds={existingIds}
          hasNextIncomplete={incompleteQueue.length > 0}
          onSave={handleSave}
          onSaveAndNext={handleSaveAndNext}
          onCancel={() => setCreatingNew(false)}
        />
      )}

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}

      {showBulk && (
        <BulkImport
          existingIds={existingIds}
          defaults={recentDefaults}
          onImport={handleBulkImport}
          onCancel={() => setShowBulk(false)}
        />
      )}

      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--ink)',
            color: 'var(--paper)',
            padding: '10px 20px',
            fontFamily: 'var(--mono)',
            fontSize: 12,
            letterSpacing: '0.05em',
            zIndex: 200,
            border: '1px solid var(--accent)',
          }}
        >
          {toast}
        </div>
      )}

      <div
        style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          fontFamily: 'var(--mono)',
          fontSize: 9,
          color: 'var(--ink-faded)',
          letterSpacing: '0.05em',
          textAlign: 'right',
          lineHeight: 1.6,
          pointerEvents: 'none',
          userSelect: 'none',
          opacity: 0.6,
        }}
      >
        n new · b bulk · / search · j/k move · ↵ open · e edit · esc close
      </div>
    </div>
  );
}
