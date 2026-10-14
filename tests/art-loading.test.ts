import { describe, expect, test } from 'vitest';
import { Store } from '../src/state/store';
import { createDroppedPlatform } from '../src/platform/dropped';
import type { ArtInfo } from '../src/art';

function store(fail = false) {
  const s = new Store({
    ...createDroppedPlatform(),
    art: {
      open: async (path): Promise<ArtInfo> => {
        if (fail) throw new Error('No artwork');
        return { kind: 'folder', path, sprites: ['weapon/axe/hand_axe'] };
      },
      url: (key) => `hlbart://localhost/${encodeURIComponent(key)}`,
      detectInstalls: async () => [],
      pickFolder: async () => null,
      close: async () => {},
      probe: async (keys) => keys,
    },
  });
  s.setSettings({ itemView: 'tiles', artPath: '/art' });
  return s;
}

describe('artwork loading', () => {
  test('explicit selection switches classic tiles to game art', async () => {
    const s = store();
    await s.loadArt('/new-art');
    expect(s.settings.itemView).toBe('art');
    expect(s.settings.artPath).toBe('/new-art');
    expect(s.artStatus.state).toBe('ready');
  });

  test('startup reload preserves a deliberate classic tiles preference', async () => {
    const s = store();
    await s.loadArt();
    expect(s.settings.itemView).toBe('tiles');
  });

  test('selection preserves game art with names', async () => {
    const s = store();
    s.setSettings({ itemView: 'artNames' });
    await s.loadArt('/new-art');
    expect(s.settings.itemView).toBe('artNames');
  });

  test('failed selection does not change the view or saved path', async () => {
    const s = store(true);
    await s.loadArt('/bad-art');
    expect(s.settings.itemView).toBe('tiles');
    expect(s.settings.artPath).toBe('/art');
    expect(s.artStatus.state).toBe('error');
  });

  test('reopening artwork resets failed image URLs', async () => {
    const s = store();
    await s.loadArt('/art');
    const first = s.art!;
    first.failedImages.add(first.url('weapon/axe/hand_axe'));
    await s.loadArt('/art');
    expect(s.art).not.toBe(first);
    expect(s.art!.failedImages.size).toBe(0);
  });
});
