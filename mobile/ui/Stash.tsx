import { useState } from 'react';
import { StashTabType, type D2SharedStash } from '../../src/core';
import { useStore } from '../../src/ui/context';
import { ItemGrid } from './grids';
import { ImportButton } from './ImportFlow';
import type { ItemRef } from './ItemSheet';

/** Shared stash (SPEC §5.3): tab chips + grid + gold. */
export function Stash({ docId, onTap }: { docId: string; onTap: (r: ItemRef) => void }) {
  const store = useStore();
  const [tab, setTab] = useState(0);
  const entry = store.docs.get(docId);
  const stash = entry?.doc as D2SharedStash | undefined;
  if (!stash || stash.kind !== 'stash') return <div className="m-empty">仓库读取失败</div>;

  const itemTabs = stash.tabs.map((t, i) => ({ t, i })).filter(({ t }) => t.type === StashTabType.Normal);
  const cur = itemTabs[Math.min(tab, itemTabs.length - 1)];

  return (
    <>
      <ImportButton docId={docId} />
      <div className="m-chips">
        {itemTabs.map(({ i }, k) => (
          <button key={i} className={`m-chip${k === Math.min(tab, itemTabs.length - 1) ? ' on' : ''}`} onClick={() => setTab(k)}>
            Tab {i + 1}
          </button>
        ))}
      </div>
      {cur ? (
        <>
          <ItemGrid items={cur.t.items} cols={10} docId={docId} onTap={onTap} />
          <div className="m-gold">金币 {cur.t.gold.toLocaleString()}</div>
        </>
      ) : (
        <div className="m-empty">没有物品页</div>
      )}
    </>
  );
}
