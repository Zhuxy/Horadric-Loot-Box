import {
  ItemMode,
  StorePage,
  characterStats,
  mercInfo,
  type D2Character,
  type D2Item,
  type MercInfo,
} from '../../src/core';
import { useMemo } from 'react';
import { useStore } from '../../src/ui/context';
import { EquipDoll, MercDoll } from './doll';
import { Grid, ItemBox } from './items';
import { CELL, beltRows, charmStats, fmt, type ItemLoc } from './model';

function BeltCell({ docId, ch, slot }: { docId: string; ch: D2Character; slot: number }) {
  const item = ch.items.find((i) => i.mode === ItemMode.Belt && i.x === slot);
  const loc: ItemLoc = { docId, kind: 'belt', slot };
  return (
    <div className="m-beltcell" data-drop="belt" data-doc={docId} data-slot={slot}>
      {item ? <ItemBox item={item} loc={loc} width={CELL - 2} height={CELL - 2} cell={CELL} /> : <span className="m-beltdot" />}
    </div>
  );
}

function BeltRow({
  docId,
  ch,
  gold,
  open,
  onToggle,
  onGold,
}: {
  docId: string;
  ch: D2Character;
  gold: number;
  open: boolean;
  onToggle: () => void;
  onGold: () => void;
}) {
  const rows = beltRows(ch);
  return (
    <div className="m-beltblock">
      <div className="m-beltgold">
        <div className="m-beltcells">
          {[0, 1, 2, 3].map((slot) => (
            <BeltCell key={slot} docId={docId} ch={ch} slot={slot} />
          ))}
        </div>
        <button className="m-smallbtn" onClick={onToggle}>
          {open ? '收起' : `展开 ${rows} 排`}
        </button>
        <button className="m-goldbtn" onClick={onGold} aria-label="金币转移">
          🪙 <b>{fmt(gold)}</b>
          <span>存 / 取</span>
        </button>
      </div>
      {/* In the flow, not an overlay: the backpack below moves down with the panel's rows. */}
      {open && (
        <div className="m-beltpanel">
          <div className="m-beltgrid" style={{ width: 4 * CELL, height: rows * CELL }}>
            {Array.from({ length: rows * 4 }, (_, i) => {
              const slot = i;
              const row = Math.floor(slot / 4);
              const col = slot % 4;
              const item = ch.items.find((x) => x.mode === ItemMode.Belt && x.x === slot);
              const loc: ItemLoc = { docId, kind: 'belt', slot };
              return (
                <div
                  key={slot}
                  className="m-beltcell m-beltcell-abs"
                  data-drop="belt"
                  data-doc={docId}
                  data-slot={slot}
                  style={{ left: col * CELL, top: (rows - 1 - row) * CELL, width: CELL, height: CELL }}
                >
                  {item ? <ItemBox item={item} loc={loc} width={CELL - 2} height={CELL - 2} cell={CELL} /> : <span className="m-beltdot" />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Character equipment sub-page: paper doll, belt + gold row, backpack/cube grid. */
export function EquipScreen({
  docId,
  ch,
  swap,
  onSwap,
  gridView,
  onGridView,
  beltOpen,
  onBeltToggle,
  onGold,
}: {
  docId: string;
  ch: D2Character;
  swap: boolean;
  onSwap: (swap: boolean) => void;
  gridView: 'inv' | 'cube';
  onGridView: (view: 'inv' | 'cube') => void;
  beltOpen: boolean;
  onBeltToggle: () => void;
  onGold: () => void;
}) {
  const gold = ch.stats.gold ?? 0;
  return (
    <div className="m-padwrap">
      <div>
        <div className="m-dollzone">
          <EquipDoll docId={docId} ch={ch} swap={swap} />
          <div className="m-swapov">
            <button className={!swap ? 'on' : ''} onClick={() => onSwap(false)}>
              I 主手
            </button>
            <button className={swap ? 'on' : ''} onClick={() => onSwap(true)}>
              II 副手
            </button>
          </div>
        </div>
        <BeltRow docId={docId} ch={ch} gold={gold} open={beltOpen} onToggle={onBeltToggle} onGold={onGold} />
      </div>
      <div className="m-gridzone">
        <div className="m-gridhead">
          <span>{gridView === 'inv' ? '背包' : '赫拉迪克方块'}</span>
          <span className="m-spacer" />
          <button className={`m-smallbtn${gridView === 'inv' ? ' on' : ''}`} onClick={() => onGridView('inv')}>
            背包
          </button>
          <button className={`m-smallbtn${gridView === 'cube' ? ' on' : ''}`} onClick={() => onGridView('cube')}>
            方块
          </button>
        </div>
        <Grid docId={docId} doc={ch} area={gridView === 'cube' ? 'cube' : 'inventory'} maxHeight={140} />
        <div className="m-hintline">单击看属性 · 双击入托盘 · 按住拖动换位置</div>
      </div>
    </div>
  );
}

/** Mercenary sub-page: info, paper doll and the character's backpack for drag-and-drop. */
export function MercScreen({ docId, ch }: { docId: string; ch: D2Character }) {
  const info: MercInfo | undefined = mercInfo(ch);
  if (!info && ch.mercItems.length === 0) {
    return (
      <div className="m-emptybox">
        🪦
        <br />
        尚未雇佣佣兵
        <br />
        <span>在游戏里雇佣后，这里会出现佣兵的属性与装备面板</span>
      </div>
    );
  }
  return (
    <div className="m-padwrap">
      <div>
        <div className="m-mercinfo">
          <div>
            <span className="m-mercname">{info?.name ?? '佣兵'}</span>
            {info?.level ? ` · ${info.level} 级` : ''}
          </div>
          <div>
            {[info?.className ?? '', info?.role ?? '', info?.act ? `第 ${info.act} 幕 ${info.difficulty}` : ''].filter(Boolean).join(' · ')}
          </div>
          {info?.gear && <div className="m-mercgear">可用 {info.gear.weaponText}{info.gear.offHand === 'shield' ? ' 与盾牌' : ''}</div>}
        </div>
        <MercDoll docId={docId} ch={ch} info={info} />
      </div>
      <div className="m-gridzone">
        <div className="m-gridhead">
          <span>角色背包（拖物品到上方槽位给佣兵换装）</span>
        </div>
        <Grid docId={docId} doc={ch} area="inventory" maxHeight={140} />
        <div className="m-hintline">佣兵能用什么武器由类型决定 · 拖错会给出原因</div>
      </div>
    </div>
  );
}

const isCharm = (i: D2Item) => i.mode === ItemMode.Stored && i.page === StorePage.Inventory && !!i.def?.flags.includes('C');

function StatRow({ label, base, bonus }: { label: string; base: number; bonus: number }) {
  return (
    <>
      <span className="m-k">{label}</span>
      <span className="m-v">
        <b>{base + bonus}</b> <span className="m-faint">（自身 {base} + 装备 {bonus}）</span>
      </span>
    </>
  );
}

/** Read-only attributes page (SPEC §5.1.2). Scrolls; it has no draggable items. */
export function AttributesScreen({ ch }: { ch: D2Character }) {
  const store = useStore();
  // ch is mutated in place, so identity alone can't key the memo — the store rev is the change signal
  const { s, gearOnly, charm } = useMemo(
    () => ({
      s: characterStats(ch),
      gearOnly: characterStats({ ...ch, items: ch.items.filter((i) => !isCharm(i)) }),
      charm: charmStats(ch),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ch, store.rev],
  );
  const base = (k: string) => ch.stats[k] ?? 0;
  const advanced = gearOnly.advanced.map((l) => l.text);
  const combat = [
    ['防御', fmt(s.defense)],
    ['攻击准确率', fmt(s.attackRating)],
    ['伤害', `${fmt(s.damage.min)} – ${fmt(s.damage.max)}`],
  ].filter(([, v]) => v && v !== '0' && v !== '0 – 0');

  return (
    <div className="m-scroll m-attrs">
      <section className="m-panel">
        <h3>人物属性</h3>
        <div className="m-vitals">
          <div className="m-vital">
            <div className="m-t">生命</div>
            <div className="m-n m-orb-hp">{fmt(s.life)}</div>
          </div>
          <div className="m-vital">
            <div className="m-t">法力</div>
            <div className="m-n m-orb-mp">{fmt(s.mana)}</div>
          </div>
          <div className="m-vital">
            <div className="m-t">耐力</div>
            <div className="m-n m-orb-st">{fmt(s.stamina)}</div>
          </div>
        </div>
        <div className="m-statgrid">
          <StatRow label="力量" base={base('strength')} bonus={s.strength - base('strength')} />
          <StatRow label="敏捷" base={base('dexterity')} bonus={s.dexterity - base('dexterity')} />
          <StatRow label="体力" base={base('vitality')} bonus={s.vitality - base('vitality')} />
          <StatRow label="精力" base={base('energy')} bonus={s.energy - base('energy')} />
          {[
            ['火焰抗性', s.fire],
            ['冰冷抗性', s.cold],
            ['闪电抗性', s.lightning],
            ['毒素抗性', s.poison],
          ].map(([label, row]) => {
            const r = row as typeof s.fire;
            return (
              <div key={label as string} className="m-resistrow">
                <span className="m-k">{label as string}</span>
                <span className="m-v">
                  <b>{r.total}%</b> <span className="m-faint">上限 {r.max}%</span>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="m-panel">
        <h3>装备加成汇总（隐藏属性）</h3>
        {combat.map(([k, v]) => (
          <div key={k} className="m-bonusline">
            <span>{k}</span>
            <span className="m-bv">{v}</span>
          </div>
        ))}
        {advanced.map((line, i) => (
          <div key={i} className="m-bonusline">
            <span>{line}</span>
          </div>
        ))}
        {advanced.length === 0 && combat.length === 0 && <div className="m-faint m-center">没有装备加成。</div>}
        <div className="m-faint m-small">触发 / 光环 / 充能类只罗列，不参与求和。</div>
      </section>

      {charm && (
        <section className="m-panel">
          <h3>背包护符加成</h3>
          {charm.advanced.map((line, i) => (
            <div key={i} className="m-bonusline">
              <span>{line.text}</span>
            </div>
          ))}
          {charm.advanced.length === 0 && <div className="m-faint m-center">背包里没有生效的护符。</div>}
        </section>
      )}
      <div className="m-faint m-small m-center">属性修改为后续版本功能，本页只读。</div>
      <div style={{ height: 16 }} />
    </div>
  );
}
