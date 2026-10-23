import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import { ItemMode, StorePage, gearSkillBonuses, grantedSkills, parseCharacter, skillTreeInfo, type D2Character } from '../src/core';

const sorc = parseCharacter(new Uint8Array(fs.readFileSync('public/demo/Sorceress.d2s')), 'Sorceress.d2s');
const chaos = parseCharacter(new Uint8Array(fs.readFileSync('tests/fixtures/ChaosSC.d2s')), 'ChaosSC.d2s');
const skill = (ch: D2Character, name: string) => skillTreeInfo(ch).flatMap((t) => t.skills).find((s) => s.name === name)!;

describe('skill tree data', () => {
  test('three trees of ten, uniquely positioned, prerequisites inside the same tree', () => {
    const trees = skillTreeInfo(sorc);
    expect(trees.map((t) => t.page)).toEqual([1, 2, 3]);
    for (const t of trees) {
      expect(t.skills).toHaveLength(10);
      const cells = new Set(t.skills.map((s) => `${s.row},${s.col}`));
      expect(cells.size).toBe(10);
      for (const s of t.skills) {
        expect(s.row).toBeGreaterThanOrEqual(1);
        expect(s.row).toBeLessThanOrEqual(6);
        expect(s.col).toBeGreaterThanOrEqual(1);
        expect(s.col).toBeLessThanOrEqual(3);
        for (const p of s.prereq) expect(t.skills.some((x) => x.id === p)).toBe(true);
      }
    }
    // spot-check the layout against the game's own panel
    expect([skill(sorc, 'Fire Bolt').row, skill(sorc, 'Fire Bolt').col]).toEqual([1, 2]);
    expect([skill(sorc, 'Frozen Orb').row, skill(sorc, 'Frozen Orb').col]).toEqual([6, 1]);
    expect(skill(sorc, 'Meteor').prereq).toContain(skill(sorc, 'Fire Ball').id);
  });

  test('base points from the save plus flat gear bonuses', () => {
    expect(skill(sorc, 'Ice Blast')).toMatchObject({ base: 20, bonus: 5, total: 25 });
    expect(skill(sorc, 'Warmth')).toMatchObject({ base: 1, bonus: 5, total: 6 });
    // a charm-stuffed Warlock: +20 all-skills from gear on a single hard point
    expect(skill(chaos, 'Summon Goatman')).toMatchObject({ base: 1, bonus: 20, total: 21 });
  });

  test('skill-tab bonuses land on the tree the item names (param tab is 0-based)', () => {
    // the demo sorceress owns a "+3 to Lightning Skills" amulet, kept in her stash (inactive).
    // Wearing it must raise only the lightning tree: 5 (her all-skills) + 3.
    const amu = sorc.items.find((i) => i.stats.some((s) => s.id === 188 && s.param === 9))!;
    const wearing: D2Character = {
      ...sorc,
      items: sorc.items.map((i) => (i === amu ? { ...i, mode: ItemMode.Equipped, bodyLoc: 2, page: StorePage.None } : i)),
    };
    expect(skill(wearing, 'Lightning').bonus).toBe(8);
    expect(skill(wearing, 'Fire Bolt').bonus).toBe(5);
    expect(skill(wearing, 'Ice Blast').bonus).toBe(5);
  });

  test('oskills: runeword grants are listed; the inactive swap grants nothing until activated', () => {
    // Enigma's Teleport and Beast's lycanthropy/werebear ride on his active gear
    expect(grantedSkills(chaos)).toEqual([
      { id: 54, name: 'Teleport', level: 1 },
      { id: 224, name: 'Lycanthropy', level: 3 },
      { id: 228, name: 'Werebear', level: 3 },
    ]);
    const flail = chaos.items.find((i) => i.stats.some((s) => s.id === 97))!;
    const swapped: D2Character = {
      ...chaos,
      items: chaos.items.map((i) => (i === flail ? { ...i, bodyLoc: 4 } : i)),
    };
    expect(grantedSkills(swapped)).toEqual([
      { id: 54, name: 'Teleport', level: 1 },
      { id: 146, name: 'Battle Cry', level: 4 },
      { id: 149, name: 'Battle Orders', level: 6 },
      { id: 155, name: 'Battle Command', level: 6 },
      { id: 224, name: 'Lycanthropy', level: 3 },
      { id: 228, name: 'Werebear', level: 3 },
    ]);
    // and they do not leak into the warlock's own tree numbers
    expect(gearSkillBonuses(swapped).get(149)).toBeUndefined();
  });
});
