import { useLayoutEffect, useRef, useState } from 'react';
import {
  gridDims,
  gridItems,
  itemSize,
  type D2Character,
  type D2Item,
  type D2SharedStash,
  type ItemDescription,
} from '../../src/core';
import { desc, itemKey } from '../../src/state/store';
import { useStore } from '../../src/ui/context';
import { ItemFace } from '../../src/ui/ItemArt';
import { useDragApi } from './drag';
import { CELL, type GridArea, type ItemLoc } from './model';
import { qText } from './parts';

const stackCount = (item: D2Item) => item.quantity ?? item.advancedStackSize;

/** One item box: game art when available, glyph fallback, plus sockets/stack size. */
export function ItemBox({
  item,
  loc,
  width,
  height,
  cell,
  showName,
  className = '',
  style,
}: {
  item: D2Item;
  loc: ItemLoc;
  width: number;
  height: number;
  cell: number;
  showName?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const store = useStore();
  const drag = useDragApi();
  const d = desc(item);
  const { w, h } = itemSize(item);
  const large = w * h > 1 || d.qualityClass === 'rune' || d.qualityClass === 'gem';
  return (
    <div
      className={`m-item m-q-${d.qualityClass}${className ? ` ${className}` : ''}`}
      style={{ width, height, ...style }}
      title={d.name}
      role="button"
      onPointerDown={(e) => drag.pointerDown(e, item, loc)}
    >
      <ItemFace
        item={item}
        width={width}
        height={height}
        cell={cell}
        view={store.art ? 'art' : 'tiles'}
        art={store.art}
        count={stackCount(item)}
      />
      {showName && store.art && large && (
        <span className="m-item-name" style={{ color: qText[d.qualityClass] }}>
          {d.short}
        </span>
      )}
    </div>
  );
}

/** Positioned item grid, sized from the save's actual coordinates (SPEC §10). */
export function Grid({
  docId,
  doc,
  area,
  tab = 0,
  maxHeight,
}: {
  docId: string;
  doc: D2Character | D2SharedStash;
  area: GridArea;
  tab?: number;
  /** Shrink cells when a mod's extra rows would otherwise push the grid off screen. */
  maxHeight?: number;
}) {
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
  const { w: cols, h: rows } = gridDims(doc, area, tab);
  const cell = width ? Math.max(12, Math.min(CELL, Math.floor(width / cols), maxHeight ? Math.floor(maxHeight / rows) : CELL)) : CELL;
  const items = gridItems(doc, area, tab);
  return (
    <div className="m-gridhost" ref={host}>
      <div
        className="m-gridwrap"
        data-drop="grid"
        data-doc={docId}
        data-area={area}
        data-tab={tab}
        data-cols={cols}
        data-rows={rows}
        data-cell={cell}
        style={{ width: cols * cell, height: rows * cell }}
      >
        <div className="m-gridbg" style={{ ['--c' as string]: `${cell}px` }} />
        {items.map((item) => {
          const { w, h } = itemSize(item);
          const loc: ItemLoc = { docId, kind: 'grid', area, tab };
          return (
            <ItemBox
              key={itemKey(item)}
              item={item}
              loc={loc}
              width={w * cell - 2}
              height={h * cell - 2}
              cell={cell}
              showName
              style={{ left: item.x * cell + 1, top: item.y * cell + 1 }}
            />
          );
        })}
        <div className="m-drop-hl" />
      </div>
    </div>
  );
}

/** Parsed tooltip lines for the item sheet. */
export function ItemProperties({ description: d }: { description: ItemDescription }) {
  return (
    <div className="m-props">
      {d.lines.map((line, i) => {
        if (line.heading) return <div key={i} className="m-prop-heading">{line.text}</div>;
        const previous = d.lines[i - 1];
        const bonusStart = line.bonus && (!previous?.bonus || previous.bonus.scope !== line.bonus.scope || previous.bonus.when !== line.bonus.when);
        return (
          <div key={i}>
            {bonusStart && <div className="m-bonus-label">{line.bonus!.scope === 'item' ? `此物品 · ${line.bonus!.when}` : line.bonus!.when}</div>}
            <div
              className={`m-prop m-prop-${line.kind}`}
              style={line.kind === 'base' && i === 0 && d.baseName === line.text ? { color: qText[d.qualityClass] } : undefined}
            >
              {line.text}
              {line.range && (
                <span className={`m-prop-range${line.perfect ? ' perfect' : ''}`} title={line.perfect ? 'Perfect roll' : `Possible roll: ${line.range}`}>
                  {' '}[{line.range}]{line.perfect ? ' ★' : ''}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
