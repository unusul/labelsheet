import type { Dispatch } from 'react';
import type { Messages } from '../core/i18n';
import { effectiveRotation, type LabelItem, type Rotation } from '../core/types';
import { LOW_SCALE_THRESHOLD } from '../core/units';
import type { Action } from '../state/store';
import { Thumb } from './Thumb';

interface Props {
  t: Messages;
  item: LabelItem;
  index: number;
  total: number;
  scale: number | undefined;
  dispatch: Dispatch<Action>;
  onCrop: (item: LabelItem) => void;
}

export function LabelCard({ t, item, index, total, scale, dispatch, onCrop }: Props) {
  const rotation = effectiveRotation(item);
  const name = `${item.fileName}${item.pageCount > 1 ? ` · ${t.page} ${item.pageIndex + 1}/${item.pageCount}` : ''}`;
  const low = scale !== undefined && scale < LOW_SCALE_THRESHOLD;
  const nextRotation = ((rotation + 90) % 360) as Rotation;
  const act = (action: Action) => () => dispatch(action);

  return (
    <li className="card" aria-label={`${index + 1}. ${name}`}>
      <div className="card-thumb">
        <Thumb preview={item.preview} pageBox={item.pageBox} crop={item.crop} rotation={rotation} alt={name} />
      </div>
      <div className="card-body">
        <div className="card-title" title={name}>
          <span className="badge">{index + 1}</span> {name}
        </div>
        <div className="card-meta">
          {scale !== undefined && (
            <span className={`scale${low ? ' low' : ''}`} title={low ? t.lowScale : undefined}>
              {t.scale} {Math.round(scale * 100)}%
            </span>
          )}
          <span className="muted small">
            {rotation}° {item.rotation === null ? `(${t.rotationAuto})` : ''}
          </span>
        </div>
        {low && <p className="warn small" role="note">⚠ {t.lowScale}</p>}
        {item.warnings.map((w) => (
          <p key={w} className="note small">
            ℹ {t[`warn_${w}`]}
          </p>
        ))}
        <div className="card-actions">
          <button type="button" className="btn" onClick={act({ type: 'rotate', id: item.id, rotation: nextRotation })} aria-label={`${t.rotate} (${rotation}° → ${nextRotation}°)`}>
            ↻ {rotation}°
          </button>
          {item.rotation !== null && (
            <button type="button" className="btn" onClick={act({ type: 'rotate', id: item.id, rotation: null })}>
              {t.resetRotation}
            </button>
          )}
          <button type="button" className="btn" onClick={() => onCrop(item)}>
            ✂ {t.crop}
          </button>
          {item.splits.length > 1 && (
            <button type="button" className="btn accent" onClick={act({ type: 'split', id: item.id })}>
              ⊞ {t.split} ({item.splits.length})
            </button>
          )}
          <label className="check">
            <input type="checkbox" checked={item.ownSheet} onChange={act({ type: 'toggleOwnSheet', id: item.id })} />
            {t.ownSheet}
          </label>
        </div>
        <div className="card-actions">
          <button type="button" className="btn icon" disabled={index === 0} onClick={act({ type: 'move', id: item.id, delta: -1 })} aria-label={t.moveUp} title={t.moveUp}>
            ↑
          </button>
          <button type="button" className="btn icon" disabled={index === total - 1} onClick={act({ type: 'move', id: item.id, delta: 1 })} aria-label={t.moveDown} title={t.moveDown}>
            ↓
          </button>
          <button type="button" className="btn" onClick={act({ type: 'duplicate', id: item.id })}>
            ⧉ {t.duplicate}
          </button>
          <button type="button" className="btn danger" onClick={act({ type: 'remove', id: item.id })}>
            ✕ {t.remove}
          </button>
        </div>
      </div>
    </li>
  );
}
