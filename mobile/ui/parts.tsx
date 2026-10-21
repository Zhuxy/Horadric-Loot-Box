import { useEffect, type ReactNode } from 'react';
import type { D2Item, QualityClass } from '../../src/core';
import { desc } from '../../src/state/store';
import { useStore } from '../../src/ui/context';
import { ItemThumb } from '../../src/ui/ItemArt';

/** Quality colours from the desktop recipe (SPEC §4). */
export const qText: Record<QualityClass, string> = {
  unique: '#c7b377',
  runeword: '#c7b377',
  quest: '#c7b377',
  gold: '#c7b377',
  set: '#1fdc1f',
  magic: '#6969ff',
  rare: '#ffff64',
  crafted: '#ff8c1a',
  tempered: '#e07cff',
  normal: '#e8e0cc',
  superior: '#e8e0cc',
  inferior: '#8f8f8f',
  rune: '#ffa033',
  gem: '#b48ce8',
};

/** Bottom sheet, styled like the prototype's panel. */
export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  return (
    <div className={`m-sheetwrap${open ? ' on' : ''}`}>
      <div className="m-sheet-bg" onClick={onClose} />
      <div className="m-sheet" role="dialog" aria-hidden={!open}>
        <div className="m-grab" />
        {children}
      </div>
    </div>
  );
}

/** Renders the newest store toast. */
export function Toasts() {
  const store = useStore();
  const current = store.toasts[store.toasts.length - 1];
  return <div className={`m-toast${current ? ' on' : ''}${current?.kind === 'error' ? ' m-err' : ''}`}>{current?.text}</div>;
}

/** Item name in its quality colour. */
export function QName({ item, className = 'm-inm' }: { item: D2Item; className?: string }) {
  const d = desc(item);
  return (
    <span className={className} style={{ color: qText[d.qualityClass] ?? undefined }}>
      {d.name}
    </span>
  );
}

/** Small item picture for lists and sheets. */
export function ItemIcon({ item, size = 42 }: { item: D2Item; size?: number }) {
  return (
    <span className="m-vic" style={{ width: size, height: size }}>
      <ItemThumb item={item} size={size - 4} />
    </span>
  );
}

/** One-line base/type subtitle. */
export function typeSub(item: D2Item): string {
  const d = desc(item);
  const def = item.def;
  if (def && d.baseName && d.baseName !== d.name) return def.name;
  return def?.type ?? d.baseName;
}
