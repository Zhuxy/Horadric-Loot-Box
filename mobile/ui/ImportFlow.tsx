import { useRef, useState } from 'react';
import { StashTabType, parseImportFile, type D2Item } from '../../src/core';
import { docLabel } from '../../src/state/store';
import { useStore } from '../../src/ui/context';
import { Sheet, Tile, QName, typeSub } from './parts';

type Target =
  | { kind: 'vault'; docId: string; label: string }
  | { kind: 'grid'; docId: string; area: 'inventory' | 'shared'; tab: number; label: string };

/** Which doc the import button was tapped from — decides the default target (SPEC §6.1). */
let entryDocId: string | null = null;
export function setImportEntryDocId(docId: string | null) {
  entryDocId = docId;
}

/**
 * Import flow (SPEC §6.1): file picker -> preview sheet (parseImportFile) ->
 * quantity stepper -> target (default follows the entry panel) -> fit hint -> confirm.
 * The hidden file input lives here; entry buttons are <label htmlFor="m-import-file">.
 */
export function ImportFlow() {
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
      if (doc.kind === 'vault') out.push({ kind: 'vault', docId: id, label: `${docLabel(doc, 'Vault')} · 宝库` });
      else if (doc.kind === 'character') out.push({ kind: 'grid', docId: id, area: 'inventory', tab: 0, label: `${doc.name} · 背包` });
      else if (doc.kind === 'stash') {
        doc.tabs.forEach((t, i) => {
          if (t.type === StashTabType.Normal) out.push({ kind: 'grid', docId: id, area: 'shared', tab: i, label: `${docLabel(doc, 'Stash')} · Tab ${i + 1}` });
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
      // default target follows the entry panel (SPEC §6.1)
      const entry = entryDocId ? store.docs.get(entryDocId)?.doc : undefined;
      let def = list[0] ?? null;
      if (entry?.kind === 'vault') def = list.find((t) => t.kind === 'vault' && t.docId === entryDocId) ?? def;
      else if (entry?.kind === 'character') def = list.find((t) => t.kind === 'grid' && t.docId === entryDocId) ?? def;
      else if (entry?.kind === 'stash') def = list.find((t) => t.kind === 'grid' && t.docId === entryDocId) ?? def;
      setItem(it);
      setFileName(f.name);
      setQty(1);
      setTarget(def);
    } catch (e) {
      store.toast('error', `Not a .d2i file: ${(e as Error).message}`);
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  const close = () => {
    setItem(null);
    entryDocId = null;
  };

  const confirm = async () => {
    if (!item || !target) return;
    setBusy(true);
    try {
      const r = target.kind === 'vault'
        ? store.importItems(target.docId, item, qty, { area: 'vault' })
        : store.importItems(target.docId, item, qty, { area: target.area, tab: target.tab });
      if (r.imported > 0) await store.saveAll();
    } finally {
      setBusy(false);
      close();
    }
  };

  const list = targets();

  return (
    <>
      <input
        ref={inputRef}
        id="m-import-file"
        type="file"
        accept=".d2i,.D2I"
        style={{ display: 'none' }}
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <Sheet open={!!item} onClose={close}>
        {item && (
          <>
            <h3 className="font-display">导入物品</h3>
            <div className="sub">{fileName}</div>
            <div className="m-vitem" style={{ cursor: 'default' }}>
              <Tile item={item} />
              <span>
                <QName item={item} />
                <br />
                <span className="m-ity">{typeSub(item)}</span>
              </span>
              <span style={{ marginLeft: 'auto' }} className="m-qtyrow">
                <button className="m-chip" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
                <b>{qty}</b>
                <button className="m-chip" onClick={() => setQty((q) => Math.min(99, q + 1))}>＋</button>
              </span>
            </div>
            <div className="m-sec">目标位置</div>
            <div className="m-chips" style={{ flexWrap: 'wrap' }}>
              {list.map((t) => (
                <button
                  key={`${t.docId}-${t.kind}-${'tab' in t ? t.tab : ''}`}
                  className={`m-chip${target?.docId === t.docId && target?.kind === t.kind && ('tab' in t ? (target as { tab: number }).tab === t.tab : true) ? ' on' : ''}`}
                  onClick={() => setTarget(t)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="m-hint" style={{ textAlign: 'left' }}>
              {target?.kind === 'vault'
                ? '宝库无限，直接追加，无需找格子。'
                : '按物品面积自动找位（First-Fit-Decreasing），放不下会提示，多余的将被丢弃。'}
            </div>
            <button className="m-abtn primary" disabled={busy || !target} onClick={confirm}>
              确认导入{target ? ` → ${target.label}` : ''}
            </button>
            <div className="m-note">解析带 round-trip 校验（core.parseImportFile）；跨版本自动重试。</div>
          </>
        )}
      </Sheet>
    </>
  );
}

/** Import entry button (a label for the hidden file input). */
export function ImportButton({ docId, compact }: { docId: string; compact?: boolean }) {
  if (compact) {
    return (
      <label className="m-chip" htmlFor="m-import-file" onClick={() => setImportEntryDocId(docId)}>
        ⤵ 导入
      </label>
    );
  }
  return (
    <label className="m-btn m-btn-ghost" htmlFor="m-import-file" onClick={() => setImportEntryDocId(docId)} style={{ textAlign: 'center' }}>
      ⤵ 从文件导入 .d2i
    </label>
  );
}
