// Copies the class skill icons the mobile skill-tree page shows out of a D2R spell-icon export
// (the `d2r-skill-icons` tool: frames cut from `data:data/hd/global/ui/Spells/<class>/*SkillIcon.sprite`).
//
// Only the frames the game data actually references are copied, into the mobile public dir, which is
// what ships in the iOS bundle. The atlas holds a dimmed duplicate of every icon in the odd frames;
// skills use the even ("lit") frame, so those are the only ones needed.
//
//   npm run icons                      # reads $SKILL_ICON_SRC, else ~/Games/d2r-skill-icons
//   node scripts/copy-skill-icons.mjs /path/to/d2r-skill-icons
//
// gamedata.json (not the export's CSV) is the source of truth for which (class, frame) pairs are used,
// so the icon set can never drift from the skills the app knows about.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public-mobile/skills');

/** Export folder per class name (the game's own folder/casing, which is inconsistent: `paladin`). */
const EXPORT_FOLDERS = {
  Amazon: 'amazon/AmSkillIcon',
  Sorceress: 'Sorceress/SoSkillIcon',
  Necromancer: 'Necromancer/NeSkillIcon',
  Paladin: 'paladin/PaSkillIcon',
  Barbarian: 'Barbarian/BaSkillIcon',
  Druid: 'Druid/DrSkillIcon',
  Assassin: 'Assassin/AsSkillIcon',
  Warlock: 'Warlock/WaSkillIcon',
};

const src = path.resolve(process.argv[2] ?? process.env.SKILL_ICON_SRC ?? path.join(os.homedir(), 'Games/d2r-skill-icons'));
if (!fs.existsSync(path.join(src, 'icons'))) {
  console.error(`No icon export at ${src}. Pass the d2r-skill-icons folder as an argument or set SKILL_ICON_SRC.`);
  process.exit(1);
}

const gamedata = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/core/data/gamedata.json'), 'utf8'));

fs.rmSync(OUT, { recursive: true, force: true });
let copied = 0;
let bytes = 0;
for (const skill of Object.values(gamedata.skills)) {
  if (skill.cls < 0 || skill.icon === undefined) continue;
  const name = gamedata.classes[skill.cls]?.name;
  const folder = EXPORT_FOLDERS[name];
  if (!folder) {
    console.error(`No icon export folder for class ${name} (skill ${skill.key})`);
    process.exit(1);
  }
  const file = `${String(skill.icon).padStart(2, '0')}.png`;
  const from = path.join(src, 'icons', folder, file);
  if (!fs.existsSync(from)) {
    console.error(`Missing icon ${from} for skill ${skill.key}`);
    process.exit(1);
  }
  const to = path.join(OUT, name.toLowerCase(), file);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  copied++;
  bytes += fs.statSync(to).size;
}

console.log(`Copied ${copied} skill icons (${Math.round(bytes / 1024)} KB) to public-mobile/skills`);
