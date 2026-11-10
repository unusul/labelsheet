import { useEffect, useRef } from 'react';
import type { Rect, Rotation } from '../core/types';

const images = new Map<string, Promise<HTMLImageElement>>();

/** Decoded page previews, shared by all labels cut from the same page. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  let p = images.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
    images.set(src, p);
  }
  return p;
}

interface Props {
  preview: string;
  pageBox: Rect;
  crop: Rect;
  rotation: Rotation;
  maxSize?: number;
  alt: string;
}

/** Crop of the page preview, rotated as it will be printed. */
export function Thumb({ preview, pageBox, crop, rotation, maxSize = 200, alt }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let alive = true;
    void loadImage(preview).then((img) => {
      const canvas = ref.current;
      if (!alive || !canvas) return;
      const kx = img.naturalWidth / pageBox.width;
      const ky = img.naturalHeight / pageBox.height;
      const sx = (crop.x - pageBox.x) * kx;
      const sy = (pageBox.y + pageBox.height - crop.y - crop.height) * ky; // PDF Y up -> image Y down
      const sw = crop.width * kx;
      const sh = crop.height * ky;
      const swap = rotation === 90 || rotation === 270;
      const k = maxSize / Math.max(crop.width, crop.height);
      const dw = crop.width * k;
      const dh = crop.height * k;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round((swap ? dh : dw) * dpr);
      canvas.height = Math.round((swap ? dw : dh) * dpr);
      canvas.style.width = `${swap ? dh : dw}px`;
      canvas.style.height = `${swap ? dw : dh}px`;
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate((swap ? dh : dw) / 2, (swap ? dw : dh) / 2);
      ctx.rotate((rotation * Math.PI) / 180); // canvas Y points down: positive = clockwise
      ctx.drawImage(img, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
    });
    return () => {
      alive = false;
    };
  }, [preview, pageBox, crop, rotation, maxSize]);

  return <canvas ref={ref} className="thumb" role="img" aria-label={alt} />;
}
