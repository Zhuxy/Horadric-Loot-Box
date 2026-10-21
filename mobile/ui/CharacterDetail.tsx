import { useState } from 'react';
import { ItemMode, StorePage } from '../../src/core';
import type { D2Character, D2Item } from '../../src/core';
import { useStore } from '../../src/ui/context';
import { EquipList, ItemGrid } from './grids';
import { ImportButton } from './ImportFlow';
import type { ItemRef } from './ItemSheet';

const SLOTS = [
  { loc: 1, label: '头盔' },
  { loc: 2, label: '项链' },
  { loc: 4, label: '武器' },
  { loc: 3, label: '护甲' },
  { loc: 5, label: '副手' },
  { loc: 8, label: '腰带' },
  { loc: 10, label: '手套' },
  { loc: 6, label: '戒指' },
  { loc: 7, label: '戒指' },
  { loc: 9, label: '靴子' },
  { loc: 11, label: '切换武器' },
  { loc: 12, label: '切换副手' },
];

const MERC_SLOT_LABEL: Record<number, string> = { 1: '头盔', 3: '护甲', 4: '武器', 5: '副手' };

/** Character detail (SPEC §5.2): 装备 / 背包 / 佣兵 segments. */
export function CharacterDetail({ docId, onTap }: { docId: string; onTap: (r: ItemRef) => void }) {
  const store = useStore();
  const [seg, setSeg] = useState(0);
  const entry = store.docs.get(docId);
  const ch = entry?.doc as D2Character | undefined;
  if (!ch || ch.kind !== 'character') return <div className="m-empty">角色读取失败</div>;

  const equipped = ch.items.filter((i) => i.mode === ItemMode.Equipped);
  const inventory = ch.items.filter((i) => i.mode === ItemMode.Stored && i.page === StorePage.Inventory);
  const hasMerc = ch.hasMerc || ch.mercItems.length > 0;
  const gold = ch.stats?.gold ?? 0;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <ImportButton docId={docId} compact />
      </div>
      <div className="m-seg">
        {['装备', '背包', '佣兵'].map((t, i) => (
          <button key={t} className={seg === i ? 'on' : ''} onClick={() => setSeg(i)}>
            {t}
            {i === 2 && !hasMerc ? ' · 无' : ''}
          </button>
        ))}
      </div>
      {seg === 0 && <EquipList items={equipped} docId={docId} onTap={onTap} slots={SLOTS} />}
      {seg === 1 && (
        <>
          <ItemGrid items={inventory} cols={10} docId={docId} onTap={onTap} />
          <div className="m-gold">金币 {gold.toLocaleString()}</div>
        </>
      )}
      {seg === 2 && <MercPanel ch={ch} docId={docId} onTap={onTap} />}
    </>
  );
}

function MercPanel({ ch, docId, onTap }: { ch: D2Character; docId: string; onTap: (r: ItemRef) => void }) {
  if (!ch.hasMerc && ch.mercItems.length === 0) {
    return <div className="m-empty">尚未雇佣佣兵。<br />去游戏里雇一个，存档后点「同步」重新载入。</div>;
  }
  const slots = [1, 3, 4, 5].map((loc) => ({ loc, label: MERC_SLOT_LABEL[loc] ?? `槽位${loc}` }));
  const items: D2Item[] = ch.mercItems;
  return <EquipList items={items} docId={docId} onTap={onTap} slots={slots} />;
}
