#!/usr/bin/env node
// find-seed.js — Brute-force find the hash that produces a given buddy
// Usage: node find-seed.js [--species=cat] [--rarity=common] [--eye=@]
//                          [--debug=25] [--patience=83] [--chaos=1] [--wisdom=40] [--snark=9]
//        node find-seed.js --help

'use strict';

const fs = require('fs');
const path = require('path');

// Saved code file
const CODE_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.buddy-arena-code');

// ============================================================
// ALGORITHM CONSTANTS (must stay in sync with buddy-algorithm.js)
// ============================================================
const SPECIES = ['duck','goose','blob','cat','dragon','octopus','owl','penguin','turtle','snail','ghost','axolotl','capybara','cactus','robot','rabbit','mushroom','chonk'];
const SPECIES_EMOJI = {duck:'🦆',goose:'🪿',blob:'🫧',cat:'🐱',dragon:'🐉',octopus:'🐙',owl:'🦉',penguin:'🐧',turtle:'🐢',snail:'🐌',ghost:'👻',axolotl:'🦎',capybara:'🦫',cactus:'🌵',robot:'🤖',rabbit:'🐰',mushroom:'🍄',chonk:'🐡'};
const EYES = ['·','✦','×','◉','@','°'];
const RARITIES = ['common','uncommon','rare','epic','legendary'];
const RARITY_WEIGHTS = {common:60,uncommon:25,rare:10,epic:4,legendary:1};
const RARITY_STARS = {common:'★',uncommon:'★★',rare:'★★★',epic:'★★★★',legendary:'★★★★★'};
const STAT_NAMES = ['DEBUGGING','PATIENCE','CHAOS','WISDOM','SNARK'];
const RARITY_FLOOR = {common:5,uncommon:15,rare:25,epic:35,legendary:50};
const SALT = 'friend-2026-401';

// ============================================================
// RNG & HASH — exact copies from buddy-algorithm.js
// ============================================================
function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

function rollRarity(rng) {
  let roll = rng() * 100;
  for (const r of RARITIES) {
    roll -= RARITY_WEIGHTS[r];
    if (roll < 0) return r;
  }
  return 'common';
}

function rollStats(rng, rarity) {
  const floor = RARITY_FLOOR[rarity];
  const peak = pick(rng, STAT_NAMES);
  let dump = pick(rng, STAT_NAMES);
  while (dump === peak) dump = pick(rng, STAT_NAMES);
  const stats = {};
  for (const name of STAT_NAMES) {
    if (name === peak) stats[name] = Math.min(100, floor + 50 + Math.floor(rng() * 30));
    else if (name === dump) stats[name] = Math.max(1, floor - 10 + Math.floor(rng() * 15));
    else stats[name] = floor + Math.floor(rng() * 40);
  }
  return { stats, peak, dump };
}

// Generate buddy from numeric hash directly (skip string → hash step)
function generateFromHash(hash) {
  const rng = mulberry32(hash);
  const rarity = rollRarity(rng);
  const species = pick(rng, SPECIES);
  const eye = pick(rng, EYES);
  const hat = rarity === 'common' ? 'none' : pick(rng, HATS_PLACEHOLDER);
  const shiny = rng() < 0.01;
  const { stats, peak, dump } = rollStats(rng, rarity);
  return { hash, rarity, species, eye, hat, shiny, stats, peak, dump };
}

// Inline HATS for completeness (needed to advance rng for non-common)
const HATS = ['none','crown','tophat','propeller','halo','wizard','beanie','tinyduck'];

// Regenerate without the placeholder
function generateFromHashFull(hash) {
  const rng = mulberry32(hash);
  const rarity = rollRarity(rng);
  const species = pick(rng, SPECIES);
  const eye = pick(rng, EYES);
  const hat = rarity === 'common' ? 'none' : pick(rng, HATS);
  const shiny = rng() < 0.01;
  const { stats, peak, dump } = rollStats(rng, rarity);
  const maxHp = 50 + Math.floor(stats.PATIENCE / 2) + (RARITY_FLOOR[rarity] * 2) + (species === 'chonk' ? 20 : 0);
  const atk = 5 + Math.floor(stats.SNARK / 8) + Math.floor(stats.CHAOS / 10);
  const def = 2 + Math.floor(stats.PATIENCE / 20);
  const cardNumber = Math.floor(hash % 7128) + 1;
  return { hash, rarity, species, eye, hat, shiny, stats, peak, dump, maxHp, atk, def, cardNumber };
}

