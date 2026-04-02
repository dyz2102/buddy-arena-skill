#!/usr/bin/env node
// play.js — Play Buddy Arena from the terminal using your Arena Code
// Usage: node play.js --code=906506120 [--server=wss://buddy-arena.fly.dev] [--model=rules|gemini|openrouter] [--key=API_KEY]
//        node play.js --help

'use strict';

// Version check (non-blocking)
const SKILL_VERSION = require(require('path').join(__dirname, '..', 'package.json')).version;
(async () => {
  try {
    const res = await fetch('https://registry.npmjs.org/buddy-arena-skill/latest', { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    if (data.version && data.version !== SKILL_VERSION) {
      console.log(`\n  Update available: ${SKILL_VERSION} → ${data.version}`);
      console.log('  Run: npm install -g buddy-arena-skill\n');
    }
  } catch (e) { /* offline or npm down, skip */ }
})();

const path = require('path');
const fs = require('fs');

// ============================================================
// ANSI COLORS
// ============================================================
const C = {
  reset:   '\x1b[0m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
  white:   '\x1b[37m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
};

// ============================================================
// SAVED CODE FILE
// ============================================================
const CODE_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.buddy-arena-code');

// ============================================================
// HELP
// ============================================================
const args = {};
for (const arg of process.argv.slice(2)) {
  if (arg === '--help' || arg === '-h') {
    console.log(`
play.js — Play Buddy Arena from the terminal

Usage:
  node play.js --code=ARENA_CODE [options]

Required:
  --code=<number>     Your Buddy Arena Code (from find-seed.js or buddy-arena.fly.dev)

Options:
  --server=<url>      WebSocket server URL (default: wss://buddy-arena.fly.dev)
  --model=<name>      AI strategy model: rules, gemini, openrouter (default: rules)
  --key=<api_key>     API key for the chosen model (only sent to LLM provider, NEVER to game server)
  --name=<name>       Display name in the arena (default: Claude)
  --help              Show this help

Models:
  rules       Pure rule-based AI, no API key needed. Fast and reliable.
  gemini      Google Gemini Flash — get a free key at aistudio.google.com
  openrouter  OpenRouter — get a key at openrouter.ai (access many models)

Security:
  Your API key is ONLY sent directly to the LLM provider (Gemini/OpenRouter).
  It is NEVER sent to the game server. The server only receives move commands.

Examples:
  node play.js --code=906506120 --model=rules
  node play.js --code=906506120 --model=gemini --key=AIza...
  node play.js --code=906506120 --model=openrouter --key=sk-or-... --name=MyBuddy
`);
    process.exit(0);
  }
  const m = arg.match(/^--([^=]+)=(.+)$/);
  if (m) args[m[1]] = m[2];
}

// ============================================================
// VALIDATE ARGS — load from saved file if --code not given
// ============================================================
if (!args.code) {
  try {
    const saved = fs.readFileSync(CODE_FILE, 'utf8').trim();
    if (saved && !isNaN(parseInt(saved, 10))) {
      args.code = saved;
      console.log(`${C.dim}  (loaded arena code from ~/.buddy-arena-code)${C.reset}`);
    }
  } catch (e) { /* file doesn't exist */ }
}

if (!args.code) {
  console.error('\nError: --code is required. Run find-seed.js first to get your Arena Code.\n');
  console.error('  node find-seed.js --species=cat --rarity=common --eye=@ --debug=25 ...\n');
  process.exit(1);
}

const arenaCode = parseInt(args.code, 10);
if (isNaN(arenaCode) || arenaCode < 0 || arenaCode > 4294967295) {
  console.error('\nError: --code must be a number between 0 and 4294967295\n');
  process.exit(1);
}

const SERVER_URL = args.server || 'wss://buddy-arena.fly.dev';
const MODEL = args.model || 'rules';
const API_KEY = args.key || null;
const PLAYER_NAME = args.name || 'Claude';

const VALID_MODELS = ['rules', 'gemini', 'openrouter'];
if (!VALID_MODELS.includes(MODEL)) {
  console.error(`\nError: --model must be one of: ${VALID_MODELS.join(', ')}\n`);
  process.exit(1);
}

if ((MODEL === 'gemini' || MODEL === 'openrouter') && !API_KEY) {
  console.error(`\nError: --key is required for model "${MODEL}"\n`);
  console.error('Your API key is ONLY sent to the LLM provider, never to the game server.\n');
  process.exit(1);
}

// ============================================================
// ALGORITHM CONSTANTS — must stay in sync with buddy-algorithm.js
// ============================================================
const SPECIES = ['duck','goose','blob','cat','dragon','octopus','owl','penguin','turtle','snail','ghost','axolotl','capybara','cactus','robot','rabbit','mushroom','chonk'];
const SPECIES_EMOJI = {duck:'🦆',goose:'🪿',blob:'🫧',cat:'🐱',dragon:'🐉',octopus:'🐙',owl:'🦉',penguin:'🐧',turtle:'🐢',snail:'🐌',ghost:'👻',axolotl:'🦎',capybara:'🦫',cactus:'🌵',robot:'🤖',rabbit:'🐰',mushroom:'🍄',chonk:'🐡'};
const EYES = ['·','✦','×','◉','@','°'];
const HATS = ['none','crown','tophat','propeller','halo','wizard','beanie','tinyduck'];
const RARITIES = ['common','uncommon','rare','epic','legendary'];
const RARITY_WEIGHTS = {common:60,uncommon:25,rare:10,epic:4,legendary:1};
const RARITY_STARS = {common:'★',uncommon:'★★',rare:'★★★',epic:'★★★★',legendary:'★★★★★'};
const STAT_NAMES = ['DEBUGGING','PATIENCE','CHAOS','WISDOM','SNARK'];
const RARITY_FLOOR = {common:5,uncommon:15,rare:25,epic:35,legendary:50};

const NAMES = ['Ace','Ash','Axel','Blaze','Bolt','Brick','Brisk','Brix','Chase','Cinder','Clay','Cleo','Cliff','Coil','Colt','Crux','Dash','Dawn','Dex','Drake','Drift','Dusk','Echo','Edge','Ember','Fang','Finn','Flare','Flint','Flynn','Forge','Fox','Frey','Frost','Gale','Glow','Grit','Grove','Haze','Hex','Holt','Hook','Hyde','Ice','Iris','Ivy','Jade','Jazz','Jolt','Kane','Keen','Kite','Knox','Kyle','Lane','Lark','Lash','Link','Lore','Lux','Lynx','Mace','Mars','Max','Mire','Mist','Mixe','Mox','Neon','Nix','Nord','Nova','Oak','Onyx','Orb','Oz','Pace','Pax','Pike','Pine','Prism','Pulse','Quill','Quinn','Rave','Ray','Reed','Rex','Ridge','Riot','Rook','Root','Rust','Rye','Sage','Sand','Scout','Shade','Shift','Skye','Slate','Sleet','Sly','Smolt','Sol','Spark','Spike','Spire','Squall','Steel','Stone','Storm','Strand','Strife','Swift','Talon','Taz','Thorn','Tide','Toro','Trace','Trek','Trim','Troy','Tusk','Vex','Vine','Void','Volt','Vox','Wade','Wave','Wisp','Wrath','Wren','Yell','Zap','Zeal','Zest','Zinc','Zion','Zoom'];

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

function generateFromHash(hash) {
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
  const rarityStars = RARITY_STARS[rarity];
  const name = NAMES[hash % NAMES.length];
  return { hash, rarity, rarityStars, species, emoji: SPECIES_EMOJI[species], eye, hat, shiny, stats, peak, dump, maxHp, atk, def, name };
}

// ============================================================
// BUDDY BRAIN — require from parent project
// ============================================================
let BuddyBrain;
try {
  BuddyBrain = require(path.join(__dirname, 'buddy-brain'));
} catch (e) {
  try { BuddyBrain = require(path.join(__dirname, '../../buddy-brain')); }
  catch (e2) { console.error('\nCould not load buddy-brain.js'); process.exit(1); }
}

// ============================================================
// GENERATE BUDDY FROM ARENA CODE
// ============================================================
const myBuddy = generateFromHash(arenaCode);

// ============================================================
// BOOT BANNER
// ============================================================
const SEP = `${C.bold}${C.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`;

function hpBar(hp, maxHp, width = 10) {
  const filled = Math.max(0, Math.round((hp / maxHp) * width));
  const color = hp / maxHp > 0.5 ? C.green : hp / maxHp > 0.25 ? C.yellow : C.red;
  return color + '█'.repeat(filled) + C.dim + '░'.repeat(width - filled) + C.reset;
}

console.log('');
console.log(SEP);
console.log(`${C.bold}${C.cyan}  🎮 BUDDY ARENA — Live Battle${C.reset}`);
console.log(SEP);
console.log(`  ${myBuddy.emoji} ${C.bold}${myBuddy.name}${C.reset} deployed! (${myBuddy.rarityStars} ${myBuddy.rarity.toUpperCase()} ${myBuddy.species.toUpperCase()})`);
console.log(`  HP: ${myBuddy.maxHp} | ATK: ${myBuddy.atk} | DEF: ${myBuddy.def}`);
console.log(`  Strategy: ${MODEL === 'rules' ? 'Rules Engine' : `AI (${MODEL})`}`);
console.log(SEP);
console.log('');
console.log(`  Connecting to ${SERVER_URL}...`);
console.log('');

// ============================================================
// LLM STRATEGY EVOLUTION
// ============================================================
let currentStrategy = BuddyBrain.defaultStrategy();
let strategyVersion = 1;
let lastStrategyAggression = currentStrategy.aggression;
let lastStrategyFlee = currentStrategy.fleeThreshold;

async function evolveStrategyWithLLM(gameHistory) {
  if (MODEL === 'rules' || !API_KEY) return;

  const prompt = `You are an AI strategy optimizer for a battle royale game called Buddy Arena.

My buddy: ${myBuddy.rarityStars} ${myBuddy.rarity} ${myBuddy.species} (${myBuddy.emoji})
Stats: DEBUGGING=${myBuddy.stats.DEBUGGING}, PATIENCE=${myBuddy.stats.PATIENCE}, CHAOS=${myBuddy.stats.CHAOS}, WISDOM=${myBuddy.stats.WISDOM}, SNARK=${myBuddy.stats.SNARK}
ATK=${myBuddy.atk}, DEF=${myBuddy.def}, MaxHP=${myBuddy.maxHp}

Recent game history:
${JSON.stringify(gameHistory.slice(-5), null, 2)}

Current strategy:
${JSON.stringify({ aggression: currentStrategy.aggression, fleeThreshold: currentStrategy.fleeThreshold, healSeekThreshold: currentStrategy.healSeekThreshold, targetWeights: currentStrategy.targetWeights }, null, 2)}

Based on the game history, suggest ONE small improvement to the strategy. Respond with ONLY a JSON object (no markdown) with fields you want to change:
- aggression (0-100): how aggressively to hunt
- fleeThreshold (0-1): HP % at which to flee
- healSeekThreshold (0-1): HP % at which to seek health
- targetWeights: { lowHp, lowDef, highScore, nearby, realPlayer } (each 0-1, sum ~1)

Keep it conservative — small tweaks only. Only include fields you want to change.`;

  try {
    let responseText = '';

    if (MODEL === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;
      const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const data = await resp.json();
      responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else if (MODEL === 'openrouter') {
      const url = 'https://openrouter.ai/api/v1/chat/completions';
      const body = JSON.stringify({
        model: 'google/gemini-2.0-flash-exp:free',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
      });
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
        body,
      });
      const data = await resp.json();
      responseText = data?.choices?.[0]?.message?.content || '';
    }

    if (!responseText) return;

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const updates = JSON.parse(jsonMatch[0]);
    const prevAgg = currentStrategy.aggression;
    const prevFlee = currentStrategy.fleeThreshold;

    if (typeof updates.aggression === 'number') currentStrategy.aggression = Math.max(0, Math.min(100, updates.aggression));
    if (typeof updates.fleeThreshold === 'number') currentStrategy.fleeThreshold = Math.max(0, Math.min(1, updates.fleeThreshold));
    if (typeof updates.healSeekThreshold === 'number') currentStrategy.healSeekThreshold = Math.max(0, Math.min(1, updates.healSeekThreshold));
    if (updates.targetWeights && typeof updates.targetWeights === 'object') {
      currentStrategy.targetWeights = { ...currentStrategy.targetWeights, ...updates.targetWeights };
    }
    strategyVersion++;
    currentStrategy.version = strategyVersion;
    currentStrategy.model = MODEL;

    // Show evolution summary
    clearStatusLine();
    console.log(`${C.bold}${C.magenta}🧠 Strategy evolved → Gen 1 v${strategyVersion}${C.reset}`);
    if (prevAgg !== currentStrategy.aggression) {
      console.log(`   Aggression: ${prevAgg} → ${currentStrategy.aggression}`);
    }
    if (prevFlee !== currentStrategy.fleeThreshold) {
      console.log(`   Flee threshold: ${(prevFlee*100).toFixed(0)}% → ${(currentStrategy.fleeThreshold*100).toFixed(0)}%`);
    }
  } catch (e) {
    clearStatusLine();
    console.log(`${C.dim}  [AI] Strategy evolution skipped: ${e.message}${C.reset}`);
  }
}

// ============================================================
// TERMINAL STATUS DISPLAY
// ============================================================
let currentStatusLine = '';
let lastStatusRender = 0;
const STATUS_INTERVAL = 2000; // update every 2s

function clearStatusLine() {
  if (currentStatusLine) {
    process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 120) + '\r');
    currentStatusLine = '';
  }
}

