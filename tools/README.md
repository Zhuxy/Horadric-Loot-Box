# tools

Helper scripts that are not part of the app build.

## `read_switch_art.py`

Reads D2R item artwork out of the **Nintendo Switch** game data that
[D2R Mobile](https://github.com/jhaizhou-ops/d2r-mobile) runs (game version
3.3.94012 / Switch 1.0.34.0). This is the data set the desktop app cannot read on its own:
`src-tauri/src/art.rs` expects a PC CASC install (`.build.info` + `Data/`, opened with
CascLib) or an already-extracted `data/hd/...` folder, whereas the Switch build ships a
console *static CASC* (`data/.build.config` + `data/NN-MMMMMMMM.data`, TVFS path tree,
BLTE blocks).

The script reads that storage directly and decodes the sprites. Two things differ from the
PC data and are handled here:

| | PC (what `art.rs` expects) | Switch (this script) |
|---|---|---|
| storage | CASC with `.build.info` | `.build.config` -> vfs-1 TVFS -> path tree -> EKey -> `NN-MMMMMMMM.data` |
| item sprite | `SpA1` v61 = DXT5/BC3, **linear** | `SpA1` v61 = DXT5/BC3, **Tegra block-linear** |

All 444 item sprites in this pack are v61 and every one needs de-swizzling before the DXT5
blocks can be decoded, so a straight reuse of `art.rs`'s `decode_bc3` would produce scrambled
icons. The de-swizzle here is a port of D2R Mobile's `dm/gfx/tex/nvn_deswizzle.c`; outputs
match that reference implementation byte for byte.

Pure standard library - no Pillow, no numpy, no C compiler.

### Data it needs

The D2R Mobile **resources** folder holds the 18 `.data` archives but **not** the index.
The index the app itself uses (`.build.config` plus its own `00-0000000N.data`) lives in the
app bundle at `DmIOS.app/romfs_overlay/data/`. Pass both:

```sh
export SWITCH_DATA_DIRS="/path/to/D2R Mobile Resources:/path/to/DmIOS.app/romfs_overlay"
```

(or repeat `--data-dir`). The contract file is taken from whichever folder has `.build.config`;
archives are looked up in all of them.

### Commands

```sh
# decode a few known sprites, write PNGs, and check they came out sane
python3 tools/read_switch_art.py selftest --out /tmp/art

# every item sprite in the pack (optionally decode each header)
python3 tools/read_switch_art.py list --filter rune
python3 tools/read_switch_art.py list --versions

# one sprite by logical path
python3 tools/read_switch_art.py extract data/hd/global/ui/items/weapon/axe/hand_axe.sprite --out /tmp/art

# resolve a game item code through the game's own tables (items/uniques/sets.json), then decode
python3 tools/read_switch_art.py item hax
python3 tools/read_switch_art.py item the_gnasher
python3 tools/read_switch_art.py item civerbs_ward

# dump everything: viewable PNGs + a folder tree the desktop app reads with no code change
python3 tools/read_switch_art.py export --out ~/D2R-item-art
```

### How many item sprites are there

The pack holds **444** item sprites under `hd/global/ui/items/`. That is the whole set, not a
subset: the game's own tables (`items.json` 692 rows, `uniques.json` 403, `sets.json` 140)
reference **421 distinct art names**, which resolve to **415** sprite files - all of them present
in the pack (0 missing). The remaining 29 files are alternate looks the tables do not name
directly (charm/gem/amulet variants). The number is small because uniques and sets mostly reuse
their base item's artwork.

### Export, and letting the editor read it

`export` writes two things under `--out`:

| output | contents |
|---|---|
| `png/` | all 444 sprites as viewable PNGs |
| `hlb/` | `hd/global/ui/items/**.sprite` (de-swizzled to PC-linear) + `hd/items/{items,uniques,sets}.json` |

The `hlb/` folder is exactly the layout `src-tauri/src/art.rs` expects from an extracted game
folder. In Horadric Loot Box open **Settings -> Items** and pick that folder; the app then shows
the item pictures. No Rust/TS change is needed, because the exported sprites are the same
`SpA1` v61 the PC build uses, only with the DXT5 blocks put back in linear order. This was
verified against the app's own `decode_sprite`/`decode_bc3`: decoding an exported sprite with
that code is byte-for-byte identical to decoding here.

To make the app read the pack *directly* (no export step) later, port the two things this script
does into `art.rs`: a `Source::SwitchCasc` that walks `.build.config` -> TVFS -> EKey -> `.data`,
and the block-linear de-swizzle in `decode_sprite` for v61 sprites.
