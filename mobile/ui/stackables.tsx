import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  GD,
  ItemMode,
  Quality,
  STACKABLE_SLOTS,
  STACKABLES_COLS,
  STACKABLES_ROWS,
  StorePage,
  arrangeStackables,
  createCompactItem,
  createUberItem,
  isUberCode,
  type D2Item,
  type D2SharedStash,
  type StackSlot,
} from '../../src/core';
import { desc } from '../../src/state/store';
import { useStore } from '../../src/ui/context';
import { ItemBox, ItemProperties } from './items';
import { ItemIcon, Sheet } from './parts';
import type { ItemLoc } from './model';

export const MAT_GROUP_ZH: Record<StackSlot['group'], string> = {
  rune: '符文',
  gem: '宝石',
  potion: '回复药水',
  key: '地狱火炬钥匙',
  uber: '召唤材料',
  organ: '器官',
  token: '赦免徽章',
  essence: '精华',
  shard: '世界石碎片',
};

/** "Perfect Amethyst" -> "P. Amethyst", "El Rune" -> "El", for text-only slots (same rule as the desktop board). */
function shortName(name: string): string {
  return name
    .replace(/ Rune$/, '')
    .replace(/^(Chipped|Flawed|Flawless|Perfect) /, (m) => m[0] + '. ')
    .replace(/ Worldstone Shard$/, ' Shard')
    .replace(/^Key of /, 'Key: ')
    .replace(/Essen[cs]e of /, 'Ess. ');
}

/**
 * The ghost "sample" an empty slot shows: the item's own art by code, dimmed and grayscaled
 * (the desktop board's approach — a fabricated item does not resolve through ItemFace).
 * Falls back to the short name when there is no art pack or the image fails.
 */
function GhostArt({ code, w, h }: { code: string; w: number; h: number }) {
  const store = useStore();
  const [failed, setFailed] = useState(false);
  const src = !failed ? store.art?.srcForCode(code) : undefined;
  if (src)
    return (
      <img src={src} alt="" draggable={false} className="m-mat-ghost" style={{ width: w, height: h }} onError={() => setFailed(true)} />
    );
  return <span className="m-mat-ghosttxt">{shortName(GD.items[code]?.name ?? code)}</span>;
}

/**
 * A stand-in item for a slot that holds nothing, so the board can show its icon, name and (for
 * runes and gems) socket effects. Potions have no core fabricator, so they get a hand-built
 * minimal item — describeItem only reads the fields set here (verified against the core).
 */
export function repItem(code: string, version: number): D2Item {
  try {
    return createCompactItem(code, version);
  } catch {
    /* not a rune or gem */
  }
  if (isUberCode(code)) {
    try {
      return createUberItem(code);
    } catch {
      /* fall through to the minimal item */
    }
  }
  return {
    code,
    def: GD.items[code],
    quality: Quality.Normal,
    sockets: [],
    stats: [],
    runewordStats: [],
    setBonusStats: [],
    prefixes: [],
    suffixes: [],
    mode: ItemMode.Stored,
    page: StorePage.Stash,
    x: 0,
    y: 0,
    bodyLoc: 0,
    saveVersion: version,
    raw: new Uint8Array(0),
    flags: 0,
    formatVersion: 3,
    compact: true,
    identified: true,
    ethereal: false,
    socketed: false,
    runeword: false,
    itemLevel: 1,
  } as unknown as D2Item;
}

/**
 * The materials page (SPEC §5.2.1): a shared stash's Advanced tab on the core's fixed board —
 * the whole 10×10 board on one screen. Filled slots are ordinary item boxes (tap opens the
 * item sheet, double-tap takes one to the tray, drag takes one out); empty slots open a
 * read-only info sheet.
 */
