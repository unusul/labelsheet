import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Messages } from '../core/i18n';
import type { LabelItem, Rect } from '../core/types';

interface Props {
  t: Messages;
  item: LabelItem;
  onApply: (crop: Rect) => void;
  onClose: () => void;
}

const MIN_SIZE_PT = 20;
const STEP_PT = 2;

function clampRect(r: Rect, page: Rect): Rect {
  const width = Math.min(Math.max(r.width, MIN_SIZE_PT), page.width);
  const height = Math.min(Math.max(r.height, MIN_SIZE_PT), page.height);
  const x = Math.min(Math.max(r.x, page.x), page.x + page.width - width);
  const y = Math.min(Math.max(r.y, page.y), page.y + page.height - height);
  return { x, y, width, height };
}

/** Manual crop on the page preview. Works with mouse, touch (pointer events) and keyboard. */
export function CropDialog({ t, item, onApply, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect>(item.crop);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const page = item.pageBox;

  useEffect(() => {
    const d = dialog.current;
    d?.showModal();
    return () => d?.close();
  }, []);

  /** Pointer position -> PDF point (Y flipped). */
  const toPdf = (e: PointerEvent): { x: number; y: number } => {
    const b = area.current!.getBoundingClientRect();
    const fx = Math.min(Math.max((e.clientX - b.left) / b.width, 0), 1);
    const fy = Math.min(Math.max((e.clientY - b.top) / b.height, 0), 1);
    return { x: page.x + fx * page.width, y: page.y + (1 - fy) * page.height };
  };

  const onDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = toPdf(e);
  };
  const onMove = (e: PointerEvent) => {
    if (!drag.current) return;
    const p = toPdf(e);
    const a = drag.current;
    setRect({ x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), width: Math.abs(p.x - a.x), height: Math.abs(p.y - a.y) });
  };
  const onUp = () => {
    drag.current = null;
    setRect((r) => clampRect(r, page));
  };

  const onKey = (e: KeyboardEvent) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (!d) return;
    e.preventDefault();
    const [dx, dy] = d.map((v) => v * STEP_PT * (e.altKey ? 5 : 1));
    setRect((r) =>
      clampRect(e.shiftKey ? { ...r, y: r.y - dy, width: r.width + dx, height: r.height + dy } : { ...r, x: r.x + dx, y: r.y + dy }, page),
    );
  };

  const pct = {
    left: `${((rect.x - page.x) / page.width) * 100}%`,
    top: `${((page.y + page.height - rect.y - rect.height) / page.height) * 100}%`,
    width: `${(rect.width / page.width) * 100}%`,
    height: `${(rect.height / page.height) * 100}%`,
  };

  return (
    <dialog ref={dialog} className="crop-dialog" aria-labelledby="crop-title" onCancel={onClose}>
      <h2 id="crop-title">{t.cropTitle}</h2>
      <p className="muted small">{t.cropHelp}</p>
      <div
        ref={area}
        className="crop-area"
        style={{ aspectRatio: `${page.width} / ${page.height}` }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <img src={item.preview} alt="" draggable={false} />
        <div
          className="crop-rect"
          style={pct}
          tabIndex={0}
          role="slider"
          aria-label={t.cropTitle}
          aria-valuetext={`x ${Math.round(rect.x)}, y ${Math.round(rect.y)}, ${Math.round(rect.width)} × ${Math.round(rect.height)} pt`}
          onKeyDown={onKey}
        />
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={() => setRect(item.autoCrop)}>
          {t.cropAuto}
        </button>
        <button type="button" className="btn" onClick={() => setRect({ ...page })}>
          {t.cropFull}
        </button>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          {t.cancel}
        </button>
        <button type="button" className="btn primary" onClick={() => onApply(clampRect(rect, page))}>
          {t.apply}
        </button>
      </div>
    </dialog>
  );
}
