import React, { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Calendar, LogOut, Plus, Save, Trash2, Copy, RefreshCw } from 'lucide-react';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { User } from './types';

type FixedWorkerFieldKey =
  | 'shift'
  | 'job'
  | 'firstName'
  | 'lastName'
  | 'payRate'
  | 'idNumber'
  | 'preferredName'
  | 'birthDay'
  | 'messenger'
  | 'persona'
  | 'knife';

type WorkerRosterRow = {
  id: string;
  shift: string;
  job: string;
  firstName: string;
  lastName: string;
  payRate: string;
  idNumber: string;
  preferredName: string;
  birthDay: string;
  messenger: string;
  persona: string;
  knife: string;
  custom: Record<string, string>;
};

type CustomWorkerColumn = {
  id: string;
  label: string;
};

type ColumnWidthMap = Record<string, number>;
type RowHeightMap = Record<string, number>;
type ColumnFilterMap = Record<string, string>;
type SortDirection = 'asc' | 'desc';
type CellRef = { rowId: string; colKey: string };
type CellSelection = { anchor: CellRef; focus: CellRef };
type ColumnType = 'text' | 'currency' | 'number' | 'dateLike' | 'choice';

type WorkerRosterProps = {
  currentUser: User;
  onBackToHub: () => void;
  onLogout: () => void;
  roleColor: string;
  viewOnly?: boolean;
};

type FixedColumnDef = {
  kind: 'fixed';
  key: string;
  fieldKey: FixedWorkerFieldKey;
  label: string;
  align?: 'left' | 'center' | 'right';
};

type CustomColumnDef = {
  kind: 'custom';
  key: string;
  customId: string;
  label: string;
  align?: 'left' | 'center' | 'right';
};

type RenderColumn = (FixedColumnDef | CustomColumnDef) & { letter: string };

const ROSTER_DOC_REF = doc(db, 'worker_roster', 'main');

const FIXED_COLUMNS: FixedColumnDef[] = [
  { kind: 'fixed', key: 'shift',         fieldKey: 'shift',         label: '',              align: 'center' },
  { kind: 'fixed', key: 'job',           fieldKey: 'job',           label: 'Job' },
  { kind: 'fixed', key: 'firstName',     fieldKey: 'firstName',     label: 'First Name' },
  { kind: 'fixed', key: 'lastName',      fieldKey: 'lastName',      label: 'Last Name' },
  { kind: 'fixed', key: 'payRate',       fieldKey: 'payRate',       label: 'Pay Rate',      align: 'right' },
  { kind: 'fixed', key: 'idNumber',      fieldKey: 'idNumber',      label: 'Id Number' },
  { kind: 'fixed', key: 'preferredName', fieldKey: 'preferredName', label: 'Prefered Name' },
  { kind: 'fixed', key: 'birthDay',      fieldKey: 'birthDay',      label: 'Birth Day' },
  { kind: 'fixed', key: 'messenger',     fieldKey: 'messenger',     label: 'Messenger' },
  { kind: 'fixed', key: 'persona',       fieldKey: 'persona',       label: 'Persona',       align: 'center' },
  { kind: 'fixed', key: 'knife',         fieldKey: 'knife',         label: 'Knife',         align: 'center' },
];

const DEFAULT_COLUMN_WIDTHS: Record<FixedWorkerFieldKey, number> = {
  shift: 120,
  job: 240,
  firstName: 170,
  lastName: 170,
  payRate: 110,
  idNumber: 130,
  preferredName: 170,
  birthDay: 120,
  messenger: 220,
  persona: 120,
  knife: 90,
};

const DEFAULT_CUSTOM_COLUMN_WIDTH = 160;
const DEFAULT_ROW_HEIGHT = 32;
const MIN_ROW_HEIGHT = 24;
const MAX_ROW_HEIGHT = 96;
const MIN_COL_WIDTH = 70;
const MAX_COL_WIDTH = 520;
const ROW_INDEX_COL_WIDTH = 56;
const OPS_COL_WIDTH = 112;

const STARTER_ROWS: WorkerRosterRow[] = [
  row('Evening', 'Apprenticeship', 'John', 'Ugay', '$16.50', '2081500', 'Dave', 'Jun-26', 'John Dave Ugay', '', '65'),
  row('Evening', 'Supply Chain', 'Belinda', 'Puspita', '$16.50', '2072718', 'Bella', 'Aug-6', 'Bilguun Chinzorig', '', '15'),
  row('Evening', 'Accountant', 'Linda', 'Daeli', '$16.50', '2081628', 'Linda D.', 'Aug-11', 'Linda Daeli', '', ''),
  row('Evening', 'Trainer', 'Karen Kristine', 'Daniel', '$18.00', '2080895', 'Karen', 'Aug-31', 'Karen Kristine Daniel', 'ISTJ-T', '20'),
  row('Morning', 'Bakery Apprentice', 'Hailey', 'Bradford', '$17.04', '584710', 'Hailey', 'May-12', '', '', ''),
  row('Morning', 'Culinary Intern 1', 'Mckenzie', 'Dawn', '$17.04', '584730', 'Mckenzie', 'Apr-20', '', '', ''),
  row('Morning', 'Pantry Lead', 'Rizkiana', 'Duffie', '$16.50', '2078727', 'Rizki', 'May-17', 'Rizkiana Duffie', '', '39'),
  row('Morning', 'Pantry Prep 1', 'Valery', 'Adman', '$16.50', '2084993', 'Valery', 'Dec-31', '', '', ''),
  row('Morning', 'Early Morning Lead', 'Sitara', "Tau'imi - Moea'i", '$17.41', '583110', 'Ara', 'Sep-25', 'Ara Moeai', 'ISFP-T', ''),
  row('Morning', 'Student Early Morning 1', 'Ronal', 'Baroi', '$16.50', '2085066', 'Ronal', 'Oct-27', '', '', ''),
  row('Afternoon', 'Afternoon Lead Bakery', 'Jhanine', 'Favia', '$16.50', '2081559', 'Jhanine', 'May-?', 'Jhanine Favia', '', ''),
  row('Afternoon', 'Student Afternoon 1', 'Tiffani', 'Ariono', '$16.50', '2082679', 'Tiffani', 'Aug-22', '', '', ''),
  row('Night', 'Night Lead', 'Grace', 'Christensen', '$17.04', '2074968', 'Grace', 'Jan-17', 'Grace Christensen', '', ''),
  row('Night', 'Student Night 1', 'Selah', 'Dadag', '$16.50', '2081156', 'Selah', 'Jan-12', '', '', ''),
  row('Morning', 'Morning Student Lead', 'Kaboiti', 'Aata', '$17.50', '2080280', 'Boisy', 'Apr-9', 'Kaboiti Aata', 'ENFJ-T', '26'),
];

