// buddy-brain.js — Shared AI Decision Engine for Buddy Arena
// Pure functions only. No global state. No DOM. No WebSocket.
// Works in Node.js (require) and browser (script tag / inline).

'use strict';

// ============================================================
// DEFAULT STRATEGY — single source of truth
// ============================================================
function defaultStrategy() {
  return {
    version: 1, model: 'rules', name: 'Default Strategy',
    aggression: 65, fleeThreshold: 0.25, healSeekThreshold: 0.50,
    targetWeights: { lowHp: 0.30, lowDef: 0.20, highScore: 0.15, nearby: 0.25, realPlayer: 0.10 },
    speciesTactics: {
      cactus: { action: 'avoid', reason: 'thorns' },
      ghost: { action: 'ignore', reason: "can't catch" },
      turtle: { action: 'lastPriority', reason: 'too tanky' },
      mushroom: { action: 'hitAndRun', reason: 'poison' },
      dragon: { action: 'kite', reason: 'high crit' },
      cat: { action: 'overkill', reason: 'nine lives' },
      robot: { action: 'earlyKill', reason: 'scales with kills' },
      axolotl: { action: 'burst', reason: 'regens fast' },
      duck: { action: 'normal', reason: '' },
      goose: { action: 'normal', reason: '' },
      blob: { action: 'normal', reason: '' },
      octopus: { action: 'kite', reason: 'high dodge' },
      owl: { action: 'normal', reason: '' },
      penguin: { action: 'normal', reason: '' },
      snail: { action: 'lastPriority', reason: 'high def' },
      capybara: { action: 'normal', reason: '' },
      rabbit: { action: 'ignore', reason: 'high dodge' },
      chonk: { action: 'lastPriority', reason: 'massive HP' },
    },
    itemPriority: ['sword', 'potion', 'shield', 'gold'],
    itemDetourRange: 8,
    movement: { preferCenter: true, wallAvoidance: 3, stuckEscapeAfter: 2, pathfinding: 'greedy' },
    phases: {
      early: { focus: 'farm', aggression: 40, fleeThreshold: 0.30 },
      mid:   { focus: 'hunt', aggression: 85, fleeThreshold: 0.20 },
      late:  { focus: 'survive', aggression: 60, fleeThreshold: 0.35 },
    },
    rules: [
      { if: 'hp < 15%',                          then: 'flee_to_potion',   priority: 100 },
      { if: 'round_time < 15 && rank > 3',        then: 'aggressive_hunt', priority: 95  },
      { if: 'enemy_hp < 20% && distance < 3',    then: 'chase_finish',     priority: 90  },
      { if: 'stuck_count > 1',                    then: 'random_direction', priority: 85  },
      { if: 'adjacent_enemy && my_hp > 50%',      then: 'attack',          priority: 80  },
      { if: 'sword_nearby < 5 && atk < 10',       then: 'grab_sword',      priority: 70  },
    ],
    history: [], llmChanges: [],
  };
}

// ============================================================
// PHASE DETECTION
// ============================================================
function getPhase(roundTimeSecs) {
  const pct = roundTimeSecs / 60;
  if (pct > 0.65) return 'early';
  if (pct > 0.25) return 'mid';
  return 'late';
}

