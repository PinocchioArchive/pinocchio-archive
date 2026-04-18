// User-local lists of sheets. Each visitor keeps their own lists in
// localStorage — they never hit the GitHub repo, so one visitor's lists
// don't leak to another visitor (or to the archive owner).
//
// Schema:
//   { version: 1, lists: [{ id, name, created_at, updated_at, sheet_ids }] }
//
// IDs are generated with a timestamp prefix so lexicographic sort orders
// them by creation, but lookup is always by ID.

export interface UserList {
  id: string;
  name: string;
  created_at: string; // ISO
  updated_at: string; // ISO
  sheet_ids: string[]; // references to ModelSheet.id
}

export interface UserListsData {
  version: 1;
  lists: UserList[];
}

const STORAGE_KEY = 'pma_user_lists';

function emptyData(): UserListsData {
  return { version: 1, lists: [] };
}

export function loadLists(): UserListsData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && Array.isArray(parsed.lists)) return parsed;
    return emptyData();
  } catch {
    return emptyData();
  }
}

export function saveLists(data: UserListsData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function newId(): string {
  return `list_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createList(name: string): UserList {
  const now = new Date().toISOString();
  const list: UserList = {
    id: newId(),
    name: name.trim() || 'Untitled list',
    created_at: now,
    updated_at: now,
    sheet_ids: [],
  };
  const data = loadLists();
  data.lists.push(list);
  saveLists(data);
  return list;
}

export function renameList(id: string, name: string): void {
  const data = loadLists();
  const list = data.lists.find((l) => l.id === id);
  if (!list) return;
  list.name = name.trim() || list.name;
  list.updated_at = new Date().toISOString();
  saveLists(data);
}

export function deleteList(id: string): void {
  const data = loadLists();
  data.lists = data.lists.filter((l) => l.id !== id);
  saveLists(data);
}

// Toggle a sheet's membership in a list. Returns the new membership state.
export function toggleSheetInList(listId: string, sheetId: string): boolean {
  const data = loadLists();
  const list = data.lists.find((l) => l.id === listId);
  if (!list) return false;
  const idx = list.sheet_ids.indexOf(sheetId);
  let newState: boolean;
  if (idx === -1) {
    list.sheet_ids.push(sheetId);
    newState = true;
  } else {
    list.sheet_ids.splice(idx, 1);
    newState = false;
  }
  list.updated_at = new Date().toISOString();
  saveLists(data);
  return newState;
}

// Add multiple sheets to a list at once; skips ones already in the list.
// Returns count actually added.
export function addSheetsToList(listId: string, sheetIds: string[]): number {
  const data = loadLists();
  const list = data.lists.find((l) => l.id === listId);
  if (!list) return 0;
  const existing = new Set(list.sheet_ids);
  let added = 0;
  for (const id of sheetIds) {
    if (!existing.has(id)) {
      list.sheet_ids.push(id);
      existing.add(id);
      added++;
    }
  }
  if (added > 0) {
    list.updated_at = new Date().toISOString();
    saveLists(data);
  }
  return added;
}

// Remove multiple sheets from a list; returns count actually removed.
export function removeSheetsFromList(
  listId: string,
  sheetIds: string[]
): number {
  const data = loadLists();
  const list = data.lists.find((l) => l.id === listId);
  if (!list) return 0;
  const toRemove = new Set(sheetIds);
  const before = list.sheet_ids.length;
  list.sheet_ids = list.sheet_ids.filter((id) => !toRemove.has(id));
  const removed = before - list.sheet_ids.length;
  if (removed > 0) {
    list.updated_at = new Date().toISOString();
    saveLists(data);
  }
  return removed;
}

// Returns the IDs of lists the given sheet belongs to.
export function listsForSheet(sheetId: string): string[] {
  return loadLists()
    .lists.filter((l) => l.sheet_ids.includes(sheetId))
    .map((l) => l.id);
}

// Export all lists as a JSON string. Includes a small header so imports
// can sanity-check the file format before merging.
export function exportListsJson(): string {
  const data = loadLists();
  const payload = {
    kind: 'pinocchio-archive-user-lists',
    exported_at: new Date().toISOString(),
    ...data,
  };
  return JSON.stringify(payload, null, 2);
}

// Validates and parses an imported file. Throws on anything it doesn't
// recognize rather than silently accepting junk.
export function parseImportedLists(raw: string): UserList[] {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Not valid JSON');
  }
  if (parsed?.kind !== 'pinocchio-archive-user-lists') {
    throw new Error(
      "Doesn't look like a Pinocchio archive lists export (missing 'kind' marker)"
    );
  }
  if (parsed.version !== 1 || !Array.isArray(parsed.lists)) {
    throw new Error('Unexpected format version');
  }
  const out: UserList[] = [];
  for (const l of parsed.lists) {
    if (
      typeof l?.id !== 'string' ||
      typeof l?.name !== 'string' ||
      !Array.isArray(l?.sheet_ids)
    ) {
      throw new Error('One of the lists is malformed');
    }
    out.push({
      id: l.id,
      name: l.name,
      created_at: l.created_at || new Date().toISOString(),
      updated_at: l.updated_at || new Date().toISOString(),
      sheet_ids: l.sheet_ids.filter((x: unknown) => typeof x === 'string'),
    });
  }
  return out;
}

// Replace all local lists with the imported ones.
export function replaceListsWith(imported: UserList[]): void {
  saveLists({ version: 1, lists: imported });
}

// Merge imported lists into local: if an imported list has the same id as
// a local one, the imported version's sheet_ids are unioned in and the
// name is updated to the imported name. New imported lists are added.
// Returns a summary of what changed.
export function mergeLists(imported: UserList[]): {
  added: number;
  merged: number;
  sheetsAdded: number;
} {
  const data = loadLists();
  const byId = new Map(data.lists.map((l) => [l.id, l]));
  let added = 0;
  let merged = 0;
  let sheetsAdded = 0;
  for (const imp of imported) {
    const existing = byId.get(imp.id);
    if (existing) {
      const existingSet = new Set(existing.sheet_ids);
      for (const sid of imp.sheet_ids) {
        if (!existingSet.has(sid)) {
          existing.sheet_ids.push(sid);
          existingSet.add(sid);
          sheetsAdded++;
        }
      }
      existing.name = imp.name;
      existing.updated_at = new Date().toISOString();
      merged++;
    } else {
      data.lists.push(imp);
      added++;
    }
  }
  saveLists(data);
  return { added, merged, sheetsAdded };
}
