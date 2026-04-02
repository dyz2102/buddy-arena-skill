# Buddy Arena — Claude Code Skill

Deploy your Claude Buddy to battle in 30 seconds. No browser, no WASD — just run `/buddy-arena` and watch your AI fight.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎮 BUDDY ARENA — Live Battle
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🐱 Flint deployed! (★ COMMON CAT)
HP: 101 | ATK: 6 | DEF: 6
Strategy: Rules Engine
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚔️  Flint hit 🤖GLaDOS for 8 dmg!
💀 Flint eliminated 👻Skynet! (+8 pts)
❤️  Flint picked up potion (+15)
⚠️  Zone shrinking! Phase 2 — get to center!

  Round 5 | #2/12 | 🐱 HP: 67/101 ██████████░░░░░░░░░░ | K:4 S:85 | Phase 2 HUNTING
```

## Install

**From GitHub:**
```bash
git clone https://github.com/dyz2102/buddy-arena-skill.git
claude plugin add ./buddy-arena-skill
```

**From npm:**
```bash
npm install -g buddy-arena-skill
claude plugin add $(npm root -g)/buddy-arena-skill
```

## Usage

### First time — `/buddy-arena`

Claude will ask for your buddy's species, rarity, eye, and stats. Run `/buddy` first to see them. Then:

1. Brute-force search finds your Arena Code (10–30s, scanning 4 billion hashes)
2. Code is saved to `~/.buddy-arena-code` so you never need to do this again
3. Confirms deploy with a buddy card
4. Connects and streams the live battle

### Return visits — `/buddy-arena play`

Your saved code is loaded automatically. Skips straight to battle.

### AI evolution — `/buddy-arena play --model=gemini --key=YOUR_KEY`

Adds LLM-powered strategy evolution. Every ~50s your buddy's behavior adapts based on the last 5 rounds. Supports `gemini` (free key at aistudio.google.com) and `openrouter`.

## What you see

**On kill:**
```
💀 Flint eliminated 🤖GLaDOS! (+8 pts)
```

**On taking damage:**
```
🛡️  🐉Skynet hit Flint for 12 dmg!
```

**On item pickup:**
```
❤️  Flint picked up potion (+15)
🗡️  Flint picked up sword (+2)
```

**Round summary:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 ROUND 5 RESULTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 1. 🐙 T_Qwen       —  12K  130pts
 2. 🐱 Flint (YOU)  —   4K   85pts  ← YOU
 3. 🐉 Skynet       —   3K   60pts
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Live status line** (updates every 2s, overwrites same line):
```
  Round 5 | #2/12 | 🐱 HP: 67/101 ██████░░░░ | K:4 S:85 | Phase 2 HUNTING
```

## Scripts (standalone)

Find your Arena Code directly:
```bash
node scripts/find-seed.js \
  --species=cat --rarity=common --eye=@ \
  --debug=25 --patience=83 --chaos=1 --wisdom=40 --snark=9
```

Play directly:
```bash
node scripts/play.js --code=906506120 --model=rules
node scripts/play.js --code=906506120 --model=gemini --key=AIza...
```

## Security

Your API key never leaves your machine. The game server only receives move commands: `{ type: "move", dx: 1, dy: 0 }`. API keys go directly to the LLM provider (Gemini/OpenRouter) for local strategy computation.

## How it works

1. `/buddy` generates a deterministic buddy from your Claude Code identity
2. `find-seed.js` brute-forces the 32-bit hash space to find your exact match
3. `play.js` joins the server using that hash as a seed — the server generates the same buddy
4. `buddy-brain.js` makes tactical decisions every tick: hunt, flee, heal, third-party
5. With AI evolution, an LLM tweaks aggression and targeting weights based on recent performance

## Requirements

- Node.js 18+
- `ws` package (installed with the skill)
- For AI strategy: free Gemini key (aistudio.google.com) or OpenRouter key
