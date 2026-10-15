import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Occupancy } from '../src/core/layout';
import { itemSize } from '../src/core/item';
import { countFittable, parseImportFile, planImport } from '../src/core/import';

const FIX = path.join(__dirname, 'fixtures', 'd2r-items');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(FIX, 'MANIFEST.json'), 'utf8'));

function loadFixture(rel: string, version: number) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(FIX, rel)));
  return parseImportFile(bytes, version);
}

describe('parseImportFile', () => {
  it('round-trips every fixture (sample of 50)', () => {
    const sample = MANIFEST.slice(0, 50);
    for (const m of sample) {
      const item = loadFixture(m.file, m.saveVersion);
      expect(item.code).toBe(m.code);
    }
  });

  it('rejects garbage bytes', () => {
    expect(() => parseImportFile(new Uint8Array([1, 2, 3, 4]), 105)).toThrow();
  });
});

describe('planImport', () => {
  it('places a single item in empty grid', () => {
    const m = MANIFEST.find((x: any) => x.quality === 'unique');
    const item = loadFixture(m.file, m.saveVersion);
    const occ = new Occupancy(10, 10);
    const { placed, discarded } = planImport([{ item, quantity: 1 }], occ);
    expect(placed).toHaveLength(1);
    expect(discarded).toHaveLength(0);
    expect(placed[0].x).toBe(0);
    expect(placed[0].y).toBe(0);
  });

  it('places largest first to reduce fragmentation', () => {
    // 2x2 armor + eight 1x1 charms in a 4x4 grid.
    // Naive order (charms first) would fragment; largest-first packs cleanly.
    const armorEntry = MANIFEST.find((x: any) => {
      const it = loadFixture(x.file, x.saveVersion);
      const s = itemSize(it);
      return s.w === 2 && s.h === 2;
    });
    const charmEntry = MANIFEST.find((x: any) => x.code === 'cm1');
    const armor = loadFixture(armorEntry.file, armorEntry.saveVersion);
    const charm = loadFixture(charmEntry.file, charmEntry.saveVersion);
    const occ = new Occupancy(4, 4);
    const { placed, discarded } = planImport(
      [
        { item: charm, quantity: 8 },
        { item: armor, quantity: 1 },
      ],
      occ,
    );
    // 4x4=16 cells, armor takes 4, charms take 8 → all 9 fit.
    expect(placed).toHaveLength(9);
    expect(discarded).toHaveLength(0);
    // Armor should be at (0,0) since it was placed first (largest).
    const armorPlaced = placed.find((p) => p.item === armor);
    expect(armorPlaced?.x).toBe(0);
    expect(armorPlaced?.y).toBe(0);
  });

  it('discards what does not fit', () => {
    const charmEntry = MANIFEST.find((x: any) => x.code === 'cm1');
    const charm = loadFixture(charmEntry.file, charmEntry.saveVersion);
    const occ = new Occupancy(2, 2); // 4 cells
    const { placed, discarded } = planImport([{ item: charm, quantity: 10 }], occ);
    expect(placed).toHaveLength(4);
    expect(discarded).toHaveLength(1);
    expect(discarded[0].quantity).toBe(6);
  });

  it('does not modify the input occupancy', () => {
    const m = MANIFEST.find((x: any) => x.quality === 'unique');
    const item = loadFixture(m.file, m.saveVersion);
    const occ = new Occupancy(10, 10);
    const before = occ.cells.slice();
    planImport([{ item, quantity: 5 }], occ);
    expect(occ.cells).toEqual(before);
  });

  it('countFittable matches planImport', () => {
    const entries = MANIFEST.filter((x: any) => x.quality === 'unique').slice(0, 5);
    const requests = entries.map((m: any) => ({ item: loadFixture(m.file, m.saveVersion), quantity: 2 }));
    const occ = new Occupancy(10, 4); // character inventory size
    expect(countFittable(requests, occ)).toBe(planImport(requests, occ).placed.length);
  });
});