// ============================================================
// PARSE ARGS
// ============================================================
const args = {};
for (const arg of process.argv.slice(2)) {
  if (arg === '--help' || arg === '-h') {
    console.log(`
find-seed.js — Find your Buddy Arena Code

Usage:
  node find-seed.js [options]

Options:
  --species=<name>    Buddy species (e.g., cat, duck, robot)
  --rarity=<rarity>   Rarity level: common, uncommon, rare, epic, legendary
  --eye=<char>        Eye character: · ✦ × ◉ @ °
  --debug=<n>         DEBUGGING stat value
  --patience=<n>      PATIENCE stat value
  --chaos=<n>         CHAOS stat value
  --wisdom=<n>        WISDOM stat value
  --snark=<n>         SNARK stat value
  --help              Show this help

Examples:
  node find-seed.js --species=cat --rarity=common --eye=@ --debug=25 --patience=83 --chaos=1 --wisdom=40 --snark=9
  node find-seed.js  (interactive — prompts you for info)

Available species:
  ${SPECIES.join(', ')}
`);
    process.exit(0);
  }
  const m = arg.match(/^--([^=]+)=(.+)$/);
  if (m) args[m[1]] = m[2];
}

// ============================================================
// INTERACTIVE MODE — if required args missing
// ============================================================
function missingArgs() {
  return !args.species || !args.rarity;
}

if (missingArgs()) {
  console.log(`
To find your Buddy Arena Code, run /buddy in Claude Code first, then re-run this script with your buddy's details:

  node find-seed.js \\
    --species=SPECIES \\
    --rarity=RARITY \\
    --eye=EYE_CHAR \\
    --debug=N --patience=N --chaos=N --wisdom=N --snark=N

Example (from running /buddy):
  node find-seed.js --species=cat --rarity=common --eye=@ --debug=25 --patience=83 --chaos=1 --wisdom=40 --snark=9

Available species: ${SPECIES.join(', ')}
Available rarities: ${RARITIES.join(', ')}
Available eyes: ${EYES.join(' ')}
`);
  process.exit(1);
}

// ============================================================
// VALIDATE INPUTS
// ============================================================
const targetSpecies = args.species.toLowerCase();
const targetRarity = args.rarity.toLowerCase();
const targetEye = args.eye || null;  // optional — speeds up search when provided

if (!SPECIES.includes(targetSpecies)) {
  console.error(`Unknown species: ${targetSpecies}`);
  console.error(`Valid: ${SPECIES.join(', ')}`);
  process.exit(1);
}
if (!RARITIES.includes(targetRarity)) {
  console.error(`Unknown rarity: ${targetRarity}`);
  console.error(`Valid: ${RARITIES.join(', ')}`);
  process.exit(1);
}
if (targetEye && !EYES.includes(targetEye)) {
  console.error(`Unknown eye: "${targetEye}"`);
  console.error(`Valid: ${EYES.join(' ')}`);
  process.exit(1);
}

const targetStats = {
  DEBUGGING: args.debug !== undefined ? parseInt(args.debug, 10) : null,
  PATIENCE:  args.patience !== undefined ? parseInt(args.patience, 10) : null,
  CHAOS:     args.chaos !== undefined ? parseInt(args.chaos, 10) : null,
  WISDOM:    args.wisdom !== undefined ? parseInt(args.wisdom, 10) : null,
  SNARK:     args.snark !== undefined ? parseInt(args.snark, 10) : null,
};
const hasStats = Object.values(targetStats).some(v => v !== null);

// ============================================================
// BRUTE FORCE SEARCH
// ============================================================
console.log(`\n  🔍 Searching for ${targetRarity} ${targetSpecies}${targetEye ? ' (eye: ' + targetEye + ')' : ''}...`);
console.log('  This takes 10–30 seconds — scanning up to 4 billion hashes.\n');

const TOTAL = 4294967296; // 2^32
let found = null;
const startTime = Date.now();
let lastPrint = startTime;

