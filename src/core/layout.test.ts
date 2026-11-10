import { describe, expect, it } from 'vitest';
import { cellRects, cutLinesFor, drawParams, fitScale, layout, layoutFixed, rectDistance, type LayoutLabel, type LayoutOptions } from './layout';
import { PAPERS, mmToPt } from './units';
import type { Rotation } from './types';

/** Default app settings: no sheet margin, no gap, 1.4 mm padding per side. */
const opts: LayoutOptions = { paper: PAPERS.A4, marginPt: 0, gapPt: 0, paddingPt: mmToPt(1.4) };

let n = 0;
const label = (width: number, height: number, rotation: Rotation = 0, ownSheet = false): LayoutLabel => ({
  id: `l${n++}`, width, height, rotation, ownSheet, marginPt: 2,
});

describe('fitScale', () => {
  it('never enlarges', () => {
    expect(fitScale(100, 100, 300, 400, 0)).toBe(1);
  });
  it('applies s = min(1, (cw - margin)/w, (ch - margin)/h)', () => {
    expect(fitScale(400, 100, 300, 400, 10)).toBeCloseTo(280 / 400);
    expect(fitScale(100, 800, 300, 400, 10)).toBeCloseTo(380 / 800);
  });
});

describe('cellRects / cut lines', () => {
  it('builds equal cells in reading order, origin bottom-left', () => {
    const cells = cellRects(PAPERS.A4, { cols: 2, rows: 2 }, 10, 6);
    expect(cells).toHaveLength(4);
    const w = (595.28 - 20 - 6) / 2;
    const h = (841.89 - 20 - 6) / 2;
    expect(cells[0]).toMatchObject({ x: 10, width: w, height: h });
    expect(cells[0].y + h).toBeCloseTo(841.89 - 10); // first cell is at the top
    expect(cells[1].x).toBeCloseTo(10 + w + 6);
    expect(cells[2].y).toBeCloseTo(10);
  });
  it('puts cut lines in the middle of the gutters, across the whole sheet', () => {
    const lines = cutLinesFor(PAPERS.A4, { cols: 2, rows: 2 }, 0, 0);
    expect(lines).toEqual([
      { x1: 595.28 / 2, y1: 0, x2: 595.28 / 2, y2: 841.89 },
      { x1: 0, y1: 841.89 / 2, x2: 595.28, y2: 841.89 / 2 },
    ]);
  });
});

describe('layoutFixed', () => {
  it('acceptance: DPD labels + Poste label fit on ONE A4 2x2, DPD at 100%, Poste at ~88%', () => {
    const dpd = [label(283, 413), label(283, 413), label(283, 413)];
    const poste = label(327, 238);
    const r = layoutFixed([...dpd, poste], { cols: 2, rows: 2 }, opts);
    expect(r.sheets).toHaveLength(1);
    for (const d of dpd) expect(r.scales[d.id]).toBeCloseTo(1, 3);
    expect(r.scales[poste.id]).toBeGreaterThan(0.87);
    expect(r.scales[poste.id]).toBeLessThan(0.9);
  });

  it('acceptance: 9 labels on 2x2 give 3 sheets (4 + 4 + 1), filled in order', () => {
    const labels = Array.from({ length: 9 }, () => label(200, 150));
    const r = layoutFixed(labels, { cols: 2, rows: 2 }, opts);
    expect(r.sheets.map((s) => s.placements.length)).toEqual([4, 4, 1]);
    expect(r.sheets[0].placements.map((p) => p.id)).toEqual(labels.slice(0, 4).map((l) => l.id));
  });

  it('centres the label in its cell and swaps width/height for 90/270', () => {
    const l = label(400, 200, 90);
    const [p] = layoutFixed([l], { cols: 1, rows: 1 }, opts).sheets[0].placements;
    expect(p.box.width).toBeCloseTo(200);
    expect(p.box.height).toBeCloseTo(400);
    expect(p.box.x + p.box.width / 2).toBeCloseTo(595.28 / 2);
    expect(p.box.y + p.box.height / 2).toBeCloseTo(841.89 / 2);
  });

  it('puts own-sheet labels on their own sheet after the grid sheets', () => {
    const a = label(100, 100);
    const big = label(595, 842, 0, true);
    const b = label(100, 100);
    const r = layoutFixed([a, big, b], { cols: 2, rows: 2 }, opts);
    expect(r.sheets.map((s) => s.placements.map((p) => p.id))).toEqual([[a.id, b.id], [big.id]]);
    expect(r.sheets[1].cutLines).toEqual([]);
  });

  it('warns when two labels are closer than 4 mm (measured on the ink)', () => {
    const tight = layoutFixed([label(297, 300), label(297, 300)], { cols: 2, rows: 1 }, { ...opts, paddingPt: 0 });
    expect(tight.close).toHaveLength(1);
    const loose = layoutFixed([label(250, 300), label(250, 300)], { cols: 2, rows: 1 }, opts);
    expect(loose.close).toHaveLength(0);
  });
});

