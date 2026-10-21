import { useEffect, useRef } from 'react';
import { itemTypeOf, type D2Item, type Vault } from '../../src/core';
import { desc, itemKey, type GoldRef } from '../../src/state/store';
import { useStore } from '../../src/ui/context';
import { GoldRow } from './gold';
import { ItemIcon, QName } from './parts';
import {
  CATEGORY_FILTERS,
  QUALITY_FILTERS,
  categoryOf,
  filterVault,
  fmt,
  goldAccountLabel,
  vaultDocs,
  type ItemLoc,
  type VaultFilter,
} from './model';

const DOUBLE_TAP_WINDOW = 330;
const MOVE_LIMIT = 9;

/** Rows are not draggable (the list scrolls); single tap opens the sheet, double tap sends to the tray. */
function useRowTaps(onTap: () => void, onDouble: () => void) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const last = useRef<{ at: number }>({ at: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      clearTimeout(timer.current);
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s || s.id !== e.pointerId) return;
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_LIMIT) return;
      const now = Date.now();
      if (now - last.current.at < DOUBLE_TAP_WINDOW) {
        clearTimeout(timer.current);
        last.current = { at: 0 };
        onDouble();
        return;
      }
      last.current = { at: now };
      clearTimeout(timer.current);
      timer.current = setTimeout(onTap, 250);
    },
    onPointerCancel: () => {
      start.current = null;
    },
  };
}

function VaultRow({
  item,
  loc,
  onTap,
  onDouble,
}: {
  item: D2Item;
  loc: ItemLoc;
  onTap: (i: D2Item, l: ItemLoc) => void;
  onDouble: (i: D2Item, l: ItemLoc) => void;
}) {
  const taps = useRowTaps(
    () => onTap(item, loc),
    () => onDouble(item, loc),
  );
  const d = desc(item);
  return (
    <div className="m-vrow" {...taps} key={itemKey(item)}>
      <ItemIcon item={item} />
      <div className="m-vmain">
        <div className="m-vn">
          <QName item={item} />
          {item.ethereal && <span className="m-vtag">（无形）</span>}
        </div>
        <div className="m-vm">
          {itemTypeOf(item.code)} · {CATEGORY_FILTERS.find(([id]) => id === categoryOf(item))?.[1] ?? ''} · 需要等级 {d.requiredLevel}
        </div>
      </div>
      <div className="m-vl">宝库</div>
    </div>
  );
}

/** Vault tab: vault picker, search, quality/type chips, gold pots and the filterable list (SPEC §5.3). */
export function VaultScreen({
  vaultId,
  onVault,
  filter,
  onFilter,
  onOpenFilter,
  charId,
  onTap,
  onDouble,
  onGold,
}: {
  vaultId?: string;
  onVault: (id: string) => void;
  filter: VaultFilter;
  onFilter: (f: VaultFilter) => void;
  onOpenFilter: () => void;
  charId?: string;
  onTap: (item: D2Item, loc: ItemLoc) => void;
  onDouble: (item: D2Item, loc: ItemLoc) => void;
  onGold: (ref: GoldRef) => void;
}) {
  const store = useStore();
  const vaults = vaultDocs(store);
  const current = (vaultId ? vaults.find((v) => v.id === vaultId) : vaults[0]) ?? vaults[0];
  if (!current) return <div className="m-empty">还没有宝库。</div>;
  const vault: Vault = current.vault;
  const list = filterVault(vault.entries, filter);
  const loc: ItemLoc = { docId: current.id, kind: 'vault' };
  const pots = new Set<string>();
  for (const [pot, n] of Object.entries(vault.gold)) if (n > 0) pots.add(pot);
  const currentPot = charId ? store.goldPotOf(charId) : undefined;
  if (currentPot) pots.add(currentPot);
  if (!pots.size) pots.add('rotw-sc');

  return (
    <div className="m-vaultwrap">
      {vaults.length > 1 && (
        <div className="m-docchips">
          {vaults.map(({ id, vault: v }) => (
            <button key={id} className={id === current.id ? 'on' : ''} onClick={() => onVault(id)}>
              {v.name}
            </button>
          ))}
        </div>
      )}
      <div className="m-vsearch">
        <input value={filter.text} onChange={(e) => onFilter({ ...filter, text: e.target.value })} placeholder="搜索名称 / 底材…" />
        <button className="m-fbtn" onClick={onOpenFilter}>
          筛选 ⚙
        </button>
      </div>
      <div className="m-fchips">
        {QUALITY_FILTERS.map(([id, label]) => (
          <button key={id} className={filter.quality === id ? 'on' : ''} onClick={() => onFilter({ ...filter, quality: id })}>
            {label}
          </button>
        ))}
      </div>
      <div className="m-fchips">
        {CATEGORY_FILTERS.map(([id, label]) => (
          <button key={id} className={filter.category === id ? 'on' : ''} onClick={() => onFilter({ ...filter, category: id })}>
            {label}
          </button>
        ))}
      </div>
      <div className="m-vaultgolds">
        {[...pots].sort().map((pot) => {
          const ref: GoldRef = { docId: current.id, kind: 'vault', pot };
          return <GoldRow key={pot} label={goldAccountLabel(store, ref)} amount={store.goldOf(ref)} onClick={() => onGold(ref)} />;
        })}
      </div>
      <div className="m-vcount">共 {list.length} 件 · 单击看属性 · 双击入托盘取出</div>
      <div className="m-vlist">
        {list.map((e) => (
          <VaultRow key={e.uid} item={e.item} loc={loc} onTap={onTap} onDouble={onDouble} />
        ))}
        {list.length === 0 && (
          <div className="m-emptybox">
            没有符合条件的物品
            <br />
            <span>放宽筛选条件试试</span>
          </div>
        )}
      </div>
      <div className="m-vfoot">无限存储 · 当前页 {fmt(vault.entries.length)} 件</div>
    </div>
  );
}
