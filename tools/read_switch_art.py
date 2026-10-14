#!/usr/bin/env python3
"""Read item artwork straight out of the Nintendo Switch game data that D2R Mobile uses.

The desktop app (src-tauri/src/art.rs) reads art from a *PC* Diablo II: Resurrected install:
either a CASC storage (opened with CascLib, needs `.build.info` + `Data/`) or a folder that
mirrors the game's `data/hd/...` tree. The Switch build shipped for D2R Mobile is neither of
those - it is a console *static CASC* (`data/.build.config` + `data/NN-MMMMMMMM.data`, paths
resolved through a TVFS path tree and BLTE blocks). This script reads that storage directly,
so we can prove the item images are reachable and decode them.

Two things differ from the PC data and are handled here:

  * storage:   .build.config -> vfs-1 TVFS -> path tree -> container file table (EKey)
               -> data/<chunk>-<archive>.data (BLTE / raw zlib / raw)
  * pixels:    Switch sprites are `SpA1`, and the HD ones are version 61 = DXT5/BC3 stored
               in Tegra *block-linear* (GOB) order. They must be de-swizzled before the DXT5
               blocks can be decoded. (PC sprites are the same format but linear.)

The D2R Mobile "resources" folder only holds the 18 `.data` archives; it does NOT contain the
index (`.build.config`). The index that the app itself uses lives in the app bundle at
`DmIOS.app/romfs_overlay/data/`. This script searches every `--data-dir` it is given for
archives and takes `.build.config` from whichever one has it, so passing the resources folder
plus the app's `romfs_overlay` folder together is enough.

Pure standard library: no Pillow, no numpy, no compiler.

Usage:
  read_switch_art.py list [--filter TEXT] [--versions]
  read_switch_art.py extract <logical/path.sprite> [--out DIR] [--frame N]
  read_switch_art.py item <code> [--kind items|uniques|sets] [--out DIR]
  read_switch_art.py export [--out DIR] [--png-only|--sprites-only]
  read_switch_art.py selftest [--out DIR]

Data folders (repeatable, first found wins for `.build.config`):
  --data-dir DIR      default: $SWITCH_DATA_DIRS (colon separated), else auto-detect
                      ./data, ./romfs_overlay/data, ./resources/data and their `data/` children.
"""

from __future__ import annotations

import argparse
import os
import struct
import sys
import zlib
from pathlib import Path

ITEMS_DIR = "hd/global/ui/items/"


# ---------------------------------------------------------------------------------------------------
# game storage: BLTE container


def blte_decode(raw: bytes) -> bytes:
    """Decode one BLTE container into its bytes."""
    if raw[:4] != b"BLTE":
        raise ValueError("not a BLTE container")
    header_size = struct.unpack(">I", raw[4:8])[0]
    block_count = int.from_bytes(raw[9:12], "big")
    pos, out = header_size, bytearray()
    for i in range(block_count):
        encoded, decoded = struct.unpack(">II", raw[12 + i * 24:20 + i * 24])
        block = raw[pos:pos + encoded]
        if block[:1] == b"N":
            content = block[1:]
        elif block[:1] == b"Z":
            content = zlib.decompress(block[1:])
        else:
            raise ValueError(f"unsupported BLTE block mode {block[:1]!r}")
        if len(content) != decoded:
            raise ValueError("BLTE decoded length mismatch")
        out.extend(content)
        pos += encoded
    return bytes(out)


def decode_storage(raw: bytes) -> bytes:
    """A container-file-table entry is stored as-is, raw zlib, or BLTE. Sniff which."""
    if raw[:4] == b"BLTE":
        return blte_decode(raw)
    if raw[:1] == b"\x78":  # zlib header
        return zlib.decompress(raw)
    return raw


# ---------------------------------------------------------------------------------------------------
# game storage: TVFS path tree (a compressed prefix tree)


