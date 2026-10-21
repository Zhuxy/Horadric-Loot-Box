import { useEffect, useMemo, useState } from 'react';
import type { D2Item } from '../../src/core';
import type { GoldRef } from '../../src/state/store';
import { useStore } from '../../src/ui/context';
import { CharacterList, SubTabs, type SubPage } from './characters';
import { AttributesScreen, EquipScreen, MercScreen } from './equipment';
import { FilterSheet } from './filter';
import { GoldSheet } from './gold';
import { ImportFlow, setImportEntry } from './ImportFlow';
import { ItemSheet, type ItemRef } from './ItemSheet';
import { useDragController, DragContext } from './drag';
import {
  activeGridLoc,
  characterDocs,
  emptyFilter,
  isTrayDoc,
  stashDocs,
  toStoreLoc,
  trayDoc,
  vaultDocs,
  type ItemLoc,
  type VaultFilter,
} from './model';
import { flushSave, getLastSavedAt, scheduleSave } from './mobileStore';
import { Toasts } from './parts';
import { SettingsScreen } from './settings';
import { StashScreen } from './stash';
import { TrayDrawer, TrayHandle } from './tray';
import { VaultScreen } from './vault';

type Tab = 0 | 1 | 2 | 3;

const TABS: { label: string; icon: string }[] = [
  { label: '角色', icon: '🧙' },
  { label: '仓库', icon: '🗄️' },
  { label: '宝库', icon: '💎' },
  { label: '设置', icon: '⚙️' },
];

