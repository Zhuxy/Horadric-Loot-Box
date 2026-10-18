import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseImportFile } from '../src/core/import';
import { itemBytes, transcodeItem, type D2Item } from '../src/core/item';

const FIX = path.join(__dirname, 'fixtures', 'd2r-items');
const MANIFEST: {
  file: string;
  saveVersion: number;
  code: string;
  quality: string;
  name: string;
}[] = JSON.parse(fs.readFileSync(path.join(FIX, 'MANIFEST.json'), 'utf8'));

const load = (file: string) => new Uint8Array(fs.readFileSync(path.join(FIX, file)));

/** The parts of an item that must be identical after a version conversion. */
const shape = (it: D2Item): string =>
  JSON.stringify({
    code: it.code,
    compact: it.compact,
    quality: it.quality,
    itemLevel: it.itemLevel,
    uniqueId: it.uniqueId,
    setId: it.setId,
    prefixes: it.prefixes,
    suffixes: it.suffixes,
    defense: it.defense,
    maxDurability: it.maxDurability,
    durability: it.durability,
    quantity: it.quantity,
    advancedStackSize: it.advancedStackSize,
    socketCount: it.socketCount,
    setMask: it.setMask,
    stats: it.stats,
    setBonusStats: it.setBonusStats,
    runewordStats: it.runewordStats,
    sockets: it.sockets.map(shape),
  });

describe('parseImportFile with a target version', () => {
  // The whole reason for the conversion: a .d2i carries no version, and a file only accepts items
  // encoded with its own version, so importing an old export used to be refused as a version mismatch.
  it('converts every fixture into a valid, unchanged v105 item', () => {
    for (const m of MANIFEST) {
      const detected = parseImportFile(load(m.file));
      const imported = parseImportFile(load(m.file), 105);
      expect(imported.saveVersion).toBe(105);
      expect(imported.code).toBe(m.code);
      expect(shape(imported)).toBe(shape(detected));
      // a converted item must be stable when written to and read back from a v105 file
      expect(itemBytes(parseImportFile(itemBytes(imported), 105))).toEqual(itemBytes(imported));
    }
  });

  it('still reports the detected source version when no target is given', () => {
    // The Cat's Eye parses as v104 (a v105 parse misaligns), so without a target its own version is kept.
    const item = parseImportFile(load('unique/0001_amu_The_Cat_s_Eye.d2i'));
    expect(item.saveVersion).toBeLessThan(105);
  });

  it('keeps the same-version bytes untouched', () => {
    const m = MANIFEST.find((x) => x.saveVersion === 98)!;
    const item = parseImportFile(load(m.file));
    expect(transcodeItem(item, item.saveVersion)).toBe(item);
  });

  it('carries a personalized name across the 7-bit/8-bit boundary', () => {
    const src = parseImportFile(load('unique/0148_mac_GGM_NorthStar_s_Crushflange.d2i'));
    expect(src.personalizedName).toBe('GGM_NorthStar');
    const v97 = transcodeItem(src, 97);
    expect(v97.saveVersion).toBe(97);
    expect(v97.personalizedName).toBe('GGM_NorthStar');
    const back = transcodeItem(v97, 105);
    expect(back.personalizedName).toBe('GGM_NorthStar');
    expect(parseImportFile(itemBytes(back), 105).personalizedName).toBe('GGM_NorthStar');
  });
});