function row(
  shift: string,
  job: string,
  firstName: string,
  lastName: string,
  payRate: string,
  idNumber: string,
  preferredName: string,
  birthDay: string,
  messenger: string,
  persona: string,
  knife: string,
): WorkerRosterRow {
  return {
    id: makeId(),
    shift,
    job,
    firstName,
    lastName,
    payRate,
    idNumber,
    preferredName,
    birthDay,
    messenger,
    persona,
    knife,
    custom: {},
  };
}

function makeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id_${Math.random().toString(36).slice(2, 10)}`;
}

function str(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeCustomCells(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) out[k] = str(v);
  return out;
}

function normalizeRows(input: unknown): WorkerRosterRow[] {
  if (!Array.isArray(input)) return [];
  return input.map((raw) => {
    const obj = (raw ?? {}) as Partial<WorkerRosterRow>;
    return {
      id: typeof obj.id === 'string' && obj.id ? obj.id : makeId(),
      shift: str(obj.shift),
      job: str(obj.job),
      firstName: str(obj.firstName),
      lastName: str(obj.lastName),
      payRate: str(obj.payRate),
      idNumber: str(obj.idNumber),
      preferredName: str(obj.preferredName),
      birthDay: str(obj.birthDay),
      messenger: str(obj.messenger),
      persona: str(obj.persona),
      knife: str(obj.knife),
      custom: normalizeCustomCells(obj.custom),
    };
  });
}

function normalizeCustomColumns(input: unknown): CustomWorkerColumn[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: CustomWorkerColumn[] = [];
  for (const raw of input) {
    const obj = (raw ?? {}) as Partial<CustomWorkerColumn>;
    const id = typeof obj.id === 'string' && obj.id ? obj.id : `col_${makeId()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: str(obj.label).trim() || 'New Column' });
  }
  return out;
}

function normalizeColumnWidths(input: unknown): ColumnWidthMap {
  if (!input || typeof input !== 'object') return {};
  const out: ColumnWidthMap = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = clamp(Math.round(v), MIN_COL_WIDTH, MAX_COL_WIDTH);
    }
  }
  return out;
}

function normalizeRowHeights(input: unknown): RowHeightMap {
  if (!input || typeof input !== 'object') return {};
  const out: RowHeightMap = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = clamp(Math.round(v), MIN_ROW_HEIGHT, MAX_ROW_HEIGHT);
    }
  }
  return out;
}

function getRowTint(row: WorkerRosterRow) {
  const shift = row.shift.toLowerCase();
  const job = row.job.toLowerCase();
  if (shift.includes('evening')) return '#d9d2e955';
  if (shift.includes('night')) return '#9fc5e855';
  if (shift.includes('afternoon')) return '#9fc5e855';
  if (shift.includes('morning')) {
    if (job.includes('bakery') || job.includes('culinary')) return '#ff00ff3a';
    if (job.includes('pantry')) return '#93c47d66';
    if (job.includes('early morning') || job.includes('student early')) return '#6fa8dc77';
    if (job.includes('student lead') || job.includes('lead')) return '#ea999966';
    return '#b6d7a866';
  }
  return '#ffffff';
}

