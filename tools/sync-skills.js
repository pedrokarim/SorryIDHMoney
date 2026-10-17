#!/usr/bin/env node
/*
 * sync-skills.js – Rend les skills du dépôt visibles par Claude Code et Codex.
 *
 * Une seule copie de chaque skill, dans `.agents/skills/<nom>/` : c'est là
 * que Codex les lit. Claude Code, lui, lit `.claude/skills/` ; ce script y
 * pose un lien (jonction sous Windows) vers chaque skill de `.agents/skills`.
 *
 * Deux familles de skills :
 *   - les nôtres (browser-bridge, fetch-logo…) : versionnés dans le dépôt ;
 *   - les tiers : listés dans `skills-lock.json`, installés en local seulement
 *     (`npx skills experimental_install`), jamais versionnés.
 *
 * Usage :
 *   node tools/sync-skills.js            liens du projet (.claude/skills)
 *   node tools/sync-skills.js --global   et aussi, dans ~/.claude/skills et
 *                                        ~/.agents/skills, nos skills qui déclarent
 *                                        `metadata.scope: global` (utilisables partout)
 *
 * Le script ne supprime jamais un dossier qui contient un vrai skill : s'il
 * trouve à la place d'un lien une copie différente de celle du dépôt, il le
 * signale et n'y touche pas.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, '.agents', 'skills');
const PROJECT_CLAUDE = path.join(ROOT, '.claude', 'skills');
const GLOBAL_TARGETS = [
  path.join(os.homedir(), '.claude', 'skills'),
  path.join(os.homedir(), '.agents', 'skills'),
];

const withGlobal = process.argv.includes('--global');

function readThirdParty() {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills-lock.json'), 'utf8'));
    return new Set(Object.keys(lock.skills || {}));
  } catch {
    return new Set();
  }
}

/** Le skill déclare-t-il `scope: global` dans son en-tête ? */
function isGlobal(name) {
  const text = fs.readFileSync(path.join(SOURCE, name, 'SKILL.md'), 'utf8');
  const header = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return !!header && /^\s+scope:\s*global\s*$/m.test(header[1]);
}

function listSkills() {
  if (!fs.existsSync(SOURCE)) return [];
  return fs.readdirSync(SOURCE, { withFileTypes: true })
    .filter((entry) => fs.existsSync(path.join(SOURCE, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

/** Cible réelle d'un lien, ou null si ce n'est pas un lien. */
function linkTarget(where) {
  try {
    if (!fs.lstatSync(where).isSymbolicLink()) return null;
    return path.resolve(path.dirname(where), fs.readlinkSync(where));
  } catch {
    return null;
  }
}

function sameFile(a, b) {
  try {
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}

/** Pose `where` → `target`. Rend un court compte rendu. */
function ensureLink(where, target) {
  fs.mkdirSync(path.dirname(where), { recursive: true });

  if (fs.existsSync(where) || linkTarget(where)) {
    const current = linkTarget(where);
    if (current && path.resolve(current) === path.resolve(target)) return 'déjà lié';
    if (current) {
      fs.unlinkSync(where);
    } else {
      // Un vrai dossier : on ne le remplace que s'il est identique au dépôt.
      if (!sameFile(path.join(where, 'SKILL.md'), path.join(target, 'SKILL.md'))) {
        return 'IGNORÉ : copie locale différente du dépôt, à comparer à la main';
      }
      fs.rmSync(where, { recursive: true });
    }
  }

  // « junction » : pas de droits administrateur nécessaires sous Windows ;
  // ignoré ailleurs, où c'est un lien symbolique ordinaire.
  fs.symlinkSync(target, where, 'junction');
  return 'lié';
}

/** Retire les liens du projet qui pointent vers un skill disparu. */
function pruneDangling(dir) {
  if (!fs.existsSync(dir)) return [];
  const removed = [];
  for (const name of fs.readdirSync(dir)) {
    const where = path.join(dir, name);
    const target = linkTarget(where);
    if (target && target.startsWith(SOURCE) && !fs.existsSync(target)) {
      fs.unlinkSync(where);
      removed.push(name);
    }
  }
  return removed;
}

const thirdParty = readThirdParty();
const skills = listSkills();

console.log(`Skills dans .agents/skills : ${skills.length}`);
for (const name of skills) {
  const kind = thirdParty.has(name) ? 'tiers, local' : 'à nous, versionné';
  const target = path.join(SOURCE, name);
  const lines = [`.claude/skills : ${ensureLink(path.join(PROJECT_CLAUDE, name), target)}`];
  if (withGlobal && !thirdParty.has(name) && isGlobal(name)) {
    for (const dir of GLOBAL_TARGETS) lines.push(`${dir} : ${ensureLink(path.join(dir, name), target)}`);
  }
  console.log(`- ${name} (${kind})`);
  for (const line of lines) console.log(`    ${line}`);
}

for (const name of pruneDangling(PROJECT_CLAUDE)) console.log(`- lien mort retiré : .claude/skills/${name}`);

const missing = [...thirdParty].filter((name) => !skills.includes(name));
if (missing.length) {
  console.log(`\nSkills tiers absents (${missing.join(', ')}) : npx skills experimental_install`);
}
