import { useMemo, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  countFittable,
  describeStats,
  itemName,
  itemSize,
  occupancy,
  parseImportFile,
  qualityClass,
  type D2Item,
  type GridKind,
} from '../core';
import { useStore } from './context';
import { QUALITY_TEXT } from './Tooltip';

/** Which grid a character import targets (all visible at once, so let the user pick). */
const CHAR_GRIDS: { id: GridKind; label: string }[] = [
  { id: 'inventory', label: 'Inventory (10×4)' },
  { id: 'stash', label: 'Personal stash (10×10)' },
  { id: 'cube', label: 'Cube (3×4)' },
];

export function ImportDialog({ pane, onClose }: { pane: 0 | 1; onClose: () => void }) {
  const store = useStore();
  const paneState = store.panes[pane];
  const entry = paneState.docId ? store.docs.get(paneState.docId) : undefined;
  const doc = entry?.doc;

  const [fileName, setFileName] = useState<string | null>(null);
  const [item, setItem] = useState<D2Item | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [charGrid, setCharGrid] = useState<GridKind>('inventory');

  // Convert the item to the target container's version so it can be placed.
  // A vault has no single version, so it keeps the item's own.
  const targetVersion = useMemo(() => {
    if (!doc) return undefined;
    if (doc.kind === 'character') return doc.version;
    if (doc.kind === 'stash') return doc.tabs[paneState.tab ?? 0]?.version;
    return undefined;
  }, [doc, paneState.tab]);

  const targetLabel = useMemo(() => {
    if (!doc) return '—';
    if (doc.kind === 'vault') return 'Vault';
    if (doc.kind === 'stash') return `Shared stash · Tab ${(paneState.tab ?? 0) + 1}`;
    return 'Character';
  }, [doc, paneState.tab]);

  const pickFile = async () => {
    const sel = await open({
      multiple: false,
      title: 'Choose a .d2i item file',
      filters: [{ name: 'D2R item', extensions: ['d2i'] }],
    });
    if (!sel || Array.isArray(sel)) return;
    setFileName(sel.split(/[/\\]/).pop() ?? sel);
    try {
      const bytes = await store.platform.readFile(sel);
      const parsed = parseImportFile(bytes, targetVersion);
      setItem(parsed);
      setParseError(null);
      setQuantity(1);
    } catch (e) {
      setItem(null);
      setParseError((e as Error).message);
    }
  };

  // Live fit estimate (D2 mockup: "预计可放置").
  const fittable = useMemo(() => {
    if (!item || !doc || doc.kind === 'vault') return quantity;
    const grid: GridKind = doc.kind === 'character' ? charGrid : 'shared';
    const tab = doc.kind === 'stash' ? (paneState.tab ?? 0) : 0;
    try {
      const occ = occupancy(doc, grid, tab);
      return countFittable([{ item, quantity }], occ);
    } catch {
      return 0;
    }
  }, [item, quantity, doc, charGrid, paneState.tab]);

  const doImport = () => {
    if (!item || !entry) return;
    if (doc?.kind === 'vault') {
      store.importItems(entry.id, item, quantity, { area: 'vault' });
    } else if (doc?.kind === 'character') {
      store.importItems(entry.id, item, quantity, { area: charGrid });
    } else if (doc?.kind === 'stash') {
      store.importItems(entry.id, item, quantity, { area: 'shared', tab: paneState.tab ?? 0 });
    }
    onClose();
  };

  const size = item ? itemSize(item) : null;
  const stats = item ? describeStats(item.stats).slice(0, 6) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Import item"
        className="w-full max-w-md rounded-lg border border-ink-600 bg-ink-900 p-6 shadow-tip"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg text-gold-300">Import item</h2>

        {/* file picker (native OS dialog) */}
        <div className="mt-4 flex items-center justify-between rounded border border-ink-700 bg-ink-950 px-3 py-2.5">
          <span className="truncate text-[13px] text-ink-400">
            {fileName ? `📄 ${fileName}` : 'Choose a .d2i file (or drop it here)'}
          </span>
          <button
            className="ml-3 flex-shrink-0 rounded border border-ink-600 bg-ink-800 px-3 py-1 text-[13px] text-ink-200 hover:bg-ink-700"
            onClick={pickFile}
          >
            Choose file…
          </button>
        </div>

        {/* preview */}
        {parseError ? (
          <div className="mt-3 rounded border border-red-900 bg-red-950/40 p-3 text-[13px] text-red-200">
            Couldn't parse this file: {parseError}
          </div>
        ) : item ? (
          <div className="mt-3 rounded border border-ink-700 bg-ink-950 p-3">
            <div className={`text-[15px] font-semibold ${QUALITY_TEXT[qualityClass(item)] ?? 'text-ink-100'}`}>
              {itemName(item)}
            </div>
            <div className="mt-0.5 text-[12px] text-ink-400">
              {item.def?.name ?? item.code} · {size!.w}×{size!.h}
              {item.ethereal ? ' · Ethereal' : ''}
              {item.socketed ? ` · ${item.socketCount} sockets` : ''}
            </div>
            {stats.length > 0 && (
              <div className="mt-2 space-y-0.5 text-[12px] text-sky-300/90">
                {stats.map((s, i) => (
                  <div key={i}>{s}</div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 rounded border border-dashed border-ink-700 p-6 text-center text-[13px] text-ink-500">
            Item preview appears here after choosing a file
          </div>
        )}

        {/* quantity */}
        <div className="mt-4 flex items-center justify-between">
          <span className="text-[13px] text-ink-300">Quantity</span>
          <div className="flex items-center gap-2">
            <button
              className="h-7 w-7 rounded border border-ink-600 bg-ink-800 text-[15px] text-ink-200 hover:bg-ink-700 disabled:opacity-40"
              disabled={!item || quantity <= 1}
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            >
              −
            </button>
            <input
              type="number"
              min={1}
              value={quantity}
              disabled={!item}
              onChange={(e) => setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              className="h-7 w-14 rounded border border-ink-600 bg-ink-950 text-center text-[13px] text-ink-100 disabled:opacity-40"
            />
            <button
              className="h-7 w-7 rounded border border-ink-600 bg-ink-800 text-[15px] text-ink-200 hover:bg-ink-700 disabled:opacity-40"
              disabled={!item}
              onClick={() => setQuantity((q) => q + 1)}
            >
              +
            </button>
          </div>
        </div>

        {/* target */}
        <div className="mt-3 flex items-center justify-between text-[13px]">
          <span className="text-ink-300">Target</span>
          <span className="text-ink-400">{targetLabel}</span>
        </div>
        {doc?.kind === 'character' && (
          <div className="mt-2 flex items-center justify-between text-[13px]">
            <span className="text-ink-300">Grid</span>
            <select
              value={charGrid}
              onChange={(e) => setCharGrid(e.target.value as GridKind)}
              className="rounded border border-ink-600 bg-ink-950 px-2 py-1 text-[13px] text-ink-200"
            >
              {CHAR_GRIDS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {item && doc?.kind !== 'vault' && (
          <div className={`mt-2 text-right text-[12.5px] ${fittable >= quantity ? 'text-emerald-400' : 'text-amber-300'}`}>
            {fittable >= quantity
              ? `Fits ${quantity} ✓`
              : `Only ${fittable} of ${quantity} fit — ${quantity - fittable} will be discarded`}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button className="rounded px-3 py-1.5 text-[13px] text-ink-300 hover:bg-ink-800" onClick={onClose}>
            Cancel
          </button>
          <button
            className="rounded bg-emerald-700 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-emerald-600 disabled:bg-ink-700 disabled:text-ink-400"
            disabled={!item}
            onClick={doImport}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
