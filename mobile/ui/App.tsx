import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
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

/** Import/export the complete save folder through the iOS Files picker. */
function Sync() {
  const store = useStore();
  const [busy, setBusy] = useState<'import' | 'export' | 'reload' | 'art' | null>(null);
  const reload = async () => {
    if (store.dirtyDocs.length && !window.confirm('还有未保存的修改。重新载入会丢弃这些修改，继续吗？')) return;
    setBusy('reload');
    try {
      await store.reload();
    } finally {
      setBusy(null);
    }
  };
  const importSaves = async () => {
    if (store.dirtyDocs.length) {
      store.toast('error', '请先保存当前修改，再导入新的存档。');
      return;
    }
    if (store.files.length && !window.confirm('导入会替换本 App 当前的 save 文件夹。旧文件会先备份在 App 内，继续吗？')) return;
    setBusy('import');
    try {
      const count = await invoke<string | null>('ios_import_saves');
      if (count !== null) {
        await store.reload();
        store.toast('success', `已导入 ${count} 个存档。`);
      }
    } catch (error) {
      store.toast('error', `导入失败：${String(error)}`);
    } finally {
      setBusy(null);
    }
  };
  const exportSaves = async () => {
    setBusy('export');
    try {
      if (store.dirtyDocs.length) {
        await store.saveAll();
        if (store.dirtyDocs.length) return;
      }
      const result = await invoke<string | null>('ios_export_saves');
      if (result !== null) store.toast('success', '已将 save 文件夹导出到所选位置。');
    } catch (error) {
      store.toast('error', `导出失败：${String(error)}`);
    } finally {
      setBusy(null);
    }
  };
  const importArt = async () => {
    if (store.art && !window.confirm('导入会替换当前物品图片资源，旧资源会保留备份。继续吗？')) return;
    setBusy('art');
    try {
      const count = await invoke<string | null>('ios_import_art');
      if (count === null) return;
      const path = await invoke<string | null>('ios_art_folder');
      if (!path) throw new Error('导入后找不到资源目录');
      await store.loadArt(path);
      if (store.artStatus.state !== 'ready') throw new Error(store.artStatus.message);
      store.toast('success', `已导入 ${count} 张物品图片。`);
    } catch (error) {
      store.toast('error', `资源导入失败：${String(error)}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <div className="m-card">
        <div className="m-sec">存档位置</div>
        <div className="m-stats">文件 › 我的 iPhone › Horadric Loot Box › save<br />当前有 {store.files.length} 个存档</div>
        <div className="m-hint">
          从 D2R Mobile 选择 <b>save</b> 文件夹导入。修改后可把完整的 <b>save</b> 文件夹导出到你选择的位置。
        </div>
        <button className="m-btn m-btn-gold" disabled={!!busy} onClick={importSaves}>{busy === 'import' ? '导入中…' : '从 D2R Mobile 导入 save'}</button>
        <button className="m-btn m-btn-ghost" disabled={!!busy || !store.files.length} onClick={exportSaves}>{busy === 'export' ? '导出中…' : '导出 save 到指定位置'}</button>
        <button className="m-btn m-btn-ghost" disabled={!!busy} onClick={reload}>{busy === 'reload' ? '载入中…' : '重新载入'}</button>
      </div>
      <div className="m-card">
        <div className="m-sec">D2R 图片资源</div>
        <div className="m-stats">
          文件 › 我的 iPhone › Horadric Loot Box › resources<br />
          {store.artStatus.state === 'ready' ? `已加载 ${store.art?.sprites.size ?? 0} 张物品图片` : store.artStatus.state === 'loading' ? '正在读取图片…' : '尚未导入图片资源'}
        </div>
        <div className="m-hint">选择解包后的 D2R 资源目录（包含 <b>hd/global/ui/items</b> 和 <b>hd/items/items.json</b>）。App 只拷贝物品图片和索引，不拷贝整个游戏。</div>
        {store.artStatus.state === 'error' && <div className="m-hint">读取失败：{store.artStatus.message}</div>}
        <button className="m-btn m-btn-ghost" disabled={!!busy} onClick={importArt}>{busy === 'art' ? '导入资源中…' : store.art ? '重新导入图片资源' : '导入 D2R 图片资源'}</button>
      </div>
      <div className="m-card">
        <div className="m-sec">注意</div>
        <div className="m-hint">
          导入前请先在游戏中保存并退出。导入会替换本 App 的 save 文件夹，原文件会保留备份。<br />
          修改存档时也会先备份，再写入。
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

export function MobileApp() {
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
    body = <Sync />;
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
      <ItemSheet selected={itemRef} onClose={() => setItemRef(null)} />
      <ImportFlow />
      <Toasts />
    </div>
  );
}
