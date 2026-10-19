import { useState } from 'react';
import { docLabel } from '../../src/state/store';
import { useStore } from '../../src/ui/context';
import { Characters } from './Characters';
import { CharacterDetail } from './CharacterDetail';
import { Stash } from './Stash';
import { Vault } from './Vault';
import { ImportFlow } from './ImportFlow';
import { ItemSheet, type ItemRef } from './ItemSheet';
import { Toasts } from './parts';

type Tab = 0 | 1 | 2 | 3;

/** Sync tab (SPEC §5.5): folder info, reload, file-flow explanation. */
function Sync({ folder }: { folder: string }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const reload = async () => {
    setBusy(true);
    try {
      await store.reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="m-card">
        <div className="m-sec">存档位置</div>
        <div className="m-stats" style={{ wordBreak: 'break-all' }}>{folder || '（未知）'}</div>
        <div className="m-hint">
          <b>考进：</b>在文件 App 里把 D2R Mobile 的存档拷进 Horadric Loot Box 的文件夹，再点重新载入。<br />
          <b>考出：</b>改完后点「重新载入」确认，再把存档拷回游戏文件夹。<br />
          <b>导出：</b>物品页「导出为 .d2i」会打开系统分享，由你亲手选位置。
        </div>
        <button className="m-btn m-btn-gold" disabled={busy} onClick={reload}>重新载入</button>
      </div>
      <div className="m-card">
        <div className="m-sec">注意</div>
        <div className="m-hint">
          iOS 上游戏与本 App 不能同时运行，不存在桌面版的"游戏运行中"冲突。<br />
          所有写操作先备份（backups），再原子写入。
        </div>
      </div>
    </>
  );
}

const TABS: { label: string; icon: string }[] = [
  { label: '角色', icon: '🧙' },
  { label: '仓库', icon: '📦' },
  { label: '宝库', icon: '🎒' },
  { label: '同步', icon: '🔄' },
];

export function MobileApp({ folder }: { folder: string }) {
  const store = useStore();
  const [tab, setTab] = useState<Tab>(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [itemRef, setItemRef] = useState<ItemRef | null>(null);

  const openDoc = (docId: string) => setDetail(docId);
  const goTab = (t: Tab) => {
    setTab(t);
    setDetail(null);
  };

  const firstOf = (kind: 'stash' | 'vault'): string | null => {
    for (const [id, e] of store.docs) if (e.doc?.kind === kind) return id;
    return null;
  };

  let title = 'Horadric Loot Box';
  let sub: string | undefined = '随身仓库';
  let body: React.ReactNode = null;

  if (detail) {
    const doc = store.docs.get(detail)?.doc;
    title = doc ? docLabel(doc, '') : '';
    sub = doc?.kind === 'character' ? `Lv ${(doc as { level: number }).level} ${(doc as { className: string }).className}` : undefined;
    if (doc?.kind === 'character') body = <CharacterDetail docId={detail} onTap={setItemRef} />;
    else if (doc?.kind === 'stash') body = <Stash docId={detail} onTap={setItemRef} />;
    else if (doc?.kind === 'vault') body = <Vault docId={detail} onTap={setItemRef} />;
  } else if (tab === 0) {
    body = <Characters onOpen={openDoc} />;
  } else if (tab === 1) {
    const id = firstOf('stash');
    body = id ? <Stash docId={id} onTap={setItemRef} /> : <div className="m-empty">没有共享仓库存档</div>;
    title = '共享仓库';
    sub = undefined;
  } else if (tab === 2) {
    const id = firstOf('vault');
    body = id ? <Vault docId={id} onTap={setItemRef} /> : <div className="m-empty">还没有宝库，去「角色」页新建一个</div>;
    title = '宝库';
    sub = undefined;
  } else {
    body = <Sync folder={folder} />;
    title = '同步';
    sub = undefined;
  }

  return (
    <div className="m-app">
      <div className="m-topbar">
        <div className="m-toprow">
          {detail && (
            <button className="m-back" onClick={() => setDetail(null)} aria-label="返回">‹</button>
          )}
          <div>
            <h1 className="font-display">{title}</h1>
            {sub && <div className="sub">{sub}</div>}
          </div>
        </div>
      </div>
      <div className="m-body">{body}</div>
      <div className="m-tabbar">
        {TABS.map((t, i) => (
          <button key={t.label} className={`m-tab${tab === i && !detail ? ' on' : ''}`} onClick={() => goTab(i as Tab)}>
            <span className="ic">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
      <ItemSheet ref={itemRef} onClose={() => setItemRef(null)} />
      <ImportFlow />
      <Toasts />
    </div>
  );
}