def path_entry(tvfs: bytes, pos: int):
    """One path-tree item -> (next pos, leading separator, name, trailing separator, value or None)."""
    pre = post = 0
    name = b""
    value = None
    if tvfs[pos] == 0:
        pre, pos = 1, pos + 1
    if tvfs[pos] != 0xFF:
        length = tvfs[pos]
        name, pos = bytes(tvfs[pos + 1:pos + 1 + length]), pos + 1 + length
    if tvfs[pos] == 0:
        post, pos = 1, pos + 1
    if tvfs[pos] == 0xFF:
        value, pos = struct.unpack(">I", tvfs[pos + 1:pos + 5])[0], pos + 5
    else:
        post = 2
    return pos, pre, name, post, value


def walk_paths(tvfs: bytes, start: int, end: int, prefix: bytes = b""):
    """Yield (path bytes, value) for every file; the value is the offset of its file-table entry."""
    pos, base = start, prefix
    while pos < end:
        pos, pre, name, post, value = path_entry(tvfs, pos)
        prefix = prefix + (b"/" if pre else b"") + name + (b"/" if post else b"")
        if value is None:
            continue
        if value & 0x80000000:  # directory: recurse into its content range
            folder_end = pos + (value & 0x7FFFFFFF) - 4
            yield from walk_paths(tvfs, pos, folder_end, prefix)
            pos = folder_end
        else:
            yield prefix, value
        prefix = base


def _offset_field_size(size: int) -> int:
    return 1 if size <= 0xFF else 2 if size <= 0xFFFF else 3 if size <= 0xFFFFFF else 4


# ---------------------------------------------------------------------------------------------------
# game storage: one opened resource pack


class Pack:
    """A merged view over several folders that each hold `data/*.data` and (one of them) `.build.config`."""

    def __init__(self, data_dirs):
        self.dirs = [Path(d) for d in data_dirs]
        self.config_dir = next((d for d in self.dirs if (d / ".build.config").is_file()), None)
        if self.config_dir is None:
            raise SystemExit(
                "No .build.config found in any --data-dir. The resources folder alone does not\n"
                "carry the index; also pass the app's romfs_overlay folder (it holds .build.config\n"
                "and its own 00-0000000N.data archive)."
            )
        self._index = None

    # -- raw files ----------------------------------------------------------------

    def read_file(self, ekey: bytes, encoded_size: int) -> bytes:
        chunk, archive = ekey[9], ekey[10]
        name = f"{chunk:02d}-{archive:08d}.data"
        offset = int.from_bytes(ekey[11:16], "big")
        for d in self.dirs:
            p = d / name
            if p.is_file():
                with p.open("rb") as f:
                    f.seek(offset)
                    return f.read(encoded_size)
        raise SystemExit(f"archive {name} not found in: {', '.join(str(d) for d in self.dirs)}")

    # -- index --------------------------------------------------------------------

    def index(self) -> dict[str, tuple[bytes, int]]:
        """logical path (lower case, e.g. `data/hd/global/ui/items/...`) -> (EKey, encoded size)."""
        if self._index is not None:
            return self._index
        values = {}
        for line in (self.config_dir / ".build.config").read_text(encoding="utf-8").splitlines():
            if " = " in line and not line.startswith("#"):
                key, value = line.split(" = ", 1)
                values[key] = value
        _, vfs_ekey = values["vfs-1"].split()
        _, vfs_encoded = map(int, values["vfs-1-size"].split())
        tvfs = blte_decode(self.read_file(bytes.fromhex(vfs_ekey), vfs_encoded))
        if tvfs[:4] != b"TVFS":
            raise SystemExit("vfs-1 is not a TVFS manifest")
        path_off, path_size, vfs_off, _, cft_off, cft_size = struct.unpack(">IIIIII", tvfs[12:36])
        cft_field = _offset_field_size(cft_size)
        out: dict[str, tuple[bytes, int]] = {}
        for path, value in walk_paths(tvfs, path_off, path_off + path_size):
            vfs_entry = vfs_off + value
            cft_pos = cft_off + int.from_bytes(tvfs[vfs_entry + 9:vfs_entry + 9 + cft_field], "big")
            ekey = bytes(tvfs[cft_pos:cft_pos + 16])
            encoded = struct.unpack(">I", tvfs[cft_pos + 16:cft_pos + 20])[0]
            out[path.decode("utf-8", "replace").lower()] = (ekey, encoded)
        self._index = out
        return out

    def read(self, logical: str) -> bytes:
        logical = logical.lower().lstrip("/")
        if not logical.startswith("data/"):
            logical = "data/" + logical
        entry = self.index().get(logical)
        if entry is None:
            raise SystemExit(f"not found in the pack: {logical}")
        return decode_storage(self.read_file(*entry))