export function StackBoard({ docId, stash, tab }: { docId: string; stash: D2SharedStash; tab: number }) {
  const t = stash.tabs[tab];
  const version = t?.version ?? 105;
  const { bySlot, extra } = useMemo(() => arrangeStackables(t?.items ?? []), [t]);
  const [info, setInfo] = useState<StackSlot | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const kinds = STACKABLE_SLOTS.filter((s) => bySlot.has(s.code)).length;
  const total = STACKABLE_SLOTS.reduce((n, s) => n + (bySlot.get(s.code)?.count ?? 0), 0);

  const filledBox = (slot: StackSlot, w: number, h: number, style?: React.CSSProperties) => {
    const e = bySlot.get(slot.code);
    if (!e) return null;
    const loc: ItemLoc = { docId, kind: 'stack', tab };
    return (
      <ItemBox item={e.items[0]} loc={loc} width={w} height={h} cell={w + 2} style={style} className={`g-${slot.group}`} />
    );
  };
  const emptyFace = (slot: StackSlot, w: number, h: number, style?: React.CSSProperties) => (
    <div
      className={`m-mat-empty g-${slot.group}`}
      style={{ width: w, height: h, ...style }}
      role="button"
      aria-label={`${slot.code} 尚未存入`}
      onClick={() => setInfo(slot)}
    >
      <GhostArt code={slot.code} w={w - 4} h={h - 4} />
    </div>
  );
  /** One slot at pixel size w×h, positioned absolutely on the board. */
  const slotAt = (slot: StackSlot, w: number, h: number, style?: React.CSSProperties) =>
    bySlot.has(slot.code) ? filledBox(slot, w, h, style) : emptyFace(slot, w, h, style);

  const boardCell = width ? Math.floor(width / STACKABLES_COLS) : 36;

  const infoRep = info ? repItem(info.code, version) : undefined;
  const infoDesc = infoRep ? desc(infoRep) : undefined;

  return (
    <div>
      <div className="m-mathead">
        <div className="m-matstats">
          已存 <b>{kinds}</b> / {STACKABLE_SLOTS.length} 种 · 共 <b>{total}</b> 件（每格上限 99）
        </div>
      </div>

      <div className="m-gridhost" ref={host}>
        <div
          className="m-gridwrap"
          style={{ width: STACKABLES_COLS * boardCell, height: STACKABLES_ROWS * boardCell, margin: '0 auto' }}
        >
          <div className="m-gridbg" style={{ ['--c' as string]: `${boardCell}px` }} />
          {STACKABLE_SLOTS.map((s) => (
            <div key={s.code}>
              {slotAt(s, boardCell - 2, s.h * boardCell - 2, {
                position: 'absolute',
                left: s.x * boardCell + 1,
                top: s.y * boardCell + 1,
              })}
            </div>
          ))}
        </div>
      </div>

      {extra.length > 0 && (
        <>
          <div className="m-hintline" style={{ marginTop: 10 }}>
            板外材料（新版本新增，暂无固定格）
          </div>
          <div className="m-mat-extra">
            {extra.map((item) => (
              <div className="m-matcell" key={item.code} style={{ width: 52, height: 52 }}>
                <ItemBox
                  item={item}
                  loc={{ docId, kind: 'stack', tab }}
                  width={50}
                  height={50}
                  cell={52}
                  style={{ position: 'absolute', left: 1, top: 1 }}
                />
              </div>
            ))}
          </div>
        </>
      )}

      <Sheet open={!!info} onClose={() => setInfo(null)}>
        {info && infoRep && infoDesc && (
          <>
            <div className="m-sheethead">
              <div>
                <h3>{infoDesc.name}</h3>
                <div className="m-sheet-base">{MAT_GROUP_ZH[info.group]} · 尚未存入</div>
              </div>
              <button className="m-sheetclose" aria-label="关闭" onClick={() => setInfo(null)}>
                ×
              </button>
            </div>
            <div className="m-sheetitem">
              <ItemIcon item={infoRep} size={46} />
              <div>
                <div className="m-ity">{MAT_GROUP_ZH[info.group]} · 材料页固定格</div>
                <div className="m-sheet-base">这一格还空着</div>
              </div>
            </div>
            <ItemProperties description={infoDesc} />
            <div className="m-hintline" style={{ textAlign: 'left', padding: '8px 2px 2px' }}>
              在游戏里获得这类材料时会自动归档到这一格；在 HLB 里，把背包 / 托盘里的同类物品用「移动到… →
              材料页」即可存入。
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}