function excelColLabel(index: number) {
  let n = index + 1;
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function colStorageKey(column: RenderColumn) {
  return column.kind === 'fixed' ? `fixed:${column.fieldKey}` : `custom:${column.customId}`;
}

function getFixedCellValue(row: WorkerRosterRow, field: FixedWorkerFieldKey) {
  return row[field];
}

function compareStrings(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function getColumnType(column: RenderColumn): ColumnType {
  if (column.kind === 'custom') return 'text';
  if (column.fieldKey === 'payRate') return 'currency';
  if (column.fieldKey === 'knife') return 'number';
  if (column.fieldKey === 'idNumber') return 'number';
  if (column.fieldKey === 'birthDay') return 'dateLike';
  if (column.fieldKey === 'shift') return 'choice';
  return 'text';
}

function normalizeCellInput(column: RenderColumn, value: string): string {
  const trimmed = value;
  if (column.kind === 'fixed' && column.fieldKey === 'payRate') {
    const n = Number(trimmed.replace(/[^0-9.-]/g, ''));
    if (trimmed.trim() === '') return '';
    if (!Number.isNaN(n)) return `$${n.toFixed(2)}`;
  }
  if (column.kind === 'fixed' && (column.fieldKey === 'idNumber' || column.fieldKey === 'knife')) {
    return trimmed.replace(/[^\d.-]/g, '');
  }
  return trimmed;
}

function validateCell(column: RenderColumn, value: string): string | null {
  if (!value.trim()) return null;
  if (column.kind === 'fixed' && column.fieldKey === 'shift') {
    const allowed = ['morning', 'afternoon', 'evening', 'night'];
    if (!allowed.includes(value.trim().toLowerCase())) return 'Use Morning, Afternoon, Evening, or Night';
  }
  if (column.kind === 'fixed' && column.fieldKey === 'payRate') {
    const n = Number(value.replace(/[^0-9.-]/g, ''));
    if (Number.isNaN(n)) return 'Invalid pay rate';
  }
  if (column.kind === 'fixed' && (column.fieldKey === 'idNumber' || column.fieldKey === 'knife')) {
    if (!/^\d+(\.\d+)?$/.test(value.trim())) return 'Numbers only';
  }
  return null;
}

export default function WorkerRoster({
  currentUser,
  onBackToHub,
  onLogout,
  roleColor,
  viewOnly = false,
}: WorkerRosterProps) {
  const [rows, setRows] = useState<WorkerRosterRow[]>([]);
  const [customColumns, setCustomColumns] = useState<CustomWorkerColumn[]>([]);
  const [columnWidths, setColumnWidths] = useState<ColumnWidthMap>({});
  const [rowHeights, setRowHeights] = useState<RowHeightMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [columnFilters, setColumnFilters] = useState<ColumnFilterMap>({});
  const [sortState, setSortState] = useState<{ colKey: string; direction: SortDirection } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [lastSavedLabel, setLastSavedLabel] = useState('');
  const [error, setError] = useState('');
  const [googleSyncConfigured, setGoogleSyncConfigured] = useState(false);
  const [googleSyncInfo, setGoogleSyncInfo] = useState<{ spreadsheetId: string | null; sheetName: string } | null>(null);
  const [lastGoogleHash, setLastGoogleHash] = useState<string | null>(null);
  const [googleSyncConflict, setGoogleSyncConflict] = useState(false);

  const resizeStateRef = useRef<
    | { kind: 'col'; colKey: string; startX: number; startWidth: number }
    | { kind: 'row'; rowId: string; startY: number; startHeight: number }
    | null
  >(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const syncPollTimerRef = useRef<number | null>(null);
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const selectionRafRef = useRef<number | null>(null);
  const pendingSelectionFocusRef = useRef<CellRef | null>(null);
  const [selection, setSelection] = useState<CellSelection | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [activeEditCell, setActiveEditCell] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);
  const deferredColumnFilters = useDeferredValue(columnFilters);
  const [gridScrollTop, setGridScrollTop] = useState(0);
  const [gridViewportHeight, setGridViewportHeight] = useState(600);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const snap = await getDoc(ROSTER_DOC_REF);
        if (!active) return;
        const data = snap.data();
        const loadedRows = normalizeRows(data?.rows);
        setRows(loadedRows.length > 0 ? loadedRows : STARTER_ROWS.map((r) => ({ ...r, id: makeId() })));
        setCustomColumns(normalizeCustomColumns(data?.customColumns));
        setColumnWidths(normalizeColumnWidths(data?.columnWidths));
        setRowHeights(normalizeRowHeights(data?.rowHeights));
        setDirty(false);
        if (snap.exists()) setLastSavedLabel('Loaded from Firestore');
        try {
          const statusResp = await fetch(`/api/worker-roster/google/status?t=${Date.now()}`, { cache: 'no-store' });
          if (statusResp.ok) {
            const status = await statusResp.json();
            setGoogleSyncConfigured(Boolean(status.configured));
            setGoogleSyncInfo({ spreadsheetId: status.spreadsheetId ?? null, sheetName: status.sheetName ?? 'Workers' });
            if (status.configured) {
              const pullResp = await fetch(`/api/worker-roster/google/pull?t=${Date.now()}`, { cache: 'no-store' });
              if (pullResp.ok) {
                const pulled = await pullResp.json();
                const pulledRows = normalizeRows(pulled.rows);
                const pulledCustom = normalizeCustomColumns(pulled.customColumns);
                setRows(pulledRows.length > 0 ? pulledRows.map((r) => ({ ...r, id: r.id || makeId() })) : []);
                setCustomColumns(pulledCustom);
                setLastGoogleHash(typeof pulled.hash === 'string' ? pulled.hash : null);
                setLastSavedLabel(`Google Sheets connected (${pulled.sheetName ?? status.sheetName ?? 'Workers'})`);
                setDirty(false);
              }
            }
          }
        } catch (syncErr) {
          console.warn('Google Sheets sync status check failed', syncErr);
        }
      } catch (e) {
        console.error('Failed to load worker roster', e);
        if (!active) return;
        setRows(STARTER_ROWS.map((r) => ({ ...r, id: makeId(), custom: {} })));
        setCustomColumns([]);
        setError('Could not load Firestore data. Showing starter roster.');
        setDirty(false);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const state = resizeStateRef.current;
      if (!state) return;
      if (state.kind === 'col') {
        const next = clamp(state.startWidth + (event.clientX - state.startX), MIN_COL_WIDTH, MAX_COL_WIDTH);
        setColumnWidths((prev) => ({ ...prev, [state.colKey]: next }));
      } else {
        const next = clamp(state.startHeight + (event.clientY - state.startY), MIN_ROW_HEIGHT, MAX_ROW_HEIGHT);
        setRowHeights((prev) => ({ ...prev, [state.rowId]: next }));
      }
    };
    const onUp = () => {
      if (!resizeStateRef.current) return;
      resizeStateRef.current = null;
      setDirty(true);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
      if (syncPollTimerRef.current !== null) window.clearInterval(syncPollTimerRef.current);
      if (selectionRafRef.current !== null) window.cancelAnimationFrame(selectionRafRef.current);
    };
  }, []);

  useEffect(() => {
    const measure = () => {
      if (!gridScrollRef.current) return;
      setGridViewportHeight(gridScrollRef.current.clientHeight || 600);
      setGridScrollTop(gridScrollRef.current.scrollTop || 0);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    const stopSelecting = () => setIsSelecting(false);
    window.addEventListener('mouseup', stopSelecting);
    return () => window.removeEventListener('mouseup', stopSelecting);
  }, []);

  const renderedColumns = useMemo<RenderColumn[]>(() => {
    const fixed: RenderColumn[] = FIXED_COLUMNS.map((c, i) => ({ ...c, letter: excelColLabel(i) }));
    const custom: RenderColumn[] = customColumns.map((c, i) => ({
      kind: 'custom',
      key: `custom:${c.id}`,
      customId: c.id,
      label: c.label,
      align: 'left',
      letter: excelColLabel(FIXED_COLUMNS.length + i),
    }));
    return [...fixed, ...custom];
  }, [customColumns]);

  const effectiveColumnWidths = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const col of renderedColumns) {
      const key = colStorageKey(col);
      if (col.kind === 'fixed') out[key] = columnWidths[key] ?? DEFAULT_COLUMN_WIDTHS[col.fieldKey];
      else out[key] = columnWidths[key] ?? DEFAULT_CUSTOM_COLUMN_WIDTH;
    }
    return out;
  }, [columnWidths, renderedColumns]);

  const tableWidth = useMemo(() => {
    const dataCols = renderedColumns.reduce((sum, col) => sum + effectiveColumnWidths[colStorageKey(col)], 0);
    return ROW_INDEX_COL_WIDTH + dataCols + OPS_COL_WIDTH;
  }, [effectiveColumnWidths, renderedColumns]);

  const filteredRows = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const withSearch = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => {
        const haystack = [
          row.shift, row.job, row.firstName, row.lastName, row.payRate, row.idNumber,
          row.preferredName, row.birthDay, row.messenger, row.persona, row.knife,
          ...Object.values(row.custom ?? {}),
        ];
        return q ? haystack.some((v) => v.toLowerCase().includes(q)) : true;
      });

    const withColumnFilters = withSearch.filter(({ row }) =>
      renderedColumns.every((col) => {
        const f = (deferredColumnFilters[colStorageKey(col)] ?? '').trim().toLowerCase();
        if (!f) return true;
        const value = col.kind === 'fixed'
          ? getFixedCellValue(row, col.fieldKey)
          : (row.custom?.[col.customId] ?? '');
        return value.toLowerCase().includes(f);
      }),
    );

    if (!sortState) return withColumnFilters;

    const sorted = [...withColumnFilters];
    sorted.sort((a, b) => {
      const col = renderedColumns.find((c) => colStorageKey(c) === sortState.colKey);
      if (!col) return 0;
      const av = col.kind === 'fixed' ? getFixedCellValue(a.row, col.fieldKey) : (a.row.custom?.[col.customId] ?? '');
      const bv = col.kind === 'fixed' ? getFixedCellValue(b.row, col.fieldKey) : (b.row.custom?.[col.customId] ?? '');
      let cmp = 0;
      const type = getColumnType(col);
      if (type === 'currency' || type === 'number') {
        cmp = (Number(av.replace(/[^0-9.-]/g, '')) || 0) - (Number(bv.replace(/[^0-9.-]/g, '')) || 0);
      } else {
        cmp = compareStrings(av, bv);
      }
      return sortState.direction === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [rows, deferredSearch, renderedColumns, deferredColumnFilters, sortState]);

  const persistRoster = async (labelPrefix: 'Saved' | 'Auto-saved') => {
    if (googleSyncConfigured) {
      const googleResp = await fetch('/api/worker-roster/google/push', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, customColumns, expectedHash: lastGoogleHash }),
      });
      if (!googleResp.ok) {
        const data = await googleResp.json().catch(() => ({}));
        if (googleResp.status === 409 || data.code === 'REMOTE_CONFLICT') {
          setGoogleSyncConflict(true);
          setLastSavedLabel('Remote changes detected');
          throw new Error('REMOTE_CONFLICT');
        }
        throw new Error(data.error || 'Google Sheets push failed');
      }
      const pushed = await googleResp.json().catch(() => ({}));
      setGoogleSyncConflict(false);
      if (typeof pushed.hash === 'string') setLastGoogleHash(pushed.hash);
    }

    await setDoc(
      ROSTER_DOC_REF,
      {
        rows,
        customColumns,
        columnWidths,
        rowHeights,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.id,
        updatedByName: currentUser.name,
      },
      { merge: true },
    );
    setDirty(false);
    setLastSavedLabel(`${labelPrefix} ${format(new Date(), 'MMM d, yyyy h:mm a')}${googleSyncConfigured ? ' • Google Sheets' : ''}`);
  };

  const pullLatestFromGoogle = async () => {
    if (!googleSyncConfigured) return;
    const resp = await fetch(`/api/worker-roster/google/pull?t=${Date.now()}`, { cache: 'no-store' });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || 'Google Sheets pull failed');
    }
    const pulled = await resp.json();
    const pulledRows = normalizeRows(pulled.rows);
    const pulledCustom = normalizeCustomColumns(pulled.customColumns);
    setRows(pulledRows.map((r) => ({ ...r, id: r.id || makeId() })));
    setCustomColumns(pulledCustom);
    setLastGoogleHash(typeof pulled.hash === 'string' ? pulled.hash : null);
    setGoogleSyncConflict(false);
    setDirty(false);
    setLastSavedLabel(`Reloaded from Google Sheets ${format(new Date(), 'h:mm:ss a')}`);
  };

  const reloadFromGoogle = async () => {
    if (!googleSyncConfigured) return;
    if (dirty && !window.confirm('Reload from Google Sheets and discard unsaved local changes?')) return;
    setSaving(true);
    setError('');
    try {
      await pullLatestFromGoogle();
    } catch (e) {
      console.error('Failed to reload worker roster from Google Sheets', e);
      setError('Failed to reload from Google Sheets.');
    } finally {
      setSaving(false);
    }
  };

  const saveRoster = async () => {
    if (viewOnly) return;
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    setSaving(true);
    setError('');
    try {
      await persistRoster('Saved');
    } catch (e) {
      console.error('Failed to save worker roster', e);
      setError(
        e instanceof Error && e.message === 'REMOTE_CONFLICT'
          ? 'Remote changes detected in Google Sheets. Reload from Google Sheets before saving again.'
          : 'Failed to save roster. Check Firestore rules/connection and try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (loading || viewOnly || !dirty) return;
    if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
    setLastSavedLabel('Auto-saving...');
    autosaveTimerRef.current = window.setTimeout(async () => {
      setSaving(true);
      setError('');
      try {
        await persistRoster('Auto-saved');
      } catch (e) {
        console.error('Failed to auto-save worker roster', e);
        if (e instanceof Error && e.message === 'REMOTE_CONFLICT') {
          setError('Remote changes detected in Google Sheets. Reload from Google Sheets before saving again.');
          setLastSavedLabel('Remote changes detected');
        } else {
          setError('Auto-save failed. You can try Save Changes manually.');
          setLastSavedLabel('Auto-save failed');
        }
      } finally {
        setSaving(false);
        autosaveTimerRef.current = null;
      }
    }, 900);
  }, [rows, customColumns, columnWidths, rowHeights, dirty, loading, viewOnly]);

  useEffect(() => {
    if (!googleSyncConfigured || loading) return;
    if (syncPollTimerRef.current !== null) window.clearInterval(syncPollTimerRef.current);

    syncPollTimerRef.current = window.setInterval(async () => {
      if (dirty || saving || activeEditCell) return;
      try {
        const resp = await fetch(`/api/worker-roster/google/pull?t=${Date.now()}`, { cache: 'no-store' });
        if (!resp.ok) return;
        const pulled = await resp.json();
        if (typeof pulled.hash === 'string' && pulled.hash === lastGoogleHash) return;
        const pulledRows = normalizeRows(pulled.rows);
        const pulledCustom = normalizeCustomColumns(pulled.customColumns);
        setRows(pulledRows.map((r) => ({ ...r, id: r.id || makeId() })));
        setCustomColumns(pulledCustom);
        setLastGoogleHash(typeof pulled.hash === 'string' ? pulled.hash : null);
        setGoogleSyncConflict(false);
        setLastSavedLabel(`Synced from Google Sheets ${format(new Date(), 'h:mm:ss a')}`);
      } catch (e) {
        console.warn('Google Sheets poll sync failed', e);
      }
    }, 10000);

    return () => {
      if (syncPollTimerRef.current !== null) {
        window.clearInterval(syncPollTimerRef.current);
        syncPollTimerRef.current = null;
      }
    };
  }, [googleSyncConfigured, loading, dirty, saving, lastGoogleHash, activeEditCell]);

  const updateFixedCell = (rowId: string, field: FixedWorkerFieldKey, value: string) => {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, [field]: value } : r)));
    setDirty(true);
  };

  const updateCustomCell = (rowId: string, customId: string, value: string) => {
    setRows((prev) => prev.map((r) => (
      r.id === rowId ? { ...r, custom: { ...(r.custom ?? {}), [customId]: value } } : r
    )));
    setDirty(true);
  };

  const getCellValueByRef = (row: WorkerRosterRow, col: RenderColumn) =>
    col.kind === 'fixed' ? getFixedCellValue(row, col.fieldKey) : (row.custom?.[col.customId] ?? '');

  const setCellValueByRef = (rowId: string, col: RenderColumn, value: string) => {
    const normalized = normalizeCellInput(col, value);
    if (col.kind === 'fixed') updateFixedCell(rowId, col.fieldKey, normalized);
    else updateCustomCell(rowId, col.customId, normalized);
  };

  const getSelectionRect = (): { rowStart: number; rowEnd: number; colStart: number; colEnd: number } | null => {
    if (!selection) return null;
    const rowIndexById = new Map<string, number>(filteredRows.map((r, idx) => [r.row.id, idx]));
    const colIndexByKey = new Map<string, number>(renderedColumns.map((c, idx) => [colStorageKey(c), idx]));
    const r1 = rowIndexById.get(selection.anchor.rowId);
    const r2 = rowIndexById.get(selection.focus.rowId);
    const c1 = colIndexByKey.get(selection.anchor.colKey);
    const c2 = colIndexByKey.get(selection.focus.colKey);
    if (r1 == null || r2 == null || c1 == null || c2 == null) return null;
    return {
      rowStart: Math.min(r1, r2),
      rowEnd: Math.max(r1, r2),
      colStart: Math.min(c1, c2),
      colEnd: Math.max(c1, c2),
    };
  };

  const selectionRect = useMemo(
    () => getSelectionRect(),
    [selection, filteredRows, renderedColumns],
  );

  const selectedCellKeys = useMemo(() => {
    if (!selectionRect) return new Set<string>();
    const set = new Set<string>();
    for (let r = selectionRect.rowStart; r <= selectionRect.rowEnd; r++) {
      const row = filteredRows[r]?.row;
      if (!row) continue;
      for (let c = selectionRect.colStart; c <= selectionRect.colEnd; c++) {
        const col = renderedColumns[c];
        if (!col) continue;
        set.add(`${row.id}::${colStorageKey(col)}`);
      }
    }
    return set;
  }, [selectionRect, filteredRows, renderedColumns]);

  const virtualRows = useMemo(() => {
    const rowCount = filteredRows.length;
    const overscan = 8;
    if (rowCount === 0) {
      return { start: 0, end: -1, topPad: 0, bottomPad: 0, visible: [] as typeof filteredRows };
    }

    const heights = filteredRows.map(({ row }) => rowHeights[row.id] ?? DEFAULT_ROW_HEIGHT);
    const viewportTop = gridScrollTop;
    const viewportBottom = gridScrollTop + gridViewportHeight;

    let start = 0;
    let y = 0;
    while (start < rowCount && y + heights[start] < viewportTop) {
      y += heights[start];
      start++;
    }
    const topPad = y;

    let end = start;
    let visibleHeight = 0;
    while (end < rowCount && visibleHeight < (viewportBottom - topPad)) {
      visibleHeight += heights[end];
      end++;
    }

    const startWithOverscan = Math.max(0, start - overscan);
    const endWithOverscan = Math.min(rowCount - 1, end + overscan);

    let adjustedTopPad = 0;
    for (let i = 0; i < startWithOverscan; i++) adjustedTopPad += heights[i];

    let renderedHeight = 0;
    for (let i = startWithOverscan; i <= endWithOverscan; i++) renderedHeight += heights[i];

    const totalHeight = heights.reduce((sum, h) => sum + h, 0);
    const bottomPad = Math.max(0, totalHeight - adjustedTopPad - renderedHeight);

    return {
      start: startWithOverscan,
      end: endWithOverscan,
      topPad: adjustedTopPad,
      bottomPad,
      visible: filteredRows.slice(startWithOverscan, endWithOverscan + 1),
    };
  }, [filteredRows, rowHeights, gridScrollTop, gridViewportHeight]);

  const copySelectionToClipboard = async () => {
    const rect = selectionRect;
    if (!rect) return;
    const lines: string[] = [];
    for (let r = rect.rowStart; r <= rect.rowEnd; r++) {
      const row = filteredRows[r]?.row;
      if (!row) continue;
      const vals: string[] = [];
      for (let c = rect.colStart; c <= rect.colEnd; c++) {
        const col = renderedColumns[c];
        if (!col) continue;
        vals.push(getCellValueByRef(row, col));
      }
      lines.push(vals.join('\t'));
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setLastSavedLabel('Copied selection');
    } catch {
      setError('Clipboard copy failed. Browser blocked clipboard access.');
    }
  };

  const applyPastedGrid = (text: string, startRowId: string, startColKey: string) => {
    const matrix = text
      .replace(/\r\n/g, '\n')
      .split('\n')
      .filter((line, idx, arr) => !(idx === arr.length - 1 && line === ''))
      .map((line) => line.split('\t'));
    if (matrix.length === 0) return;

    const rowIndexById = new Map<string, number>(filteredRows.map((r, idx) => [r.row.id, idx]));
    const colIndexByKey = new Map<string, number>(renderedColumns.map((c, idx) => [colStorageKey(c), idx]));
    const startRow = rowIndexById.get(startRowId) ?? -1;
    const startCol = colIndexByKey.get(startColKey) ?? -1;
    if (startRow < 0 || startCol < 0) return;

    setRows((prev) => {
      const next = prev.map((r) => ({ ...r, custom: { ...(r.custom ?? {}) } }));
      const rowIndexById = new Map<string, number>(next.map((r, idx) => [r.id, idx]));
      for (let rOffset = 0; rOffset < matrix.length; rOffset++) {
        const targetVisible = filteredRows[startRow + rOffset];
        if (!targetVisible) break;
        const actualIdx = rowIndexById.get(targetVisible.row.id);
        if (actualIdx == null) continue;
        for (let cOffset = 0; cOffset < matrix[rOffset].length; cOffset++) {
          const col = renderedColumns[startCol + cOffset];
          if (!col) break;
          const incoming = normalizeCellInput(col, matrix[rOffset][cOffset] ?? '');
          if (col.kind === 'fixed') {
            (next[actualIdx] as any)[col.fieldKey] = incoming;
          } else {
            next[actualIdx].custom[col.customId] = incoming;
          }
        }
      }
      return next;
    });
    setDirty(true);
  };

  const toggleSort = (colKey: string) => {
    setSortState((prev) => {
      if (!prev || prev.colKey !== colKey) return { colKey, direction: 'asc' };
      if (prev.direction === 'asc') return { colKey, direction: 'desc' };
      return null;
    });
  };

  const beginCellSelection = (rowId: string, colKey: string) => {
    const ref = { rowId, colKey };
    setSelection({ anchor: ref, focus: ref });
    setIsSelecting(true);
  };

  const queueSelectionFocus = (rowId: string, colKey: string) => {
    if (!isSelecting || !selection) return;
    pendingSelectionFocusRef.current = { rowId, colKey };
    if (selectionRafRef.current !== null) return;
    selectionRafRef.current = window.requestAnimationFrame(() => {
      selectionRafRef.current = null;
      const next = pendingSelectionFocusRef.current;
      pendingSelectionFocusRef.current = null;
      if (!next) return;
      setSelection((prev) => (prev ? { ...prev, focus: next } : prev));
    });
  };

  const addRow = () => {
    const base = row('Morning', '', '', '', '', '', '', '', '', '', '');
    for (const c of customColumns) base.custom[c.id] = '';
    setRows((prev) => [...prev, base]);
    setDirty(true);
  };

  const duplicateRow = (rowId: string) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === rowId);
      if (idx < 0) return prev;
      const copy = { ...prev[idx], id: makeId(), custom: { ...(prev[idx].custom ?? {}) } };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
    setDirty(true);
  };

  const deleteRow = (rowId: string) => {
    setRows((prev) => prev.filter((r) => r.id !== rowId));
    setDirty(true);
  };

  const addColumn = () => {
    if (viewOnly) return;
    const label = window.prompt('Column name', 'New Column')?.trim();
    if (!label) return;
    const id = `col_${makeId()}`;
    setCustomColumns((prev) => [...prev, { id, label }]);
    setRows((prev) => prev.map((r) => ({ ...r, custom: { ...(r.custom ?? {}), [id]: '' } })));
    setDirty(true);
  };

  const renameCustomColumn = (customId: string, label: string) => {
    setCustomColumns((prev) => prev.map((c) => (c.id === customId ? { ...c, label } : c)));
    setDirty(true);
  };

  const resetToStarter = () => {
    if (viewOnly) return;
    if (!window.confirm('Reset the roster rows to the starter template? Custom columns stay available.')) return;
    setRows(STARTER_ROWS.map((r) => {
      const next: WorkerRosterRow = { ...r, id: makeId(), custom: {} };
      for (const c of customColumns) next.custom[c.id] = '';
      return next;
    }));
    setDirty(true);
  };

  const startColumnResize = (event: React.MouseEvent, colKey: string) => {
    if (viewOnly) return;
    event.preventDefault();
    event.stopPropagation();
    resizeStateRef.current = {
      kind: 'col',
      colKey,
      startX: event.clientX,
      startWidth: effectiveColumnWidths[colKey] ?? DEFAULT_CUSTOM_COLUMN_WIDTH,
    };
  };

  const startRowResize = (event: React.MouseEvent, rowId: string, currentHeight: number) => {
    if (viewOnly) return;
    event.preventDefault();
    event.stopPropagation();
    resizeStateRef.current = { kind: 'row', rowId, startY: event.clientY, startHeight: currentHeight };
  };

  return (
    <div className="min-h-screen bg-[#0a0510] text-white">
      <header className="h-16 border-b border-white/10 px-4 sm:px-8 flex items-center justify-between sticky top-0 z-50 bg-[#0a0510]/80 backdrop-blur-md">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <button onClick={onBackToHub} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all text-xs font-bold text-slate-300">
            ← Hub
          </button>
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center text-white font-bold" style={{ backgroundColor: roleColor }}>W</div>
          <div className="min-w-0">
            <h1 className="font-display text-base sm:text-xl font-bold truncate" style={{ color: '#7dd3fc' }}>Worker Roster</h1>
            <p className="text-[10px] sm:text-xs text-slate-500 truncate">Spreadsheet-style employee records for shifts, roles, pay, IDs, and notes</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-white/5 rounded-full border border-white/10">
            <Calendar size={16} className="text-[#00ffff]" />
            <span className="text-sm font-medium text-slate-300">{format(new Date(), 'EEEE, MMMM do yyyy')}</span>
          </div>
          <button onClick={onLogout} title="Logout" className="p-2 text-slate-500 hover:text-white transition-colors">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="p-4 sm:p-6 lg:p-8 space-y-4">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <div className="flex flex-col xl:flex-row xl:items-center gap-3 xl:gap-4 justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={addRow} disabled={viewOnly} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-[#00c2ff] text-[#062033] disabled:opacity-50">
                <Plus size={16} /> Add Row
              </button>
              <button onClick={addColumn} disabled={viewOnly} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-[#93c5fd] text-[#082f49] disabled:opacity-50">
                <Plus size={16} /> Add Column
              </button>
              <button onClick={resetToStarter} disabled={viewOnly} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border border-white/15 bg-white/5 text-slate-200 disabled:opacity-50">
                <RefreshCw size={15} /> Reset Template
              </button>
              <button
                onClick={() => { if (viewOnly) return; setColumnWidths({}); setRowHeights({}); setDirty(true); }}
                disabled={viewOnly}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border border-white/15 bg-white/5 text-slate-200 disabled:opacity-50"
              >
                Reset Sizes
              </button>
              <button
                onClick={saveRoster}
                disabled={viewOnly || saving || !dirty}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                style={{ backgroundColor: dirty ? '#22c55e' : '#334155' }}
              >
                <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={copySelectionToClipboard}
                disabled={!selection}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border border-white/15 bg-white/5 text-slate-200 disabled:opacity-50"
              >
                <Copy size={15} /> Copy Range
              </button>
              <button
                onClick={() => { void reloadFromGoogle(); }}
                disabled={!googleSyncConfigured || saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border border-white/15 bg-white/5 text-slate-200 disabled:opacity-50"
                title="Discard local unsaved changes and reload latest data from Google Sheets"
              >
                <RefreshCw size={15} /> Reload from Google
              </button>
              {viewOnly && <span className="text-xs font-black uppercase tracking-widest px-3 py-2 rounded-xl border border-[#ffd700]/40 bg-[#ffd700]/10 text-[#ffd700]">View Only</span>}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <input
                value={search}
                onChange={(e) => {
                  const next = e.target.value;
                  startTransition(() => setSearch(next));
                }}
                placeholder="Search workers, jobs, IDs..."
                className="w-full sm:w-72 px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#38bdf8]"
              />
              <div className="text-[11px] text-slate-500">
                {lastSavedLabel || 'Not saved yet'}{dirty ? ' • Unsaved changes' : ''}
              </div>
            </div>
          </div>
          {googleSyncInfo && (
            <p className="mt-3 text-[11px] text-slate-400">
              Google Sheets: {googleSyncConfigured ? `Connected to "${googleSyncInfo.sheetName}"` : 'Not configured on server'} {googleSyncInfo.spreadsheetId ? `(${googleSyncInfo.spreadsheetId})` : ''}
            </p>
          )}
          <p className="mt-3 text-[11px] text-slate-500">Drag the right edge of a column header to resize columns. Drag the bottom edge of a row number to resize row height.</p>
          <p className="mt-1 text-[11px] text-slate-500">Changes auto-save automatically after you stop typing or resizing. Custom column headers can be renamed inline. Ctrl/Cmd+V pastes tabular ranges into the selected cell. When Google Sheets is configured, edits sync both ways.</p>
          {googleSyncConflict && (
            <p className="mt-2 text-xs text-amber-300">
              Remote changes detected in Google Sheets. Reload from Google Sheets before saving again (or manually merge your changes first).
            </p>
          )}
          {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
        </div>

        <div className="rounded-3xl border border-white/10 overflow-hidden">
          <div
            ref={gridScrollRef}
            onScroll={(e) => setGridScrollTop((e.currentTarget as HTMLDivElement).scrollTop)}
            className="overflow-auto bg-[#f4f4f5] max-h-[75vh]"
          >
            <table className="border-collapse table-fixed text-[#111827]" style={{ width: `${tableWidth}px`, minWidth: `${tableWidth}px` }}>
              <colgroup>
                <col style={{ width: `${ROW_INDEX_COL_WIDTH}px` }} />
                {renderedColumns.map((col) => (
                  <col key={col.key} style={{ width: `${effectiveColumnWidths[colStorageKey(col)]}px` }} />
                ))}
                <col style={{ width: `${OPS_COL_WIDTH}px` }} />
              </colgroup>

              <thead>
                <tr>
                  <th className="sticky top-0 left-0 z-30 bg-[#dbeafe] border border-[#9ca3af] h-8 text-xs font-bold" />
                  {renderedColumns.map((col) => (
                    <th key={`letter-${col.key}`} className="sticky top-0 z-20 bg-[#dbeafe] border border-[#9ca3af] h-8 text-xs font-bold relative">
                      {col.letter}
                      <button
                        type="button"
                        onMouseDown={(e) => startColumnResize(e, colStorageKey(col))}
                        disabled={viewOnly}
                        aria-label={`Resize column ${col.label || col.letter}`}
                        className="absolute top-0 right-[-4px] h-full w-2 cursor-col-resize disabled:cursor-default group"
                      >
                        <span className="absolute right-[3px] top-1/2 -translate-y-1/2 h-5 w-[2px] rounded bg-[#60a5fa] opacity-0 group-hover:opacity-70" />
                      </button>
                    </th>
                  ))}
                  <th className="sticky top-0 z-20 bg-[#dbeafe] border border-[#9ca3af] h-8 text-xs font-bold">Ops</th>
                </tr>
                <tr>
                  <th className="sticky top-8 left-0 z-30 bg-white border border-[#9ca3af] h-9 text-[11px] font-bold text-slate-500">#</th>
                  {renderedColumns.map((col) => (
                    <th
                      key={`header-${col.key}`}
                      className="sticky top-8 z-20 bg-white border border-[#9ca3af] h-9 px-2 text-[12px] font-semibold relative"
                      style={{ textAlign: col.align ?? 'left' }}
                    >
                      <div className="flex items-center gap-1 pr-3">
                        <button
                          type="button"
                          onClick={() => toggleSort(colStorageKey(col))}
                          className="text-[10px] px-1 rounded hover:bg-slate-200/80"
                          title="Toggle sort"
                        >
                          {sortState?.colKey === colStorageKey(col) ? (sortState.direction === 'asc' ? '↑' : '↓') : '↕'}
                        </button>
                        <div className="flex-1 min-w-0">
                          {col.kind === 'custom' ? (
                            <input
                              value={col.label}
                              onChange={(e) => renameCustomColumn(col.customId, e.target.value)}
                              readOnly={viewOnly}
                              className="w-full bg-transparent outline-none text-[12px] font-semibold read-only:cursor-default"
                              style={{ textAlign: col.align ?? 'left' }}
                            />
                          ) : (
                            col.label
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onMouseDown={(e) => startColumnResize(e, colStorageKey(col))}
                        disabled={viewOnly}
                        aria-label={`Resize column ${col.label || col.letter}`}
                        className="absolute top-0 right-[-4px] h-full w-2 cursor-col-resize disabled:cursor-default group"
                      >
                        <span className="absolute right-[3px] top-1/2 -translate-y-1/2 h-5 w-[2px] rounded bg-[#60a5fa] opacity-0 group-hover:opacity-70" />
                      </button>
                    </th>
                  ))}
                  <th className="sticky top-8 z-20 bg-white border border-[#9ca3af] h-9 px-2 text-[12px] font-semibold text-center">Actions</th>
                </tr>
                <tr>
                  <th className="sticky top-[68px] left-0 z-30 bg-[#f8fafc] border border-[#9ca3af] h-8 text-[10px] font-semibold text-slate-500">
                    Filter
                  </th>
                  {renderedColumns.map((col) => (
                    <th
                      key={`filter-${col.key}`}
                      className="sticky top-[68px] z-20 bg-[#f8fafc] border border-[#9ca3af] h-8 px-1"
                    >
                      <input
                        value={columnFilters[colStorageKey(col)] ?? ''}
                        onChange={(e) => {
                          const key = colStorageKey(col);
                          const next = e.target.value;
                          startTransition(() => setColumnFilters((prev) => ({ ...prev, [key]: next })));
                        }}
                        placeholder="filter"
                        className="w-full h-6 px-1.5 text-[10px] border border-slate-300 rounded bg-white/90 outline-none focus:ring-1 focus:ring-sky-400"
                      />
                    </th>
                  ))}
                  <th className="sticky top-[68px] z-20 bg-[#f8fafc] border border-[#9ca3af] h-8 px-1 text-[10px] font-semibold text-slate-500">
                    {sortState ? 'Sorted' : ''}
                  </th>
                </tr>
              </thead>

              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={renderedColumns.length + 2} className="px-4 py-8 text-center text-sm text-slate-500 bg-white">
                      Loading worker roster...
                    </td>
                  </tr>
                )}

                {!loading && filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={renderedColumns.length + 2} className="px-4 py-8 text-center text-sm text-slate-500 bg-white">
                      No rows match your search.
                    </td>
                  </tr>
                )}

                {!loading && virtualRows.topPad > 0 && (
                  <tr>
                    <td colSpan={renderedColumns.length + 2} style={{ height: `${virtualRows.topPad}px`, padding: 0, border: 'none', background: '#f4f4f5' }} />
                  </tr>
                )}

                {!loading && virtualRows.visible.map(({ row, index }) => {
                  const tint = getRowTint(row);
                  const rowHeight = rowHeights[row.id] ?? DEFAULT_ROW_HEIGHT;
                  return (
                    <tr key={row.id} style={{ backgroundColor: tint, height: `${rowHeight}px` }}>
                      <td className="sticky left-0 z-10 border border-[#9ca3af] px-2 text-center text-[11px] font-semibold relative" style={{ backgroundColor: tint, height: `${rowHeight}px` }}>
                        {index + 2}
                        <button
                          type="button"
                          onMouseDown={(e) => startRowResize(e, row.id, rowHeight)}
                          disabled={viewOnly}
                          aria-label={`Resize row ${index + 2}`}
                          className="absolute left-0 bottom-[-4px] w-full h-2 cursor-row-resize disabled:cursor-default group"
                        >
                          <span className="absolute left-1/2 -translate-x-1/2 bottom-[3px] h-[2px] w-8 rounded bg-[#60a5fa] opacity-0 group-hover:opacity-70" />
                        </button>
                      </td>

                      {renderedColumns.map((col) => {
                        const colKey = colStorageKey(col);
                        const value = col.kind === 'fixed'
                          ? getFixedCellValue(row, col.fieldKey)
                          : (row.custom?.[col.customId] ?? '');
                        const validationError = validateCell(col, value);
                        const selected = selectedCellKeys.has(`${row.id}::${colKey}`);
                        return (
                          <td key={`${row.id}-${col.key}`} className="border border-[#9ca3af] p-0" style={{ height: `${rowHeight}px` }}>
                            {col.kind === 'fixed' && col.fieldKey === 'shift' && !viewOnly ? (
                              <select
                                value={value}
                                onChange={(e) => updateFixedCell(row.id, col.fieldKey, e.target.value)}
                                onFocus={() => { setActiveEditCell(`${row.id}::${colKey}`); setSelection({ anchor: { rowId: row.id, colKey }, focus: { rowId: row.id, colKey } }); }}
                                onBlur={() => setActiveEditCell((prev) => (prev === `${row.id}::${colKey}` ? null : prev))}
                                onMouseDown={() => beginCellSelection(row.id, colKey)}
                                onMouseEnter={() => queueSelectionFocus(row.id, colKey)}
                                className="w-full px-2 text-[12px] bg-transparent outline-none focus:bg-white/70"
                                style={{ height: `${Math.max(rowHeight - 1, MIN_ROW_HEIGHT)}px`, textAlign: col.align ?? 'left', boxShadow: selected ? 'inset 0 0 0 2px #2563eb' : undefined, backgroundColor: validationError ? 'rgba(254,226,226,.8)' : undefined }}
                                title={validationError ?? ''}
                              >
                                <option value=""></option>
                                <option value="Morning">Morning</option>
                                <option value="Afternoon">Afternoon</option>
                                <option value="Evening">Evening</option>
                                <option value="Night">Night</option>
                              </select>
                            ) : (
                              <input
                                key={`${row.id}-${colKey}-${value}`}
                                defaultValue={value}
                                onBlur={(e) => {
                                  setCellValueByRef(row.id, col, e.target.value);
                                  setActiveEditCell((prev) => (prev === `${row.id}::${colKey}` ? null : prev));
                                }}
                                onFocus={() => { setActiveEditCell(`${row.id}::${colKey}`); setSelection({ anchor: { rowId: row.id, colKey }, focus: { rowId: row.id, colKey } }); }}
                                onMouseDown={() => beginCellSelection(row.id, colKey)}
                                onMouseEnter={() => queueSelectionFocus(row.id, colKey)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    (e.currentTarget as HTMLInputElement).blur();
                                  }
                                }}
                                onCopy={(e) => {
                                  const rect = selectionRect;
                                  if (rect && !(rect.rowStart === rect.rowEnd && rect.colStart === rect.colEnd)) {
                                    e.preventDefault();
                                    void copySelectionToClipboard();
                                  }
                                }}
                                onPaste={(e) => {
                                  const txt = e.clipboardData.getData('text/plain');
                                  if (txt.includes('\t') || txt.includes('\n')) {
                                    e.preventDefault();
                                    setActiveEditCell(null);
                                    applyPastedGrid(txt, row.id, colKey);
                                  }
                                }}
                                readOnly={viewOnly}
                                className="w-full px-2 text-[12px] bg-transparent outline-none focus:bg-white/70 read-only:cursor-default"
                                style={{
                                  height: `${Math.max(rowHeight - 1, MIN_ROW_HEIGHT)}px`,
                                  textAlign: col.align ?? 'left',
                                  boxShadow: selected ? 'inset 0 0 0 2px #2563eb' : undefined,
                                  backgroundColor: validationError ? 'rgba(254,226,226,.8)' : undefined,
                                }}
                                title={validationError ?? ''}
                              />
                            )}
                          </td>
                        );
                      })}

                      <td className="border border-[#9ca3af] px-1 py-0.5" style={{ height: `${rowHeight}px` }}>
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => duplicateRow(row.id)} disabled={viewOnly} title="Duplicate row" className="h-7 w-7 inline-flex items-center justify-center rounded bg-white/70 hover:bg-white text-slate-700 disabled:opacity-40">
                            <Copy size={13} />
                          </button>
                          <button onClick={() => deleteRow(row.id)} disabled={viewOnly} title="Delete row" className="h-7 w-7 inline-flex items-center justify-center rounded bg-rose-100 hover:bg-rose-200 text-rose-700 disabled:opacity-40">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {!loading && virtualRows.bottomPad > 0 && (
                  <tr>
                    <td colSpan={renderedColumns.length + 2} style={{ height: `${virtualRows.bottomPad}px`, padding: 0, border: 'none', background: '#f4f4f5' }} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
