# Narrative Engine — Argent

## Version 2.0.0

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform: Desktop](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-blue)]()
[![Self-Hosted](https://img.shields.io/badge/Self--Hosted-100%25%20Local-brightgreen)]()

**Your AI Dungeon Master.** A self-hosted TTRPG engine that runs extended, multi-session campaigns with persistent memory, living NPCs, and automated world management — powered by any OpenAI-compatible LLM or local Ollama model.

No cloud. No subscription. Your campaigns stay on your machine.

> **Argent is a fork of [Narrative Engine](https://github.com/Sagesheep/NarrativeEngine-P) tuned for solo play.** It keeps the upstream memory, NPC, and world-simulation systems and changes how the table feels: the engine decides *when* something is uncertain and states the terms, the player rolls the dice and does the maths, and the prose mentions neither. The full statement of intent is in [`argent_design_goals.md`](argent_design_goals.md).
>
> Upstream's [Discord](https://discord.gg/gf3Ntw6pUY) and [Android client](https://github.com/Sagesheep/NarrativeEngine-M) are the place for questions about the base engine. They do not track this fork.

---

## What Argent changes

If you have used the upstream engine, these are the differences that matter:

- **Mechanics stay off the page.** No subsystem is named in narration — no attribute, tier, die, threshold or bonus. Outcomes read as cause in the world ("hinges recently oiled"), never as machinery.
- **The GM asks; the player rolls.** The old engine-rolled `[DICE OUTCOMES]` pool is gone. When an action needs dice the GM states the die, the reason, the bar to beat and what a miss costs — then stops and waits. You roll real dice and report one total.
- **Pacing follows the stakes.** Tense scenes run short and hand the turn back the moment a decision lands. Calm scenes may breathe. There is no fixed beat quota in either direction.
- **Prose is lean.** A sentence that adds no new fact is cut.
- **No numeric character sheet.** No derived stats, no combat maths layer. Character creation is AI-guided and prose-shaped; the point-buy wizard is gone.
- **Consequences live in the world, not the engine.** What success and failure *mean* belongs to the ruleset and your world docs. The engine only needs the outcome.

---

## Project status

Honest state of the tree, not a roadmap.

| Area | State |
|---|---|
| Memory, archive, condensation | Stable — inherited from upstream, unchanged |
| NPC agency, goals, relationships | Stable — inherited from upstream, unchanged |
| Ask To Resolve | **Reworked in this fork.** The pre-rolled pool is removed; `request_outcome` is the only resolution path, and it is system-agnostic — no die, no threshold, no number |
| Character sheet & creation | **Reworked in this fork.** AI-guided, no point-buy, condition staging instead of stat blocks |
| Narrative event engines | Working. Seeds are parsed from your lore file's Engine Seed Tags |
| World Map | **Unfinished — v0.3.0-wip.** Ships enabled because a half-built map is more useful than a hidden one. Read [`public/bundled-mods/worldmap/STATUS.md`](public/bundled-mods/worldmap/STATUS.md) before relying on it |
| Mod system | Working, documented in [`docs/MODDING.md`](docs/MODDING.md) |
| Mobile client (`mobile/`) | Present and kept compiling, but unversioned (`0.0.0`) and not released from this fork |

Test suite: 326 files, 4547 tests, all passing. One unrelated unhandled rejection (`indexedDB is not defined`, from settings encryption under jsdom) is reported at the end of a full run; it does not fail any test.

---

## Getting Started

1. **Clone the repo**
   ```bash
   git clone https://github.com/bjj1478/NarrativeEngine-Argent.git
   cd NarrativeEngine-Argent
   ```

2. **Install & run**

   **Windows** — double-click `Start_Narrative_Engine.bat`

   **Linux / macOS** — run `start.sh`

   **Or manually:**
   ```bash
   npm install
   npm run build --prefix packages/engine
   npm run dev
   ```

3. **Open your browser** at `http://localhost:5173` (the API runs on `http://localhost:3001`)

4. **Configure your LLM** — open Settings and add your API key + endpoint. Supports OpenAI, Ollama, DeepSeek, and any OpenAI-compatible API.

That's it. Create a campaign, load a world, and start playing.

---

## Updating to the Latest Version

When a new version comes out, you can update your local copy without losing your campaigns or settings.

**Windows** — double-click `Update_Narrative_Engine.bat`

It will:
- Download the newest app files from GitHub (`git pull`)
- Run `npm install` to keep dependencies in sync
- Leave your saved campaigns, lore, and API keys untouched (the `data/` folder is not tracked by Git)

**Manual:**
```bash
git pull
npm install
```

**Notes**
- Close the app completely before updating (close any terminal windows titled "Narrative Engine").
- If you downloaded the app as a ZIP instead of cloning it, the updater won't work — download the newest ZIP from GitHub instead.
- If you edited any app files directly, the update may ask before overwriting them. Edits inside `data/` are never touched.

After updating, start the app the same way as before (`Start_Narrative_Engine.bat` / `start.sh` / `npm run dev`).

---

## Troubleshooting

**"Node.js is not installed"** when running the start script
Install the LTS version from https://nodejs.org/ and run the script again.

**"needs Node 20 or newer"** when running the start script
Your Node.js is too old. Upgrade to the LTS version at https://nodejs.org/.

**"NODE_MODULE_VERSION mismatch"** error after upgrading Node
Your database module was built for the old Node version. Run the repair script and choose **option 1 (Quick fix)**:
- **Windows** — double-click `Repair_Narrative_Engine.bat`
- **Linux / macOS** — run `./Repair_Narrative_Engine.sh`

If the repair fails on Windows with a C++ build tools error, install the [Visual C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (select "Desktop development with C++") and run the repair again. Alternatively, run the repair script and choose **option 2 (Full clean reinstall)** — it may succeed without needing the C++ build tools.

**"Cannot find native binding" / "rolldown" / "is not a valid Win32 application"** when starting the app
Your dependency install was incomplete (a known [npm bug](https://github.com/npm/cli/issues/4828) with optional dependencies). Run the repair script and choose **option 2 (Full clean reinstall)**:
- **Windows** — double-click `Repair_Narrative_Engine.bat`
- **Linux / macOS** — run `./Repair_Narrative_Engine.sh`

---

## Setting Up Your First Campaign

Two folders hold ready-to-play material:

- **`Custom_Setup/Worlds/`** — the worlds this fork is actually tuned against: *Forgotten Realms (Sword Coast)* and *Witch Reverse Isekai*. Each has a world file, and Forgotten Realms adds its own ruleset. These are the reference implementations of the current lore format.
- **`Example_Setup/`** — the upstream compendium: 24 world folders / 81 Markdown files across genres, plus `Ruleset/` (the `AI_GM_OS_*` GM system prompts) and `Ability Compendium/`.

### Quick start with an existing world

1. Create a new campaign and give it the lore file (e.g. `Custom_Setup/Worlds/Forgotten Realms/sword_coast_world_engine.md`)
2. Give it the matching ruleset as the system prompt (`sword_coast_rules.md`, or one of `Example_Setup/Ruleset/AI_GM_OS_*`)
3. Paste the world's `starter_prompt.md` as your first message
4. The GM will walk you through character creation and then drop you into the world

### Writing your own world

Start from [`Example_Setup/World_compendium/lore_template.md`](Example_Setup/World_compendium/lore_template.md) — it is a copy-paste prompt that makes an LLM emit a correctly formatted file. The format is machine-parsed, so three rules matter:

**1. Headers carry the type.** `## N. SECTION` for sections, `### TYPE -- Name` for entries (double-hyphen separator). The `TYPE` token is authoritative — it decides the entry's category, its retrieval priority, and whether it feeds the NPC ledger, the place ledger, or the map:

```markdown
## 2. FACTIONS
### FACTION -- The Harpers
```

Recognised types: `OVERVIEW` / `WORLD`, `FACTION` / `ORGANIZATION`, `CHARACTER` / `HERO` / `NPC`, `LOCATION` / `CITY` / `REGION`, `EVENT` / `TIMELINE`, `POWER_SYSTEM` / `POWER` / `MAGIC`, `ECONOMY`, `CULTURE` / `RELIGION`, `RULES` / `MECHANIC`, `RELATIONSHIP`. An unrecognised token is not an error — the entry just falls back to keyword heuristics.

**2. Every entry gets a retrieval directive.** One `<!-- rag: ... -->` comment on the line below the header. The engine strips it before the GM ever sees it. Without one, the engine falls back to guessing keywords from your prose — which shreds names and indexes stopwords.

```markdown
### FACTION -- The Harpers
<!-- rag: vector, triggers: harpers, spy, coded message, safe house, priority: 7 -->
```

- `always` + `priority` — permanently in context. Reserve for the world kernel.
- `vector` + `triggers` — retrieved by meaning. The default for factions, locations, characters, events.
- `keyword` + `triggers` — retrieved only on a literal word match. For mechanical tables.

**3. End the file with Engine Seed Tags.** These fill the three narrative event engines. Tier 3's four rows are concatenated verbatim into one sentence — `[WORLD_EVENT: {who} {what} {why} {where}]` — so write each row to fit its slot and read the joined line back:

```markdown
## 8. ENGINE SEED TAGS (IMPORTANT)
### SYSTEM -- Engine Seeds
<!-- rag: always, priority: 10 -->
**Surprise Types:** TAVERN_RUMOR, MARKET_HAGGLE, STREET_PREACHER
**Surprise Tones:** MUNDANE, AMUSING, CURIOUS
**Encounter Types:** HOSTILE_PRESENCE, TERRITORIAL_THREAT, AMBUSH_LAID
**Encounter Tones:** TENSE, SUDDEN, OMINOUS
**World Event Who:** the Zhentarim, a Waterdhavian noble house, a hill giant warband
**World Event What:** seized a caravan depot, broke an old treaty, blockaded a harbour
**World Event Why:** to corner the caravan trade, to settle a grudge older than the city
**World Event Where:** along the Trade Way, beneath Waterdeep's Dock Ward
```

> `**Quest Hook Who/What/Where/Why:**` is the legacy label and is still parsed — those rows are authored in rumour order and the parser swaps Where and Why so the sentence still reads correctly. Prefer `World Event` in new files. If both are present, `World Event` wins.

Each list needs **at least 3 entries** or the engine falls back to its genre-neutral defaults. `Example_Setup/World_compendium/CLAUDE.md` is the condensed authoring spec.

---

## Ask To Resolve

Argent's resolution system. The engine does not roll behind the narration — it asks, and waits.

It also does not assume your system. There is no die, no threshold and no number anywhere on this
path; whether you play with 2d6, a d20, cards, or an oracle deck is entirely your business, and
the engine never learns which.

When the GM judges an action uncertain it calls `request_outcome` and stops, stating three things:

- **the reason** — why this is in doubt, in world terms
- **the difficulty** — `trivial`, `easy`, `average`, `hard` or `impossible`. Committed to *before*
  you answer, so it cannot be bent to suit the result
- **what a failure costs** — named up front, not invented afterwards

You resolve it however your table does, then pick one of four outcomes:

| Outcome | What it means |
|---|---|
| **Fail** | The attempted action does not happen |
| **Fail with consequence** | It does not happen, and the stated cost lands |
| **Success with consequence** | It happens, but a cost rides along |
| **Success** | It happens, as attempted |

Any *fail* means the action does not happen — not a near-miss that lands anyway, and not the same
thing achieved by another route in the same breath. Any *success* means it fundamentally does, and
the GM carries the scene on from there. What a *consequence* costs belongs to your ruleset and
world docs, per genre — the engine only needs to know which of the four came back.

The GM narrates the result as cause in the world and never names the difficulty, the outcome, a
die, or a bonus.

### Consequences

The two *with consequence* outcomes are where the cost gets named. The resolve prompt carries a
**Consequence** field: it opens with one entry drawn at random from the campaign's list, a reroll
button beside it draws another, and the field is freely editable — so you can take the draw,
swap it, or write your own.

The list lives in **Engine Tuning → Costs of a Miss**, one whole phrase per line. It is seeded
from your lore file's consequence tables and can be extended by Populate. The documented shape is
a label and what it costs:

```
Noise — Not discovery, attention. A patrol changes its route.
Trace — You are through, but you left something.
```

The field only matters when you pick **Fail with consequence** or **Success with consequence**.
Then the outcome lands exactly as it would have — the action still does or does not happen — and
the GM is additionally told to weave that consequence into the same beat as a twist or
complication arriving alongside it, never instead of it and never deferred to a later scene.

Pick a plain **Fail** or **Success** and the field is ignored, even with text in it. Pick a
*with consequence* outcome with the field blank and the GM falls back to the cost it already
named when it asked. If the campaign has no list authored, the field simply opens empty and you
can type into it.

The division of labour is the same one the rest of the engine uses: the engine draws, you approve
or override, the model renders. The engine never gets the last word on the fiction, and the model
never invents the cost from nothing.

**If you have nothing to resolve with**, "Decide for me" picks an outcome weighted by the
difficulty the GM already committed to. It is an explicit opt-in, and the difficulty is the only
input — so it cannot be steered any more than the manual pick can.

**If you would rather roll something concrete**, the "dice me" modal rolls for you: pick a die
type, a modifier (advantage / disadvantage / none), a count, and how the dice aggregate, then
confirm. That *arms* the roll — the app resolves it at send time and asserts the result as fact.
It is the one path on which a number reaches the writer, and the only path by which the app rolls
at all.

**Ask frequency** is a threshold, not a quota. Three settings in Engine Tuning:

| Setting | What deserves asking |
|---|---|
| **Any contested action** | Anything meeting real resistance — a lock, a fight, a risky climb, persuasion against a genuine want |
| **Only when it costs something** | Only when failure leaves a mark. Mere inconvenience resolves in the fiction |
| **Only decisive moments** | Only a conflict that could genuinely go either way |

Turning Ask To Resolve off means **nothing is ever asked** — pure freeform narration. Every "ask
the player" imperative lives in the tool's own description, so withholding the tool is also what
stops the GM being told to ask.

Campaigns saved under the retired pre-rolled pool are migrated on load. Transcripts recorded under
the older `request_roll` tool still render in full.

---

## Memory That Never Forgets

Most AI TTRPG tools suffer from **context drift**. After a handful of sessions the LLM runs out of token space, and suddenly it has no idea who Bob is, what happened in Chapter 1, or why the kingdom is at war. Players notice. Immersion breaks.

Narrative Engine was built from the ground up to solve this. Every piece of your campaign history is preserved and retrievable, no matter how many sessions you play.

### Lossless Scene Archive

Every turn — every roll reported, every line of dialogue, every narrative beat — is archived verbatim. Nothing is summarised away. Nothing is discarded.

### Two-Phase Deep Archive Search

When the GM needs to recall something from a sealed chapter, it runs a two-stage retrieval pipeline:

1. **Chapter scan** — the engine evaluates LLM-generated chapter overviews to identify which sealed chapters are relevant
2. **Scene retrieval** — within those chapters, specific scenes are retrieved using local vector embeddings (`@huggingface/transformers` running ONNX models locally, stored in `sqlite-vec` via `better-sqlite3`), ranked by importance, and injected verbatim into context

This means the GM can accurately recall that Bob betrayed the party in Chapter 3 and reference the exact dialogue — even if that was 50 chapters and 200 sessions ago.

### Auto-Condensation

When approaching the token limit, older turns are compressed automatically using one of three strategies:

| Strategy | Compression | Best for |
|---|---|---|
| **Tight** | ~50% | Long-running campaigns, smaller context windows |
| **Smart** | ~75% | Balanced play (default) |
| **Deep** | Maximum detail | Short campaigns, large context windows |

The most recent 8 messages are always kept verbatim. Reported rolls and all proper names are preserved exactly. Dramatic moments are tagged and survive re-compression.

### Pinned Memories

Select any passage from the chat and pin it. Pinned excerpts are injected into every GM call until you unpin them — useful for keeping critical plot points, NPC promises, or player-declared intentions in active context.

### World State Tracking (Divergence Register)

A structured fact-sheet the GM maintains throughout your campaign:

- Automatically extracts world-state facts after each turn: who is where, who holds what, alliances, deaths, promises, debts
- Organised into categories: locations, NPC events, promises & debts, world state, party facts, lore & rules
- Pin high-priority facts so they are always in context regardless of token budget
- AI-assisted structuring for manual entries — paste raw notes and let the engine categorise them
- Semantic deduplication and fact clustering prevent redundant entries from bloating context

---

## NPC Agency

NPCs are not static text snippets. They are simulated characters with their own psychology, goals, and relationships — all managed automatically in the background.

### Auto-Detection & Profiling

NPCs are detected as they appear in the story. The AI generates full profiles: personality, voice, goals, faction, visual description. NPCs written into your lore file as `### CHARACTER -- Name` are seeded into the ledger on import and treated as canon — their authored `PersonalityHex`, `Traits`, and `Tier` override inference.

### Personality Hexagon

Each NPC is defined by six psychological axes, each ranging from −3 to +3:

| Axis | Low end | High end |
|---|---|---|
| Drive | Passive | Ambitious |
| Diligence | Careless | Meticulous |
| Boldness | Cautious | Reckless |
| Warmth | Cold | Affectionate |
| Empathy | Detached | Compassionate |
| Composure | Volatile | Stoic |

These values shape how the NPC speaks, reacts, and makes decisions. They drift naturally as the NPC experiences events — a betrayal might erode warmth, while a victory could boost boldness.

### Background Goal Engine

Every NPC maintains three tiers of wants:

- **Short-term** — immediate scene needs (drawn from personality pools, no LLM cost)
- **Medium-term** — session-level goal templates that advance via background dice rolls
- **Long-term** — a single defining ambition, LLM-generated at creation

Each turn, a heartbeat roll determines whether an NPC's goal advances. Successes and failures accumulate. When NPC goals collide, the engine detects the conflict, resolves the "tangle" with dice, and surfaces the results as rumours or direct events in the GM's next response.

### Relationships & Pressure

- **NPC-to-NPC relations** — directed relationship edges (−3 to +3) that evolve based on goal outcomes and collisions
- **PC Relation Meter** — a dedicated tracker for how each NPC feels about the player
- **Pressure system** — `ignored` and `engaged` counters track how the player treats each NPC, with natural decay. Cross a threshold and the NPC's behaviour shifts
- **Behavioural triggers** — keyword-mapped pressure spikes (mention a sensitive topic and the NPC reacts)
- **Boundaries** — hard limits (NPC refuses outright) and soft limits (NPC complies but pressure rises)

### Tiering & Progression

- NPCs are classified as **Recurring**, **One-shot**, or **Walk-on**
- A skill rung ladder (0–4) tracks NPC competence, with promotion possible as goals succeed
- Inactive NPCs are automatically archived to reduce context clutter and restored when they reappear

### Portrait Generation

Generate NPC portraits on the fly. Eight current art styles — Stylized Game Realism (default), Cinematic Historical Fantasy, Painterly Realism, Classical Ink & Colour, Graphic Novel, Western RPG Concept Art, Stylized Anime, Chibi — plus five legacy styles kept selectable so older campaigns can regenerate consistently. Works with any OpenAI-compatible image API. Images are stored locally.

---

## The Player Character

Argent has no numeric character sheet by design. What it keeps instead:

- **AI-guided creation** — a conversational wizard that builds the character from questions rather than a point-buy budget. Capabilities are stated in the player's own words ("skilled with a blade from years as a Flaming Fist mercenary"), and the player sets their own bonuses to reflect them
- **Character ledger** — the durable profile the GM reads each turn: who you are, what you carry, what is true about you now
- **Conditions** — the GM proposes a condition change (wounded, exhausted, marked) and you confirm it. Conditions persist and degrade what they govern until treated
- **Inventory proposals** — the GM never silently edits your kit; it proposes, you accept

---

## World Simulation

### World Arc Engine

Large-scale storylines — political coups, economic crises, supernatural plagues — run as background **World Arcs**. Each arc is a 5-to-12 rung ladder that advances via dice, independently of the player's actions:

- **Stance tracking** — the engine detects whether the player is `opposing`, `aiding`, `ignoring`, `fleeing from`, or `unaware of` each arc, and adjusts difficulty accordingly
- **Avoidance has consequences** — if the player ignores or flees from a direct threat, the world moves without them. The engine writes the consequence as a permanent fact in the Divergence Register
- **Surface tiers** — arc events reach the player as ambient hints, rumours, or direct confrontations depending on the current rung

### Narrative Event Engines

Three probability engines create emergent storytelling. Each is an *escalating* timer, not a flat per-turn chance — the longer nothing happens, the more likely something will:

| Engine | Die | Start DC | Decay / turn | Produces |
|---|---|---|---|---|
| **Surprise** | d100 | 95 | −3 | Ambient flavour — a type and a tone |
| **Encounter** | d200 | 198 | −2 | A mid-stakes situation that interrupts the scene |
| **World Event** | d500 | 498 | −2 | A background world shift — who, what, why, where |

On a miss the DC drops; on a fire it resets. The tag is appended to your turn and the GM narrates it without ever acknowledging it.

The tag vocabulary comes from your lore file's Engine Seed Tags, so a Sword Coast campaign draws on `TAVERN_RUMOR` and the Zhentarim while a modern one draws on `RING_DOORBELL_ALERT` and a Senate subcommittee. Every threshold, decay rate and list is editable live in **Engine Tuning**, and a per-field **Populate** button will regenerate a list from your own lore.

### Timeskip Simulation

Type *"three weeks later"* and the engine handles the gap. It detects the narrative jump, runs background ticks to advance NPC goals, resolves faction conflicts, and updates the world state — so the world has believably moved forward when the player re-engages.

### Knowledge Boundaries

The engine programmatically prevents NPC metagaming:

- **Witness tracking** — every scene records which NPCs were physically present vs. merely mentioned. When recalling past events, witness-matching scenes are ranked higher
- **Faction scoping** — facts in the Divergence Register carry `knownBy` permissions (`player`, `npc:<id>`, `faction:<name>`). An NPC will never reference a secret they shouldn't know about

---

## Lore Check

A consistency QA tool you can run on any message:

- Select text from any chat message to flag it for review
- Choose from check categories: wrong fact, contradicts lore, wrong NPC/place, tone mismatch, out of character
- The engine cross-references your lore chunks, chapter archive, and sealed chapters
- Returns a verdict (consistent / unsupported / contradicts), specific issues with citations, and a suggested rewrite
- Accept the rewrite with one click to replace the message in place

---

## LLM Tool Calls

The GM can use five tools mid-conversation:

| Tool | What it does |
|---|---|
| `query_campaign_lore` | Searches your world bible on the fly when the GM needs a detail |
| `update_scene_notebook` | Volatile working memory — active effects, timers, NPC positions, environmental conditions |
| `request_outcome` | Asks the player to resolve an action, stating the reason, the difficulty, and the cost of a failure |
| `propose_condition_change` | Suggests a condition on the player character (you confirm) |
| `propose_inventory_change` | Suggests adding, removing, or equipping items (you confirm) |

Works with OpenAI function calling and DeepSeek models (with DSML fallback parsing).

---

## World Building Tools

### World Map — unfinished, ships enabled

A bundled mod (`public/bundled-mods/worldmap`, **v0.3.0-wip**) that places your world on a map derived from the relations in your lore, and lets you walk a journey one day at a time.

**Working and verified in a real browser:** field solve with terrain-aware placement and cells frozen on visit; twelve biomes with textured variants, hillshade, contour lines and coastal shading; A\* routing over the chunk grid with per-mode impassable sets and terrain-priced day counts; travel as an engine action — one press, one day, one camp, no LLM call.

**Not done:** roads cost the pathfinder nothing, so routes cut across open country beside a road the map itself drew; multi-hop journeys take one press too many; there is nothing to find at a camp yet. The full, honest list is in [`STATUS.md`](public/bundled-mods/worldmap/STATUS.md) — read it before you rely on the map.

Switch the mod off and the ledger goes back to plain topology; every place stays exactly where it was.

### World Lore Builder

A structured pre-game world editor:

- Dedicated fields for world background, languages, power systems, technology level, timeline, tone, and house rules
- Expandable lists for geography, factions, cultures, threats, and pre-seeded NPCs
- Export to Markdown with one click for backup or sharing
- Import Markdown with a smart review modal that merges changes without overwriting your work
- Multiple draft worlds — switch between them or delete old ones

### Rules Manager

Your system prompt is automatically chunked and indexed. Each rule chunk gets AI-generated trigger keywords so the engine retrieves only the relevant rules for each turn, keeping token usage efficient.

---

## Mods

The engine has a first-class mod system. A mod is one folder under `mods/` with a `manifest.json` and whatever source it points at; it talks only to the `ModContext` the host hands it and never imports from `src/`.

Three mods ship bundled — **World Map**, **Enemy Compendium**, and a tone example — and `mods/` carries the ability compendium, a skill tree, an NPC tagger, and a set of worked examples covering interceptors, surfaces, windows, facts, and native hooks.

[`docs/MODDING.md`](docs/MODDING.md) is the single author-facing reference, and [`docs/narrative-mod-api.d.ts`](docs/narrative-mod-api.d.ts) is the typed surface every sample compiles against.

---

## Backups & Rollback

- **Automatic backups** before any risky operation
- **Manual labelled backups** at any time
- **Batch backup deletion** for cleanup
- **Scene-level rollback** — undo any scene and the entire world state (timeline, chapters, NPCs, Divergence Register) cascades back to that point
- Pre-rollback safety backup so you can never lose data

---

## Security & Privacy

- **Encrypted API key vault** — AES-256-GCM encryption, password-optional
- **Machine-key mode** — no password needed, keys auto-unlock on your device
- **Password mode** — PBKDF2 with 100K iterations for full lock-down
- **Client-side encryption** — API keys are encrypted in the browser before they touch the server
- **100% local vector search** — all semantic memory, lore queries, and embedding operations run locally via `@huggingface/transformers` (ONNX models) and `sqlite-vec`. No campaign text is sent to third-party vector providers
- All campaign data stored as local files under `data/` — no database server, no cloud, no vendor lock-in
- Export and import your vault for backups

---

## Supported LLM Providers

Any OpenAI-compatible API works. A preset assigns a model to each of eight roles — six required, two optional:

| Role | Purpose | Required |
|---|---|---|
| **Story AI** | GM narration, Scene Continue, swipes, Ask GM; plus invented content (encounter tags, complications, arcs, the overworld) | yes |
| **Director AI** | The Director Brief — audits the last turn and steers the next GM reply. Blocking and in-turn, so latency here is felt directly | yes |
| **Extraction AI** | Reads scenes and reports structured data: importance rating, inventory/location/trait scans, NPC detection and updates, scene events. Never writes prose — a small fast model suits this | yes |
| **Worldbuilding & Lore AI** | Lore formatting, expansion and import, the World Primer, AI-guided character creation | yes |
| **Utility AI** | Chooses what the GM sees: archive recall, context recommendation, query expansion, reranking, rules and lore indexing, fact clustering. Never writes prose | yes |
| **Summarizer AI** | Chapter summaries, synopsis backfill, divergence pruning, location enrichment, lore-check rewrites, timeskip narration | yes |
| **Image AI** | Portrait and scene illustration generation | no |
| **Vision AI** | Reads an attached image and writes it back as character-sheet text (needs a multimodal model) | no |

**Roles never substitute for one another.** If a required slot has no model, the app says so and
stops rather than quietly spending your narration model on bookkeeping. Pointing several slots at
the same provider is fine — that is the default after an upgrade — so start there and split off
the cheap work when you want to.

Each endpoint has its own model, API key, base URL, and reasoning effort. Sampling (temperature,
top-p, max tokens) is configured once per preset and applies to narration; utility calls set their
own temperatures internally.

Works with Ollama for fully local play — no internet required after setup.

---

## Quick Reference

| Action | Command |
|---|---|
| Install & run (Windows) | Double-click `Start_Narrative_Engine.bat` |
| Install & run (Linux / macOS) | Run `start.sh` |
| Update to latest (Windows) | Double-click `Update_Narrative_Engine.bat` |
| Update to latest (manual) | `git pull` then `npm install` |
| Start the app | `npm run dev` |
| Start with LAN access | `npm run dev:lan` |
| Build for production | `npm run build` |
| Run tests (watch) | `npm run test` |
| Run tests (once) | `npm run test:run` |
| Run tests with coverage | `npm run test:coverage` |
| Base-app regression gate | `npm run test:base-app-gate` |
| Browser end-to-end tests | `npx playwright test` |
| Lint | `npm run lint` |

---

## Credits & License

Argent is a fork of [Narrative Engine](https://github.com/Sagesheep/NarrativeEngine-P) by Sagesheep. The memory, NPC agency, and world simulation systems are upstream's work; the resolution, pacing, and character-sheet changes described above are this fork's.

Licensed under the [MIT License](LICENSE) — Copyright (c) 2026 Sagesheep.