describe('layout auto', () => {
  it('chooses the grid with fewer sheets as long as labels stay >= 80%', () => {
    // 6 small labels: 2x3 fits them all on one sheet at 100%.
    const r = layout(Array.from({ length: 6 }, () => label(250, 200)), 'auto', opts);
    expect(r.grid).toEqual({ cols: 2, rows: 3 });
    expect(r.sheets).toHaveLength(1);
  });

  it('does not shrink barcodes below 80% just to save a sheet', () => {
    // 6 DPD portrait labels: 2x3 would need ~66%, so 2x2 (100%) wins with 2 sheets.
    const r = layout(Array.from({ length: 6 }, () => label(283, 413)), 'auto', opts);
    expect(r.grid).toEqual({ cols: 2, rows: 2 });
    expect(r.minScale).toBeCloseTo(1, 3);
  });
});

describe('rectDistance', () => {
  it('is 0 for touching rects and euclidean for diagonal ones', () => {
    expect(rectDistance({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 5, height: 5 })).toBe(0);
    expect(rectDistance({ x: 0, y: 0, width: 10, height: 10 }, { x: 13, y: 14, width: 5, height: 5 })).toBe(5);
  });
});

describe('drawParams', () => {
  /** Applies pdf-lib's translate · rotate(ccw) to the corners of a w x h object and returns their bbox. */
  function placedBox(w: number, h: number, rotation: Rotation, box = { x: 100, y: 200, width: 0, height: 0 }) {
    const [bw, bh] = rotation % 180 ? [h, w] : [w, h];
    const target = { ...box, width: bw, height: bh };
    const { x, y, ccwDegrees } = drawParams(target, rotation);
    const t = (ccwDegrees * Math.PI) / 180;
    const pts = [[0, 0], [w, 0], [0, h], [w, h]].map(([u, v]) => [
      x + u * Math.cos(t) - v * Math.sin(t),
      y + u * Math.sin(t) + v * Math.cos(t),
    ]);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { target, got: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) } };
  }

  for (const rotation of [0, 90, 180, 270] as Rotation[]) {
    it(`maps the object exactly onto its box for ${rotation}° clockwise`, () => {
      const { target, got } = placedBox(300, 120, rotation);
      expect(got.x).toBeCloseTo(target.x);
      expect(got.y).toBeCloseTo(target.y);
      expect(got.width).toBeCloseTo(target.width);
      expect(got.height).toBeCloseTo(target.height);
    });
  }

  it('90° clockwise sends the top-left corner of the content to the top-right', () => {
    // Content point (0, h) = top-left. After a clockwise quarter turn it must be at the top-right.
    const w = 300, h = 120;
    const box = { x: 0, y: 0, width: h, height: w };
    const { x, y } = drawParams(box, 90);
    // rotate -90: (u, v) -> (v, -u)
    expect([x + h, y - 0]).toEqual([box.x + box.width, box.y + box.height]);
  });
});
