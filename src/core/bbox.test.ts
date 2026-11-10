import { describe, expect, it } from 'vitest';
import { coversNearlyFullPage, detectLabelBlocks, findInkBox, greyOverWhite, pixelBoxToPdfRect } from './bbox';

/** White RGBA bitmap with black rectangles painted in. */
function bitmap(width: number, height: number, blacks: Array<[number, number, number, number]> = []) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [left, top, right, bottom] of blacks) {
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const o = (y * width + x) * 4;
        data[o] = data[o + 1] = data[o + 2] = 0;
      }
    }
  }
  return data;
}

describe('greyOverWhite', () => {
  it('treats transparent pixels as white and opaque black as black', () => {
    expect(greyOverWhite(0, 0, 0, 0)).toBe(255);
    expect(greyOverWhite(0, 0, 0, 255)).toBe(0);
    expect(greyOverWhite(255, 255, 255, 255)).toBe(255);
  });
});

describe('findInkBox', () => {
  it('returns null on a blank page', () => {
    expect(findInkBox(bitmap(20, 30), 20, 30).box).toBeNull();
  });

  it('finds the tight box of the ink (right/bottom exclusive)', () => {
    const { box } = findInkBox(bitmap(100, 140, [[10, 5, 30, 20], [50, 60, 61, 70]]), 100, 140);
    expect(box).toEqual({ left: 10, top: 5, right: 61, bottom: 70 });
  });

  it('ignores near-white pixels above the threshold', () => {
    const data = bitmap(10, 10);
    const o = (4 * 10 + 4) * 4;
    data[o] = data[o + 1] = data[o + 2] = 252; // light grey "paper noise"
    expect(findInkBox(data, 10, 10, 250).box).toBeNull();
    expect(findInkBox(data, 10, 10, 254).box).toEqual({ left: 4, top: 4, right: 5, bottom: 5 });
  });

  it('honours the scan region', () => {
    const data = bitmap(40, 40, [[2, 2, 4, 4], [30, 30, 35, 36]]);
    const { box } = findInkBox(data, 40, 40, 250, { left: 20, top: 20, right: 40, bottom: 40 });
    expect(box).toEqual({ left: 30, top: 30, right: 35, bottom: 36 });
  });
});

describe('pixelBoxToPdfRect', () => {
  const a4 = { x: 0, y: 0, width: 595.28, height: 841.89 };

  it('flips the Y axis: a box at the top of the bitmap is at the top of the PDF page', () => {
    // Rendered at 2 px/pt. Ink from (100, 50) to (300, 250) px => 50..150 pt across, 25..125 pt from the top.
    const r = pixelBoxToPdfRect({ left: 100, top: 50, right: 300, bottom: 250 }, 2, a4, 0);
    expect(r.x).toBeCloseTo(50);
    expect(r.width).toBeCloseTo(100);
    expect(r.y).toBeCloseTo(841.89 - 125);
    expect(r.height).toBeCloseTo(100);
  });

  it('adds the safety margin and clamps to the page box', () => {
    const r = pixelBoxToPdfRect({ left: 0, top: 0, right: 100, bottom: 100 }, 1, a4, 2);
    expect(r.x).toBe(0); // clamped
    expect(r.y + r.height).toBeCloseTo(841.89); // clamped at the top
    expect(r.width).toBeCloseTo(102);
    expect(r.y).toBeCloseTo(841.89 - 102);
  });

  it('accounts for a page box not starting at the origin', () => {
    const box = { x: 10, y: 20, width: 200, height: 300 };
    const r = pixelBoxToPdfRect({ left: 0, top: 0, right: 200, bottom: 300 }, 1, box, 0);
    expect(r).toEqual(box);
  });
});

describe('coversNearlyFullPage', () => {
  const page = { x: 0, y: 0, width: 100, height: 100 };
  it('is true only when both sides cover >= 90%', () => {
    expect(coversNearlyFullPage({ x: 0, y: 0, width: 95, height: 92 }, page)).toBe(true);
    expect(coversNearlyFullPage({ x: 0, y: 0, width: 95, height: 50 }, page)).toBe(false);
  });
});

describe('detectLabelBlocks', () => {
  it('splits two labels stacked vertically', () => {
    const data = bitmap(100, 200, [[10, 10, 90, 80], [10, 120, 90, 190]]);
    const scan = findInkBox(data, 100, 200);
    const blocks = detectLabelBlocks(scan, 20, 40);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ top: 10, bottom: 80 });
    expect(blocks[1]).toMatchObject({ top: 120, bottom: 190 });
  });

  it('splits two labels side by side', () => {
    const data = bitmap(200, 100, [[5, 10, 80, 90], [120, 10, 195, 90]]);
    const blocks = detectLabelBlocks(findInkBox(data, 200, 100), 20, 40);
    expect(blocks.map((b) => [b.left, b.right])).toEqual([[5, 80], [120, 195]]);
  });

  it('does not split on a gap that is too narrow or a block that is too small', () => {
    const data = bitmap(100, 200, [[10, 10, 90, 80], [10, 90, 90, 190]]);
    expect(detectLabelBlocks(findInkBox(data, 100, 200), 20, 40)).toEqual([]);
    const small = bitmap(100, 200, [[10, 10, 90, 80], [10, 150, 90, 160]]);
    expect(detectLabelBlocks(findInkBox(small, 100, 200), 20, 40)).toEqual([]);
  });
});
