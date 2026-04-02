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
// VALIDATE ARGS
// ============================================================
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
  return { hash, rarity, rarityStars, species, emoji: SPECIES_EMOJI[species], eye, hat, shiny, stats, peak, dump, maxHp, atk, def };
}

// ============================================================
// BUDDY BRAIN — require from parent project
// ============================================================
let BuddyBrain;
try {
  // Try local copy first (standalone install), then parent project
  BuddyBrain = require(path.join(__dirname, 'buddy-brain'));
} catch (e) {
  try { BuddyBrain = require(path.join(__dirname, '../../buddy-brain')); }
  catch (e2) { console.error('\nCould not load buddy-brain.js'); process.exit(1); }
}

// ============================================================
// GENERATE BUDDY FROM ARENA CODE
// ============================================================
const myBuddy = generateFromHash(arenaCode);

console.log(`\n╔══════════════════════════════════════════╗`);
console.log(`  Buddy Arena — Terminal Player`);
console.log(`╚══════════════════════════════════════════╝\n`);
console.log(`  ${myBuddy.rarityStars} ${myBuddy.rarity.toUpperCase()} ${myBuddy.species.toUpperCase()}  ${myBuddy.emoji}`);
console.log(`  Arena Code: ${arenaCode}`);
console.log(`  Model: ${MODEL}${API_KEY ? ' (with API key)' : ''}`);
console.log(`  Server: ${SERVER_URL}\n`);
console.log(`  Connecting...\n`);

// ============================================================
// LLM STRATEGY EVOLUTION
// ============================================================
let currentStrategy = BuddyBrain.defaultStrategy();
let strategyVersion = 1;

async function evolveStrategyWithLLM(gameHistory) {
  if (MODEL === 'rules' || !API_KEY) return; // no LLM, use default strategy

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

    // Strip markdown code fences if present
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const updates = JSON.parse(jsonMatch[0]);
    if (typeof updates.aggression === 'number') currentStrategy.aggression = Math.max(0, Math.min(100, updates.aggression));
    if (typeof updates.fleeThreshold === 'number') currentStrategy.fleeThreshold = Math.max(0, Math.min(1, updates.fleeThreshold));
    if (typeof updates.healSeekThreshold === 'number') currentStrategy.healSeekThreshold = Math.max(0, Math.min(1, updates.healSeekThreshold));
    if (updates.targetWeights && typeof updates.targetWeights === 'object') {
      currentStrategy.targetWeights = { ...currentStrategy.targetWeights, ...updates.targetWeights };
    }
    strategyVersion++;
    currentStrategy.version = strategyVersion;
    currentStrategy.model = MODEL;
    logStatus(`[AI] Strategy evolved to v${strategyVersion} — aggression=${currentStrategy.aggression}, flee=${currentStrategy.fleeThreshold}`);
  } catch (e) {
    logStatus(`[AI] Strategy evolution failed: ${e.message}`);
  }
}

// ============================================================
// TERMINAL STATUS DISPLAY
// ============================================================
let statusLine = '';
function logStatus(msg) {
  process.stdout.write('\r' + ' '.repeat(80) + '\r');
  console.log(msg);
}

function renderStatus(gameState) {
  if (!gameState) return;
  const me = gameState.me;
  if (!me) return;
  const hpBar = renderBar(me.hp, me.maxHp, 10);
  const hpPct = Math.round((me.hp / me.maxHp) * 100);
  const line = `  Round ${gameState.round || '?'} | HP: ${me.hp}/${me.maxHp} ${hpBar} ${hpPct}% | ATK: ${me.atk} | Kills: ${gameState.kills || 0} | Score: ${gameState.score || 0} | ${gameState.state || 'idle'} | ${gameState.thought || ''}`;
  process.stdout.write('\r' + line.padEnd(120).slice(0, 120));
}