// ============================================================
// TARGET SCORING
// ============================================================
function scoreTarget(enemy, me, weights, tactics) {
  const dist = Math.abs(enemy.x - me.x) + Math.abs(enemy.y - me.y);
  if (dist > 20) return { score: -Infinity, skip: true };
  const tactic = tactics ? tactics[enemy.species] : null;
  if (tactic) {
    if (tactic.action === 'avoid' || tactic.action === 'ignore') return { score: -Infinity, skip: true };
    if (tactic.action === 'lastPriority') return { score: -100 + 10 - dist, skip: false, tactic: tactic.action };
  }
  const hpPct = enemy.hp / enemy.maxHp;
  let s = 0;
  const w = weights || {};
  s += (1 - hpPct) * 40 * ((w.lowHp || 0.30) / 0.30);
  s += (10 - (enemy.def || 3)) * 3 * ((w.lowDef || 0.20) / 0.20);
  s += (enemy.score || 0) * 0.3 * ((w.highScore || 0.15) / 0.15);
  s += (20 - dist) * 1.5 * ((w.nearby || 0.25) / 0.25);
  s += (!enemy.isBot ? 15 : 0) * ((w.realPlayer || 0.10) / 0.10);
  if (tactic && tactic.action === 'earlyKill') s += 20;
  if (tactic && tactic.action === 'burst') s += 10;
  return { score: s, skip: false, tactic: tactic ? tactic.action : 'normal' };
}

// ============================================================
// ITEM SELECTION
// ============================================================
function findBestItem(me, items, strategy) {
  const range = (strategy && strategy.itemDetourRange) || 8;
  const prio = (strategy && strategy.itemPriority) || ['sword', 'potion', 'shield', 'gold'];
  const hpPct = me.hp / me.maxHp;
  let best = null, bestScore = -Infinity;
  for (const it of items) {
    const d = Math.abs(it.x - me.x) + Math.abs(it.y - me.y);
    if (d > range) continue;
    // Skip potions at high HP — waste of time
    if (it.type === 'potion' && hpPct > 0.75) continue;
    const typeIdx = prio.indexOf(it.type);
    let typePri = typeIdx >= 0 ? (prio.length - typeIdx) * 20 : 10;
    // Boost potion priority when hurt
    if (it.type === 'potion') typePri = Math.round(typePri * (1 + (1 - hpPct)));
    // Boost sword/shield — permanent upgrades
    if (it.type === 'sword' || it.type === 'shield') typePri += 15;
    const score = typePri - d * 2;
    if (score > bestScore) { bestScore = score; best = it; }
  }
  return best;
}

// ============================================================
// MOVE TOWARD TARGET — wall-aware, no axis lock
// ============================================================
function moveStep(me, tx, ty, walls, occupied, arenaW, arenaH, tickParity) {
  let dx = 0, dy = 0;
  if (tx > me.x) dx = 1; else if (tx < me.x) dx = -1;
  if (ty > me.y) dy = 1; else if (ty < me.y) dy = -1;

  // Single-axis selection when diagonal
  if (dx !== 0 && dy !== 0) {
    const xDist = Math.abs(tx - me.x);
    const yDist = Math.abs(ty - me.y);
    const totalDist = xDist + yDist;
    if (totalDist <= 2) {
      // Very close — alternate axes to guarantee reaching target
      if (tickParity) dy = 0; else dx = 0;
    } else if (xDist > yDist) {
      dy = 0;
    } else if (yDist > xDist) {
      dx = 0;
    } else {
      // Equal distance — alternate, not random
      if (tickParity) dx = 0; else dy = 0;
    }
  }

  // Wall + occupied check — try selected direction first, then fallbacks
  const tryMove = (tdx, tdy) => {
    if (tdx === 0 && tdy === 0) return false;
    const nx = me.x + tdx;
    const ny = me.y + tdy;
    if (nx < 0 || nx >= arenaW || ny < 0 || ny >= arenaH) return false;
    const key = `${nx},${ny}`;
    if (walls && walls.has(key)) return false;
    // Occupied by a non-enemy (AFK) is blocked
    if (occupied && occupied.has(key)) return false;
    return true;
  };

  if (tryMove(dx, dy)) return { dx, dy };

  // Primary blocked — try swapping axes
  if (dx !== 0 && dy === 0 && tryMove(0, 1)) return { dx: 0, dy: 1 };
  if (dx !== 0 && dy === 0 && tryMove(0, -1)) return { dx: 0, dy: -1 };
  if (dy !== 0 && dx === 0 && tryMove(1, 0)) return { dx: 1, dy: 0 };
  if (dy !== 0 && dx === 0 && tryMove(-1, 0)) return { dx: -1, dy: 0 };

  // Both original blocked — try all four dirs
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [tdx, tdy] of dirs) {
    if (tryMove(tdx, tdy)) return { dx: tdx, dy: tdy };
  }

  return { dx: 0, dy: 0 };
}

