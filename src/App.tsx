import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { ArchiveData, ModelSheet } from './types/schema';
import {
  compareSheets,
  compareSheetsByCharacter,
  compareSheetsBySequence,
  compareSheetsBySheetMark,
  extractVocabulary,
  extractSourceVocabulary,
  findSeriesWithGaps,
  getRecentDefaults,
  makeEmptySheet,
  migrateArchive,
  parseSequenceNumber,
} from './lib/sheets';
import {
  commitBinaryFile,
  commitTextFile,
  fileToBase64,
  getRepoConfig,
  getToken,
  verifyToken,
} from './lib/github';
import { useKeyboardShortcuts } from './lib/useKeyboardShortcuts';
import { loadLists, addSheetsToList, createList } from './lib/lists';
import { reverifyPendingSource } from './lib/archive';
import { SheetCard } from './components/SheetCard';
import { SheetListRow } from './components/SheetListRow';
import { SheetDetail } from './components/SheetDetail';
import { SheetEdit } from './components/SheetEdit';
import { Settings } from './components/Settings';
import { BulkImport } from './components/BulkImport';
import { ManageLists } from './components/ManageLists';
import { useDialog } from './components/Dialog';
import { VocabularyHealth } from './components/VocabularyHealth';
import { useVocabulary } from './components/VocabularyProvider';

type SortMode =
  | 'number'
  | 'date'
  | 'title'
  | 'updated'
  | 'created'
  | 'character'
  | 'sequence'
  | 'sheet_mark';
type ViewMode = 'grid' | 'list' | 'by_character';

const BASE = import.meta.env.BASE_URL || '/';

// Filters kept in the URL so you can bookmark views.
interface FilterState {
  search: string;
  sequence_association: string | null;
  character: string | null;
  tag: string | null;
  sheetMark: string | null;
  needsResearch: boolean;
  listId: string | null; // filter to a specific user list (local storage)
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
    sheetMark: params.get('mark'),
    needsResearch: params.get('research') === '1',
    listId: params.get('list'),
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
  if (f.sheetMark) params.set('mark', f.sheetMark);
  if (f.needsResearch) params.set('research', '1');
  if (f.listId) params.set('list', f.listId);
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
  const [showManageLists, setShowManageLists] = useState(false);
  const [showVocabularyHealth, setShowVocabularyHealth] = useState(false);
  const { promptDialog, confirmDialog } = useDialog();
  const vocabulary = useVocabulary();
  // Select mode toggles checkboxes on cards; in this mode clicking a card
  // toggles selection rather than opening the detail view. Used for
  // bulk "add to list" operations.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Bump this whenever user lists are mutated (from Manage Lists modal or
  // from detail / card bookmark interactions) so dependent useMemos rebuild.
  const [listsTick, setListsTick] = useState(0);
  const bumpLists = useCallback(() => setListsTick((t) => t + 1), []);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
  const [toast, setToast] = useState<string | null>(null);

