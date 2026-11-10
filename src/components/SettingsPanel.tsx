import type { Dispatch } from 'react';
import type { Messages } from '../core/i18n';
import type { GridId, Lang, PaperName, Settings, ThemePref } from '../core/types';
import type { Action } from '../state/store';

interface Props {
  t: Messages;
  settings: Settings;
  dispatch: Dispatch<Action>;
}

const GRID_IDS: GridId[] = ['auto', '2x2', '2x3', '1x2', '1x3'];

function NumberField({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        max={30}
        step={0.5}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= 0) onChange(Math.min(v, 30));
        }}
      />
    </div>
  );
}

export function SettingsPanel({ t, settings, dispatch }: Props) {
  const set = (patch: Partial<Settings>) => dispatch({ type: 'settings', patch });
  return (
    <section className="panel" aria-labelledby="settings-title">
      <h2 id="settings-title">{t.settings}</h2>
      <fieldset className="field">
        <legend>{t.grid}</legend>
        <div className="segmented" role="radiogroup" aria-label={t.grid}>
          {GRID_IDS.map((g) => (
            <label key={g} className={settings.grid === g ? 'on' : ''}>
              <input type="radio" name="grid" value={g} checked={settings.grid === g} onChange={() => set({ grid: g })} />
              {g === 'auto' ? t.gridAuto : g.replace('x', '×')}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor="paper">{t.paper}</label>
        <select id="paper" value={settings.paper} onChange={(e) => set({ paper: e.target.value as PaperName })}>
          <option value="A4">A4 (210 × 297 mm)</option>
          <option value="Letter">Letter (8.5 × 11 in)</option>
        </select>
      </div>
      <div className="row3">
        <NumberField id="margin" label={t.margin} value={settings.marginMm} onChange={(v) => set({ marginMm: v })} />
        <NumberField id="gap" label={t.gap} value={settings.gapMm} onChange={(v) => set({ gapMm: v })} />
        <NumberField id="padding" label={t.padding} value={settings.paddingMm} onChange={(v) => set({ paddingMm: v })} />
      </div>
      <label className="check">
        <input type="checkbox" checked={settings.cutLines} onChange={(e) => set({ cutLines: e.target.checked })} />
        {t.cutLines}
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.colorMode === 'grayscale'}
          onChange={(e) => set({ colorMode: e.target.checked ? 'grayscale' : 'color' })}
        />
        {t.grayscale}
      </label>
      <div className="row3">
        <div className="field">
          <label htmlFor="lang">{t.language}</label>
          <select id="lang" value={settings.lang} onChange={(e) => set({ lang: e.target.value as Lang })}>
            <option value="it">Italiano</option>
            <option value="en">English</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="theme">{t.theme}</label>
          <select id="theme" value={settings.theme} onChange={(e) => set({ theme: e.target.value as ThemePref })}>
            <option value="system">{t.themeSystem}</option>
            <option value="light">{t.themeLight}</option>
            <option value="dark">{t.themeDark}</option>
          </select>
        </div>
      </div>
    </section>
  );
}