// ============================================================
// RULE ENGINE
// ============================================================
function evalRule(rule, ctx) {
  const c = rule.if;
  if (c === 'hp < 15%') return ctx.hpPct < 0.15;
  if (c === 'enemy_hp < 20% && distance < 3') {
    // Check ALL nearby enemies for low-HP finish
    const lowHpNear = ctx.scoredTargets.find(t => (t.p.hp / t.p.maxHp) < 0.20 && t.dist < 3);
    if (lowHpNear) { ctx._chaseTarget = lowHpNear.p; return true; }
    return false;
  }
  if (c === 'stuck_count > 1') return ctx.stuckCount > 1;
  if (c === 'adjacent_enemy && my_hp > 50%') return ctx.nearestEnemyDist <= 1.5 && ctx.hpPct > 0.50;
  if (c === 'sword_nearby < 5 && atk < 10') return ctx.nearestSwordDist < 5 && ctx.myAtk < 10;
  if (c === 'round_time < 15 && rank > 3') return ctx.roundTimeSecs < 15 && ctx.myRank > 3;
  return false;
}

function execRule(action, ctx) {
  const me = ctx.me;
  if (action === 'flee_to_potion') {
    if (ctx.nearestPotion) return { tx: ctx.nearestPotion.x, ty: ctx.nearestPotion.y, state: 'healing', thought: 'Rule: flee to potion!' };
    if (ctx.nearestEnemy) return { tx: me.x + (me.x - ctx.nearestEnemy.x) * 2, ty: me.y + (me.y - ctx.nearestEnemy.y) * 2, state: 'fleeing', thought: 'Rule: flee! No potion' };
    return null;
  }
  if (action === 'chase_finish') {
    const t = ctx._chaseTarget || ctx.nearestEnemy;
    if (t) return { tx: t.x, ty: t.y, state: 'hunting', thought: 'Rule: finishing ' + t.species + '!' };
    return null;
  }
  if (action === 'random_direction') {
    // Use a pseudorandom offset based on me position (no true Math.random for stuck escape)
    const rx = me.x + ((me.x * 7 + me.y * 3 + ctx.stuckCount * 13) % 8) - 4;
    const ry = me.y + ((me.y * 5 + me.x * 11 + ctx.stuckCount * 7) % 8) - 4;
    return { tx: rx, ty: ry, state: 'patrolling', thought: 'Rule: unstuck!', resetStuck: true };
  }
  if (action === 'attack' && ctx.nearestEnemy) {
    return { tx: ctx.nearestEnemy.x, ty: ctx.nearestEnemy.y, state: 'hunting', thought: 'Rule: attack adjacent!' };
  }
  if (action === 'grab_sword' && ctx.nearestSword) {
    return { tx: ctx.nearestSword.x, ty: ctx.nearestSword.y, state: 'looting', thought: 'Rule: grab sword!' };
  }
  if (action === 'aggressive_hunt' && ctx.scoredTargets[0]) {
    return { tx: ctx.scoredTargets[0].p.x, ty: ctx.scoredTargets[0].p.y, state: 'hunting', thought: 'Rule: aggressive hunt!' };
  }
  return null;
}