  // Authentication state. `null` = verification pending (initial load).
  // `true` = GitHub PAT present and verified against GitHub API.
  // `false` = no token, or token invalid/expired, or network failure.
  // When false, admin UI (Add/Edit/Delete/Bulk) is hidden entirely.
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  // Verifies the stored token against GitHub's /user endpoint. Called once
  // on mount, and again whenever Settings is closed (in case the user just
  // configured a new token). Falls back to read-only mode on any error.
  const checkAuth = useCallback(async () => {
    if (!getToken()) {
      setIsAuthenticated(false);
      return;
    }
    try {
      const result = await verifyToken();
      setIsAuthenticated(result.ok);
    } catch {
      setIsAuthenticated(false);
    }
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  // Re-check auth when Settings modal closes — the user may have just
  // configured a token or disconnected.
  const handleCloseSettings = () => {
    setShowSettings(false);
    void checkAuth();
  };

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
      .then((raw) => {
        const migrated = migrateArchive(raw);
        setData(migrated);
        // Seed the vocabulary from these sheets if vocabulary.json
        // doesn't yet exist. Silent no-op if already seeded or if
        // the user isn't authenticated.
        void vocabulary.seedIfMissing(migrated.sheets);
      })
      .catch((e) => {
        console.warn('Could not load sheets.json, starting empty:', e);
        setData({ schema_version: 5, sheets: [] });
        setLoadError(e.message);
      });
    // Only run once on mount; vocabulary.seedIfMissing is stable enough
    // that including it in deps would re-trigger the fetch unnecessarily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-reverify pending Wayback captures when data loads. Runs in the
  // background after a brief delay so it doesn't compete with initial
  // render. Collects all status changes and, if the user is authenticated,
  // commits a single batched update to avoid commit spam.
  useEffect(() => {
    if (!data) return;
    // Find all pending sources across all sheets. Identify them by
    // stable properties (sheet ID + source URL) rather than array
    // indices — this way, if a sheet is deleted or reordered while
    // reverify is in flight, we don't write to the wrong record.
    const pending: {
      sheetId: string;
      sourceUrl: string;
      src: {
        url?: string;
        archive_status?: 'not_attempted' | 'pending' | 'verified' | 'failed';
        archive_captured_at?: string;
        archive_url?: string;
      };
    }[] = [];
    data.sheets.forEach((sheet) => {
      sheet.image_sources?.forEach((src) => {
        if (src.archive_status === 'pending' && src.url) {
          pending.push({ sheetId: sheet.id, sourceUrl: src.url, src });
        }
      });
    });
    if (pending.length === 0) return;

    let cancelled = false;
    const run = async () => {
      // Small delay so this doesn't fire during the first render
      await new Promise((r) => setTimeout(r, 2000));
      if (cancelled) return;
      console.info(
        `[Wayback reverify] Checking ${pending.length} pending source(s)…`
      );
      let anyChanged = false;
      for (const { sheetId, sourceUrl, src } of pending) {
        if (cancelled) return;
        try {
          const outcome = await reverifyPendingSource(src);
          if (!outcome || cancelled) continue;
          anyChanged = true;
          // Functional update — finds the sheet+source by ID/URL at the
          // moment the update runs, so concurrent edits or deletions
          // don't corrupt unrelated records.
          setData((current) => {
            if (!current) return current;
            const sheetIdx = current.sheets.findIndex((s) => s.id === sheetId);
            if (sheetIdx < 0) return current; // sheet was deleted
            const sheet = current.sheets[sheetIdx];
            const sourceIdx = (sheet.image_sources || []).findIndex(
              (s) => s.url === sourceUrl
            );
            if (sourceIdx < 0) return current; // source was removed
            const sources = (sheet.image_sources || []).slice();
            // Only update if still pending — if user manually changed it,
            // respect that
            if (sources[sourceIdx].archive_status !== 'pending') return current;
            // Preserve the reverify note if present. Append rather than
            // overwrite so any note the user had typed stays visible too.
            const existingNotes = sources[sourceIdx].notes || '';
            const mergedNotes = outcome.note
              ? existingNotes
                ? `${existingNotes}\n\n[auto] ${outcome.note}`
                : `[auto] ${outcome.note}`
              : existingNotes;
            sources[sourceIdx] = {
              ...sources[sourceIdx],
              archive_status: outcome.archive_status,
              archive_url: outcome.archive_url || sources[sourceIdx].archive_url,
              ...(outcome.note ? { notes: mergedNotes } : {}),
            };
            const sheets = current.sheets.slice();
            sheets[sheetIdx] = { ...sheet, image_sources: sources };
            return { ...current, sheets };
          });
        } catch (e) {
          console.warn('[Wayback reverify] error on source:', src.url, e);
        }
      }
      // If statuses changed and user is authenticated, persist one commit
      if (anyChanged && getToken() && !cancelled) {
        // Wait a beat so setData settles, then commit the current state.
        // This is best-effort — if the commit fails (e.g., user offline),
        // the local state is still updated and next load will re-check.
        setTimeout(() => {
          if (cancelled) return;
          setData((current) => {
            if (!current) return current;
            void commitTextFile(
              'data/sheets.json',
              JSON.stringify(current, null, 2),
              'Auto-verify Wayback statuses'
            ).catch((e) =>
              console.warn('[Wayback reverify] commit failed:', e)
            );
            return current;
          });
        }, 1000);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // Depend only on data identity; don't re-run on every edit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.sheets.length]);

  // Tag-pile chips dispatch `filter:set` CustomEvents when clicked.
  // Handle them here by mapping the detail key to the appropriate filter
  // field. Keeps SheetCard decoupled from filter state.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ key: string; value: string }>;
      const { key, value } = ce.detail || ({} as any);
      if (!key || !value) return;
      setFilters((f) => {
        switch (key) {
          case 'character':
            return { ...f, character: value };
          case 'tag':
            return { ...f, tag: value };
          case 'sheet_mark':
            return { ...f, sheetMark: value };
          case 'sequence_association':
            return { ...f, sequence_association: value };
          case 'year':
            // no dedicated year filter — route to search instead
            return { ...f, search: value };
          default:
            return f;
        }
      });
    };
    window.addEventListener('filter:set', handler);
    return () => window.removeEventListener('filter:set', handler);
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
    if (filters.sheetMark)
      list = list.filter((s) =>
        (s.sheet_marks || []).some(
          (m) => m.value === filters.sheetMark
        )
      );
    if (filters.listId) {
      // Re-read the specific list from localStorage so filter is fresh.
      const userLists = loadLists().lists;
      const sel = userLists.find((l) => l.id === filters.listId);
      if (sel) {
        const ids = new Set(sel.sheet_ids);
        list = list.filter((s) => ids.has(s.id));
      } else {
        // List was deleted underneath us — show nothing and let UI recover.
        list = [];
      }
    }
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
          s.approvals.some((a) => a.toLowerCase().includes(q)) ||
          (s.sheet_marks || []).some(
            (m) =>
              m.value.toLowerCase().includes(q) ||
              (m.notes || '').toLowerCase().includes(q)
          )
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
      case 'sequence':
        list.sort(compareSheetsBySequence);
        break;
      case 'character':
        list.sort(compareSheetsByCharacter);
        break;
      case 'sheet_mark':
        list.sort(compareSheetsBySheetMark);
        break;
    }
    return list;
  }, [data, filters, listsTick]);

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

  // User-local lists (from localStorage). Re-read whenever listsTick bumps.
  const userLists = useMemo(() => {
    return loadLists().lists;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listsTick]);

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
    const seqVocab = extractVocabulary(data.sheets, 'sequence_association');
    // Sort sequences by leading number so chips appear in natural order
    // (1.5, 1.6, 4.2, 4.4) rather than by frequency or alphabetically.
    seqVocab.sort((a, b) => {
      const an = parseSequenceNumber(a.value);
      const bn = parseSequenceNumber(b.value);
      if (!an && !bn) return a.value.localeCompare(b.value);
      if (!an) return 1;
      if (!bn) return -1;
      if (an[0] !== bn[0]) return an[0] - bn[0];
      return an[1] - bn[1];
    });
    return {
      characters: extractVocabulary(data.sheets, 'characters'),
      sequences: seqVocab,
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

  // Stores the active toast dismissal timer. Clearing the previous timer
  // before starting a new one ensures rapid-succession toasts don't race:
  // each new toast resets the 3.5s countdown, so you always see the
  // latest message for its full duration.
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3500);
  }, []);

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