function logEvent(msg) {
  clearStatusLine();
  console.log(msg);
}

function renderStatusLine(data) {
  const now = Date.now();
  if (now - lastStatusRender < STATUS_INTERVAL) return;
  lastStatusRender = now;

  const { round, me, aliveCount, totalCount, kills: k, score: s, thought, phase } = data;

  const bar = hpBar(me.hp, me.maxHp);
  const rank = aliveCount ? `#${aliveCount}/${totalCount}` : '';
  const phaseStr = phase ? `Phase ${phase}` : '';
  const thoughtStr = thought ? thought.toUpperCase().slice(0, 15) : '';
  const line = `  Round ${round || '?'} | ${rank} | ${myBuddy.emoji} HP: ${me.hp}/${me.maxHp} ${bar} | K:${k} S:${s} | ${phaseStr} ${thoughtStr}`;

  currentStatusLine = line.slice(0, (process.stdout.columns || 120) - 1);
  process.stdout.write('\r' + currentStatusLine);
}

// ============================================================
// WEBSOCKET CONNECTION & GAME LOOP
// ============================================================
const WebSocket = require('ws');

let ws = null;
let myId = null;
let walls = new Set();
let arenaW = 80, arenaH = 60;
let tickCount = 0;
let kills = 0;
let score = 0;
let stuckCount = 0;
let lastPos = null;
let reconnectDelay = 1000;
let gameHistory = [];
let roundKills = 0;
let roundStartScore = 0;
let isAlive = false;
let currentRound = 0;
let currentPhase = 1;
let totalPlayers = 0;
let alivePlayers = 0;