function renderBar(val, max, width) {
  const filled = Math.round((val / max) * width);
  return '[' + '|'.repeat(filled) + '-'.repeat(width - filled) + ']';
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

function connect() {
  try {
    ws = new WebSocket(SERVER_URL);
  } catch (e) {
    console.error(`\nFailed to create WebSocket: ${e.message}\n`);
    process.exit(1);
  }

  ws.on('open', () => {
    reconnectDelay = 1000;
    logStatus(`[+] Connected to ${SERVER_URL}`);

    // Join as verified player using arena code as seed
    ws.send(JSON.stringify({
      type: 'join',
      name: PLAYER_NAME,
      seed: String(arenaCode),
    }));
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'welcome') {
      myId = msg.id;
      arenaW = msg.w || 80;
      arenaH = msg.h || 60;
      walls = new Set(msg.walls || []);
      logStatus(`[✓] Joined as ${myBuddy.emoji} ${myBuddy.species} (${myBuddy.rarity}) — ID: ${myId}`);
      logStatus(`  Arena: ${arenaW}x${arenaH} | HP: ${myBuddy.maxHp} | ATK: ${myBuddy.atk} | DEF: ${myBuddy.def}`);
      logStatus('  Press Ctrl+C to quit.\n');
      if (msg.savedStrategy) {
        currentStrategy = { ...BuddyBrain.defaultStrategy(), ...msg.savedStrategy };
        logStatus(`[AI] Loaded saved strategy v${currentStrategy.version || 1}`);
      }
      isAlive = true;
    }

    if (msg.type === 'full') {
      logStatus(`[!] Arena is full (${msg.queue} in queue). Retrying in 10s...`);
      setTimeout(connect, 10000);
      return;
    }

    if (msg.type === 'kill') {
      if (msg.killer === PLAYER_NAME) {
        kills++;
        roundKills++;
        logStatus(`  [KILL] ${myBuddy.emoji} ${msg.killer} killed ${msg.victimEmoji} ${msg.victim}! Total: ${kills}`);
      } else if (msg.victim === PLAYER_NAME) {
        isAlive = false;
        logStatus(`  [DEAD] ${myBuddy.emoji} ${msg.victim} was killed by ${msg.killerEmoji} ${msg.killer}. Waiting for respawn...`);
      }
    }

    if (msg.type === 'respawn') {
      if (msg.name === PLAYER_NAME) {
        isAlive = true;
        logStatus(`  [RESPAWN] ${myBuddy.emoji} Back in the arena!`);
      }
    }

    if (msg.type === 'state') {
      handleGameState(msg);
    }

    if (msg.type === 'event') {
      logStatus(`  [EVENT] ${msg.msg}`);
    }
  });

  ws.on('close', (code, reason) => {
    logStatus(`\n[!] Disconnected (${code}). Reconnecting in ${reconnectDelay / 1000}s...`);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  });

  ws.on('error', (err) => {
    logStatus(`\n[!] WebSocket error: ${err.message}`);
  });
}

// ============================================================
// GAME STATE HANDLER — runs every server tick (100ms)
// ============================================================
let lastEvolutionTick = 0;
const EVOLUTION_INTERVAL = 500; // evolve every 500 ticks = ~50s

function handleGameState(state) {
  tickCount++;

  // Find my player in the state
  const me = (state.players || []).find(p => p.id === myId);
  if (!me || me.dead || !isAlive) {
    renderStatus(null);
    return;
  }

  // Track stuck
  if (lastPos && lastPos.x === me.x && lastPos.y === me.y) {
    stuckCount++;
  } else {
    stuckCount = 0;
  }
  lastPos = { x: me.x, y: me.y };

  // Build enemies list
  const enemies = (state.players || [])
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

  // Build occupied set (AFK players + non-adjacent live players)
  const occupied = new Set();
  for (const p of (state.players || [])) {
    if (p.id === myId || p.dead) continue;
    if (p.afk) {
      occupied.add(`${p.x},${p.y}`);
      continue;
    }
    const dist = Math.abs(p.x - me.x) + Math.abs(p.y - me.y);
    if (dist > 2) occupied.add(`${p.x},${p.y}`);
  }

  // Determine rank
  const sorted = [...(state.players || [])].sort((a, b) => b.score - a.score);
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

  // Update score/kills from state
  score = me.score || 0;

  // Render status line
  renderStatus({
    round: state.round,
    me: { hp: me.hp, maxHp: me.maxHp, atk: me.atk || myBuddy.atk },
    kills,
    score,
    state: decision.state,
    thought: decision.thought,
  });

  // Periodic LLM strategy evolution
  if (MODEL !== 'rules' && API_KEY && tickCount - lastEvolutionTick >= EVOLUTION_INTERVAL) {
    lastEvolutionTick = tickCount;
    // Record snapshot for history
    gameHistory.push({
      tick: tickCount,
      hp: me.hp, maxHp: me.maxHp,
      kills, score, rank: myRank,
      playerCount: state.playerCount || 0,
      roundKills,
    });
    if (gameHistory.length > 20) gameHistory = gameHistory.slice(-20);
    // Evolve asynchronously
    evolveStrategyWithLLM(gameHistory).catch(() => {});
  }
}

// ============================================================
// CLEAN EXIT
// ============================================================
process.on('SIGINT', () => {
  process.stdout.write('\r' + ' '.repeat(120) + '\r');
  console.log('\n[!] Disconnecting...\n');
  if (ws) ws.close();
  setTimeout(() => {
    console.log(`Final stats: Kills=${kills} | Score=${score} | Arena Code=${arenaCode}`);
    console.log('Come back to buddy-arena.fly.dev to check the leaderboard!\n');
    process.exit(0);
  }, 500);
});

// ============================================================
// START
// ============================================================
connect();
