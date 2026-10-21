import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { StashTabType, itemBytes, itemName, type D2Item, type ItemDescription } from '../../src/core';
import { desc, docLabel } from '../../src/state/store';
import { useStore } from '../../src/ui/context';
import { isTauri } from '../../src/platform/tauri';
import { download } from '../../src/platform/dropped';
import { Sheet, Tile, QName, qText, typeSub } from './parts';

export interface ItemRef {
  item: D2Item;
  docId: string;
}

/** Bottom action sheet for one item (SPEC §5.2): 放入宝库 / 移动到… / 导出为 .d2i / 删除. */
export function ItemSheet({ selected, onClose }: { selected: ItemRef | null; onClose: () => void }) {
  const store = useStore();
  const [moving, setMoving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setMoving(false);
    setConfirmDel(false);
    onClose();
  };

  if (!selected) return <Sheet open={false} onClose={close}>{null}</Sheet>;
  const { item, docId } = selected;
  const d = desc(item);

  const vaults = [...store.docs.entries()].filter(([, e]) => e.doc?.kind === 'vault');

  const toVault = async () => {
    const v = vaults[0];
    if (!v) {
      store.toast('error', 'No vault yet — create one from the Characters tab');
      return;
    }
    setBusy(true);
    try {
      if (store.move(item, docId, { docId: v[0], area: 'vault' })) await store.saveAll();
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
        // iOS app: export_item writes into Documents/exports/ (app-owned, no
        // security-scoped URL needed); the user moves it in the Files app ("考出").
        await invoke<string>('export_item', { name, data: Array.from(bytes) });
        store.toast('success', '已导出到文件 App → Horadric Loot Box → exports');
      } else {
        download(name, bytes);
        store.toast('success', `Exported ${name}`);
      }
    } catch (e) {
      store.toast('error', `Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      close();
    }
  };

  const doDelete = async () => {
    setBusy(true);
    try {
      store.deleteItems(docId, [item]);
      await store.saveAll();
    } finally {
      setBusy(false);
      close();
    }
  };

  return (
    <Sheet open onClose={close}>
      <div className="m-sheet-title">
        <h3 className="font-display">装备属性</h3>
        <button type="button" className="m-sheet-close" aria-label="关闭装备属性" onClick={close}>×</button>
      </div>
      <div className="m-vitem" style={{ cursor: 'default' }}>
        <Tile item={item} />
        <span>
          <QName item={item} />
          <br />
          <span className="m-ity">{typeSub(item)}</span>
        </span>
      </div>
      <ItemProperties description={d} />
      {moving ? (
        <MoveTargets item={item} docId={docId} onDone={close} />
      ) : (
        <>
          <button className="m-abtn primary" disabled={busy} onClick={toVault}>放入宝库</button>
          <button className="m-abtn" disabled={busy} onClick={() => setMoving(true)}>移动到…</button>
          <button className="m-abtn" disabled={busy} onClick={doExport}>导出为 .d2i</button>
          {confirmDel ? (
            <button className="m-abtn danger" disabled={busy} onClick={doDelete}>确认删除？（备份保留）</button>
          ) : (
            <button className="m-abtn danger" disabled={busy} onClick={() => setConfirmDel(true)}>删除</button>
          )}
        </>
      )}
    </Sheet>
  );
}

function ItemProperties({ description: d }: { description: ItemDescription }) {
  return (
    <div className="m-item-props">
      {d.lines.map((line, i) => {
        if (line.heading) return <div key={i} className="m-item-prop-heading">{line.text}</div>;
        const previous = d.lines[i - 1];
        const bonusStart = line.bonus && (!previous?.bonus || previous.bonus.scope !== line.bonus.scope || previous.bonus.when !== line.bonus.when);
        return (
          <div key={i}>
            {bonusStart && <div className="m-item-bonus-label">{line.bonus!.scope === 'item' ? `This item · ${line.bonus!.when}` : line.bonus!.when}</div>}
            <div className={`m-item-prop m-item-prop-${line.kind}`} style={line.kind === 'base' && i === 0 && d.baseName === line.text ? { color: qText[d.qualityClass] } : undefined}>
              {line.text}
              {line.range && <span className={`m-item-range${line.perfect ? ' perfect' : ''}`} title={line.perfect ? 'Perfect roll' : `Possible roll: ${line.range}`}> [{line.range}]{line.perfect ? ' ★' : ''}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MoveTargets({ item, docId, onDone }: { item: D2Item; docId: string; onDone: () => void }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);

  const targets: { label: string; sub: string; go: () => boolean }[] = [];
  for (const [id, e] of store.docs) {
    if (id === docId || !e.doc) continue;
    const doc = e.doc;
    if (doc.kind === 'vault') {
      targets.push({ label: docLabel(doc, 'Vault'), sub: `${doc.entries.length} items · unlimited`, go: () => store.move(item, docId, { docId: id, area: 'vault' }) });
    } else if (doc.kind === 'character') {
      targets.push({
        label: `${doc.name} · 背包`, sub: `Lv ${doc.level} ${doc.className}`,
        go: () => {
          const c = store.check(item, docId, { docId: id, area: 'inventory' });
          return c.ok ? store.move(item, docId, { docId: id, area: 'inventory', x: c.x, y: c.y }) : (store.toast('error', c.reason ?? 'No space'), false);
        },
      });
    } else if (doc.kind === 'stash') {
      doc.tabs.forEach((t, i) => {
        if (t.type !== StashTabType.Normal) return;
        targets.push({
          label: `${docLabel(doc, 'Stash')} · Tab ${i + 1}`, sub: `${t.items.length} items`,
          go: () => {
            const c = store.check(item, docId, { docId: id, area: 'shared', tab: i });
            return c.ok ? store.move(item, docId, { docId: id, area: 'shared', tab: i, x: c.x, y: c.y }) : (store.toast('error', c.reason ?? 'No space'), false);
          },
        });
      });
    }
  }

  const go = async (t: (typeof targets)[number]) => {
    setBusy(true);
    try {
      if (t.go()) await store.saveAll();
    } finally {
      setBusy(false);
      onDone();
    }
  };

  return (
    <>
      <div className="sub">选择目标位置（放不下会提示）</div>
      {targets.length === 0 && <div className="m-empty">没有其他可移动的位置</div>}
      {targets.map((t) => (
        <button key={t.label} className="m-vitem" disabled={busy} onClick={() => go(t)}>
          <span>
            <span className="m-inm">{t.label}</span>
            <br />
            <span className="m-ity">{t.sub}</span>
          </span>
        </button>
      ))}
    </>
  );
}