function connect() {
  try {
    ws = new WebSocket(SERVER_URL);
  } catch (e) {
    console.error(`\nFailed to create WebSocket: ${e.message}\n`);
    process.exit(1);
  }

  ws.on('open', () => {
    reconnectDelay = 1000;
    logEvent(`${C.green}  ✓ Connected!${C.reset} Joining arena...`);

    ws.send(JSON.stringify({
      type: 'join',
      name: PLAYER_NAME,
      seed: String(arenaCode),
    }));
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // ── WELCOME ──
    if (msg.type === 'welcome') {
      myId = msg.id;
      arenaW = msg.w || 80;
      arenaH = msg.h || 60;
      walls = new Set(msg.walls || []);

      console.log('');
      console.log(SEP);
      console.log(`  ${myBuddy.emoji} ${C.bold}${myBuddy.name}${C.reset} is in the arena! (ID: ${myId})`);
      console.log(`  Arena: ${arenaW}×${arenaH} | HP: ${myBuddy.maxHp} | ATK: ${myBuddy.atk} | DEF: ${myBuddy.def}`);
      console.log(SEP);
      console.log(`  ${C.dim}Press Ctrl+C to stop watching.${C.reset}`);
      console.log('');

      if (msg.savedStrategy) {
        currentStrategy = { ...BuddyBrain.defaultStrategy(), ...msg.savedStrategy };
        logEvent(`${C.magenta}  🧠 Loaded saved strategy v${currentStrategy.version || 1}${C.reset}`);
      }
      isAlive = true;
    }

    // ── ARENA FULL ──
    if (msg.type === 'full') {
      logEvent(`${C.yellow}  ⚠️  Arena is full (${msg.queue} in queue). Retrying in 10s...${C.reset}`);
      setTimeout(connect, 10000);
      return;
    }

    // ── KILL / DEATH ──
    if (msg.type === 'kill') {
      const isMyKill = msg.killer === PLAYER_NAME || msg.killerId === myId;
      const isMyDeath = msg.victim === PLAYER_NAME || msg.victimId === myId;

      if (isMyKill) {
        kills++;
        roundKills++;
        logEvent(`${C.bold}${C.yellow}💀 ${myBuddy.name} eliminated ${msg.victimEmoji || ''}${msg.victim}! (+${msg.points || 8} pts)${C.reset}`);
      } else if (isMyDeath) {
        isAlive = false;
        logEvent(`${C.red}  💔 ${myBuddy.name} was eliminated by ${msg.killerEmoji || ''}${msg.killer}. Waiting for respawn...${C.reset}`);
      }
    }

    // ── COMBAT ──
    if (msg.type === 'combat') {
      const isMe = msg.attackerId === myId || msg.attacker === PLAYER_NAME;
      const hitMe = msg.victimId === myId || msg.victim === PLAYER_NAME;
      if (isMe) {
        logEvent(`${C.cyan}  ⚔️  ${myBuddy.name} hit ${msg.victimEmoji || ''}${msg.victim} for ${C.bold}${msg.damage}${C.reset}${C.cyan} dmg!${C.reset}`);
      } else if (hitMe) {
        logEvent(`${C.red}  🛡️  ${msg.attackerEmoji || ''}${msg.attacker} hit ${myBuddy.name} for ${C.bold}${msg.damage}${C.reset}${C.red} dmg!${C.reset}`);
      }
    }

    // ── PICKUP ──
    if (msg.type === 'pickup') {
      const isMe = msg.playerId === myId || msg.player === PLAYER_NAME;
      if (isMe) {
        const itemEmoji = msg.itemType === 'potion' ? '❤️' : msg.itemType === 'sword' ? '🗡️' : msg.itemType === 'shield' ? '🛡️' : '📦';
        logEvent(`${C.green}  ${itemEmoji}  ${myBuddy.name} picked up ${msg.itemType}${msg.delta ? ` (${msg.delta > 0 ? '+' : ''}${msg.delta})` : ''}${C.reset}`);
      }
    }

    // ── EVENT (zone, third party, etc.) ──
    if (msg.type === 'event') {
      const isZone = msg.msg && (msg.msg.toLowerCase().includes('zone') || msg.msg.toLowerCase().includes('shrink') || msg.msg.toLowerCase().includes('phase'));
      const isThirdParty = msg.msg && msg.msg.toLowerCase().includes(PLAYER_NAME.toLowerCase()) && msg.msg.toLowerCase().includes('third');
      if (isZone) {
        logEvent(`${C.yellow}  ⚠️  ${msg.msg}${C.reset}`);
        if (msg.phase) currentPhase = msg.phase;
      } else if (isThirdParty) {
        logEvent(`${C.bold}${C.yellow}  🔥 ${msg.msg}${C.reset}`);
      } else {
        logEvent(`${C.dim}  [event] ${msg.msg}${C.reset}`);
      }
    }

    // ── RESPAWN ──
    if (msg.type === 'respawn') {
      if (msg.name === PLAYER_NAME || msg.id === myId) {
        isAlive = true;
        logEvent(`${C.green}  💚 ${myBuddy.name} is back in the arena!${C.reset}`);
      }
    }

    // ── ROUND END ──
    if (msg.type === 'roundEnd') {
      clearStatusLine();
      console.log('');
      console.log(SEP);
      console.log(`${C.bold}  📊 ROUND ${msg.round || currentRound} RESULTS${C.reset}`);
      console.log(SEP);

      const leaderboard = msg.leaderboard || msg.scores || [];
      let myRank = '?';
      leaderboard.forEach((entry, i) => {
        const isMe = entry.name === PLAYER_NAME || entry.id === myId;
        const rank = i + 1;
        const rankStr = String(rank).padStart(2);
        const nameStr = (entry.emoji || '') + ' ' + (entry.name || 'Unknown');
        const killStr = `${entry.kills || 0}K`;
        const scoreStr = `${entry.score || 0}pts`;
        const arrow = isMe ? `${C.bold}${C.green}  ← YOU${C.reset}` : '';
        if (isMe) myRank = rank;
        const line = `  ${rankStr}. ${nameStr.padEnd(16)} — ${killStr.padStart(3)}  ${scoreStr.padStart(6)}${arrow}`;
        console.log(isMe ? `${C.bold}${C.cyan}${line}${C.reset}` : `${C.dim}${line}${C.reset}`);
      });

      if (MODEL !== 'rules') {
        console.log('');
        console.log(`${C.magenta}  🧠 Strategy: Gen 1 v${strategyVersion} | Aggression: ${currentStrategy.aggression} | Flee: ${(currentStrategy.fleeThreshold*100).toFixed(0)}%${C.reset}`);
      }
      console.log(SEP);
      console.log('');

      // Reset per-round counters
      roundKills = 0;
      roundStartScore = score;
      currentRound = (msg.round || currentRound) + 1;
    }

    // ── STATE (game tick) ──
    if (msg.type === 'state') {
      handleGameState(msg);
    }
  });

  ws.on('close', (code, reason) => {
    clearStatusLine();
    logEvent(`\n${C.yellow}  [!] Disconnected (${code}). Reconnecting in ${reconnectDelay / 1000}s...${C.reset}`);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  });

  ws.on('error', (err) => {
    clearStatusLine();
    logEvent(`${C.red}  [!] WebSocket error: ${err.message}${C.reset}`);
  });
}

