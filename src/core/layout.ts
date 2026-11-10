/**
 * Sheet layout: equal cells in a grid, one label per cell, centred, never enlarged.
 *
 *   s = min(1, (cellW - 2*padding) / w, (cellH - 2*padding) / h)
 *
 * where (w, h) is the label size AFTER rotation. Sheets are filled one at a time in label order;
 * labels flagged `ownSheet` get a whole printable area each, appended after the grid sheets.
 */
import type { Grid, GridId, PaperSize, Rect, Rotation } from './types';
import { LOW_SCALE_THRESHOLD, MIN_CUT_DISTANCE_PT } from './units';

export const GRIDS: Record<Exclude<GridId, 'auto'>, Grid> = {
  '2x2': { cols: 2, rows: 2 },
  '2x3': { cols: 2, rows: 3 },
  '1x2': { cols: 1, rows: 2 },
  '1x3': { cols: 1, rows: 3 },
};

export interface LayoutLabel {
  id: string;
  /** Crop size in points, BEFORE rotation. */
  width: number;
  height: number;
  rotation: Rotation;
  ownSheet: boolean;
  /** Safety margin included in the crop (excluded when measuring distances between labels). */
  marginPt?: number;
}

export interface LayoutOptions {
  paper: PaperSize;
  marginPt: number;
  gapPt: number;
  paddingPt: number;
}

export interface Placement {
  id: string;
  /** Displayed box on the sheet (after rotation and scale), PDF coordinates. */
  box: Rect;
  scale: number;
  rotation: Rotation;
  cell: Rect;
}

export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Sheet {
  placements: Placement[];
  /** Dashed cut lines, spanning the whole sheet. */
  cutLines: Line[];
}

export interface CloseLabels {
  sheet: number;
  a: string;
  b: string;
  distancePt: number;
}

export interface LayoutResult {
  grid: Grid;
  sheets: Sheet[];
  /** Scale per label id. */
  scales: Record<string, number>;
  minScale: number;
  close: CloseLabels[];
}

export function rotatedSize(w: number, h: number, rotation: Rotation): [number, number] {
  return rotation === 90 || rotation === 270 ? [h, w] : [w, h];
}

export function fitScale(w: number, h: number, cellW: number, cellH: number, paddingPt: number): number {
  const availW = Math.max(cellW - 2 * paddingPt, 1);
  const availH = Math.max(cellH - 2 * paddingPt, 1);
  return Math.min(1, availW / w, availH / h);
}

/** Cells in reading order (left-to-right, top-to-bottom), PDF coordinates. */
export function cellRects(paper: PaperSize, grid: Grid, marginPt: number, gapPt: number): Rect[] {
  const cellW = (paper.width - 2 * marginPt - (grid.cols - 1) * gapPt) / grid.cols;
  const cellH = (paper.height - 2 * marginPt - (grid.rows - 1) * gapPt) / grid.rows;
  const cells: Rect[] = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const x = marginPt + c * (cellW + gapPt);
      const yTop = paper.height - marginPt - r * (cellH + gapPt);
      cells.push({ x, y: yTop - cellH, width: cellW, height: cellH });
    }
  }
  return cells;
}

/** Cut lines in the middle of the gutters between cells, from edge to edge of the sheet. */
export function cutLinesFor(paper: PaperSize, grid: Grid, marginPt: number, gapPt: number): Line[] {
  const cellW = (paper.width - 2 * marginPt - (grid.cols - 1) * gapPt) / grid.cols;
  const cellH = (paper.height - 2 * marginPt - (grid.rows - 1) * gapPt) / grid.rows;
  const lines: Line[] = [];
  for (let c = 1; c < grid.cols; c++) {
    const x = marginPt + c * cellW + (c - 0.5) * gapPt;
    lines.push({ x1: x, y1: 0, x2: x, y2: paper.height });
  }
  for (let r = 1; r < grid.rows; r++) {
    const y = paper.height - marginPt - r * cellH - (r - 0.5) * gapPt;
    lines.push({ x1: 0, y1: y, x2: paper.width, y2: y });
  }
  return lines;
}

function place(label: LayoutLabel, cell: Rect, paddingPt: number): Placement {
  const [w, h] = rotatedSize(label.width, label.height, label.rotation);
  const scale = fitScale(w, h, cell.width, cell.height, paddingPt);
  const box = {
    x: cell.x + (cell.width - w * scale) / 2,
    y: cell.y + (cell.height - h * scale) / 2,
    width: w * scale,
    height: h * scale,
  };
  return { id: label.id, box, scale, rotation: label.rotation, cell };
}

/** Euclidean distance between two rectangles (0 if they touch or overlap). */
export function rectDistance(a: Rect, b: Rect): number {
  const dx = Math.max(0, b.x - (a.x + a.width), a.x - (b.x + b.width));
  const dy = Math.max(0, b.y - (a.y + a.height), a.y - (b.y + b.height));
  return Math.hypot(dx, dy);
}

