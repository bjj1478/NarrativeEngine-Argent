# World Compendium — AI Instructions

This directory contains world lore files for an AI Game Master engine (mobile app + main app). All lore files must be formatted to be parsed by the engine's RegEx and RAG pipeline.

## MANDATORY FORMAT

Every world lore file **must** follow the structure in [lore_template.md](lore_template.md) exactly. No exceptions. The format is machine-parsed — deviating from it breaks the engine.

### Key rules:

**Headers** must use `### Category — Title` format (double dash `—`, not `-`):
- `### OVERVIEW — ...`
- `### FACTION — [Name]`
- `### LOCATION — [Name]`
- `### CHARACTER — [Name]`
- `### POWER_SYSTEM — [Name]`
- `### ECONOMY — [Currency / Trade]`
- `### EVENT — [Name]`
- `### SYSTEM — Engine Seeds`

**Section numbers** (`## 1. WORLD OVERVIEW`, `## 2. FACTIONS`, etc.) must be present and in order.

**Retrieval directives** — every `###` header needs a `<!-- rag: ... -->` comment on the line
directly below it. Without one the engine guesses keywords from prose, which shreds names
(`TikTok` → `tik`/`tok`) and indexes stopwords. Modes: `always` + `priority` for kernel
sections, `vector` + `triggers` for factions/locations/characters/events, `keyword` +
`triggers` for mechanical tables. `priority` is 1–10. See
`Custom_Setup/Worlds/Forgotten Realms/sword_coast_world_engine.md` for a fully tagged file.

**`**Key Members:**`** is split on commas — names only, no parenthetical containing its own
comma, no trailing "and others". **`**Goals:**`** should be a bare clause with no leading
"To".

**CHARACTER entries** must include all bolded fields in this exact order:
`Aliases`, `Appearance`, `Disposition`, `Personality`, `Voice`, `Status`, `Faction`, `Goals`, `StoryRelevance`, `Example Output`, `Affinity`

**Character Intro Flags** (optional, but must use exact syntax if used):
- `**Wandering: true**` — character can appear anywhere
- `**Location: [Place Name]**` — character is place-bound
- `**Intro Boost: [keyword1, keyword2]**` — triggers on these GM narration keywords

**Engine Seed Tags** (end of file, required — copy this block structure exactly):

```markdown
## 6. ENGINE SEED TAGS (IMPORTANT)
### SYSTEM — Engine Seeds

**── TIER 1: SURPRISE ENGINE (mundane world flavor) ──**
**Surprise Types:** [5-10 mundane situation archetypes]
**Surprise Tones:** [5-10 emotional flavors]

**── TIER 2: ENCOUNTER ENGINE (location-agnostic threat situations) ──**
**Encounter Types:** [5-10 threat situation archetypes — write SITUATIONS not enemy names]
**Encounter Tones:** [5-10 tones]

**── TIER 3: WORLD ENGINE (background world events) ──**
**World Event Who:** [5-10 actors — bare noun phrases]
**World Event What:** [5-10 past-tense verb phrases]
**World Event Why:** [5-10 to… / because… clauses]
**World Event Where:** [5-10 prepositional phrases]
```

Tier 3's four rows are concatenated verbatim into one sentence, in this order:
`[WORLD_EVENT: {who} {what} {why} {where}]` — e.g. *"a major faction declared open
hostilities to seize power in a neighboring city"*. Write each row to fit its slot and read
the joined sentence back before committing. The event is TRUE and moves the campaign
baseline; it reaches the player as news, rumour, or environmental consequence.

`**Quest Hook Who/What/Where/Why:**` is the legacy label and is still parsed. Those rows are
authored in rumour order (who + what + WHERE + why), and the parser swaps Where and Why so
the sentence still reads correctly. Use `World Event` in new files. If a file carries both
label sets, `World Event` wins and the Quest Hook rows are ignored.

The tier header lines (`**── TIER X: ... ──**`) must be present verbatim — they are parsed as delimiters. The section number for Engine Seed Tags varies (it comes after Economy/Events) — just keep it as the final `##` section.

## FILE NAMING

World lore files follow the pattern: `world_lore_[worldname].md`
Starter prompts follow: `[worldname]_starterPrompt.md` or `starter_prompt.md`

## CONTENT RULES

- No AI name-slop (no "Aethermancer Zyn'kael the Voidweaver" type names — keep names grounded and pronounceable)
- No default fantasy/sci-fi power clichés — every power system must have a specific cost or limitation
- Tonal variety is preferred over monotone grimdark
- NPC characters must feel like real people with conflicting loyalties — no sycophant companions
- All factions should have internal tensions, not just be monolithic good/evil blocs

## WHEN ADDING NEW LORE

1. Use `lore_template.md` as your structural skeleton
2. Generate content that fits the world's established tone and power ceiling
3. All new CHARACTERS must have all required fields filled — no placeholders
4. Engine Seeds must be tailored to the specific world's genre and setting
5. When expanding an existing world file, match the existing style and header format exactly
