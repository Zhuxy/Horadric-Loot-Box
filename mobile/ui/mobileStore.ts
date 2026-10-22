import type { Platform } from '../../src/platform/types';
import { Store } from '../../src/state/store';
import { TRAY_NAME } from './model';

/** How long after the last change the save reaches disk (SPEC §8). */
const SAVE_DEBOUNCE = 500;

let lastSavedAt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<void> | undefined;

export const getLastSavedAt = () => lastSavedAt;

/** Debounced real-time save: every change is written ~500 ms later, no save button. */
export function scheduleSave(store: Store) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flushSave(store), SAVE_DEBOUNCE);
}

/** Writes now (app going to the background, settings actions, undo). */
export async function flushSave(store: Store, isRetry = false): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  if (inFlight) {
    // a rejected save must never wedge later saves: swallow here, state is re-checked below
    try {
      await inFlight;
    } catch {
      /* saveAll reports its own failures */
    }
    if (store.dirtyDocs.some((d) => d.doc)) await flushSave(store, isRetry);
    return;
  }
  if (!store.dirtyDocs.some((d) => d.doc)) return;
  const run = store.saveAll();
  inFlight = run;
  try {
    await run;
  } catch {
    /* saveAll reports its own failures; the finally keeps future saves possible */
  } finally {
    if (inFlight === run) inFlight = undefined;
  }
  if (!store.dirtyDocs.some((d) => d.doc)) {
    lastSavedAt = Date.now();
    // saveAll already emits; this one makes the header pick up the new time
    store.emit();
  } else if (!isRetry) {
    // still dirty — the save failed, or edits landed mid-write (they stay dirty by design):
    // one delayed retry; after that, the next edit's scheduleSave is the retry path
    timer = setTimeout(() => void flushSave(store, true), 2000);
  }
}

export class MobileStore extends Store {
  constructor(platform: Platform) {
    super(platform);
    // The copied resource directory is resolved afresh on every launch.
    // Avoid racing Store.openFolder's background load of a stale saved path.
    this.settings.artPath = undefined;
    // The mobile UI has no read-only switch; never start in a mode the player can't leave.
    this.settings.readOnly = false;
    // Game art when loaded, glyph tiles when not (SPEC §13); no per-device switch.
    this.settings.itemView = 'art';
  }

  protected emptyFolderMessage = '';

  /** Real-time saves are silent: the top bar already shows the save state. */
  override toast(kind: 'info' | 'error' | 'success', text: string) {
    if (kind === 'success' && /^Saved \d+ file/.test(text)) return;
    // The store's desktop wording talks about Ctrl+Z and saving later; mobile writes immediately.
    const mobile = text
      .replace(/Undo with Ctrl\+Z; nothing is written until you save\.?/g, '可以撤销；修改会实时保存。')
      .replace(/Undo with Ctrl\+Z\.?/g, '可以撤销。')
      .replace(/; nothing is written until you save\.?/g, '。');
    super.toast(kind, mobile);
  }

  /** Mobile saves after every change, so take a fresh backup before each write (the app keeps the newest ten). */
  override async saveAll() {
    for (const e of this.docs.values()) if (e.doc) e.backedUp = false;
    await super.saveAll();
  }

  async openFolder(folder: string) {
    await super.openFolder(folder);
    // The tray is an app-private vault document, always present, saved with its items.
    this.ensureTray();
    this.ensureVault();
    lastSavedAt = Date.now();
    this.emit();
  }

  /** The tray lives in a vault-format file, created on first launch. */
  ensureTray(): string {
    for (const [id, e] of this.docs) {
      if (e.doc?.kind === 'vault' && e.doc.name === TRAY_NAME) return id;
    }
    return this.addVault(TRAY_NAME, false, false);
  }

  /** The vault tab needs at least one real vault (the tray is hidden from it). */
  private ensureVault() {
    for (const e of this.docs.values()) {
      if (e.doc?.kind === 'vault' && e.doc.name !== TRAY_NAME) return;
    }
    this.addVault('MainVault', false, false);
  }
}