function inset(r: Rect, d: number): Rect {
  const dx = Math.min(d, r.width / 2);
  const dy = Math.min(d, r.height / 2);
  return { x: r.x + dx, y: r.y + dy, width: r.width - 2 * dx, height: r.height - 2 * dy };
}

function findCloseLabels(sheets: Sheet[], labels: Map<string, LayoutLabel>): CloseLabels[] {
  const close: CloseLabels[] = [];
  sheets.forEach((sheet, index) => {
    // Measure on the ink, i.e. without the crop safety margin.
    const ink = sheet.placements.map((p) => inset(p.box, (labels.get(p.id)?.marginPt ?? 0) * p.scale));
    for (let i = 0; i < ink.length; i++) {
      for (let j = i + 1; j < ink.length; j++) {
        const d = rectDistance(ink[i], ink[j]);
        if (d < MIN_CUT_DISTANCE_PT) {
          close.push({ sheet: index, a: sheet.placements[i].id, b: sheet.placements[j].id, distancePt: d });
        }
      }
    }
  });
  return close;
}

/** Lays out labels on sheets with a fixed grid. */
export function layoutFixed(labels: LayoutLabel[], grid: Grid, opts: LayoutOptions): LayoutResult {
  const cells = cellRects(opts.paper, grid, opts.marginPt, opts.gapPt);
  const lines = cutLinesFor(opts.paper, grid, opts.marginPt, opts.gapPt);
  const fullArea = cellRects(opts.paper, { cols: 1, rows: 1 }, opts.marginPt, 0)[0];
  const sheets: Sheet[] = [];
  const own: Sheet[] = [];
  let current: Sheet | null = null;
  for (const label of labels) {
    if (label.ownSheet) {
      own.push({ placements: [place(label, fullArea, opts.paddingPt)], cutLines: [] });
      continue;
    }
    if (!current || current.placements.length === cells.length) {
      current = { placements: [], cutLines: lines };
      sheets.push(current);
    }
    current.placements.push(place(label, cells[current.placements.length], opts.paddingPt));
  }
  const all = [...sheets, ...own];
  const scales: Record<string, number> = {};
  for (const s of all) for (const p of s.placements) scales[p.id] = p.scale;
  const values = Object.values(scales);
  const minScale = values.length ? Math.min(...values) : 1;
  const byId = new Map(labels.map((l) => [l.id, l]));
  return { grid, sheets: all, scales, minScale, close: findCloseLabels(all, byId) };
}

/**
 * "Automatic" grid: the grid that needs the fewest sheets while keeping every label at or above
 * the low-scale threshold (barcodes stay readable). Ties are broken by the larger minimum scale.
 * If no grid keeps all labels above the threshold, the one with the largest minimum scale wins
 * (fewer sheets on equal scale).
 */
export function layoutAuto(labels: LayoutLabel[], opts: LayoutOptions): LayoutResult {
  const results = Object.values(GRIDS).map((g) => layoutFixed(labels, g, opts));
  const readable = results.filter((r) => r.minScale >= LOW_SCALE_THRESHOLD - 1e-9);
  const byFewestSheets = (a: LayoutResult, b: LayoutResult) =>
    a.sheets.length - b.sheets.length || b.minScale - a.minScale;
  const byLargestScale = (a: LayoutResult, b: LayoutResult) =>
    b.minScale - a.minScale || a.sheets.length - b.sheets.length;
  return readable.length ? readable.sort(byFewestSheets)[0] : results.sort(byLargestScale)[0];
}

export function layout(labels: LayoutLabel[], gridId: GridId, opts: LayoutOptions): LayoutResult {
  return gridId === 'auto' ? layoutAuto(labels, opts) : layoutFixed(labels, GRIDS[gridId], opts);
}

/**
 * Parameters for pdf-lib `drawPage` so that a crop of size (w, h), scaled by `scale` and rotated
 * CLOCKWISE by `rotation`, fills exactly `box` (its displayed bounding box).
 *
 * pdf-lib applies: translate(x, y) · rotate(ccw) · scale, so the object's origin (its lower-left
 * corner before rotation) must be moved to the right corner of `box`.
 */
export function drawParams(box: Rect, rotation: Rotation): { x: number; y: number; ccwDegrees: number } {
  switch (rotation) {
    case 0:
      return { x: box.x, y: box.y, ccwDegrees: 0 };
    case 90: // (u, v) -> (v, -u): origin goes to the top-left corner
      return { x: box.x, y: box.y + box.height, ccwDegrees: -90 };
    case 180: // (u, v) -> (-u, -v): origin goes to the top-right corner
      return { x: box.x + box.width, y: box.y + box.height, ccwDegrees: 180 };
    case 270: // (u, v) -> (-v, u): origin goes to the bottom-right corner
      return { x: box.x + box.width, y: box.y, ccwDegrees: 90 };
  }
}
