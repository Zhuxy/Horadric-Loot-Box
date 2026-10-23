import { activeItems } from './charstats';
import type { D2Character } from './d2s';
import { socketStats } from './describe';
import { GD, statByName } from './gamedata';
import { ItemMode, type ItemStat } from './item';

/**
 * Skill levels as the game shows them: hard points from the save's skill section,
 * plus gear bonuses from everything the character is wearing and carrying
 * (activeItems: worn gear on the active weapon swap, plus charms in the backpack).
 */

const ALL_SKILLS = statByName('item_allskills')?.id;
const ADD_CLASS = statByName('item_addclassskills')?.id;
const ADD_TAB = statByName('item_addskill_tab')?.id;
const SINGLE = statByName('item_singleskill')?.id;
const NONCLASS = statByName('item_nonclassskill')?.id;

/** The class's own skills, in skill-id order (the order the save's skill section uses). */
function classSkills(ch: D2Character) {
  return Object.entries(GD.skills)
    .filter(([, s]) => s.cls === ch.classId)
    .map(([id, s]) => ({ id: Number(id), ...s }))
    .sort((a, b) => a.id - b.id);
}

/** Hard points per skill id, read from the save's skill section (one byte per class skill, id order). */
export function baseSkillPoints(ch: D2Character): Map<number, number> {
  const byClass = classSkills(ch);
  const bytes = ch.head.subarray(ch.statsAt.end + 2, ch.statsAt.end + 2 + byClass.length);
  const out = new Map<number, number>();
  byClass.forEach((s, i) => out.set(s.id, bytes[i] ?? 0));
  return out;
}

interface GearSkillEffects {
  /** Bonus levels for the character's own skills. */
  bonus: Map<number, number>;
  /** Levels of other classes' skills granted by gear (oskills), summed per skill. */
  granted: Map<number, number>;
}

function gearSkillEffects(ch: D2Character): GearSkillEffects {
  const byClass = classSkills(ch);
  const bonus = new Map<number, number>();
  const granted = new Map<number, number>();
  const add = (map: Map<number, number>, id: number, n: number) => {
    if (n) map.set(id, (map.get(id) ?? 0) + n);
  };
  const apply = (s: ItemStat) => {
    if (!s.value) return;
    if (s.id === ALL_SKILLS) byClass.forEach((sk) => add(bonus, sk.id, s.value));
    else if (s.id === ADD_CLASS && s.param === ch.classId) byClass.forEach((sk) => add(bonus, sk.id, s.value));
    else if (s.id === ADD_TAB && s.param >> 3 === ch.classId) {
      // the tab in the param is 0-based; GD pages are 1-based (verified against item text:
      // param 9 on a Sorceress amulet reads "+3 to Lightning Skills", the second tree)
      const page = (s.param & 7) + 1;
      byClass.filter((sk) => sk.page === page).forEach((sk) => add(bonus, sk.id, s.value));
    } else if (s.id === SINGLE && GD.skills[s.param]?.cls === ch.classId) add(bonus, s.param, s.value);
    else if (s.id === NONCLASS) {
      const target = GD.skills[s.param];
      if (!target || target.cls < 0) return;
      // an oskill of the character's own class counts, but the game caps it at +3
      if (target.cls === ch.classId) add(bonus, s.param, Math.min(s.value, 3));
      else add(granted, s.param, s.value);
    }
  };
  const items = activeItems(ch);
  for (const item of items) {
    item.stats.forEach(apply);
    item.runewordStats.forEach(apply);
    for (const socket of item.sockets) socketStats(item, socket).forEach(apply);
  }
  // set bonuses that are active with this many pieces
  const setCount = new Map<string, number>();
  for (const item of items) {
    if (item.mode !== ItemMode.Equipped || item.setId === undefined) continue;
    const key = GD.setItems[item.setId]?.setKey;
    if (key) setCount.set(key, (setCount.get(key) ?? 0) + 1);
  }
  for (const item of items) {
    if (item.setId === undefined) continue;
    const key = GD.setItems[item.setId]?.setKey;
    const n = key ? (setCount.get(key) ?? 0) : 0;
    item.setBonusStats.forEach((list, i) => {
      if (n >= i + 2) list.forEach(apply);
    });
  }
  return { bonus, granted };
}

/** Bonus levels gear gives to the character's own skills (all/class/tab/single + capped own-class oskills). */
export function gearSkillBonuses(ch: D2Character): Map<number, number> {
  return gearSkillEffects(ch).bonus;
}

/** Other classes' skills the gear grants (oskills), with their total level. */
export function grantedSkills(ch: D2Character): { id: number; name: string; level: number }[] {
  return [...gearSkillEffects(ch).granted.entries()]
    .map(([id, level]) => ({ id, name: GD.skills[id]?.name ?? String(id), level }))
    .sort((a, b) => a.id - b.id);
}

export interface SkillLevelInfo {
  id: number;
  name: string;
  /** The game's description text for the skill, when it has one. */
  desc?: string;
  page: number;
  /** In-game tree position (1-based): row = tier 1–6, col = 1–3. */
  row: number;
  col: number;
  icon?: number;
  reqLevel: number;
  prereq: number[];
  base: number;
  bonus: number;
  total: number;
}

export interface SkillTreeInfo {
  page: number;
  skills: SkillLevelInfo[];
}

const TIER_LEVELS = [1, 6, 12, 18, 24, 30];

/** Every skill of the character's three trees, positioned as in the game's skill panel. */
export function skillTreeInfo(ch: D2Character): SkillTreeInfo[] {
  const base = baseSkillPoints(ch);
  const { bonus } = gearSkillEffects(ch);
  const trees = new Map<number, SkillLevelInfo[]>();
  for (const sk of classSkills(ch)) {
    if (sk.page < 1 || sk.page > 3) continue;
    const b = base.get(sk.id) ?? 0;
    const g = bonus.get(sk.id) ?? 0;
    const row = sk.row ?? TIER_LEVELS.findIndex((lv) => sk.reqLevel <= lv) + 1;
    const list = trees.get(sk.page) ?? [];
    list.push({
      id: sk.id,
      name: sk.name,
      desc: sk.desc,
      page: sk.page,
      row: row > 0 ? row : 1,
      col: sk.col ?? ((list.length % 3) + 1),
      icon: sk.icon,
      reqLevel: sk.reqLevel,
      prereq: sk.prereq ?? [],
      base: b,
      bonus: g,
      total: b + g,
    });
    trees.set(sk.page, list);
  }
  return [...trees.entries()].sort((a, b) => a[0] - b[0]).map(([page, skills]) => ({ page, skills }));
}
