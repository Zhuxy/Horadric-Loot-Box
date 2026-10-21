import type { D2Item } from '../../src/core';
import { desc, docLabel, itemKey } from '../../src/state/store';
import { useStore } from '../../src/ui/context';
import { ItemFace } from '../../src/ui/ItemArt';
import { Tile, QName } from './parts';
import type { ItemRef } from './ItemSheet';

/** Positioned item grid (inventory 10x4, stash tabs 10xN). Tap a tile -> item sheet. */
export function ItemGrid({
  items,
  cols,
  docId,
  onTap,
}: {
  items: D2Item[];
  cols: number;
  docId: string;
  onTap: (r: ItemRef) => void;
}) {
  const store = useStore();
  let rows = 4;
  for (const it of items) rows = Math.max(rows, (it.y ?? 0) + (it.def?.h ?? 1));
  return (
    <div className="m-grid10" style={{ gridTemplateColumns: `repeat(${cols},1fr)` }}>
      {Array.from({ length: cols * rows }).map((_, i) => (
        <span key={i} className="m-cell" style={{ visibility: 'hidden' }} aria-hidden />
      ))}
      {items.map((it) => {
        const w = it.def?.w ?? 1;
        const h = it.def?.h ?? 1;
        const d = desc(it);
        const stack = (it as { quantity?: number }).quantity;
        return (
          <button
            key={itemKey(it)}
            className="m-cell"
            style={{
              gridColumn: `${(it.x ?? 0) + 1} / span ${w}`,
              gridRow: `${(it.y ?? 0) + 1} / span ${h}`,
              aspectRatio: 'auto',
              zIndex: 1,
              padding: 2,
            }}
            title={d.name}
            onClick={() => onTap({ item: it, docId })}
          >
            <span style={{ position: 'relative', width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}>
              <ItemFace item={it} width={64} height={64} cell={32} view="art" art={store.art} />
            </span>
            {stack != null && stack > 1 && <span className="m-qty">{stack}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Equipment slot list (SPEC §5.2): vertical rows instead of the desktop paper doll. */
export function EquipList({
  items,
  docId,
  onTap,
  slots,
}: {
  items: D2Item[];
  docId: string;
  onTap: (r: ItemRef) => void;
  slots: { loc: number; label: string }[];
}) {
  return (
    <>
      {slots.map((s) => {
        const it = items.find((i) => i.bodyLoc === s.loc);
        return (
          <button key={s.loc} className="m-slot" onClick={() => it && onTap({ item: it, docId })}>
            <Tile item={it} empty={!it} />
            <span>
              <span className="m-ity">{s.label}</span>
              <br />
              {it ? <QName item={it} /> : <span className="m-ity">—</span>}
            </span>
          </button>
        );
      })}
    </>
  );
}

/** Doc list for pickers (characters + stashes + vaults). */
export function useDocs() {
  const store = useStore();
  return [...store.docs.entries()]
    .filter(([, e]) => e.doc)
    .map(([id, e]) => ({ id, doc: e.doc!, label: docLabel(e.doc, id) }));
}
