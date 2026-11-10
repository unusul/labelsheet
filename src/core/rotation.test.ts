import { describe, expect, it } from 'vitest';
import { autoRotation, dominantTextAngle, normalizeRotation } from './rotation';

const item = (str: string, angleDeg: number) => {
  const t = (angleDeg * Math.PI) / 180;
  return { str, transform: [Math.cos(t) * 10, Math.sin(t) * 10, -Math.sin(t) * 10, Math.cos(t) * 10, 0, 0] };
};

describe('normalizeRotation', () => {
  it('snaps to quarter turns in [0, 360)', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(89.6)).toBe(90);
    expect(normalizeRotation(-180)).toBe(180);
  });
});

describe('dominantTextAngle', () => {
  it('is null without enough text', () => {
    expect(dominantTextAngle([item('ab', 0)])).toBeNull();
  });
  it('weights by number of characters', () => {
    expect(dominantTextAngle([item('SHORT', 0), item('A MUCH LONGER ADDRESS LINE', 90)])).toBe(90);
    expect(dominantTextAngle([item('Mario Rossi, Via Roma 1', 0), item('123', 270)])).toBe(0);
  });
});

describe('autoRotation', () => {
  it('uses the text direction when available, even for a portrait label (DPD A6 stays upright)', () => {
    expect(autoRotation(0, 0, 283, 413)).toBe(0);
  });
  it('rotates a label saved sideways (text running bottom-to-top) clockwise by 90°', () => {
    expect(autoRotation(90, 0, 238, 327)).toBe(90);
  });
  it('without text: turns taller-than-wide content into landscape (clockwise)', () => {
    expect(autoRotation(null, 0, 200, 400)).toBe(90);
    expect(autoRotation(null, 0, 400, 200)).toBe(0);
  });
  it('without text: honours the page /Rotate', () => {
    // Raw content 400x200 shown rotated 90° by the page => shown as 200x400 => +90 => 180.
    expect(autoRotation(null, 90, 400, 200)).toBe(180);
    expect(autoRotation(null, 90, 200, 400)).toBe(90);
  });
});
