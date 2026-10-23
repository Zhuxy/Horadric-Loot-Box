import { useMemo, useState } from 'react';
import { grantedSkills, skillTreeInfo, type D2Character, type SkillLevelInfo } from '../../src/core';
import { useStore } from '../../src/ui/context';
import { treeTitle } from './model';

/**
 * Skill-tree page, laid out like the game's own panel: three trees, each a 6-row × 3-column
 * grid in the game's positions, prerequisite links behind the tiles, effective levels
 * (hard points + gear, worn and backpack charms) on every tile.
 */
export function SkillsScreen({ ch }: { ch: D2Character }) {
  const store = useStore();
  // ch is mutated in place; the store rev is the change signal (same pattern as the attributes page)
  const { trees, granted } = useMemo(
    () => ({ trees: skillTreeInfo(ch), granted: grantedSkills(ch) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ch, store.rev],
  );
  const [pageSel, setPageSel] = useState<number | null>(null);
  const [selId, setSelId] = useState<number | null>(null);
  if (!trees.length) return <div className="m-empty">没有技能数据。</div>;
  const invested = (p: number) => trees.find((t) => t.page === p)?.skills.reduce((n, s) => n + s.base, 0) ?? 0;
  const page = trees.some((t) => t.page === pageSel) ? pageSel! : trees.reduce((a, b) => (invested(b.page) > invested(a.page) ? b : a)).page;
  const tree = trees.find((t) => t.page === page)!;
  const byId = new Map(tree.skills.map((s) => [s.id, s]));
  const sel = selId !== null ? byId.get(selId) : undefined;

  const cx = (s: SkillLevelInfo) => (s.col - 0.5) * 100;
  const top = (s: SkillLevelInfo) => (s.row - 1) * 100;
  const bottom = (s: SkillLevelInfo) => s.row * 100;

  return (
    <div className="m-scroll">
      <div className="m-seg m-skillseg">
        {trees.map((t) => (
          <button key={t.page} className={t.page === page ? 'on' : ''} onClick={() => setPageSel(t.page)}>
            {treeTitle(ch, t.page)}
          </button>
        ))}
      </div>
      <div className="m-skillgrid">
        <svg className="m-skilllinks" viewBox="0 0 300 600" preserveAspectRatio="none" aria-hidden>
          {tree.skills.flatMap((s) =>
            s.prereq.map((pid) => {
              const p = byId.get(pid);
              if (!p) return null;
              const midY = (bottom(p) + top(s)) / 2;
              const lit = p.total > 0 && s.total > 0;
              return (
                <path
                  key={`${pid}-${s.id}`}
                  d={`M ${cx(p)} ${bottom(p)} V ${midY} H ${cx(s)} V ${top(s)}`}
                  className={lit ? 'lit' : ''}
                />
              );
            }),
          )}
        </svg>
        {tree.skills.map((s) => (
          <button
            key={s.id}
            className={`m-skilltile${s.total === 0 ? ' dim' : ''}${sel?.id === s.id ? ' sel' : ''}`}
            style={{ gridRow: s.row, gridColumn: s.col }}
            onClick={() => setSelId(s.id)}
          >
            <span className="m-skillname">{s.name}</span>
            {s.total > 0 ? (
              <span className="m-skilllvl">
                {s.total}
                {s.bonus > 0 && <i>+{s.bonus}</i>}
              </span>
            ) : (
              <span className="m-skillreq">Lv {s.reqLevel}</span>
            )}
          </button>
        ))}
      </div>
      <div className="m-skilldetail">
        {sel ? (
          <>
            <div className="m-skilldname">{sel.name}</div>
            <div className="m-skilldline">
              基础 {sel.base} · 装备 +{sel.bonus} · 当前等级 <b>{sel.total}</b>
            </div>
            <div className="m-skilldline m-faint">
              需要等级 {sel.reqLevel}
              {sel.prereq.length > 0 && <> · 前置：{sel.prereq.map((pid) => byId.get(pid)?.name ?? pid).join('、')}</>}
            </div>
          </>
        ) : (
          <div className="m-skilldline m-faint">点任意技能查看详情。等级含身上装备与背包护符的加成（+N 为装备部分）。</div>
        )}
      </div>
      {granted.length > 0 && (
        <div className="m-skillgranted">
          装备赋予：{granted.map((g) => `${g.name} ${g.level}`).join(' · ')}
        </div>
      )}
    </div>
  );
}
