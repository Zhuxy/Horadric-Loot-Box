import { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { StashTabType, itemBytes, itemName, slotCodes, type D2Item } from '../../src/core';
import { desc, docLabel } from '../../src/state/store';
import { useStore } from '../../src/ui/context';
import { isTauri } from '../../src/platform/tauri';
import { download } from '../../src/platform/dropped';
import { ItemProperties } from './items';
import { Sheet, ItemIcon, QName, qText, typeSub } from './parts';
import {
  areaLabel,
  isTrayDoc,
  toStoreLoc,
  trayDoc,
  vaultDocs,
  stashDocs,
  tabLabel,
  type ItemLoc,
} from './model';

export interface ItemRef {
  item: D2Item;
  loc: ItemLoc;
}

/** Main equipment slots an item might fit (weapon-swap hands are filled by dragging in the II view). */
const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

interface MoveTarget {
  label: string;
  loc: ItemLoc;
}

/** Bottom action sheet for one item (SPEC §7.3). */
export function ItemSheet({
  selected,
  activeLoc,
  charId,
  onClose,
  afterChange,
}: {
  selected: ItemRef | null;
  activeLoc?: ItemLoc;
  charId?: string;
  onClose: () => void;
  afterChange: () => void;
}) {
  const store = useStore();
  const [moving, setMoving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setMoving(false);
    setConfirmDel(false);
    onClose();
  };

  const item = selected?.item;
  const loc = selected?.loc;
  const d = item ? desc(item) : undefined;

  const targets = useMemo<MoveTarget[]>(() => {
    if (!item || !loc) return [];
    const out: MoveTarget[] = [];
    const add = (label: string, target: ItemLoc) => {
      const same = JSON.stringify(target) === JSON.stringify(loc);
      if (!same) out.push({ label, loc: target });
    };
    const ch = charId ? store.docs.get(charId)?.doc : undefined;
    if (ch?.kind === 'character') {
      add(`${ch.name} · 背包`, { docId: charId!, kind: 'grid', area: 'inventory', tab: 0 });
      add(`${ch.name} · 方块`, { docId: charId!, kind: 'grid', area: 'cube', tab: 0 });
      add(`${ch.name} · 个人仓库`, { docId: charId!, kind: 'grid', area: 'stash', tab: 0 });
    }
    for (const { id, stash } of stashDocs(store)) {
      stash.tabs.forEach((t, i) => {
        if (t.type !== StashTabType.Normal) return;
        add(`${docLabel(stash, id)} · ${tabLabel(i)}`, { docId: id, kind: 'grid', area: 'shared', tab: i });
      });
    }
    for (const { id, vault } of vaultDocs(store)) add(`${vault.name} · 宝库`, { docId: id, kind: 'vault' });
    const tray = trayDoc(store);
    if (tray && !isTrayDoc(store, loc.docId)) add('装备托盘', { docId: tray.id, kind: 'vault' });
    return out;
  }, [item, loc, store, charId]);

  const tray = trayDoc(store);
  const inTray = isTrayDoc(store, loc?.docId);

  // Hooks run on every render — the sheet is mounted while closed (selected === null) too, so this
  // memo must stay above the early return or React aborts the whole tree (black screen on first tap).
  // Up to ten store.check calls — don't rerun them on every render of the open sheet.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const equipTo = useMemo(() => {
    if (!item || !loc || !charId) return undefined;
    for (const bodyLoc of SLOTS) {
      if (store.check(item, loc.docId, { docId: charId, area: 'equip', bodyLoc }).ok) return bodyLoc;
    }
    return undefined;
  }, [item, loc, charId, store.rev]);

  if (!selected || !item || !loc || !d) return <Sheet open={false} onClose={close}>{null}</Sheet>;

  const couldEquip = slotCodes(item).size > 0;

  const toTray = () => {
    if (!tray) {
      store.toast('error', '托盘尚未准备好');
      return;
    }
    setBusy(true);
    try {
      if (store.move(item, loc.docId, { docId: tray.id, area: 'vault' })) afterChange();
    } finally {
      setBusy(false);
      close();
    }
  };

  const backToGrid = () => {
    if (!activeLoc) {
      store.toast('info', '当前页面没有网格区，切到装备页 / 仓库页再放回');
      return;
    }
    setBusy(true);
    try {
      if (store.move(item, loc.docId, toStoreLoc(activeLoc))) afterChange();
    } finally {
      setBusy(false);
      close();
    }
  };

  const doEquip = () => {
    if (!charId) return;
    if (equipTo === undefined) {
      store.toast('error', '对应槽位都被占用了，用拖动直接换装，或先把原装备放进托盘');
      return;
    }
    setBusy(true);
    try {
      if (store.move(item, loc.docId, { docId: charId, area: 'equip', bodyLoc: equipTo })) afterChange();
    } finally {
      setBusy(false);
      close();
    }
  };

  const doMove = (target: ItemLoc) => {
    setBusy(true);
    try {
      const ok = store.move(item, loc.docId, toStoreLoc(target));
      if (ok) afterChange();
    } finally {
      setBusy(false);
      close();
    }
  };

  const doExport = async () => {
    setBusy(true);
    try {
      const safe = itemName(item).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || item.code;
      const name = `${item.code}_${safe}.d2i`;
      const bytes = itemBytes(item);
      if (isTauri()) {
        await invoke<string>('export_item', { name, data: Array.from(bytes) });
        store.toast('success', '已导出到文件 App → Horadric Loot Box → exports');
      } else {
        download(name, bytes);
        store.toast('success', `已导出 ${name}`);
      }
    } catch (e) {
      store.toast('error', `导出失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
      close();
    }
  };

  const doDelete = () => {
    setBusy(true);
    try {
      const n = store.deleteItems(loc.docId, [item]);
      if (n > 0) afterChange();
    } finally {
      setBusy(false);
      close();
    }
  };

  return (
    <Sheet open onClose={close}>
      <div className="m-sheethead">
        <div>
          <h3 style={{ color: qText[d.qualityClass] }}>{d.name}</h3>
          <div className="m-sheet-base">
            {typeSub(item)} · 位于{areaLabel(store, loc)}
            {d.requiredLevel > 1 ? ` · 需要等级 ${d.requiredLevel}` : ''}
          </div>
        </div>
        <button className="m-sheetclose" aria-label="关闭" onClick={close}>
          ×
        </button>
      </div>
      <div className="m-sheetitem">
        <ItemIcon item={item} size={46} />
        <div>
          <QName item={item} />
          <div className="m-ity">{typeSub(item)}</div>
        </div>
      </div>
      <ItemProperties description={d} />

      {moving ? (
        <div className="m-movetargets">
          <div className="m-sheet-base">选择目标位置（放不下会提示）</div>
          {targets.map((t) => (
            <button key={t.label} className="m-movetarget" disabled={busy} onClick={() => doMove(t.loc)}>
              {t.label}
            </button>
          ))}
          {targets.length === 0 && <div className="m-empty">没有可移动的位置</div>}
          <button className="m-movetarget" onClick={() => setMoving(false)}>
            返回
          </button>
        </div>
      ) : (
        <div className="m-sheet-btns">
          {inTray ? (
            <button className="m-primary m-wide" disabled={busy} onClick={backToGrid}>
              放回当前网格
            </button>
          ) : (
            <button className="m-primary m-wide" disabled={busy} onClick={toTray}>
              放入托盘
            </button>
          )}
          {!inTray && loc.kind !== 'equip' && loc.kind !== 'merc' && couldEquip && (
            <button className="m-wide" disabled={busy} onClick={doEquip}>
              装备到空槽
            </button>
          )}
          <button disabled={busy} onClick={() => setMoving(true)}>
            移动到…
          </button>
          <button disabled={busy} onClick={doExport}>
            导出 .d2i
          </button>
          {confirmDel ? (
            <button className="m-danger m-wide" disabled={busy} onClick={doDelete}>
              确认删除？（备份保留）
            </button>
          ) : (
            <button className="m-danger m-wide" disabled={busy} onClick={() => setConfirmDel(true)}>
              删除
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}
