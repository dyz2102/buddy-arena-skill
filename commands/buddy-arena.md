---
name: buddy-arena
description: Get your Buddy Arena Code to play as your official Claude Buddy, or play directly from the terminal with your own API key.
---

# Buddy Arena — Terminal Skill

You are helping the user interact with Buddy Arena, a multiplayer battle royale game where each Claude Code installation has a unique deterministic buddy.

## Step 1: Find the User's Buddy

Tell the user: "Finding your Claude Buddy..."

Run the find-seed script to detect their buddy and generate their arena code:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/find-seed.js"
```

**If the script needs manual input** (it will print instructions), ask the user to provide their buddy's details from `/buddy`:
- Species (e.g., cat, duck, robot)
- Rarity (common, uncommon, rare, epic, legendary)
- Eye character (one of: · ✦ × ◉ @ °)
- The 5 stat values: DEBUGGING, PATIENCE, CHAOS, WISDOM, SNARK

Then run with those args:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/find-seed.js" \
  --species=SPECIES \
  --rarity=RARITY \
  --eye=EYE \
  --debug=N --patience=N --chaos=N --wisdom=N --snark=N
```

## Step 2: Show the Result

Display the full buddy card output from the script. It will look like:

```
═══════════════════════════════════════
  YOUR BUDDY ARENA CODE
═══════════════════════════════════════

  ★ COMMON CAT
  Flint

  DEBUGGING  ███░░░░░░░  25
  PATIENCE   ████████░░  83
  CHAOS      ░░░░░░░░░░   1
  WISDOM     ████░░░░░░  40
  SNARK      █░░░░░░░░░   9

  Arena Code: 906506120

  → Paste at buddy-arena.fly.dev
  → Or run: /buddy-arena play
═══════════════════════════════════════
```

Remind the user:
- Paste their Arena Code at **buddy-arena.fly.dev** to play as their official buddy
- Their buddy is deterministic — same Claude installation always gets the same buddy

## Step 3: Offer to Play Directly

Ask: "Want to play directly from this terminal? You'll need an API key for AI strategy evolution (your key stays local and is never sent to the game server)."

If they say **yes**:

1. Ask which AI model they want to use for strategy evolution:
   - `rules` — Pure rule-based, no API key needed
   - `gemini` — Google Gemini (needs GEMINI_API_KEY or paste key)
   - `openrouter` — OpenRouter (needs OPENROUTER_API_KEY or paste key, access to many models)

2. If they choose a model requiring an API key, ask them to provide it. Assure them: "Your API key is only sent directly to the LLM provider — never to the game server."

3. Run the play script:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/play.js" \
  --code=ARENA_CODE \
  --model=MODEL \
  --key=API_KEY
```

For `rules` model (no key needed):
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/play.js" --code=ARENA_CODE --model=rules
```

## Notes

- The Arena Code is just the numeric hash (e.g., `906506120`) — it's the seed that generates the buddy
- The brute-force search in find-seed.js takes ~10-30 seconds — this is normal
- API keys for AI strategy are **local only** — the game server only sees moves, never credentials
- Ctrl+C to quit the live game session
