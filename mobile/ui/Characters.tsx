import { useState } from 'react';
import { StashTabType } from '../../src/core';
import { useStore } from '../../src/ui/context';
import { useDocs } from './grids';

/** Tab 1: characters, shared stashes, vaults (SPEC §5.1). */
export function Characters({ onOpen }: { onOpen: (docId: string) => void }) {
  const store = useStore();
  const docs = useDocs();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const chars = docs.filter((d) => d.doc.kind === 'character');
  const stashes = docs.filter((d) => d.doc.kind === 'stash');
  const vaults = docs.filter((d) => d.doc.kind === 'vault');

  const addVault = () => {
    const n = name.trim();
    if (!n) return;
    try {
      store.addVault(n);
    } catch (e) {
      store.toast('error', (e as Error).message);
      return;
    }
    void store.saveAll();
    setName('');
    setNaming(false);
  };

  return (
    <>
      {chars.length > 0 && (
        <>
          <div className="m-sec">角色</div>
          {chars.map(({ id, doc }) => {
            if (doc.kind !== 'character') return null;
            return (
              <button key={id} className="m-charcard" onClick={() => onOpen(id)}>
                <span className="m-avatar">🧙</span>
                <span>
                  <span className="m-cname font-display">{doc.name}</span>
                  <br />
                  <span className="m-csub">Lv {doc.level} {doc.className}{doc.hardcore ? ' · HC' : ''}</span>
                </span>
                <span className="m-go">›</span>
              </button>
            );
          })}
        </>
      )}
      {stashes.length > 0 && (
        <>
          <div className="m-sec">共享仓库</div>
          {stashes.map(({ id, doc, label }) => {
            if (doc.kind !== 'stash') return null;
            const n = doc.tabs.filter((t) => t.type === StashTabType.Normal).reduce((a, t) => a + t.items.length, 0);
            return (
              <button key={id} className="m-charcard" onClick={() => onOpen(id)}>
                <span className="m-avatar">📦</span>
                <span>
                  <span className="m-cname font-display">{label}</span>
                  <br />
                  <span className="m-csub">{doc.tabs.length} tabs · {n} items</span>
                </span>
                <span className="m-go">›</span>
              </button>
            );
          })}
        </>
      )}
      <div className="m-sec">宝库</div>
      {vaults.map(({ id, doc, label }) => {
        if (doc.kind !== 'vault') return null;
        return (
          <button key={id} className="m-charcard" onClick={() => onOpen(id)}>
            <span className="m-avatar">🎒</span>
            <span>
              <span className="m-cname font-display">{label}</span>
              <br />
              <span className="m-csub">{doc.entries.length} items · 无限</span>
            </span>
            <span className="m-go">›</span>
          </button>
        );
      })}
      {naming ? (
        <div className="m-card">
          <div className="m-search">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="宝库名称（字母/数字/-/_）" maxLength={32} />
          </div>
          <button className="m-btn m-btn-gold" onClick={addVault}>创建</button>
          <button className="m-btn m-btn-ghost" onClick={() => setNaming(false)}>取消</button>
        </div>
      ) : (
        <button className="m-btn m-btn-ghost" onClick={() => setNaming(true)}>＋ 新建宝库</button>
      )}
      {docs.length === 0 && <div className="m-empty">没有读到存档。<br />请在「同步」页点击「从 D2R Mobile 导入 save」，选择游戏的 save 文件夹。</div>}
    </>
  );
}