// ============================================================
// MAIN DECISION FUNCTION
// Input: normalized context object (see README / spec at top)
// Output: { dx, dy, state, thought, targetX, targetY }
// ============================================================
function decide(ctx) {
  const {
    me, enemies, items, walls, occupied,
    arenaW, arenaH, roundTimeSecs, strategy, myRank, stuckCount,
  } = ctx;

  const ARENA_W = arenaW || 80;
  const ARENA_H = arenaH || 60;
  const strat = strategy || defaultStrategy();
  const stuck = stuckCount || 0;

  if (!me || me.dead) return null;

  const hpPct = me.hp / me.maxHp;
  const phase = getPhase(roundTimeSecs || 0);
  const phaseParams = strat.phases[phase] || {};
  const eff = {
    aggression: phaseParams.aggression !== undefined ? phaseParams.aggression : strat.aggression,
    fleeThreshold: phaseParams.fleeThreshold !== undefined ? phaseParams.fleeThreshold : strat.fleeThreshold,
    healSeekThreshold: phaseParams.healSeekThreshold || strat.healSeekThreshold,
    focus: phaseParams.focus || 'hunt',
    phase,
  };

  // Build enemy list (skip dead/afk)
  const liveEnemies = (enemies || []).filter(e => !e.dead && !e.afk);
  const nearbyEnemies = liveEnemies
    .map(e => ({ p: e, dist: Math.abs(e.x - me.x) + Math.abs(e.y - me.y) }))
    .filter(e => e.dist <= 20)
    .sort((a, b) => a.dist - b.dist);
  const ne = nearbyEnemies[0] || null;

  // Score targets
  const scoredTargets = [];
  for (const e of nearbyEnemies) {
    const r = scoreTarget(e.p, me, strat.targetWeights, strat.speciesTactics);
    if (!r.skip) scoredTargets.push({ p: e.p, dist: e.dist, score: r.score, tactic: r.tactic });
  }
  scoredTargets.sort((a, b) => b.score - a.score);

  // Find items
  let nearestPotion = null, nearestPotionDist = 999;
  let nearestSword = null, nearestSwordDist = 999;
  for (const it of (items || [])) {
    const d = Math.abs(it.x - me.x) + Math.abs(it.y - me.y);
    if (it.type === 'potion' && d < nearestPotionDist) { nearestPotionDist = d; nearestPotion = it; }
    if (it.type === 'sword' && d < nearestSwordDist) { nearestSwordDist = d; nearestSword = it; }
  }

  // AFK tiles are blocked — add to occupied set
  // (caller should already include afk players in occupied, but belt+suspenders)
  const blockedTiles = occupied || new Set();

  // Build rule evaluation context
  const ruleCtx = {
    me, hpPct,
    nearestEnemy: ne ? ne.p : null,
    nearestEnemyDist: ne ? ne.dist : 999,
    nearestPotion, nearestPotionDist,
    nearestSword, nearestSwordDist,
    roundTimeSecs: roundTimeSecs || 0,
    myAtk: me.atk || 5,
    myRank: myRank || 999,
    scoredTargets,
    stuckCount: stuck,
    _chaseTarget: null,
  };

  // Tick parity for axis alternation — use caller-provided tick or fallback
  const tickParity = ctx.tick !== undefined ? (ctx.tick % 2 === 0) : ((Date.now() % 200) < 100);

  // === RULE ENGINE ===
  const sortedRules = [...(strat.rules || [])].sort((a, b) => b.priority - a.priority);
  for (const rule of sortedRules) {
    if (evalRule(rule, ruleCtx)) {
      const result = execRule(rule.then, ruleCtx);
      if (result) {
        const move = moveStep(me, result.tx, result.ty, walls, blockedTiles, ARENA_W, ARENA_H, tickParity);
        return {
          dx: move.dx, dy: move.dy,
          state: result.state || 'idle',
          thought: result.thought || '',
          targetX: result.tx, targetY: result.ty,
          resetStuck: !!result.resetStuck,
        };
      }
    }
  }

  // === FALLBACK PHASE BEHAVIOR ===
  let tx = me.x, ty = me.y, state = 'idle', thought = '';
  const cx = Math.floor(ARENA_W / 2), cy = Math.floor(ARENA_H / 2);

  if (hpPct < eff.fleeThreshold && ne) {
    // Flee from nearest enemy, bias toward center
    tx = me.x + (me.x - ne.p.x);
    ty = me.y + (me.y - ne.p.y);
    if (strat.movement && strat.movement.preferCenter) {
      tx = Math.round(tx * 0.6 + cx * 0.4);
      ty = Math.round(ty * 0.6 + cy * 0.4);
    }
    tx = Math.max(2, Math.min(ARENA_W - 3, tx));
    ty = Math.max(2, Math.min(ARENA_H - 3, ty));
    state = 'fleeing'; thought = 'Fleeing! HP ' + Math.round(hpPct * 100) + '%';
  } else if (hpPct < eff.healSeekThreshold && nearestPotion && nearestPotionDist < (strat.itemDetourRange || 8)) {
    tx = nearestPotion.x; ty = nearestPotion.y;
    state = 'healing'; thought = 'Need potion...';
  } else if (eff.focus === 'farm') {
    const bi = findBestItem(me, items || [], strat);
    if (bi) { tx = bi.x; ty = bi.y; state = 'looting'; thought = '[EARLY] Farming items'; }
    else if (scoredTargets[0]) { tx = scoredTargets[0].p.x; ty = scoredTargets[0].p.y; state = 'hunting'; thought = '[EARLY] No items, hunting'; }
    else { state = 'patrolling'; thought = '[EARLY] Patrolling'; tx = me.x + Math.sign(cx - me.x); ty = me.y + Math.sign(cy - me.y); }
  } else if (eff.focus === 'hunt' && scoredTargets[0] && eff.aggression > 40) {
    const t = scoredTargets[0];
    tx = t.p.x; ty = t.p.y;
    state = 'hunting'; thought = '[MID] Hunting ' + t.p.species + (t.tactic && t.tactic !== 'normal' ? ' [' + t.tactic.toUpperCase() + ']' : '');
  } else if (eff.focus === 'survive') {
    if (hpPct < 0.5 && nearestPotion && nearestPotionDist < 10) {
      tx = nearestPotion.x; ty = nearestPotion.y; state = 'healing'; thought = '[LATE] Heal first';
    } else if (scoredTargets[0]) {
      tx = scoredTargets[0].p.x; ty = scoredTargets[0].p.y; state = 'hunting'; thought = '[LATE] Careful hunt';
    } else {
      state = 'patrolling'; thought = '[LATE] Staying alive';
      tx = cx; ty = cy;
    }
  } else {
    const bi = findBestItem(me, items || [], strat);
    if (bi) { tx = bi.x; ty = bi.y; state = 'looting'; thought = 'Grabbing item'; }
    else if (scoredTargets[0]) { tx = scoredTargets[0].p.x; ty = scoredTargets[0].p.y; state = 'hunting'; thought = 'Targeting ' + scoredTargets[0].p.species; }
    else { state = 'patrolling'; thought = 'Patrolling'; tx = me.x + Math.sign(cx - me.x); ty = me.y + Math.sign(cy - me.y); }
  }

  // Small idle chance — deterministic from position hash (no Math.random)
  const idleHash = ((me.x * 7 + me.y * 13 + (stuck || 0) * 3) % 100);
  if (idleHash > eff.aggression && (idleHash % 13 === 0)) {
    return { dx: 0, dy: 0, state, thought, targetX: tx, targetY: ty };
  }

  const move = moveStep(me, tx, ty, walls, blockedTiles, ARENA_W, ARENA_H, tickParity);
  return { dx: move.dx, dy: move.dy, state, thought, targetX: tx, targetY: ty };
}

// ============================================================
// EXPORT — works in both Node.js and browser
// ============================================================
const BuddyBrain = { decide, getPhase, scoreTarget, findBestItem, defaultStrategy };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BuddyBrain;
} else if (typeof window !== 'undefined') {
  window.BuddyBrain = BuddyBrain;
}
