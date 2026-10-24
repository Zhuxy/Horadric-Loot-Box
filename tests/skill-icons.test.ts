import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import { GD } from '../src/core';
import { skillIconFile } from '../mobile/ui/model';

/** The skill-tree page shows the game's own icon for every skill (scripts/copy-skill-icons.mjs). */
describe('skill icons', () => {
  test('every class skill ships its icon in the mobile bundle', () => {
    const classSkills = Object.entries(GD.skills).filter(([, s]) => s.cls >= 0);
    expect(classSkills).toHaveLength(240); // 8 classes x 30 tree skills
    for (const [id, skill] of classSkills) {
      const file = skillIconFile(Number(id));
      expect(file, `skill ${id} ${skill.key}`).toBeDefined();
      expect(fs.existsSync(`public-mobile/${file}`), `missing public-mobile/${file} for ${skill.key}`).toBe(true);
    }
  });

  test('icon paths follow the class folder and the sprite frame cell', () => {
    expect(skillIconFile(6)).toBe('skills/amazon/00.png'); // Magic Arrow is the Amazon's first frame
    expect(skillIconFile(35)).toBe('skills/amazon/58.png'); // Lightning Fury
    expect(skillIconFile(0)).toBeUndefined(); // Attack is not a class skill
    expect(skillIconFile(9999)).toBeUndefined();
  });
});
