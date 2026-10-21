import { useRef, useState } from 'react';
import { StashTabType, parseImportFile, transcodeItem, type D2Item } from '../../src/core';
import { docLabel } from '../../src/state/store';
import { useStore } from '../../src/ui/context';
import { Sheet, ItemIcon, QName, typeSub } from './parts';
import { isTrayDoc, tabLabel, type GridArea } from './model';

type Target =
  | { kind: 'vault'; docId: string; label: string }
  | { kind: 'grid'; docId: string; area: GridArea; tab: number; label: string; version: number };

interface Entry {
  docId: string;
  area?: GridArea;
  tab?: number;
}

/** Which page opened the import sheet; decides the default target (SPEC §11.1). */
let entry: Entry | null = null;
export function setImportEntry(docId: string | null, area?: GridArea, tab = 0) {
  entry = docId ? { docId, area, tab } : null;
}

/** Import flow: file picker -> preview sheet -> quantity -> target -> fit hint -> confirm. */
export function ImportFlow({ afterChange }: { afterChange: () => void }) {
  const store = useStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [item, setItem] = useState<D2Item | null>(null);
  const [fileName, setFileName] = useState('');
  const [qty, setQty] = useState(1);
  const [target, setTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);

  const targets = (): Target[] => {
    const out: Target[] = [];
    for (const [id, e] of store.docs) {
      const doc = e.doc;
      if (!doc) continue;
      if (doc.kind === 'vault') {
        if (!isTrayDoc(store, id)) out.push({ kind: 'vault', docId: id, label: `${doc.name} · 宝库` });
      } else if (doc.kind === 'character') {
        out.push(
          { kind: 'grid', docId: id, area: 'inventory', tab: 0, label: `${doc.name} · 背包`, version: doc.version },
          { kind: 'grid', docId: id, area: 'cube', tab: 0, label: `${doc.name} · 方块`, version: doc.version },
          { kind: 'grid', docId: id, area: 'stash', tab: 0, label: `${doc.name} · 个人仓库`, version: doc.version },
        );
      } else {
        doc.tabs.forEach((t, i) => {
          if (t.type === StashTabType.Normal) {
            out.push({ kind: 'grid', docId: id, area: 'shared', tab: i, label: `${docLabel(doc, id)} · ${tabLabel(i)}`, version: t.version });
          }
        });
      }
    }
    return out;
  };

  const pick = async (f: File | undefined) => {
    if (!f) return;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const it = parseImportFile(bytes);
      const list = targets();
      let def = list[0] ?? null;
      if (entry) {
        const matching = list.find((t) => t.docId === entry!.docId && (t.kind === 'vault' || !entry!.area || (t.kind === 'grid' && t.area === entry!.area && (t.area !== 'shared' || t.tab === entry!.tab))));
        if (matching) def = matching;
        else def = list.find((t) => t.docId === entry!.docId) ?? def;
      }
      setItem(it);
      setFileName(f.name);
      setQty(1);
      setTarget(def);
    } catch (e) {
      store.toast('error', `.d2i 解析失败：${(e as Error).message}`);
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  const close = () => {
    setItem(null);
    entry = null;
  };

  const confirm = async () => {
    if (!item || !target) return;
    setBusy(true);
    try {
      let travel = item;
      if (target.kind === 'grid' && item.saveVersion !== target.version) {
        travel = transcodeItem(item, target.version);
        store.toast('info', `物品已从 v${item.saveVersion} 转换为 v${target.version}`);
      }
      const r =
        target.kind === 'vault'
          ? store.importItems(target.docId, travel, qty, { area: 'vault' })
          : store.importItems(target.docId, travel, qty, { area: target.area, tab: target.tab });
      if (r.imported > 0) afterChange();
    } catch (e) {
      store.toast('error', `导入失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
      close();
    }
  };

  const list = targets();
  const same = (a: Target, b: Target) =>
    a.docId === b.docId && a.kind === b.kind && (a.kind === 'vault' || (b.kind === 'grid' && a.area === b.area && a.tab === b.tab));

  return (
    <>
      <input ref={inputRef} id="m-import-file" type="file" accept=".d2i,.D2I" style={{ display: 'none' }} onChange={(e) => pick(e.target.files?.[0])} />
      <Sheet open={!!item} onClose={close}>
        {item && (
          <>
            <h3>导入物品</h3>
            <div className="m-sheet-base">{fileName}</div>
            <div className="m-sheetitem">
              <ItemIcon item={item} size={46} />
              <div>
                <QName item={item} />
                <div className="m-ity">{typeSub(item)}</div>
              </div>
              <div className="m-qtyrow">
                <button className="m-smallbtn" onClick={() => setQty((q) => Math.max(1, q - 1))}>
                  −
                </button>
                <b>{qty}</b>
                <button className="m-smallbtn" onClick={() => setQty((q) => Math.min(99, q + 1))}>
                  ＋
                </button>
              </div>
            </div>
            <div className="m-fl">目标位置</div>
            <div className="m-destchips">
              {list.map((t) => (
                <button
                  key={`${t.docId}-${t.kind}-${t.kind === 'grid' ? `${t.area}-${t.tab}` : ''}`}
                  className={target && same(t, target) ? 'on' : ''}
                  onClick={() => setTarget(t)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="m-sethint">
              {target?.kind === 'vault' ? '宝库无限，直接追加，无需找格子。' : '按物品面积自动找位（First-Fit-Decreasing），放不下会提示，多余的将被丢弃。'}
            </div>
            <div className="m-sheet-btns">
              <button className="m-primary m-wide" disabled={busy || !target} onClick={confirm}>
                确认导入{target ? ` → ${target.label}` : ''}
              </button>
            </div>
          </>
        )}
      </Sheet>
    </>
  );
}
