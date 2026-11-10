/**
 * App state (labels, file issues, settings) as a plain reducer: easy to reason about and to test.
 */
import { autoRotation } from '../core/rotation';
import type { FileIssue, LabelItem, Rect, Rotation, Settings } from '../core/types';
import { detectLang } from '../core/i18n';
import { uid } from '../core/ids';

export interface State {
  items: LabelItem[];
  issues: FileIssue[];
  settings: Settings;
}

export type Action =
  | { type: 'addItem'; item: LabelItem }
  | { type: 'addIssue'; issue: FileIssue }
  | { type: 'remove'; id: string }
  | { type: 'duplicate'; id: string }
  | { type: 'move'; id: string; delta: -1 | 1 }
  | { type: 'rotate'; id: string; rotation: Rotation | null }
  | { type: 'setCrop'; id: string; crop: Rect }
  | { type: 'split'; id: string }
  | { type: 'toggleOwnSheet'; id: string }
  | { type: 'clear' }
  | { type: 'settings'; patch: Partial<Settings> };

const SETTINGS_KEY = 'labelsheet.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  paper: 'A4',
  grid: '2x2',
  marginMm: 0,
  gapMm: 0,
  paddingMm: 1.4,
  cutLines: true,
  colorMode: 'color',
  lang: 'en',
  theme: 'system',
};

/** Settings are a per-device convenience: storage may be unavailable (private mode), so never fail. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS, lang: detectLang() };
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

function withCrop(item: LabelItem, crop: Rect): LabelItem {
  return { ...item, crop, autoRotation: autoRotation(item.textAngle, item.pageRotate, crop.width, crop.height) };
}

function mapItem(state: State, id: string, fn: (item: LabelItem) => LabelItem): State {
  return { ...state, items: state.items.map((i) => (i.id === id ? fn(i) : i)) };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'addItem':
      return { ...state, items: [...state.items, action.item] };
    case 'addIssue':
      return { ...state, issues: [...state.issues, action.issue] };
    case 'remove':
      return { ...state, items: state.items.filter((i) => i.id !== action.id) };
    case 'duplicate': {
      const index = state.items.findIndex((i) => i.id === action.id);
      if (index < 0) return state;
      const items = [...state.items];
      items.splice(index + 1, 0, { ...items[index], id: uid('label') });
      return { ...state, items };
    }
    case 'move': {
      const index = state.items.findIndex((i) => i.id === action.id);
      const target = index + action.delta;
      if (index < 0 || target < 0 || target >= state.items.length) return state;
      const items = [...state.items];
      [items[index], items[target]] = [items[target], items[index]];
      return { ...state, items };
    }
    case 'rotate':
      return mapItem(state, action.id, (i) => ({ ...i, rotation: action.rotation }));
    case 'setCrop':
      return mapItem(state, action.id, (i) => withCrop(i, action.crop));
    case 'split': {
      const index = state.items.findIndex((i) => i.id === action.id);
      const item = state.items[index];
      if (!item || item.splits.length < 2) return state;
      const parts = item.splits.map((crop) => ({
        ...withCrop(item, crop),
        id: uid('label'),
        autoCrop: crop,
        splits: [],
        warnings: item.warnings.filter((w) => w !== 'multiLabel'),
      }));
      const items = [...state.items];
      items.splice(index, 1, ...parts);
      return { ...state, items };
    }
    case 'toggleOwnSheet':
      return mapItem(state, action.id, (i) => ({ ...i, ownSheet: !i.ownSheet }));
    case 'clear':
      return { ...state, items: [], issues: [] };
    case 'settings':
      return { ...state, settings: { ...state.settings, ...action.patch } };
  }
}
