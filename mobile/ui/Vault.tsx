import { useMemo, useState } from 'react';
import type { D2Item, VaultEntry } from '../../src/core';
import { desc } from '../../src/state/store';
import { useStore } from '../../src/ui/context';
import { Tile, QName, typeSub } from './parts';
import { ImportButton } from './ImportFlow';
import type { ItemRef } from './ItemSheet';

const CATS = [
  { id: 'all', label: '全部' },
  { id: 'unique', label: '暗金' },
  { id: 'set', label: '套装' },
  { id: 'rare', label: '亮金' },
  { id: 'magic', label: '魔法' },
  { id: 'rune', label: '符文' },
  { id: 'gem', label: '宝石' },
  { id: 'charm', label: '护身符' },
] as const;

function catOf(item: D2Item): string {
  const d = desc(item);
  const code = item.code;
  if (/^r\d\d$/.test(code)) return 'rune';
  if (/^g[ms][wvlbyp]$/.test(code) || code === 'jew') return 'gem';
  if (/^cm[123]$/.test(code)) return 'charm';
  if (['unique', 'set', 'rare', 'magic'].includes(d.qualityClass)) return d.qualityClass;
  return 'other';
}

/** Vault (SPEC §5.4): search + category filter + list rows. List-based, no grid mapping. */
export function Vault({ docId, onTap }: { docId: string; onTap: (r: ItemRef) => void }) {
  const store = useStore();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('all');
  const entry = store.docs.get(docId);
  const vault = entry?.doc;
  if (!vault || vault.kind !== 'vault') return <div className="m-empty">宝库读取失败</div>;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return vault.entries.filter((e: VaultEntry) => {
      if (cat !== 'all' && catOf(e.item) !== cat) return false;
      if (needle && !desc(e.item).search.includes(needle)) return false;
      return true;
    });
  }, [vault.entries, vault, q, cat]);

  return (
    <>
      <ImportButton docId={docId} />
      <div className="m-search">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索宝库…" />
      </div>
      <div className="m-chips">
        {CATS.map((c) => (
          <button key={c.id} className={`m-chip${cat === c.id ? ' on' : ''}`} onClick={() => setCat(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="m-hint">{vault.entries.length} 件 · 无限存储</div>
      {rows.map((e: VaultEntry) => (
        <button key={e.uid} className="m-vitem" onClick={() => onTap({ item: e.item, docId })}>
          <Tile item={e.item} />
          <span>
            <QName item={e.item} />
            <br />
            <span className="m-ity">{typeSub(e.item)}</span>
          </span>
          {e.source && (
            <span style={{ marginLeft: 'auto' }} className="m-vsrc">
              {e.source}
            </span>
          )}
        </button>
      ))}
      {rows.length === 0 && <div className="m-empty">没有匹配的物品</div>}
    </>
  );
}
