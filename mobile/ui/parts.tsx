import { useEffect, useState, type ReactNode } from 'react';
import type { D2Item, QualityClass } from '../../src/core';
import { desc } from '../../src/state/store';
import { useStore } from '../../src/ui/context';
import { ItemFace, QUALITY_BORDER } from '../../src/ui/ItemArt';

/** Quality -> text color (desktop palette hex; Tailwind q-* classes aren't generated for the mobile entry). */
export const qText: Record<QualityClass, string> = {
  unique: '#c7b377', runeword: '#c7b377', quest: '#c7b377', gold: '#c7b377',
  set: '#1fdc1f', magic: '#6969ff', rare: '#ffff64', crafted: '#ffa800',
  tempered: '#e07cff', normal: '#e6e0d6', superior: '#e6e0d6',
  inferior: '#8f8f8f', rune: '#ffa033', gem: '#e6e0d6',
};

/** Bottom sheet. */
export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  return (
    <>
      <div className={`m-scrim${open ? ' show' : ''}`} onClick={onClose} />
      <div className={`m-sheet${open ? ' show' : ''}`} role="dialog" aria-hidden={!open}>
        <div className="m-grab" />
        {children}
      </div>
    </>
  );
}

/** Renders store toasts (import results, save confirmations, errors). */
export function Toasts() {
  const store = useStore();
  const [last, setLast] = useState<{ id: number; kind: string; text: string } | null>(null);
  const cur = store.toasts[store.toasts.length - 1];
  useEffect(() => {
    if (!cur || cur.id === last?.id) return;
    setLast(cur);
    const t = setTimeout(() => setLast((l) => (l?.id === cur.id ? null : l)), 2600);
    return () => clearTimeout(t);
  }, [cur, last?.id]);
  return <div className={`m-toast${last ? ' show' : ''}${last?.kind === 'error' ? ' err' : ''}`}>{last?.text}</div>;
}

/** Small item tile: game art when available, glyph fallback otherwise (SPEC §8). */
export function Tile({ item, size = 46, empty }: { item?: D2Item; size?: number; empty?: boolean }) {
  if (empty || !item) return <span className="m-tile empty" style={{ width: size, height: size }}>·</span>;
  const d = desc(item);
  return (
    <span
      className="m-tile"
      style={{ width: size, height: size, borderColor: QUALITY_BORDER[d.qualityClass] ?? undefined }}
      title={d.name}
    >
      <span style={{ position: 'relative', width: '88%', height: '88%', display: 'block' }}>
        <ItemFace item={item} width={size} height={size} cell={size / 2} view="art" art={undefined} />
      </span>
    </span>
  );
}

/** Item name in its quality color. */
export function QName({ item, className = 'm-inm' }: { item: D2Item; className?: string }) {
  const d = desc(item);
  return (
    <span className={className} style={{ color: qText[d.qualityClass] ?? undefined }}>
      {d.name}
    </span>
  );
}

/** One-line type subtitle, e.g. "Long Sword · 1H weapon". */
export function typeSub(item: D2Item): string {
  const d = desc(item);
  return d.baseName && d.baseName !== d.name ? `${d.baseName}` : shortKind(item);
}

function shortKind(item: D2Item): string {
  const code = item.code;
  if (/^r[0-9]{2}$/.test(code)) return 'Rune';
  if (/^g[ms][wvlbyp]$/.test(code)) return 'Gem';
  return item.def?.type ?? '';
}
