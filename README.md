# Buddy Arena — Claude Code Skill

Play **Buddy Arena** as your official Claude Buddy, directly from the terminal.

Each Claude Code installation generates a unique, deterministic buddy based on its identity. This skill lets you find your buddy's Arena Code and either play at buddy-arena.fly.dev or battle live from the terminal.

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

**Or just download and point to it:**
```bash
claude plugin add /path/to/buddy-arena-skill
```

## Commands

### `/buddy-arena`

Finds your Buddy Arena Code and shows your buddy card.

1. Runs `/buddy` to detect your Claude buddy's species, rarity, and stats
2. Brute-forces the matching hash (10–30 seconds — normal, expected)
3. Displays your buddy card with Arena Code
4. Offers to connect and play directly from the terminal

### `/buddy-arena play`

Plays the game live from the terminal using AI strategy (rule-based or LLM-powered).

```
Round 3 | HP: 45/101 [||||------] 44% | ATK: 9 | Kills: 3 | Score: 85 | hunting robot
```

## Scripts (standalone)

### `skill/scripts/find-seed.js`

Find your Arena Code from buddy stats:

```bash
node skill/scripts/find-seed.js --help

node skill/scripts/find-seed.js \
  --species=cat --rarity=common --eye=@ \
  --debug=25 --patience=83 --chaos=1 --wisdom=40 --snark=9
```

Output: `Arena Code: 906506120`

### `skill/scripts/play.js`

Play from the terminal:

```bash
# Rule-based AI — no API key needed
node skill/scripts/play.js --code=906506120 --model=rules

# Gemini AI strategy evolution (free key at aistudio.google.com)
node skill/scripts/play.js --code=906506120 --model=gemini --key=AIza...

# OpenRouter (many models available)
node skill/scripts/play.js --code=906506120 --model=openrouter --key=sk-or-...
```

## Security

**Your API key never leaves your machine.**

- The game server (`buddy-arena.fly.dev`) only receives move commands: `{ type: "move", dx: 1, dy: 0 }`
- API keys are sent directly to the LLM provider (Gemini/OpenRouter) for strategy evolution
- No credentials are ever forwarded to the game server

## How It Works

1. Your Arena Code is a 32-bit hash that deterministically generates your buddy
2. `find-seed.js` brute-forces all ~4 billion possible hashes to find the one that matches your buddy's exact species, rarity, eye, and stats
3. `play.js` uses that same hash as your seed when joining the server — so the server generates the same buddy you see in `/buddy`
4. The AI brain (`buddy-brain.js`) makes tactical decisions each tick based on the game state
5. Optionally, an LLM refines the strategy every ~50 seconds based on how you're performing

## Requirements

- Node.js 18+ (ships with Claude Code)
- `ws` package — already in `buddy-arena/node_modules` if running from the project directory
- For AI strategy: a free Gemini or OpenRouter API key
