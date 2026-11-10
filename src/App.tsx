import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { CropDialog } from './components/CropDialog';
import { DropZone } from './components/DropZone';
import { LabelCard } from './components/LabelCard';
import { SettingsPanel } from './components/SettingsPanel';
import { SheetPreview } from './components/SheetPreview';
import { MESSAGES } from './core/i18n';
import { layout, type LayoutLabel } from './core/layout';
import { effectiveRotation, type LabelItem } from './core/types';
import { CROP_SAFETY_MARGIN_PT, PAPERS, mmToPt, outputFileName, ptToMm } from './core/units';
import { analyzeFile } from './pdf/analyze';
import type { ComposeLabel } from './pdf/compose';
import { getEngine } from './pdf/engine';
import { downloadPdf, isNative, printPdf, sharePdf, type OutputResult } from './platform/output';
import { loadSettings, reducer, saveSettings } from './state/store';

type Step = 1 | 2 | 3;

interface Progress {
  total: number;
  done: number;
  current: string;
}

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({ items: [], issues: [], settings: loadSettings() }));
  const { items, issues, settings } = state;
  const t = MESSAGES[settings.lang];
  const [step, setStep] = useState<Step>(1);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [cropping, setCropping] = useState<LabelItem | null>(null);
  const [pdf, setPdf] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const queue = useRef<File[]>([]);
  const running = useRef(false);
  const stepRef = useRef(step);
  stepRef.current = step;

  // Persist settings, apply theme and language.
  useEffect(() => {
    saveSettings(settings);
    const root = document.documentElement;
    if (settings.theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = settings.theme;
    root.lang = settings.lang;
  }, [settings]);

  // ---------- Step 1: sequential analysis queue (UI stays responsive) ----------
  const processQueue = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    let done = 0;
    let added = 0;
    while (queue.current.length) {
      const file = queue.current.shift()!;
      setProgress((p) => ({ total: p?.total ?? 1, done, current: file.name }));
      await analyzeFile(
        file,
        {
          onItem: (item) => {
            added++;
            dispatch({ type: 'addItem', item });
          },
          onIssue: (issue) => dispatch({ type: 'addIssue', issue }),
        },
        (page, pages) => setProgress((p) => p && { ...p, done: done + page / pages }),
      );
      done++;
    }
    running.current = false;
    setProgress(null);
    if (added && stepRef.current === 1) setStep(2);
  }, []);

  const onFiles = (files: File[]) => {
    queue.current.push(...files);
    setProgress((p) => ({ total: (p?.total ?? 0) + files.length, done: p?.done ?? 0, current: p?.current ?? files[0].name }));
    void processQueue();
  };

  // ---------- Step 2: layout (pure, cheap: recomputed on every change) ----------
  const paper = PAPERS[settings.paper];
  const layoutOpts = useMemo(
    () => ({ paper, marginPt: mmToPt(settings.marginMm), gapPt: mmToPt(settings.gapMm), paddingPt: mmToPt(settings.paddingMm) }),
    [paper, settings.marginMm, settings.gapMm, settings.paddingMm],
  );
  const result = useMemo(() => {
    const labels: LayoutLabel[] = items.map((i) => ({
      id: i.id,
      width: i.crop.width,
      height: i.crop.height,
      rotation: effectiveRotation(i),
      ownSheet: i.ownSheet,
      marginPt: CROP_SAFETY_MARGIN_PT,
    }));
    return layout(labels, settings.grid, layoutOpts);
  }, [items, settings.grid, layoutOpts]);
  const indexOf = useMemo(() => new Map(items.map((i, n) => [i.id, n + 1])), [items]);

  // ---------- Step 3: compose in the worker (debounced) ----------
  const grayscale = settings.colorMode === 'grayscale';
  useEffect(() => {
    if (step !== 3 || !items.length) return;
    let stale = false;
    setBusy(true);
    const timer = setTimeout(async () => {
      const labels: Record<string, ComposeLabel> = {};
      for (const i of items) labels[i.id] = { sourceId: i.sourceId, pageIndex: i.pageIndex, crop: i.crop, rotation: effectiveRotation(i) };
      try {
        const bytes = await getEngine().compose({ paper, sheets: result.sheets, labels, cutLines: settings.cutLines, grayscale, title: outputFileName() });
        if (!stale) setPdf(bytes);
      } catch (e) {
        if (!stale) setStatus(`${t.error}: ${String(e)}`);
      } finally {
        if (!stale) setBusy(false);
      }
    }, 200);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [step, items, result, paper, settings.cutLines, grayscale, t]);

  const runOutput = async (fn: (b: Uint8Array, name: string, title: string) => Promise<OutputResult>, kind: 'download' | 'share' | 'print') => {
    if (!pdf) return;
    const res = await fn(pdf, outputFileName(), outputFileName());
    if (res === 'fallback-download') setStatus(t.sharedFallback);
    else if (res === 'native-share' && kind === 'print') setStatus(t.nativePrintHint);
    else if (res === 'done' && kind === 'download') setStatus(isNative() ? t.savedDocuments : t.saved);
    else setStatus('');
  };

  const gridName = `${result.grid.cols}×${result.grid.rows}`;
  const steps: Array<[Step, string]> = [
    [1, t.stepUpload],
    [2, t.stepReview],
    [3, t.stepOutput],
  ];

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <img src="./icon.svg" alt="" width="32" height="32" />
          <div>
            <h1>LabelSheet</h1>
            <p className="muted small">{t.appTagline}</p>
          </div>
        </div>
        <nav aria-label="Steps">
          <ol className="stepper">
            {steps.map(([n, label]) => (
              <li key={n}>
                <button
                  type="button"
                  className={step === n ? 'current' : ''}
                  aria-current={step === n ? 'step' : undefined}
                  disabled={n > 1 && !items.length}
                  onClick={() => setStep(n)}
                >
                  <span className="num">{n}</span> {label}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </header>

      <main>
        {progress && (
          <div className="progress" role="status" aria-live="polite">
            <div className="progress-text">
              {t.processing} {Math.min(Math.floor(progress.done) + 1, progress.total)}/{progress.total}: {progress.current}
            </div>
            <progress max={progress.total} value={progress.done} />
          </div>
        )}

        {issues.length > 0 && (
          <details className="issues" open={step === 1}>
            <summary>
              ⚠ {t.issues} ({issues.length})
            </summary>
            <ul>
              {issues.map((i, n) => (
                <li key={n}>
                  <strong>{i.fileName}</strong>
                  {i.page ? ` (${t.page} ${i.page})` : ''}: {t[`issue_${i.code}`]}
                </li>
              ))}
            </ul>
          </details>
        )}

        {step === 1 && (
          <section aria-labelledby="s1">
            <h2 id="s1" className="sr-only">{t.stepUpload}</h2>
            <DropZone t={t} onFiles={onFiles} />
            {items.length > 0 && (
              <div className="bar">
                <span>{t.labelsCount(items.length)}</span>
                <button type="button" className="btn" onClick={() => dispatch({ type: 'clear' })}>
                  {t.clearAll}
                </button>
                <button type="button" className="btn primary" onClick={() => setStep(2)}>
                  {t.next} →
                </button>
              </div>
            )}
          </section>
        )}

        {step === 2 && (
          <section aria-labelledby="s2" className="review">
            <h2 id="s2" className="sr-only">{t.stepReview}</h2>
            <div className="review-main">
              {items.length ? (
                <>
                  <p className="summary" aria-live="polite">
                    {t.summary(items.length, result.sheets.length, gridName)}
                  </p>
                  {result.close.map((c, n) => (
                    <p key={n} className="warn small">
                      ⚠ {t.closeWarning(`#${indexOf.get(c.a)}`, `#${indexOf.get(c.b)}`, ptToMm(c.distancePt).toFixed(1))}
                    </p>
                  ))}
                  <ul className="cards">
                    {items.map((item, n) => (
                      <LabelCard
                        key={item.id}
                        t={t}
                        item={item}
                        index={n}
                        total={items.length}
                        scale={result.scales[item.id]}
                        dispatch={dispatch}
                        onCrop={setCropping}
                      />
                    ))}
                  </ul>
                </>
              ) : (
                <p>{t.emptyReview}</p>
              )}
            </div>
            <aside className="review-side">
              <SettingsPanel t={t} settings={settings} dispatch={dispatch} />
            </aside>
            <div className="bar sticky">
              <button type="button" className="btn" onClick={() => setStep(1)}>
                ← {t.back}
              </button>
              <span className="muted">{t.sheetsCount(result.sheets.length)}</span>
              <button type="button" className="btn primary" disabled={!items.length} onClick={() => setStep(3)}>
                {t.next} →
              </button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section aria-labelledby="s3" className="output">
            <h2 id="s3" className="sr-only">{t.stepOutput}</h2>
            <p className="reminder" role="note">
              🖨 {t.printReminder}
            </p>
            <div className="bar">
              <button type="button" className="btn primary big" disabled={!pdf || busy} onClick={() => runOutput(downloadPdf, 'download')}>
                ⬇ {t.download}
              </button>
              <button type="button" className="btn big" disabled={!pdf || busy} onClick={() => runOutput(sharePdf, 'share')}>
                ⇪ {t.share}
              </button>
              <button type="button" className="btn big" disabled={!pdf || busy} onClick={() => runOutput(printPdf, 'print')}>
                🖨 {t.print}
              </button>
            </div>
            <p className="muted small" aria-live="polite">
              {busy ? t.generating : `${outputFileName()} · ${t.summary(items.length, result.sheets.length, gridName)}`}
            </p>
            {status && (
              <p className="note" role="status">
                {status}
              </p>
            )}
            {pdf && <SheetPreview t={t} bytes={pdf} />}
            <div className="bar">
              <button type="button" className="btn" onClick={() => setStep(2)}>
                ← {t.back}
              </button>
            </div>
          </section>
        )}
      </main>

      <footer className="privacy">
        <p className="small">🔒 {t.privacy}</p>
      </footer>

      {cropping && (
        <CropDialog
          t={t}
          item={cropping}
          onClose={() => setCropping(null)}
          onApply={(crop) => {
            dispatch({ type: 'setCrop', id: cropping.id, crop });
            setCropping(null);
          }}
        />
      )}
    </div>
  );
}
