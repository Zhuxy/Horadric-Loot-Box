import {
  fingerprint,
  itemBytes,
  itemSize,
  parseItemBytes,
  type D2Item,
} from './item';
import { Occupancy } from './layout';

/**
 * Parses a standalone .d2i file's bytes into an item, validating that the
 * bytes round-trip exactly. The .d2i format is raw itemBytes() output
 * (D2R item bitstream, no JM header, no version header).
 *
 * The source version is auto-detected: v97–v105 are tried in order and the
 * first version that parses AND round-trips byte-for-byte wins. This is
 * necessary because the item bitstream is NOT fully compatible across
 * versions (e.g. v105 added a quantity-present bool that v98 lacks; parsing
 * v98 bytes as v105 misaligns the stream).
 *
 * @param bytes The .d2i file contents.
 * @param hintVersion Version to try first (e.g. the target container's).
 */
export function parseImportFile(bytes: Uint8Array, hintVersion = 105): D2Item {
  // Try hint first, then newest-to-oldest (recent exports are most common).
  const versions = [hintVersion, ...[105, 104, 103, 102, 101, 100, 99, 98, 97].filter((v) => v !== hintVersion)];
  let lastError: Error | undefined;
  for (const v of versions) {
    try {
      const item = parseItemBytes(bytes, v);
      // Round-trip validation: re-serializing must produce identical bytes.
      const rt = itemBytes(item);
      if (rt.length === bytes.length && rt.every((b, i) => b === bytes[i])) {
        return item;
      }
    } catch (e) {
      lastError = e as Error;
    }
  }
  throw lastError ?? new Error('Could not parse item with any D2R version (v97–v105)');
}

export interface ImportRequest {
  item: D2Item;
  /** How many copies the user wants to import. */
  quantity: number;
}

export interface PlacedImport {
  /**
   * The request's item (same reference may appear multiple times for
   * quantity > 1). Callers MUST place via withPlacement(), which copies
   * the raw bytes, never by mutating this object.
   */
  item: D2Item;
  x: number;
  y: number;
}

export interface ImportPlan {
  placed: PlacedImport[];
  /** Items that didn't fit, with the unplaced quantity. */
  discarded: { item: D2Item; quantity: number }[];
}

/**
 * Plans bulk import into a grid using First-Fit-Decreasing: quantities are
 * expanded, items are sorted largest-first to reduce fragmentation, then each
 * is placed with the game's own first-fit scan (Occupancy.findSpot).
 *
 * The occupancy is NOT modified; callers apply placements themselves.
 * For vault (list-based, unlimited) targets, skip this and append directly.
 */
export function planImport(requests: ImportRequest[], occ: Occupancy): ImportPlan {
  // Expand quantities into individual instances.
  const instances: D2Item[] = [];
  for (const r of requests) {
    const q = Math.max(0, Math.floor(r.quantity));
    for (let i = 0; i < q; i++) instances.push(r.item);
  }
  // Largest-first: sort by area desc, then by max side desc for determinism.
  const withSize = instances.map((item) => ({ item, ...itemSize(item) }));
  withSize.sort((a, b) => b.w * b.h - a.w * a.h || Math.max(b.w, b.h) - Math.max(a.w, a.h));

  // Work on a scratch copy so the caller's occupancy is untouched.
  const scratch = new Occupancy(occ.w, occ.h);
  scratch.cells = occ.cells.slice();

  const placed: PlacedImport[] = [];
  const discardedByItem = new Map<D2Item, number>();
  for (const { item, w, h } of withSize) {
    const spot = scratch.findSpot(w, h);
    if (!spot) {
      discardedByItem.set(item, (discardedByItem.get(item) ?? 0) + 1);
      continue;
    }
    // Mark cells on the scratch grid. We mark with a placeholder object
    // cast as D2Item; only identity matters for fits().
    const marker = { __importMarker: true } as unknown as D2Item;
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++) scratch.cells[(spot.y + dy) * scratch.w + spot.x + dx] = marker;
    placed.push({ item, x: spot.x, y: spot.y });
  }
  const discarded = [...discardedByItem.entries()].map(([item, quantity]) => ({ item, quantity }));
  return { placed, discarded };
}

/** Counts how many copies of the requests would fit (for live dialog feedback). */
export function countFittable(requests: ImportRequest[], occ: Occupancy): number {
  return planImport(requests, occ).placed.length;
}

export { fingerprint };
