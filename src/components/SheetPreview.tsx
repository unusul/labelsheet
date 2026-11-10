import { useEffect, useRef, useState } from 'react';
import type { Messages } from '../core/i18n';
import { openPdf } from '../pdf/pdfjs';

interface Props {
  t: Messages;
  bytes: Uint8Array;
}

/** Renders the generated PDF itself (what you see is exactly what will be printed). */
export function SheetPreview({ t, bytes }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const container = host.current!;
    container.replaceChildren();
    void (async () => {
      const pdf = await openPdf(bytes);
      if (cancelled) return void pdf.destroy();
      setPages(pdf.numPages);
      const dpr = window.devicePixelRatio || 1;
      for (let i = 1; i <= pdf.numPages && !cancelled; i++) {
        const page = await pdf.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const cssWidth = Math.min(420, container.clientWidth || 420);
        const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });
        const figure = document.createElement('figure');
        figure.className = 'sheet';
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${cssWidth}px`;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `${t.sheet} ${i} / ${pdf.numPages}`);
        const caption = document.createElement('figcaption');
        caption.textContent = `${t.sheet} ${i} / ${pdf.numPages}`;
        figure.append(canvas, caption);
        if (cancelled) break;
        container.append(figure);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        page.cleanup();
      }
      await pdf.destroy();
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes, t]);

  return (
    <section aria-label={`${t.preview} (${pages})`}>
      <div ref={host} className="sheets" />
    </section>
  );
}
