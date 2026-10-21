import type { D2Character } from '../../src/core';
import { fmt } from './model';

const ICON: Record<string, string> = {
  Amazon: '🏹',
  Sorceress: '🔮',
  Necromancer: '💀',
  Paladin: '🛡️',
  Barbarian: '🪓',
  Druid: '🐺',
  Assassin: '🗡️',
  Warlock: '🪄',
};

export type SubPage = 'attrs' | 'equip' | 'merc';

export function CharacterList({ chars, currentId, onOpen }: { chars: { id: string; ch: D2Character }[]; currentId?: string; onOpen: (id: string) => void }) {
  return (
    <div className="m-scroll m-charlist">
      <div className="m-hintline">选择角色进入 · 当前角色与仓库页共享</div>
      {chars.map(({ id, ch }) => (
        <button key={id} className={`m-charcard${id === currentId ? ' m-current' : ''}`} onClick={() => onOpen(id)}>
          <span className="m-ava">{ICON[ch.className] ?? '🧙'}</span>
          <span className="m-charmain">
            <span className="m-nm">{ch.name}</span>
            <span className="m-meta">
              {ch.level} 级 · {ch.className}
              {ch.hardcore ? ' · HC' : ''} · 携带金币 {fmt(ch.stats.gold ?? 0)}
            </span>
          </span>
          <span className="m-go">›</span>
        </button>
      ))}
      {chars.length === 0 && (
        <div className="m-emptybox">
          没有读到角色存档
          <br />
          <span>在「设置」里从 D2R Mobile 导入 save 文件夹。</span>
        </div>
      )}
      <div className="m-hintline m-small">从 D2R Mobile 文件夹考入的存档会出现在这里</div>
    </div>
  );
}

export function SubTabs({ sub, onSub }: { sub: SubPage; onSub: (sub: SubPage) => void }) {
  return (
    <div className="m-subtabs">
      {(
        [
          ['attrs', '属性'],
          ['equip', '装备'],
          ['merc', '佣兵'],
        ] as const
      ).map(([id, label]) => (
        <button key={id} className={sub === id ? 'on' : ''} onClick={() => onSub(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}