  const findNextIncompleteIn = (
    sheets: ModelSheet[],
    excludingId: string | null
  ): ModelSheet | null => {
    return (
      sheets
        .filter((s) => s.needs_research && s.id !== excludingId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null
    );
  };

  const handleSave = async (
    updated: ModelSheet,
    newImageFile?: File
  ): Promise<ArchiveData | null> => {
    if (!data) return null;
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
    return nextData;
  };

  const handleSaveAndNext = async (
    updated: ModelSheet,
    newImageFile?: File
  ) => {
    // Get the freshly-saved archive back rather than reading from the
    // `data` state, which may not have flushed yet by the time we look
    // up the next record.
    const saved = await handleSave(updated, newImageFile);
    if (!saved) return;
    const next = findNextIncompleteIn(saved.sheets, updated.id);
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
    const ok = await confirmDialog({
      title: `Delete record ${id}?`,
      message:
        'The image file will remain in the repo, but the record itself will be removed. This cannot be undone from within the app.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const nextData: ArchiveData = {
      ...data,
      sheets: data.sheets.filter((s) => s.id !== id),
    };
    await writeArchive(nextData, `Delete ${id}`);
    flashToast(`Deleted ${id}`);
    setSelectedId(null);
  };

  // Tracks a card to scroll into view + pulse-highlight on next render.
  // Set by "focus in context" (clicking the sheet ID in detail view) and
  // cleared once the scroll has happened. We use a ref-like state rather
  // than imperative DOM work so React owns the timing.
  const [pulseId, setPulseId] = useState<string | null>(null);

  // Close detail, ensure sort is by sheet number (so the card is among
  // its numerical neighbors), and schedule a scroll-and-pulse on the
  // target card. No data is lost — filters/search stay as they were.
  const handleFocusInContext = useCallback(
    (id: string) => {
      setSelectedId(null);
      setFilters((f) => (f.sort === 'number' ? f : { ...f, sort: 'number' }));
      setPulseId(id);
    },
    []
  );

  // When pulseId is set, wait for the next paint (so the card is in the
  // DOM after any re-sort), then scroll it into view and trigger the
  // pulse animation. Cleared after the animation duration so the class
  // toggles reliably on repeat clicks.
  useEffect(() => {
    if (!pulseId) return;
    const handle = requestAnimationFrame(() => {
      const el = document.querySelector(
        `[data-sheet-id="${CSS.escape(pulseId)}"]`
      ) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.remove('sheet-pulse');
        // Force reflow so re-adding the class restarts the animation
        void el.offsetWidth;
        el.classList.add('sheet-pulse');
      }
    });
    const clearTimer = window.setTimeout(() => setPulseId(null), 1400);
    return () => {
      cancelAnimationFrame(handle);
      window.clearTimeout(clearTimer);
    };
  }, [pulseId]);

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
      'production_stamps',
      'sheet_marks',
      'date_on_sheet',
      'date_precision',
      'approvals',
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
      const marksStr = (s.sheet_marks || [])
        .map((m) => (m.notes ? `${m.value} (${m.notes})` : m.value))
        .join('; ');
      return [
        s.id,
        s.title,
        s.characters.join('; '),
        s.sequence_association || '',
        stampsStr,
        marksStr,
        s.date_on_sheet || '',
        s.date_precision,
        s.approvals.join('; '),
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
    if (!isAuthenticated) return;
    if (editing || creatingNew || selected) return;
    setCreatingNew(true);
  }, [editing, creatingNew, selected, isAuthenticated]);

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
        if (!isAuthenticated) return;
        if (!editing && !creatingNew && !selected) setShowBulk(true);
      },
    },
    {
      key: 'e',
      handler: () => {
        if (!isAuthenticated) return;
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
        else if (showSettings) handleCloseSettings();
        else if (showManageLists) setShowManageLists(false);
        else if (showVocabularyHealth) setShowVocabularyHealth(false);
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
    filters.sheetMark ||
    filters.needsResearch ||
    filters.listId;

  const clearFilters = () =>
    setFilters((f) => ({
      ...f,
      search: '',
      sequence_association: null,
      character: null,
      tag: null,
      sheetMark: null,
      needsResearch: false,
      listId: null,
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
          <div
            className="masthead-subtitle"
            style={{ display: 'flex', alignItems: 'center', gap: 10 }}
          >
            <span>Character Model Department · Research Finding Aid</span>
            {isAuthenticated === false && (
              <span
                style={{
                  background: 'var(--paper-deep)',
                  border: '1px solid var(--rule)',
                  color: 'var(--ink-soft)',
                  padding: '2px 8px',
                  letterSpacing: '0.1em',
                }}
                title="Read-only view. Sign in via Settings to edit."
              >
                Public view
              </span>
            )}
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
            {incompleteQueue.length > 0 && isAuthenticated && (
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
            {isAuthenticated && (
              <button
                onClick={() => setShowVocabularyHealth(true)}
                title="Vocabulary health check"
              >
                Vocabulary
                {(() => {
                  const unreviewed =
                    vocabulary.vocab.characters.filter((e) => !e.reviewed)
                      .length +
                    vocabulary.vocab.tags.filter((e) => !e.reviewed).length;
                  if (unreviewed === 0) return null;
                  return (
                    <span
                      style={{
                        marginLeft: 6,
                        background: 'var(--warn)',
                        color: 'var(--paper)',
                        fontSize: 9,
                        padding: '1px 5px',
                        borderRadius: 999,
                        fontFamily: 'var(--mono)',
                      }}
                    >
                      {unreviewed}
                    </span>
                  );
                })()}
              </button>
            )}
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
          <option value="sequence">Sort: Sequence</option>
          <option value="date">Sort: Date on Sheet</option>
          <option value="title">Sort: Title</option>
          <option value="character">Sort: Character</option>
          <option value="sheet_mark">Sort: Sheet Mark</option>
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
          onClick={() => {
            if (selectMode) clearSelection();
            setSelectMode((v) => !v);
          }}
          title="Toggle multi-select (for bulk list actions)"
          style={
            selectMode
              ? {
                  background: 'var(--navy)',
                  color: 'var(--cream)',
                  borderColor: 'var(--navy)',
                }
              : undefined
          }
        >
          {selectMode ? 'Done selecting' : 'Select'}
        </button>
        {isAuthenticated && (
          <>
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
          </>
        )}
      </div>

      <div className="facet-bar">
        {isAuthenticated && (
          <>
            <span className="facet-label">Toggles</span>
            <button
              className={`chip ${filters.needsResearch ? 'active' : ''}`}
              onClick={() =>
                setFilters((f) => ({ ...f, needsResearch: !f.needsResearch }))
              }
            >
              Needs research ({incompleteQueue.length})
            </button>
          </>
        )}

        <span
          className="facet-label"
          style={{ marginLeft: isAuthenticated ? 12 : 0 }}
        >
          Lists
        </span>
        {userLists.length === 0 && (
          <span
            style={{
              fontSize: 11,
              color: 'var(--ink-faded)',
              fontStyle: 'italic',
            }}
          >
            None yet.
          </span>
        )}
        {userLists.slice(0, 6).map((l) => (
          <button
            key={l.id}
            className={`chip ${filters.listId === l.id ? 'active' : ''}`}
            onClick={() =>
              setFilters((f) => ({
                ...f,
                listId: f.listId === l.id ? null : l.id,
              }))
            }
            title={`${l.sheet_ids.length} sheet${
              l.sheet_ids.length === 1 ? '' : 's'
            }`}
          >
            {l.name} ({l.sheet_ids.length})
          </button>
        ))}
        <button
          className="chip"
          onClick={() => setShowManageLists(true)}
          style={{ fontStyle: 'italic' }}
          title="Create, rename, delete, export / import lists"
        >
          Manage…
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

        {filters.sheetMark && (
          <>
            <span className="facet-label" style={{ marginLeft: 12 }}>
              Mark
            </span>
            <button
              className="chip active"
              onClick={() =>
                setFilters((f) => ({ ...f, sheetMark: null }))
              }
              title="Click to clear this filter"
              style={{ fontFamily: 'var(--mono)' }}
            >
              {filters.sheetMark} ×
            </button>
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

      {selectMode && (
        <div
          style={{
            padding: '8px 24px',
            borderBottom: '1px solid var(--rule)',
            background: 'var(--paper-deep)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            fontSize: 13,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 11,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: 'var(--ink-faded)',
            }}
          >
            {selectedIds.size === 0
              ? 'Click cards to select'
              : `${selectedIds.size} selected`}
          </span>
          {selectedIds.size > 0 && (
            <>
              <button
                className="btn-small"
                onClick={() => {
                  setSelectedIds(new Set(filtered.map((s) => s.id)));
                }}
                title="Select all currently filtered sheets"
              >
                Select all filtered ({filtered.length})
              </button>
              <button className="btn-small" onClick={clearSelection}>
                Clear selection
              </button>
              <div style={{ flex: 1 }} />
              <AddToListPicker
                userLists={userLists}
                count={selectedIds.size}
                onChoose={async (listIdOrNew) => {
                  let listId = listIdOrNew;
                  if (listIdOrNew === '__new__') {
                    const name = await promptDialog({
                      title: 'New list',
                      message: `This list will be created and ${selectedIds.size} sheet${
                        selectedIds.size === 1 ? '' : 's'
                      } will be added to it.`,
                      placeholder: 'List name',
                    });
                    if (!name) return;
                    listId = createList(name).id;
                  }
                  const added = addSheetsToList(
                    listId,
                    Array.from(selectedIds)
                  );
                  bumpLists();
                  const list = loadLists().lists.find((l) => l.id === listId);
                  flashToast(
                    `Added ${added} sheet${added === 1 ? '' : 's'} to "${
                      list?.name ?? 'list'
                    }"`
                  );
                }}
              />
            </>
          )}
        </div>
      )}

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
                  borderBottom: '1px solid var(--rule)',
                  paddingBottom: 8,
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
                    userLists={userLists}
                    onListsChanged={bumpLists}
                    selectMode={selectMode}
                    selected={selectedIds.has(s.id)}
                    onSelectToggle={() => toggleSelect(s.id)}
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
              userLists={userLists}
              onListsChanged={bumpLists}
              selectMode={selectMode}
              selected={selectedIds.has(s.id)}
              onSelectToggle={() => toggleSelect(s.id)}
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
          canEdit={!!isAuthenticated}
          userLists={userLists}
          onListsChanged={bumpLists}
          onClose={() => setSelectedId(null)}
          onEdit={() => setEditingId(selected.id)}
          onDelete={() => handleDelete(selected.id)}
          onFocusInContext={() => handleFocusInContext(selected.id)}
          seriesSlots={findSeriesWithGaps(selected, data.sheets)}
          onSelectSibling={(id) => setSelectedId(id)}
        />
      )}

      {editing && isAuthenticated && (
        <SheetEdit
          key={editing.id}
          sheet={editing}
          imageBase={BASE}
          publicBaseUrl={publicBaseUrl}
          vocab={vocab}
          isNew={false}
          existingIds={existingIds}
          hasNextIncomplete={hasNextIncomplete}
          onSave={async (u, f) => { await handleSave(u, f); }}
          onSaveAndNext={handleSaveAndNext}
          onCancel={() => setEditingId(null)}
        />
      )}

      {creatingNew && isAuthenticated && (
        <SheetEdit
          sheet={makeEmptySheet('', recentDefaults)}
          imageBase={BASE}
          publicBaseUrl={publicBaseUrl}
          vocab={vocab}
          isNew={true}
          existingIds={existingIds}
          hasNextIncomplete={incompleteQueue.length > 0}
          onSave={async (u, f) => { await handleSave(u, f); }}
          onSaveAndNext={handleSaveAndNext}
          onCancel={() => setCreatingNew(false)}
        />
      )}

      {showManageLists && (
        <ManageLists
          onClose={() => setShowManageLists(false)}
          onChange={bumpLists}
        />
      )}

      {showVocabularyHealth && (
        <VocabularyHealth
          onClose={() => setShowVocabularyHealth(false)}
        />
      )}

      {showSettings && <Settings onClose={handleCloseSettings} />}

      {showBulk && isAuthenticated && (
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
        className="keyboard-hint"
        aria-hidden="true"
      >
        n new · b bulk · / search · j/k move · ↵ open · e edit · esc close
      </div>
    </div>
  );
}

// Tiny inline component used by the select-mode action bar. Renders a
// dropdown of user lists + a "+ New list" option. Kept in App.tsx since
// it's used only here.
function AddToListPicker({
  userLists,
  count,
  onChoose,
}: {
  userLists: { id: string; name: string; sheet_ids: string[] }[];
  count: number;
  onChoose: (listId: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) return;
        onChoose(v);
        setValue(''); // reset so user can repeat
      }}
      style={{ fontSize: 12, padding: '4px 8px' }}
      aria-label="Add selected sheets to a list"
    >
      <option value="">Add {count} to list…</option>
      {userLists.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name} ({l.sheet_ids.length})
        </option>
      ))}
      <option value="__new__">+ New list…</option>
    </select>
  );
}
