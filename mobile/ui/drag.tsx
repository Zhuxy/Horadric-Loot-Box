import { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import { itemSize, type D2Item } from '../../src/core';
import { itemKey, type Store } from '../../src/state/store';
import { isTrayDoc, itemAtSlot, locKey, type ItemLoc } from './model';

export interface DragApi {
  pointerDown: (e: React.PointerEvent, item: D2Item, loc: ItemLoc) => void;
}

export const DragContext = createContext<DragApi>({ pointerDown: () => {} });
export const useDragApi = () => useContext(DragContext);

const DISTANCE = 9;
const DOUBLE_TAP_WINDOW = 330;

type Drop =
  | { kind: 'tray'; ok: true }
  | { kind: 'slot'; docId: string; area: 'equip' | 'merc'; bodyLoc: number; ok: boolean; reason?: string; swapItem?: D2Item }
  | { kind: 'belt'; docId: string; slot: number; ok: boolean; reason?: string }
  | { kind: 'grid'; docId: string; area: string; tab: number; x: number; y: number; ok: boolean; reason?: string };

interface Pending {
  item: D2Item;
  loc: ItemLoc;
  el: HTMLElement;
  pointerId: number;
  x0: number;
  y0: number;
  offX: number;
  offY: number;
  dragging: boolean;
  fromTray: boolean;
  drop: Drop | null;
}

interface Options {
  store: Store;
  trayId: string | undefined;
  trayOpen: boolean;
  closeTray: () => void;
  openTray: () => void;
  onTap: (item: D2Item, loc: ItemLoc) => void;
  onDouble: (item: D2Item, loc: ItemLoc) => void;
  afterChange: () => void;
}

/** Tap / double-tap / hold-and-drag on items (SPEC §6). DOM highlights are painted directly while dragging. */
export function useDragController(opts: Options): DragApi {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const pending = useRef<Pending | null>(null);
  const ghost = useRef<HTMLDivElement | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastTap = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  const hitRaf = useRef(0);
  const hitPos = useRef<{ p: Pending; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = document.createElement('div');
    el.className = 'm-ghost';
    document.body.appendChild(el);
    ghost.current = el;
    return () => {
      el.remove();
      ghost.current = null;
    };
  }, []);

  const clearHighlights = useCallback(() => {
    document.querySelectorAll('.m-drop-ok,.m-drop-bad').forEach((node) => node.classList.remove('m-drop-ok', 'm-drop-bad'));
    document.querySelectorAll<HTMLElement>('.m-drop-hl').forEach((node) => {
      node.style.display = 'none';
      node.classList.remove('m-bad');
    });
    document.querySelectorAll('.m-droptarget').forEach((node) => node.classList.remove('m-droptarget'));
  }, []);

  const cleanup = useCallback(
    (p: Pending) => {
      if (hitRaf.current) {
        cancelAnimationFrame(hitRaf.current);
        hitRaf.current = 0;
      }
      hitPos.current = null;
      ghost.current?.classList.remove('on', 'm-ghost-bad');
      if (ghost.current) ghost.current.style.display = 'none';
      clearHighlights();
      p.el.classList.remove('m-drag-src');
      pending.current = null;
    },
    [clearHighlights],
  );

  const hitTest = useCallback((p: Pending, x: number, y: number) => {
    const { store, trayId } = optsRef.current;
    clearHighlights();
    p.drop = null;
    const hit = document.elementFromPoint(x, y);
    if (!hit) {
      ghost.current?.classList.add('m-ghost-bad');
      return;
    }
    const handle = hit.closest('[data-trayhandle]');
    if (handle && trayId && !p.fromTray) {
      p.drop = { kind: 'tray', ok: true };
      handle.classList.add('m-droptarget');
      ghost.current?.classList.remove('m-ghost-bad');
      return;
    }

    const slot = hit.closest<HTMLElement>('[data-drop="slot"]');
    if (slot) {
      const docId = slot.dataset.doc!;
      const area = slot.dataset.area as 'equip' | 'merc';
      const bodyLoc = Number(slot.dataset.body);
      let check = store.check(p.item, p.loc.docId, { docId, area, bodyLoc });
      let swapItem: D2Item | undefined;
      if (!check.ok && docId === p.loc.docId && (p.loc.kind === 'equip' || p.loc.kind === 'merc')) {
        const occupant = itemAtSlot(store, docId, area, bodyLoc);
        if (occupant) {
          const swap = store.canSwapWorn(docId, p.item, occupant);
          if (swap.ok) {
            check = { ok: true };
            swapItem = occupant;
          }
        }
      }
      p.drop = { kind: 'slot', docId, area, bodyLoc, ok: check.ok, reason: check.reason, swapItem };
      slot.classList.add(check.ok ? 'm-drop-ok' : 'm-drop-bad');
      ghost.current?.classList.toggle('m-ghost-bad', !check.ok);
      return;
    }

    const belt = hit.closest<HTMLElement>('[data-drop="belt"]');
    if (belt) {
      const docId = belt.dataset.doc!;
      const slot = Number(belt.dataset.slot);
      const check = store.check(p.item, p.loc.docId, { docId, area: 'belt', x: slot });
      p.drop = { kind: 'belt', docId, slot, ok: check.ok, reason: check.reason };
      belt.classList.add(check.ok ? 'm-drop-ok' : 'm-drop-bad');
      ghost.current?.classList.toggle('m-ghost-bad', !check.ok);
      return;
    }

    const grid = hit.closest<HTMLElement>('[data-drop="grid"]');
    if (grid) {
      const docId = grid.dataset.doc!;
      const area = grid.dataset.area!;
      const tab = Number(grid.dataset.tab ?? 0);
      const cols = Number(grid.dataset.cols);
      const rows = Number(grid.dataset.rows);
      const cell = Number(grid.dataset.cell);
      const rect = grid.getBoundingClientRect();
      const { w, h } = itemSize(p.item);
      // The frame snaps by the item's own top-left, not the finger: the picture keeps following the finger
      // (no magnet on the ghost), while the frame settles on the nearest cell the item can actually go to.
      const lx = x - p.offX - rect.left;
      const ly = y - p.offY - rect.top;
      const bx = Math.max(0, Math.min(cols - w, Math.floor(lx / cell)));
      const by = Math.max(0, Math.min(rows - h, Math.floor(ly / cell)));
      // Candidates: the nearest in-bounds cell and its neighbours, so the frame can step around an occupied
      // cell but never drift away from the item it belongs to (one cell is the whole search radius).
      const cells: { gx: number; gy: number; d: number }[] = [];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const gx = bx + dx;
          const gy = by + dy;
          if (gx < 0 || gy < 0 || gx > cols - w || gy > rows - h) continue;
          cells.push({ gx, gy, d: (gx * cell - lx) ** 2 + (gy * cell - ly) ** 2 });
        }
      cells.sort((a, b) => a.d - b.d);
      const targetAt = (gx: number, gy: number) =>
        area === 'shared'
          ? ({ docId, area: 'shared', tab, x: gx, y: gy } as const)
          : area === 'stashpage'
            ? ({ docId, area: 'stashpage', page: tab, x: gx, y: gy } as const)
            : ({ docId, area: area as 'inventory' | 'stash' | 'cube', x: gx, y: gy } as const);
      // first legal candidate wins; if none is legal the nearest one is shown red (with its reason on release)
      let pick: { gx: number; gy: number; ok: boolean; reason?: string } | undefined;
      let nearestBad: typeof pick;
      for (const c of cells) {
        const check = store.check(p.item, p.loc.docId, targetAt(c.gx, c.gy));
        if (check.ok) {
          pick = { gx: c.gx, gy: c.gy, ok: true };
          break;
        }
        nearestBad ??= { gx: c.gx, gy: c.gy, ok: false, reason: check.reason };
      }
      pick ??= nearestBad;
      if (!pick) {
        ghost.current?.classList.add('m-ghost-bad');
        return;
      }
      p.drop = { kind: 'grid', docId, area, tab, x: pick.gx, y: pick.gy, ok: pick.ok, reason: pick.reason };
      const hl = grid.querySelector<HTMLElement>('.m-drop-hl');
      if (hl) {
        hl.style.display = 'block';
        hl.style.left = `${pick.gx * cell}px`;
        hl.style.top = `${pick.gy * cell}px`;
        hl.style.width = `${w * cell}px`;
        hl.style.height = `${h * cell}px`;
        hl.classList.toggle('m-bad', !pick.ok);
      }
      ghost.current?.classList.toggle('m-ghost-bad', !pick.ok);
      return;
    }
    ghost.current?.classList.add('m-ghost-bad');
  }, [clearHighlights]);

  const beginDrag = useCallback(
    (p: Pending, e: PointerEvent) => {
      const { closeTray, trayOpen } = optsRef.current;
      const rect = p.el.getBoundingClientRect();
      p.dragging = true;
      // Grip was taken at pointerdown; re-measuring it here would re-anchor the item to wherever the
      // finger happened to be when the drag threshold was crossed (a visible jump, i.e. "not following").
      p.fromTray = isTrayDoc(optsRef.current.store, p.loc.docId);
      const g = ghost.current;
      if (g) {
        g.style.display = 'flex';
        g.style.width = `${rect.width}px`;
        g.style.height = `${rect.height}px`;
        g.classList.add('on');
        g.classList.remove('m-ghost-bad');
        // Carry the item's own picture (and its real footprint) along with the finger.
        const face = p.el.cloneNode(true) as HTMLElement;
        face.classList.add('m-ghost-face');
        g.replaceChildren(face);
      }
      p.el.classList.add('m-drag-src');
      if (p.fromTray && trayOpen) closeTray();
      hitTest(p, e.clientX, e.clientY);
    },
    [hitTest],
  );

  const finishDrag = useCallback(
    (p: Pending) => {
      const { store, trayId, openTray, afterChange } = optsRef.current;
      const drop = p.drop;
      let ok = false;
      if (drop?.ok) {
        if (drop.kind === 'tray' && trayId) {
          ok = store.move(p.item, p.loc.docId, { docId: trayId, area: 'vault' });
        } else if (drop.kind === 'slot') {
          ok = drop.swapItem
            ? store.swapWorn(drop.docId, p.item, drop.swapItem)
            : store.move(p.item, p.loc.docId, { docId: drop.docId, area: drop.area, bodyLoc: drop.bodyLoc });
        } else if (drop.kind === 'belt') {
          ok = store.move(p.item, p.loc.docId, { docId: drop.docId, area: 'belt', x: drop.slot });
        } else if (drop.kind === 'grid') {
          ok =
            drop.area === 'shared'
              ? store.move(p.item, p.loc.docId, { docId: drop.docId, area: 'shared', tab: drop.tab, x: drop.x, y: drop.y })
              : drop.area === 'stashpage'
                ? store.move(p.item, p.loc.docId, { docId: drop.docId, area: 'stashpage', page: drop.tab, x: drop.x, y: drop.y })
                : store.move(p.item, p.loc.docId, {
                    docId: drop.docId,
                    area: drop.area as 'inventory' | 'stash' | 'cube',
                    x: drop.x,
                    y: drop.y,
                  });
        }
        if (ok) afterChange();
      } else if (drop && 'reason' in drop && drop.reason) {
        store.toast('error', drop.reason);
      }
      if (!ok && p.fromTray) openTray();
      if (ok && trayId && drop?.kind === 'tray') {
        const handle = document.querySelector('[data-trayhandle]');
        handle?.classList.remove('m-bump');
        // force the animation to restart
        void (handle as HTMLElement | null)?.offsetWidth;
        handle?.classList.add('m-bump');
      }
    },
    [],
  );

  useEffect(() => {
    /** Coalesce hit-tests to one per frame (each does full-document queries); the ghost still tracks every event. */
    const queueHit = (p: Pending, x: number, y: number) => {
      hitPos.current = { p, x, y };
      if (hitRaf.current) return;
      hitRaf.current = requestAnimationFrame(() => {
        hitRaf.current = 0;
        const q = hitPos.current;
        if (q && pending.current === q.p) hitTest(q.p, q.x, q.y);
      });
    };
    /** Run a queued hit-test immediately, so a drop is decided by the final pointer position. */
    const flushHit = () => {
      if (!hitRaf.current) return;
      cancelAnimationFrame(hitRaf.current);
      hitRaf.current = 0;
      const q = hitPos.current;
      if (q && pending.current === q.p) hitTest(q.p, q.x, q.y);
    };
    const onMove = (e: PointerEvent) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.pointerId) return;
      if (!p.dragging) {
        if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) <= DISTANCE) return;
        beginDrag(p, e);
      }
      e.preventDefault();
      const g = ghost.current;
      if (g) {
        g.style.left = `${e.clientX - p.offX}px`;
        g.style.top = `${e.clientY - p.offY}px`;
      }
      queueHit(p, e.clientX, e.clientY);
    };
    const onUp = (e: PointerEvent) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.pointerId) return;
      if (p.dragging) {
        flushHit();
        finishDrag(p);
        cleanup(p);
        return;
      }
      cleanup(p);
      const key = `${locKey(p.loc)}:${itemKey(p.item)}`;
      const now = Date.now();
      if (lastTap.current.key === key && now - lastTap.current.at < DOUBLE_TAP_WINDOW) {
        clearTimeout(tapTimer.current);
        lastTap.current = { key: '', at: 0 };
        optsRef.current.onDouble(p.item, p.loc);
      } else {
        lastTap.current = { key, at: now };
        clearTimeout(tapTimer.current);
        tapTimer.current = setTimeout(() => optsRef.current.onTap(p.item, p.loc), 250);
      }
    };
    const onCancel = (e: PointerEvent) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.pointerId) return;
      const wasDragging = p.dragging;
      const fromTray = p.fromTray;
      cleanup(p);
      if (wasDragging && fromTray) optsRef.current.openTray();
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      clearTimeout(tapTimer.current);
      if (hitRaf.current) cancelAnimationFrame(hitRaf.current);
      hitRaf.current = 0;
    };
  }, [beginDrag, cleanup, finishDrag, hitTest]);

  return {
    pointerDown: useCallback((e: React.PointerEvent, item: D2Item, loc: ItemLoc) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (pending.current) return;
      clearTimeout(tapTimer.current);
      const el = e.currentTarget as HTMLElement;
      const rect = el.getBoundingClientRect();
      pending.current = {
        item,
        loc,
        el,
        pointerId: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        // The grip is where the finger sits inside the item at press time; the picture follows the finger
        // from there, so it never jumps when the drag starts.
        offX: e.clientX - rect.left,
        offY: e.clientY - rect.top,
        dragging: false,
        fromTray: false,
        drop: null,
      };
    }, []),
  };
}