# ---------------------------------------------------------------------------------------------------
# artwork: SpA1 sprite -> RGBA


def _gob_offset(x: int, y: int) -> int:
    """Byte offset of (x byte, y row) inside one 64x8 GOB."""
    return (x % 64 // 32) * 256 + (y % 8 // 2) * 64 + (x % 32 // 16) * 32 + (y % 2) * 16 + x % 16


def _adj_tile(shift: int, unit: int, dim: int) -> int:
    """Tegra: shrink the block height/ depth until the level is not smaller than one block."""
    if not shift:
        return 0
    x = unit << (shift - 1)
    if x >= dim:
        while shift > 1:
            shift -= 1
            x >>= 1
            if x < dim:
                break
    return shift


def deswizzle_block_linear(src: bytes, row_bytes: int, rows: int, tile_h: int) -> bytes:
    """Tegra block-linear -> linear, for a single-level 2D texture. 16 bytes are contiguous in a GOB."""
    bh = 1 << tile_h
    gobs_x = (row_bytes + 63) // 64
    block = 512 * bh
    out = bytearray(row_bytes * rows)
    for y in range(rows):
        row_base = (y // (8 * bh)) * gobs_x * block + ((y % (8 * bh)) // 8) * 512
        for x in range(0, row_bytes, 16):
            n = min(16, row_bytes - x)
            off = row_base + (x // 64) * block + _gob_offset(x, y)
            out[y * row_bytes + x:y * row_bytes + x + n] = src[off:off + n]
    return bytes(out)


def decode_bc3(buf: bytes, width: int, height: int) -> bytes:
    """DXT5/BC3 -> RGBA. Blocks are linear (de-swizzle first for the Switch textures)."""
    rgba = bytearray(width * height * 4)
    bw = (width + 3) // 4
    for bi in range(bw * ((height + 3) // 4)):
        b = buf[bi * 16:bi * 16 + 16]
        a0, a1 = b[0], b[1]
        alpha = [a0, a1]
        for i in range(2, 8):
            if a0 > a1:
                alpha.append(((8 - i) * a0 + (i - 1) * a1) // 7)
            elif i < 6:
                alpha.append(((6 - i) * a0 + (i - 1) * a1) // 5)
            elif i == 6:
                alpha.append(0)
            else:
                alpha.append(255)
        abits = 0
        for i in range(6):
            abits |= b[2 + i] << (8 * i)

        def color(v):
            r, g = (v >> 11) & 31, (v >> 5) & 63
            bl = v & 31
            return (r << 3) | (r >> 2), (g << 2) | (g >> 4), (bl << 3) | (bl >> 2)

        c0 = color(b[8] | (b[9] << 8))
        c1 = color(b[10] | (b[11] << 8))
        mix = lambda x, y, wx, wy: (  # noqa: E731
            (x[0] * wx + y[0] * wy) // 3,
            (x[1] * wx + y[1] * wy) // 3,
            (x[2] * wx + y[2] * wy) // 3,
        )
        colors = [c0, c1, mix(c0, c1, 2, 1), mix(c0, c1, 1, 2)]
        cbits = b[12] | (b[13] << 8) | (b[14] << 16) | (b[15] << 24)
        bx, by = (bi % bw) * 4, (bi // bw) * 4
        for py in range(4):
            for px in range(4):
                x, y = bx + px, by + py
                if x >= width or y >= height:
                    continue
                i = py * 4 + px
                c = colors[(cbits >> (2 * i)) & 3]
                a = alpha[(abits >> (3 * i)) & 7]
                o = (y * width + x) * 4
                rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3] = c[0], c[1], c[2], a
    return bytes(rgba)


def linear_body(data: bytes):
    """SpA1 -> (version, frame_w, width, height, linear body).

    The body is the storage the sprite would have on PC: raw RGBA for v31, and for v61 the
    DXT5 blocks in *linear* order (the Switch file has them block-linear, so they are
    de-swizzled here). `header = data[:0x28] + body` is a sprite the desktop app's `art.rs`
    decodes with no changes at all.
    """
    if data[:4] != b"SpA1" or len(data) < 0x28:
        raise ValueError("not an SpA1 sprite")
    version, frame_w, width, height = struct.unpack_from("<HHII", data, 4)
    if version == 31:  # raw RGBA, already linear
        body = data[0x28:0x28 + width * height * 4]
        if len(body) != width * height * 4:
            raise ValueError("v31 sprite is truncated")
        return version, frame_w, width, height, body
    if version == 61:  # DXT5/BC3, block-linear on the Switch
        rows = (height + 3) // 4
        row_bytes = ((width + 3) // 4) * 16
        tile_h = _adj_tile(data[23], 8, rows)
        return version, frame_w, width, height, deswizzle_block_linear(data[0x28:], row_bytes, rows, tile_h)
    raise ValueError(f"unsupported sprite version {version}")


def decode_sprite(data: bytes):
    """SpA1 -> (version, frame width, width, height, RGBA)."""
    version, frame_w, width, height, body = linear_body(data)
    if version == 31:
        return version, frame_w, width, height, body
    return version, frame_w, width, height, decode_bc3(body, width, height)


def frame_of(frame_w: int, width: int, height: int, rgba: bytes, index: int) -> tuple[int, int, bytes]:
    """Crop frame `index` out of a multi-frame sheet (frames sit side by side)."""
    fw = frame_w if 0 < frame_w < width else width
    count = width // fw
    if not 0 <= index < count:
        raise SystemExit(f"frame {index} out of range (0..{count - 1})")
    out = bytearray()
    for y in range(height):
        start = (y * width + index * fw) * 4
        out += rgba[start:start + fw * 4]
    return fw, height, bytes(out)


def write_png(path: Path, width: int, height: int, rgba: bytes) -> None:
    """Minimal PNG writer (8-bit RGBA), so this script needs nothing but the standard library."""
    def chunk(tag: bytes, payload: bytes) -> bytes:
        body = tag + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter: none
        raw += rgba[y * width * 4:(y + 1) * width * 4]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


# ---------------------------------------------------------------------------------------------------
# commands


def auto_data_dirs() -> list[Path]:
    here = Path(__file__).resolve().parent.parent
    return [
        here / "romfs_overlay",
        here / "data",
        here / "resources",
    ]


def resolve_dirs(args) -> list[Path]:
    dirs: list[Path] = []
    if args.data_dir:
        dirs = [Path(d) for d in args.data_dir]
    elif os.environ.get("SWITCH_DATA_DIRS"):
        dirs = [Path(d) for d in os.environ["SWITCH_DATA_DIRS"].split(":") if d]
    else:
        dirs = auto_data_dirs()
    # accept either the folder holding `data/` or the `data/` folder itself
    normalized = []
    for d in dirs:
        normalized.append(d / "data" if (d / "data").is_dir() and not (d / ".build.config").is_file() else d)
    present = [d for d in normalized if d.is_dir()]
    if not present:
        raise SystemExit("no data folders found; pass --data-dir")
    return present


def cmd_list(pack: Pack, args) -> int:
    sprites = sorted(p for p in pack.index() if ITEMS_DIR in p and p.endswith(".sprite"))
    if args.filter:
        f = args.filter.lower()
        sprites = [s for s in sprites if f in s]
    print(f"{len(sprites)} item sprite(s)")
    for s in sprites:
        if args.versions:
            data = pack.read(s)
            version, frame_w, w, h = struct.unpack_from("<HHII", data, 4)
            frames = w // frame_w if 0 < frame_w < w else 1
            print(f"  v{version}  {w}x{h}  {frames} frame(s)  {s}")
        else:
            print("  " + s)
    return 0


def cmd_extract(pack: Pack, args) -> int:
    data = pack.read(args.path)
    version, frame_w, width, height, rgba = decode_sprite(data)
    frames = width // frame_w if 0 < frame_w < width else 1
    if args.frame is not None:
        width, height, rgba = frame_of(frame_w, width, height, rgba, args.frame)
        out_name = f"{Path(args.path).stem}.frame{args.frame}.png"
    else:
        out_name = f"{Path(args.path).stem}.png"
    out = (Path(args.out) / out_name) if args.out else Path(out_name)
    write_png(out, width, height, rgba)
    print(f"{args.path}")
    print(f"  SpA1 v{version}, {width}x{height}, {frames} frame(s) -> {out}")
    return 0


SAMPLES = [
    "data/hd/global/ui/items/misc/potion/healing_potion.sprite",
    "data/hd/global/ui/items/misc/rune/zod_rune.sprite",
    "data/hd/global/ui/items/weapon/axe/hand_axe.sprite",
    "data/hd/global/ui/items/armor/shield/buckler.sprite",
    "data/hd/global/ui/items/misc/gem/perfect_skull.sprite",
]

CATEGORIES = ("weapon", "armor", "misc")
TABLES = {
    "items": "data/hd/items/items.json",
    "uniques": "data/hd/items/uniques.json",
    "sets": "data/hd/items/sets.json",
}


def _sprite_path(pack: Pack, asset: str) -> str | None:
    """`items.json` stores assets as `<folder>/<name>` without the top category, and a few
    unique rows use a `../` prefix. Try every category."""
    index = pack.index()
    asset = asset.lower().lstrip("./")  # strip a leading `../`
    for cat in ("", "weapon/", "armor/", "misc/"):
        logical = f"data/{ITEMS_DIR}{cat}{asset}.sprite"
        if logical in index:
            return logical
    return None


def cmd_item(pack: Pack, args) -> int:
    """Resolve a game item code through the game's own tables, then decode its sprite."""
    import json

    kinds = [args.kind] if args.kind else list(TABLES)
    code = args.code.lower()
    for kind in kinds:
        rows = json.loads(pack.read(TABLES[kind]))
        for row in rows:
            key = next(iter(row))
            if key.lower() != code:
                continue
            entry = row[key]
            asset = entry.get("asset") or entry.get("normal")
            if not asset:
                continue
            logical = _sprite_path(pack, asset)
            print(f"{kind}:{key} -> asset={asset} -> {logical}")
            if logical is None:
                print("  no matching .sprite in this pack")
                return 1
            version, frame_w, width, height, rgba = decode_sprite(pack.read(logical))
            out = Path(args.out or ".") / f"{code}.png"
            write_png(out, width, height, rgba)
            print(f"  SpA1 v{version}, {width}x{height} -> {out}")
            return 0
    print(f"item code not found: {args.code}")
    return 1


def cmd_export(pack: Pack, args) -> int:
    """Dump every item sprite, both as viewable PNGs and as a folder tree the editor can read.

    The `hlb/` tree is `hd/global/ui/items/**.sprite` (de-swizzled to PC-linear) plus
    `hd/items/{items,uniques,sets}.json`, i.e. exactly what `art.rs`'s "extracted folder"
    source expects - so the desktop app reads it with no code change.
    """
    index = pack.index()
    sprites = sorted(p for p in index if ITEMS_DIR in p and p.endswith(".sprite"))
    out = Path(args.out or "switch-art-out")
    want_png = not args.sprites_only
    want_sprite = not args.png_only
    n_png = n_sprite = 0
    for logical in sprites:
        data = pack.read(logical)
        version, _frame_w, width, height, body = linear_body(data)
        rel = logical[len("data/"):]  # hd/global/ui/items/<cat>/<name>.sprite
        if want_sprite:
            dst = out / "hlb" / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(data[:0x28] + body)  # header + linear body = a PC-style sprite
            n_sprite += 1
        if want_png:
            rgba = body if version == 31 else decode_bc3(body, width, height)
            write_png(out / "png" / (rel[:-len(".sprite")] + ".png"), width, height, rgba)
            n_png += 1
    if want_sprite:
        for logical in TABLES.values():
            dst = out / "hlb" / logical[len("data/"):]
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(pack.read(logical))
    print(f"{len(sprites)} item sprites")
    if n_png:
        print(f"  PNGs         -> {out / 'png'}")
    if n_sprite:
        print(f"  editor tree  -> {out / 'hlb'}   (Horadric Loot Box: Settings -> Items -> pick this folder)")
    return 0


def cmd_selftest(pack: Pack, args) -> int:
    """Decode a handful of well-known sprites, write PNGs, and assert they came out sane."""
    index = pack.index()
    print(f"index: {len(index)} files, "
          f"{sum(1 for p in index if ITEMS_DIR in p and p.endswith('.sprite'))} item sprites")
    out = Path(args.out or "switch-art-out")
    failures = 0
    for logical in SAMPLES:
        if logical not in index:
            print(f"  SKIP  {logical} (not in this pack)")
            continue
        try:
            version, frame_w, width, height, rgba = decode_sprite(pack.read(logical))
        except Exception as exc:  # noqa: BLE001
            print(f"  FAIL  {logical}: {exc}")
            failures += 1
            continue
        opaque = sum(1 for i in range(3, len(rgba), 4) if rgba[i] > 0)
        coverage = opaque / (width * height)
        path = out / f"{Path(logical).stem}.png"
        write_png(path, width, height, rgba)
        ok = coverage > 0.05
        failures += 0 if ok else 1
        print(f"  {'PASS' if ok else 'FAIL'}  {logical}  v{version} {width}x{height} "
              f"coverage={coverage:.0%} -> {path}")
    print("selftest:", "OK" if failures == 0 else f"{failures} failure(s)")
    return 1 if failures else 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Read D2R item art from the Switch game data (D2R Mobile).")
    parser.add_argument("--data-dir", action="append", help="folder holding data/*.data (repeatable)")
    sub = parser.add_subparsers(dest="command", required=True)

    p_list = sub.add_parser("list", help="list every item sprite in the pack")
    p_list.add_argument("--filter", help="only paths containing this text")
    p_list.add_argument("--versions", action="store_true", help="also decode each header (slower)")
    p_list.set_defaults(func=cmd_list)

    p_ext = sub.add_parser("extract", help="decode one sprite to a PNG")
    p_ext.add_argument("path", help="logical path, e.g. data/hd/global/ui/items/weapon/axe/hand_axe.sprite")
    p_ext.add_argument("--out", help="output folder (default: current folder)")
    p_ext.add_argument("--frame", type=int, help="save only this frame of a multi-frame sheet")
    p_ext.set_defaults(func=cmd_extract)

    p_item = sub.add_parser("item", help="resolve an item code via items/uniques/sets.json and decode it")
    p_item.add_argument("code", help="item code / unique / set key, e.g. hax, the_gnasher")
    p_item.add_argument("--kind", choices=("items", "uniques", "sets"), help="search only this table")
    p_item.add_argument("--out", help="output folder (default: current folder)")
    p_item.set_defaults(func=cmd_item)

    p_exp = sub.add_parser("export", help="dump every item sprite as PNGs and/or an editor-readable tree")
    p_exp.add_argument("--out", default="switch-art-out", help="output folder (default: switch-art-out)")
    p_exp.add_argument("--png-only", action="store_true", help="only write PNGs")
    p_exp.add_argument("--sprites-only", action="store_true", help="only write the editor-readable tree")
    p_exp.set_defaults(func=cmd_export)

    p_self = sub.add_parser("selftest", help="decode a few known sprites and check the result")
    p_self.add_argument("--out", help="output folder (default: switch-art-out)")
    p_self.set_defaults(func=cmd_selftest)

    args = parser.parse_args(argv)
    pack = Pack(resolve_dirs(args))
    print(f"data folders: {', '.join(str(d) for d in pack.dirs)}")
    print(f"index config: {pack.config_dir / '.build.config'}")
    return args.func(pack, args)


if __name__ == "__main__":
    sys.exit(main())