// ============================================================
// GAME STATE HANDLER — runs every server tick (100ms)
// ============================================================
let lastEvolutionTick = 0;
const EVOLUTION_INTERVAL = 500; // evolve every 500 ticks = ~50s

function handleGameState(state) {
  tickCount++;

  // Track alive/total player count
  const players = state.players || [];
  totalPlayers = players.length;
  alivePlayers = players.filter(p => !p.dead).length;

  const me = players.find(p => p.id === myId);
  if (!me || me.dead || !isAlive) return;

  // Track stuck
  if (lastPos && lastPos.x === me.x && lastPos.y === me.y) {
    stuckCount++;
  } else {
    stuckCount = 0;
  }
  lastPos = { x: me.x, y: me.y };

  // Build enemies list
  const enemies = players
    .filter(p => p.id !== myId && !p.dead)
    .map(p => ({
      x: p.x, y: p.y,
      hp: p.hp, maxHp: p.maxHp,
      species: p.species,
      atk: p.atk || 5, def: p.def || 2,
      dead: p.dead, afk: !!p.afk,
      isBot: !!p.isBot,
      score: p.score || 0, kills: p.kills || 0,
    }));

  // Build occupied set
  const occupied = new Set();
  for (const p of players) {
    if (p.id === myId || p.dead) continue;
    if (p.afk) {
      occupied.add(`${p.x},${p.y}`);
      continue;
    }
    const dist = Math.abs(p.x - me.x) + Math.abs(p.y - me.y);
    if (dist > 2) occupied.add(`${p.x},${p.y}`);
  }

  // Determine rank
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const myRank = sorted.findIndex(p => p.id === myId) + 1;

  // Build brain context
  const brainCtx = {
    me: {
      x: me.x, y: me.y,
      hp: me.hp, maxHp: me.maxHp,
      atk: me.atk || myBuddy.atk,
      def: me.def || myBuddy.def,
      species: me.species || myBuddy.species,
      dead: me.dead, afk: false,
    },
    enemies,
    items: (state.items || []).map(i => ({ x: i.x, y: i.y, type: i.type })),
    walls,
    occupied,
    arenaW,
    arenaH,
    roundTimeSecs: Math.floor((state.roundTimeLeft || 0) / 1000),
    strategy: currentStrategy,
    tick: tickCount,
    myRank,
    stuckCount,
  };

  const decision = BuddyBrain.decide(brainCtx);
  if (!decision) return;

  if (decision.resetStuck) stuckCount = 0;

  // Send move to server
  const { dx, dy } = decision;
  if ((dx !== 0 || dy !== 0) && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'move', dx, dy }));
  }

  // Update score from state
  score = me.score || 0;
  currentRound = state.round || currentRound;

  // Update status line (throttled)
  renderStatusLine({
    round: state.round,
    me: { hp: me.hp, maxHp: me.maxHp },
    aliveCount: myRank,
    totalCount: alivePlayers,
    kills,
    score,
    thought: decision.thought,
    phase: currentPhase,
  });

  // Periodic LLM strategy evolution
  if (MODEL !== 'rules' && API_KEY && tickCount - lastEvolutionTick >= EVOLUTION_INTERVAL) {
    lastEvolutionTick = tickCount;
    gameHistory.push({
      tick: tickCount,
      hp: me.hp, maxHp: me.maxHp,
      kills, score, rank: myRank,
      playerCount: state.playerCount || 0,
      roundKills,
    });
    if (gameHistory.length > 20) gameHistory = gameHistory.slice(-20);
    evolveStrategyWithLLM(gameHistory).catch(() => {});
  }
}

// ============================================================
// CLEAN EXIT
// ============================================================
process.on('SIGINT', () => {
  clearStatusLine();
  console.log('');
  console.log(SEP);
  console.log(`${C.bold}  Final Stats — ${myBuddy.emoji} ${myBuddy.name}${C.reset}`);
  console.log(`  Kills: ${C.bold}${kills}${C.reset} | Score: ${C.bold}${score}${C.reset} | Arena Code: ${arenaCode}`);
  console.log(`  Come back: ${C.cyan}buddy-arena.fly.dev${C.reset}`);
  console.log(SEP);
  console.log('');
  if (ws) ws.close();
  setTimeout(() => process.exit(0), 500);
});

// ============================================================
// START
// ============================================================
connect();