// Animated progress bar update every ~1 second
function printProgress(hash) {
  const now = Date.now();
  if (now - lastPrint > 1000) {
    const pct = (hash / TOTAL) * 100;
    const elapsed = ((now - startTime) / 1000).toFixed(0);
    const barWidth = 20;
    const filled = Math.round((pct / 100) * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
    process.stderr.write(`\r  Searching for your buddy... ${bar} ${pct.toFixed(1)}% (${elapsed}s)`);
    lastPrint = now;
  }
}

for (let hash = 0; hash < TOTAL; hash++) {
  if (hash % 1000000 === 0) printProgress(hash);

  // Fast path: check rarity first (most rejects here — 60% are common)
  const rng = mulberry32(hash);
  const rarity = rollRarity(rng);
  if (rarity !== targetRarity) continue;

  // Check species
  const species = pick(rng, SPECIES);
  if (species !== targetSpecies) continue;

  // Check eye (optional but fast)
  const eye = pick(rng, EYES);
  if (targetEye && eye !== targetEye) continue;

  // Advance rng past hat (needed to get to stats)
  const hat = rarity === 'common' ? 'none' : pick(rng, HATS);
  // Advance rng past shiny roll
  const shiny = rng() < 0.01; // consume the value

  // Roll stats
  const floor = RARITY_FLOOR[rarity];
  const peak = pick(rng, STAT_NAMES);
  let dump = pick(rng, STAT_NAMES);
  while (dump === peak) dump = pick(rng, STAT_NAMES);

  const stats = {};
  for (const name of STAT_NAMES) {
    if (name === peak) stats[name] = Math.min(100, floor + 50 + Math.floor(rng() * 30));
    else if (name === dump) stats[name] = Math.max(1, floor - 10 + Math.floor(rng() * 15));
    else stats[name] = floor + Math.floor(rng() * 40);
  }

  // Check stats if provided
  if (hasStats) {
    let match = true;
    for (const name of STAT_NAMES) {
      if (targetStats[name] !== null && stats[name] !== targetStats[name]) {
        match = false;
        break;
      }
    }
    if (!match) continue;
  }

  // Found it!
  found = { hash, rarity, species, eye, hat, shiny, stats, peak, dump };
  break;
}

process.stdout.write('\r' + ' '.repeat(60) + '\r'); // clear progress line

if (!found) {
  console.error('\nNo matching buddy found. Double-check your stats and try again.');
  console.error('Tip: Make sure species, rarity, and stats match exactly what /buddy showed you.');
  process.exit(1);
}

// ============================================================
// DISPLAY BUDDY CARD
// ============================================================
function bar(val, max = 100, width = 10) {
  const filled = Math.round((val / max) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function pad(n, width = 3) {
  return String(n).padStart(width);
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
const stars = RARITY_STARS[found.rarity];
const emoji = SPECIES_EMOJI[found.species];
const speciesUpper = found.species.toUpperCase();
const rarityUpper = found.rarity.toUpperCase();

// Derive display name from stats (same logic as buddy-algorithm + a simple name picker)
const cardNumber = Math.floor(found.hash % 7128) + 1;
const NAMES = ['Ace','Ash','Axel','Blaze','Bolt','Brick','Brisk','Brix','Chase','Cinder','Clay','Cleo','Cliff','Coil','Colt','Crux','Dash','Dawn','Dex','Drake','Drift','Dusk','Echo','Edge','Ember','Fang','Finn','Flare','Flint','Flynn','Forge','Fox','Frey','Frost','Gale','Glow','Grit','Grove','Haze','Hex','Holt','Hook','Hyde','Ice','Iris','Ivy','Jade','Jazz','Jolt','Kane','Keen','Kite','Knox','Kyle','Lane','Lark','Lash','Link','Lore','Lux','Lynx','Mace','Mars','Max','Mire','Mist','Mixe','Mox','Neon','Nix','Nord','Nova','Oak','Onyx','Orb','Oz','Pace','Pax','Pike','Pine','Prism','Pulse','Quill','Quinn','Rave','Ray','Reed','Rex','Ridge','Riot','Rook','Root','Rust','Rye','Sage','Sand','Scout','Shade','Shift','Skye','Slate','Sleet','Sly','Smolt','Sol','Spark','Spike','Spire','Squall','Steel','Stone','Storm','Strand','Strife','Swift','Talon','Taz','Thorn','Tide','Toro','Trace','Trek','Trim','Troy','Tusk','Vex','Vine','Void','Volt','Vox','Wade','Wave','Wisp','Wrath','Wren','Yell','Zap','Zeal','Zest','Zinc','Zion','Zoom'];
const buddyName = NAMES[found.hash % NAMES.length];

// Save code to ~/.buddy-arena-code for quick reuse
try {
  fs.writeFileSync(CODE_FILE, String(found.hash), 'utf8');
} catch (e) { /* ignore write errors */ }

console.log('═══════════════════════════════════════');
console.log('  YOUR BUDDY ARENA CODE');
console.log('═══════════════════════════════════════');
console.log('');
console.log(`  ${stars} ${rarityUpper} ${speciesUpper}  ${emoji}`);
console.log(`  ${buddyName}`);
console.log('');
for (const name of STAT_NAMES) {
  const val = found.stats[name];
  const label = name.padEnd(9);
  console.log(`  ${label}  ${bar(val)}  ${pad(val)}`);
}
console.log('');
console.log(`  Arena Code: ${found.hash}`);
console.log('');
console.log('  → Paste at buddy-arena.fly.dev');
console.log('  → Or run: /buddy-arena play');
console.log('');
if (found.shiny) console.log('  ✨ SHINY — rare variant!');
if (found.hat !== 'none') console.log(`  Hat: ${found.hat}`);
console.log(`  Eye: ${found.eye}  |  Card #${cardNumber}`);
console.log(`  (Found in ${elapsed}s)`);
console.log(`  ✅ Code saved to ~/.buddy-arena-code`);
console.log('═══════════════════════════════════════');
console.log('');