export function MobileApp() {
  const store = useStore();
  const [tab, setTab] = useState<Tab>(0);
  const [charView, setCharView] = useState<'list' | 'detail'>('list');
  const [charId, setCharId] = useState<string | undefined>();
  const [sub, setSub] = useState<SubPage>('equip');
  const [swap, setSwap] = useState(false);
  const [gridView, setGridView] = useState<'inv' | 'cube'>('inv');
  const [beltOpen, setBeltOpen] = useState(false);
  const [stashSeg, setStashSeg] = useState<'personal' | 'shared'>('personal');
  const [sharedTab, setSharedTab] = useState(0);
  const [sharedId, setSharedId] = useState<string | undefined>();
  const [vaultId, setVaultId] = useState<string | undefined>();
  const [filter, setFilter] = useState<VaultFilter>(() => emptyFilter());
  const [filterOpen, setFilterOpen] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [itemRef, setItemRef] = useState<ItemRef | null>(null);
  const [goldFrom, setGoldFrom] = useState<GoldRef | null>(null);

  const chars = characterDocs(store);
  const currentId = (charId && chars.some((c) => c.id === charId) ? charId : chars[0]?.id) || undefined;
  const character = currentId ? store.docs.get(currentId)?.doc : undefined;
  const ch = character?.kind === 'character' ? character : undefined;
  const stashes = stashDocs(store);
  const sharedDocId = (sharedId && stashes.some((s) => s.id === sharedId) ? sharedId : stashes[0]?.id) || undefined;
  const vaults = vaultDocs(store);
  const currentVaultId = (vaultId && vaults.some((v) => v.id === vaultId) ? vaultId : vaults[0]?.id) || undefined;
  const tray = trayDoc(store);
  const trayId = tray?.id;

  const activeLoc = useMemo(
    () => activeGridLoc(tab, sub, gridView, stashSeg, sharedTab, currentId, sharedDocId),
    [tab, sub, gridView, stashSeg, sharedTab, currentId, sharedDocId],
  );

  const afterChange = () => scheduleSave(store);

  const onTap = (item: D2Item, loc: ItemLoc) => setItemRef({ item, loc });

  const onDouble = (item: D2Item, loc: ItemLoc) => {
    if (isTrayDoc(store, loc.docId)) {
      if (!activeLoc) {
        store.toast('info', '当前页面没有网格区，切到装备页 / 仓库页再双击取出');
        return;
      }
      if (store.move(item, loc.docId, toStoreLoc(activeLoc))) {
        afterChange();
        setTrayOpen(false);
        const label = activeLoc.kind === 'grid' ? activeLoc.area : '';
        store.toast('success', `已放入${label === 'cube' ? '方块' : label === 'stash' ? '个人仓库' : label === 'shared' ? '共享仓库' : '背包'}`);
      }
      return;
    }
    if (!trayId) {
      store.toast('error', '托盘尚未准备好');
      return;
    }
    if (store.move(item, loc.docId, { docId: trayId, area: 'vault' })) {
      afterChange();
      store.toast('success', '已放入托盘（已落盘）');
    }
  };

  const drag = useDragController({
    store,
    trayId,
    trayOpen,
    closeTray: () => setTrayOpen(false),
    openTray: () => setTrayOpen(true),
    onTap,
    onDouble,
    afterChange,
  });

  // iOS can kill the app at any time: flush the debounced write when it goes to the background.
  useEffect(() => {
    const save = () => {
      if (document.visibilityState === 'hidden') void flushSave(store);
    };
    const unload = () => void flushSave(store);
    document.addEventListener('visibilitychange', save);
    window.addEventListener('pagehide', unload);
    return () => {
      document.removeEventListener('visibilitychange', save);
      window.removeEventListener('pagehide', unload);
    };
  }, [store]);

  const undo = () => {
    store.undo();
    afterChange();
  };

  const openChar = (id: string) => {
    setCharId(id);
    setCharView('detail');
    setSub('equip');
    setSwap(false);
    setBeltOpen(false);
  };

  const goTab = (next: Tab) => {
    setTab(next);
    setTrayOpen(false);
    if (next === 0) setCharView('list');
  };

  const importEntry = (): { docId: string; area?: 'inventory' | 'stash' | 'cube' | 'shared'; tab?: number } | undefined => {
    if (tab === 0 && charView === 'detail' && currentId) {
      return { docId: currentId, area: sub === 'equip' && gridView === 'cube' ? 'cube' : 'inventory' };
    }
    if (tab === 1 && activeLoc?.kind === 'grid') return { docId: activeLoc.docId, area: activeLoc.area, tab: activeLoc.tab };
    if (tab === 2 && currentVaultId) return { docId: currentVaultId };
    return undefined;
  };
  const entry = importEntry();

  const crumb =
    tab === 0
      ? charView === 'detail' && ch
        ? `${ch.name}（${ch.className}）`
        : '角色'
      : tab === 1
        ? '仓库'
        : tab === 2
          ? '宝库'
          : '设置';

  const dirty = store.dirtyDocs.some((d) => d.doc);
  const saving = store.busy;
  const lastSaved = getLastSavedAt();
  const saveText = saving ? '保存中…' : dirty ? '待保存…' : lastSaved ? `已保存 ${new Date(lastSaved).toTimeString().slice(0, 5)}` : '已保存';

  let content: React.ReactNode = null;
  if (tab === 0) {
    content =
      charView === 'list' ? (
        <CharacterList chars={chars} currentId={currentId} onOpen={openChar} />
      ) : ch && currentId ? (
        <>
          <SubTabs
            sub={sub}
            onSub={(next) => {
              setSub(next);
              setBeltOpen(false);
            }}
          />
          <div className="m-screenbody">
            {sub === 'equip' && (
              <EquipScreen
                docId={currentId}
                ch={ch}
                swap={swap}
                onSwap={setSwap}
                gridView={gridView}
                onGridView={setGridView}
                beltOpen={beltOpen}
                onBeltToggle={() => setBeltOpen((v) => !v)}
                onGold={() => setGoldFrom({ docId: currentId, kind: 'inventory' })}
              />
            )}
            {sub === 'attrs' && <AttributesScreen ch={ch} />}
            {sub === 'merc' && <MercScreen docId={currentId} ch={ch} />}
          </div>
        </>
      ) : (
        <div className="m-empty">角色读取失败。</div>
      );
  } else if (tab === 1) {
    content = (
      <StashScreen
        charId={currentId}
        onChar={setCharId}
        segment={stashSeg}
        onSegment={setStashSeg}
        sharedId={sharedDocId}
        onShared={(id) => {
          setSharedId(id);
          setSharedTab(0);
        }}
        sharedTab={sharedTab}
        onSharedTab={setSharedTab}
        onGold={setGoldFrom}
      />
    );
  } else if (tab === 2) {
    content = (
      <VaultScreen
        vaultId={currentVaultId}
        onVault={setVaultId}
        filter={filter}
        onFilter={setFilter}
        onOpenFilter={() => setFilterOpen(true)}
        charId={currentId}
        onTap={onTap}
        onDouble={onDouble}
        onGold={setGoldFrom}
      />
    );
  } else {
    content = <SettingsScreen afterChange={afterChange} />;
  }

  return (
    <DragContext.Provider value={drag}>
      <div className="m-app">
        <header className="m-header">
          {tab === 0 && charView === 'detail' && (
            <button className="m-back" onClick={() => setCharView('list')} aria-label="返回角色列表">
              ‹
            </button>
          )}
          <div className="m-ttl">
            Horadric <b>· {crumb}</b>
          </div>
          <div className="m-headright">
            <button className={`m-hbtn${store.history.length ? '' : ' off'}`} onClick={undo} disabled={!store.history.length} title="撤销上一步">
              ↶
            </button>
            {entry && (
              <label className="m-hbtn" htmlFor="m-import-file" onClick={() => setImportEntry(entry.docId, entry.area, entry.tab)} title="导入 .d2i">
                ⤵
              </label>
            )}
            <div className={`m-save${dirty && !saving ? ' wait' : ''}${saving ? ' busy' : ''}`}>
              <span className="m-dot" />
              <span>{saveText}</span>
            </div>
          </div>
        </header>

        <main className="m-main">
          <div className="m-screen on">{content}</div>
          <TrayHandle onOpen={() => setTrayOpen(true)} />
        </main>

        <nav className="m-tabs">
          {TABS.map((t, i) => (
            <button key={t.label} className={tab === i ? 'on' : ''} onClick={() => goTab(i as Tab)}>
              <span className="m-ic">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>

        <TrayDrawer open={trayOpen} onClose={() => setTrayOpen(false)} />
        <ItemSheet selected={itemRef} activeLoc={activeLoc} charId={currentId} onClose={() => setItemRef(null)} afterChange={afterChange} />
        {filterOpen && <FilterSheet filter={filter} onApply={setFilter} onClose={() => setFilterOpen(false)} />}
        {goldFrom && <GoldSheet from={goldFrom} charId={currentId} onClose={() => setGoldFrom(null)} afterChange={afterChange} />}
        <ImportFlow afterChange={afterChange} />
        <Toasts />
      </div>
    </DragContext.Provider>
  );
}
