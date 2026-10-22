import { ItemMode, itemSize, type D2Character, type D2Item, type MercInfo } from '../../src/core';
import { ItemBox } from './items';
import { CELL, type ItemLoc } from './model';

interface SlotDef {
  key: string;
  /** Body location in the main weapon set; hands use `swapLoc` in the swap view. */
  loc: number;
  swapLoc?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

const DOLL: SlotDef[] = [
  { key: 'head', loc: 1, x: 2, y: 0, w: 2, h: 2, label: '头盔' },
  { key: 'neck', loc: 2, x: 4, y: 0.5, w: 1, h: 1, label: '护符' },
  { key: 'rh', loc: 4, swapLoc: 11, x: 0, y: 2.2, w: 2, h: 4, label: '武器' },
  { key: 'torso', loc: 3, x: 2, y: 2.2, w: 2, h: 3, label: '铠甲' },
  { key: 'lh', loc: 5, swapLoc: 12, x: 4, y: 2.2, w: 2, h: 4, label: '盾牌' },
  { key: 'belt', loc: 8, x: 2, y: 5.4, w: 2, h: 1, label: '腰带' },
  { key: 'gloves', loc: 10, x: 0, y: 6.6, w: 2, h: 2, label: '手套' },
  { key: 'ringR', loc: 6, x: 2, y: 7.2, w: 1, h: 1, label: '戒指' },
  { key: 'ringL', loc: 7, x: 3, y: 7.2, w: 1, h: 1, label: '戒指' },
  { key: 'feet', loc: 9, x: 4, y: 6.6, w: 2, h: 2, label: '靴子' },
];

/** Positions are in cells; each cell also carries 1.5px of visual gap (desktop recipe). */
const px = (v: number) => Math.round(v * (CELL + 1.5));

/** Bottom-most slot edge in cell units — gloves and boots reach 8.6. */
const DOLL_BOTTOM = Math.max(...DOLL.map((s) => s.y + s.h));
const DOLL_RIGHT = Math.max(...DOLL.map((s) => s.x + s.w));

function Figure({ width, height }: { width: number; height: number }) {
  return (
    <svg className="m-figure" width={width} height={height} viewBox="0 0 210 290" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <ellipse cx="50%" cy="52%" rx="46%" ry="48%" fill="rgba(212,182,106,.055)" />
      <path
        d="M105 12c18 0 30 14 30 32 0 10-4 18-10 24l27 11c15 6 23 17 25 34l8 92c1 15-7 24-20 26l-13 2 6 44H52l6-44-13-2c-13-2-21-11-20-26l8-92c2-17 10-28 25-34l27-11c-6-6-10-14-10-24 0-18 12-32 30-32z"
        fill="#241d12"
        stroke="#5a4a28"
        strokeWidth="1.5"
        transform="translate(-8,0) scale(1.02)"
      />
    </svg>
  );
}

function Slot({
  docId,
  area,
  slot,
  item,
  disabled,
}: {
  docId: string;
  area: 'equip' | 'merc';
  slot: SlotDef;
  item?: D2Item;
  disabled?: boolean;
}) {
  const loc: ItemLoc = { docId, kind: area, bodyLoc: slot.loc };
  // The slot is sized for the biggest item that fits it; the picture keeps the item's own footprint, centred.
  const size = item && itemSize(item);
  const iw = Math.min(size ? size.w : slot.w, slot.w);
  const ih = Math.min(size ? size.h : slot.h, slot.h);
  return (
    <div
      className={`m-slot${item ? ' m-filled' : ''}${disabled ? ' m-disabled' : ''}`}
      data-drop="slot"
      data-doc={docId}
      data-area={area}
      data-body={slot.loc}
      title={disabled ? '此佣兵不可用' : undefined}
      style={{ left: px(slot.x), top: px(slot.y), width: slot.w * CELL, height: slot.h * CELL }}
    >
      {item ? (
        <ItemBox
          item={item}
          loc={loc}
          width={iw * CELL - 2}
          height={ih * CELL - 2}
          cell={CELL}
          style={{ left: ((slot.w - iw) * CELL) / 2 + 1, top: ((slot.h - ih) * CELL) / 2 + 1 }}
        />
      ) : (
        <span className="m-slot-label">
          {disabled ? (
            <>
              {slot.label}
              <br />
              <span className="m-slot-small">此佣兵不可用</span>
            </>
          ) : (
            slot.label
          )}
        </span>
      )}
    </div>
  );
}

/** Equipped gear stays the same cell size as the backpack and stash, so items never change size. */
export function EquipDoll({ docId, ch, swap }: { docId: string; ch: D2Character; swap: boolean }) {
  const equipped = ch.items.filter((i) => i.mode === ItemMode.Equipped);
  const bodyLoc = (s: SlotDef) => (s.swapLoc !== undefined && swap ? s.swapLoc : s.loc);
  const width = px(DOLL_RIGHT);
  const height = px(DOLL_BOTTOM);
  return (
    <div className="m-dollwrap" style={{ width, height }}>
      <Figure width={width + 2 * CELL} height={height} />
      {DOLL.map((s) => {
        const loc = bodyLoc(s);
        return <Slot key={s.key} docId={docId} area="equip" slot={{ ...s, loc }} item={equipped.find((i) => i.bodyLoc === loc)} />;
      })}
    </div>
  );
}

/** Mercenary paper doll: helm, armor, weapon, and the kind's second hand (shield or weapon). */
export function MercDoll({ docId, ch, info }: { docId: string; ch: D2Character; info?: MercInfo }) {
  const items = ch.mercItems;
  const off = info?.gear?.offHand;
  const slots: SlotDef[] = [
    { key: 'head', loc: 1, x: 0, y: 0, w: 2, h: 2, label: '头盔' },
    { key: 'torso', loc: 3, x: 0, y: 2.2, w: 2, h: 3, label: '铠甲' },
    { key: 'rh', loc: 4, x: 2.2, y: 0, w: 2, h: 4, label: '武器' },
    off === 'weapon'
      ? { key: 'lh2', loc: 5, x: 4.4, y: 0, w: 2, h: 4, label: '第二武器' }
      : { key: 'lh', loc: 5, x: 2.2, y: 4.45, w: 2, h: 2, label: '盾牌' },
  ];
  const width = px(Math.max(...slots.map((s) => s.x + s.w)));
  const height = px(Math.max(...slots.map((s) => s.y + s.h)));
  return (
    <div className="m-dollwrap" style={{ width, height }}>
      <Figure width={width + 2 * CELL} height={height} />
      {slots.map((s) => (
        <Slot
          key={s.key}
          docId={docId}
          area="merc"
          slot={s}
          item={items.find((i) => i.bodyLoc === s.loc)}
          disabled={s.loc === 5 && off !== 'shield' && off !== 'weapon'}
        />
      ))}
    </div>
  );
}
