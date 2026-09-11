# World Lore Prompt Template

Copy and paste the text below and provide it to an AI (like ChatGPT, Claude, DeepSeek) to generate a structured world lore file formatted perfectly for our engine.

---

**PROMPT TO COPY AND SEND TO AI:**

You are an expert worldbuilder for a tabletop RPG engine. I need you to generate a comprehensive world lore document for my new campaign. 

**[INSERT YOUR CAMPAIGN IDEA HERE — e.g. "A cyberpunk city built on the ruins of a magical floating island"]**

You **MUST** format the output exactly according to the structured template below.
Do not deviate from the `### Category -- Title` header structure (note the double-hyphen `--` separator), as it is parsed programmatically by the engine's RegEx.
For characters, you MUST include the expected bolded fields (Aliases, Appearance, Disposition, Personality, Voice, Status, Faction, Goals, StoryRelevance, Example Output, Affinity). The optional **PersonalityHex / Traits / Tier** fields are authoritative when present — they stop the engine inferring a personality for a character you have already written. Where a character is known for signature gear or powers, also fill the optional **SignatureEquipment / SignatureAbilities / Element** fields — these are the character's durable loadout and keep their equipment and abilities consistent across the whole campaign.

**Retrieval directives.** Put one `<!-- rag: ... -->` comment on the line immediately below
every `###` header. The engine strips it before the GM AI ever sees it, and it decides how
that section reaches the prompt. Without one, the engine falls back to guessing keywords from
your prose — which shreds names ("TikTok" becomes "tik" and "tok") and fills the index with
stopwords. Three modes:

- `<!-- rag: always, priority: 10 -->` — permanently in context. Use for the world kernel,
  the core premise, and campaign-wide operating rules. Keep this to a handful of sections.
- `<!-- rag: vector, triggers: harpers, spy, safe house, priority: 7 -->` — retrieved by
  meaning. The default for factions, locations, characters, and events. `triggers:` are the
  words you would expect in play when this section becomes relevant.
- `<!-- rag: keyword, triggers: persuade, haggle, bribe, priority: 9 -->` — retrieved only on
  a literal word match. Use for mechanical tables and lookup blocks.

`priority:` is 1–10 and breaks ties when the context budget is tight. `secondary: a, b` adds
a second gate: the section is only retrieved when a secondary word matches too.
See `Custom_Setup/Worlds/Forgotten Realms/sword_coast_world_engine.md` for a fully tagged file.

Here is the exact structure you must use:

```markdown
# [World Name]

## 1. WORLD OVERVIEW
### OVERVIEW -- [Core Premise or Intro]
<!-- rag: always, priority: 10 -->
[Describe the fundamental premise, era, and core conflict of the world. State the genre and tone clearly.]
**Tone:** [e.g. GRIM, NOIR, COMEDIC, EPIC]

## 2. FACTIONS
### FACTION -- [Faction Name]
<!-- rag: vector, triggers: [3-8 words that should surface this faction], priority: 7 -->
**Type:** [Military Order / Megacorp / Guild / Cult]
**Key Members:** [Leader Name, Notable Member — names only. This line is split on commas, so never put a parenthetical containing its own comma here, and do not end it with "and others".]
**Stance:** [Pro-establishment, Hostile, Neutral]
[Describe the faction's goals, methods, and relationship to the world.]

## 3. LOCATIONS
### LOCATION -- [Location Name]
<!-- rag: vector, triggers: [3-8 place names, districts, landmarks], priority: 7 -->
**Type:** [City / Region / Landmark]
**Status:** [Flourishing / Ruined / Contested]
[Describe the key features, atmosphere, and importance of this location.]

## 4. CHARACTERS
### CHARACTER -- [Character Name]
<!-- rag: vector, triggers: [name, alias, role, faction], priority: 7 -->
**Aliases:** [aka..., The Title]
**Appearance:** [Describe visual features — used by AI for image/description generation.]
**Disposition:** [Stoic, Protective, Ambitious]
**Personality:** [Elaborate on personality traits beyond disposition.]
**Voice:** [How they speak — cadence, vocabulary, verbal tics, speech pattern.]
**Status:** [Alive / Deceased / Missing]
**Faction:** [Faction Name or None]
**Goals:** [Describe what they want to achieve. Write it as a bare clause with no leading "To" — "Hold the northern marches", not "To hold the northern marches."]
**StoryRelevance:** [Why this character matters to the plot or world.]
**Example Output:** [One line of dialogue that perfectly captures their voice.]
**Affinity:** [0–100] (0 = hostile, 50 = neutral, 100 = devoted)
**SignatureEquipment:** [Optional. Signature gear this character is known for — e.g. Excalibur (holy longsword), plate armor. Their durable loadout; max 4 items. Omit if they carry nothing notable.]
**SignatureAbilities:** [Optional. Signature powers or techniques — e.g. fire magic, holy smite. Max 4.]
**Element:** [Optional. A single elemental / damage affinity — e.g. fire, light, ice. Omit if none.]
[Describe their background and relevance to the story.]

### CHARACTER INTRO FLAGS (optional — controls when/where this character appears in play)
**Wandering: true**         ← include this line if the character can appear ANYWHERE in the world
**Location: [Place Name]**  ← include this line if the character is tied to a specific location
**Intro Boost: [keyword1, keyword2]**  ← include this to make the character 3× more likely to appear when these words appear in recent GM narration

> Notes on intro flags:
> - Omit all three lines if the character should only appear when the GM explicitly introduces them.
> - Use Wandering for roaming characters (merchants, wandering knights, etc.).
> - Use Location for place-bound NPCs (innkeepers, guards, local bosses).
> - Use Intro Boost to tie a character to plot themes (e.g. "Intro Boost: poison, assassination" for a spy).
> - Location + Intro Boost = character appears when party is at that place AND the boost keyword is relevant.

## 5. POWER SYSTEM & RULES
### POWER_SYSTEM -- [Name of Magic/Tech]
<!-- rag: vector, triggers: [3-8 words for this power system], priority: 7 -->
[Explain how magic, technology, or special abilities work. What are the limitations?]

## 6. ECONOMY
### ECONOMY -- [Currency / Trade]
<!-- rag: vector, triggers: [coin, price, trade, cost], priority: 6 -->
[Detail the monetary system, rare resources, and general cost of living.]

## 7. EVENTS
### EVENT -- [Significant Event]
<!-- rag: vector, triggers: [3-8 words tied to this event], priority: 6 -->
[Summarize a major historical or plot event that shapes the current state.]

## 8. ENGINE SEED TAGS (IMPORTANT)
### SYSTEM -- Engine Seeds
<!-- rag: always, priority: 10 -->

> The engine has 3 tiers. Read the guidance for each carefully — the tag format matters.

**── TIER 1: SURPRISE ENGINE (mundane world flavor) ──**
> Everyday ambient moments that make the world feel alive. NOT combat, NOT major events.
> Use genre-appropriate mundane situations. The GM AI resolves the specific detail from context.
> Examples: a street argument, someone drops their coin purse, lovers fighting in public, a dog chasing a cart.
**Surprise Types:** [List 5-10 mundane situation archetypes e.g. STREET_DRAMA, FOUND_OBJECT, OVERHEARD_GOSSIP, VENDOR_DISPUTE, ANIMAL_INCIDENT]
**Surprise Tones:** [List 5-10 emotional flavors e.g. AMUSING, AWKWARD, MUNDANE, CURIOUS, HEARTWARMING, TENSE]

**── TIER 2: ENCOUNTER ENGINE (location-agnostic threat situations) ──**
> Threat SITUATIONS, NOT specific enemies. The GM AI determines what the threat actually is
> based on the current in-game location. "TERRITORIAL_THREAT" in a sewer = rats; in a palace = guards.
> DO NOT write enemy names — write the type of danger scenario instead.
**Encounter Types:** [List 5-10 threat situation archetypes e.g. HOSTILE_PRESENCE, TERRITORIAL_THREAT, PATROL_CONFRONTATION, AMBUSH_LAID, SCAVENGING_PREDATOR]
**Encounter Tones:** [List 5-10 tones e.g. TENSE, DESPERATE, SUDDEN, PREDATORY, GRIM]

**── TIER 3: WORLD ENGINE (background world events) ──**
> A shift in the world that is TRUE and moves the campaign baseline — a faction leader
> replaced, a trade route claimed, a bridge destroyed. It reaches the player as news,
> rumour, or environmental consequence, but the event itself happened.
> The four rows are concatenated verbatim, in this order, into one sentence:
>     [WORLD_EVENT: {who} {what} {why} {where}]
> So write each row to fit its slot, and read the joined sentence back before you commit:
>     who   — a bare noun phrase          "a major faction"
>     what  — a PAST-TENSE verb phrase    "declared open hostilities"
>     why   — a to… / because… clause     "to seize power"
>     where — a prepositional phrase      "in a neighboring city"
>   → "a major faction declared open hostilities to seize power in a neighboring city"
**World Event Who:** [List 5-10 actors e.g. a major faction, a rogue splinter group, a desperate individual]
**World Event What:** [List 5-10 past-tense actions e.g. declared open hostilities, seized a trade route, assassinated a key figure]
**World Event Why:** [List 5-10 motives e.g. to seize power, for brutal vengeance, to protect a dangerous secret]
**World Event Where:** [List 5-10 prepositional phrases e.g. in a neighboring city, along a main trade route, in a forgotten ruin]

**── CONSEQUENCES: what a miss costs in THIS world ──**
> Not an engine tier — a pool of world-shaped costs, held on the campaign and editable in
> Engine Tuning. One phrase per line, NOT comma-separated: each entry is a whole sentence
> or two and carries its own commas. Write the form "Label — what it costs", where the
> label names the shape of the miss and the cost is specific and concrete.
**Consequences:**
- Noise — Not discovery, attention. A patrol changes its route, a dog does not settle.
- Trace — You are through, but you left something: a print, a scratch on a lock.
- Overreached — They hear the ask underneath the words. The price of their help doubles.

> Already have `| The miss | What it costs |` tables under a `## CONSEQUENCE TABLES`
> section? They are read automatically — the two columns are joined as "Label — cost", so
> there is nothing to rewrite.

> Legacy: `**Quest Hook Who/What/Where/Why:**` is still accepted. Those rows are authored
> in rumour order (who + what + WHERE + why), and the parser swaps Where and Why so the
> sentence still reads correctly. Prefer the `World Event` labels in new files — if both
> label sets are present, `World Event` wins and the Quest Hook rows are ignored.

```

---

## Signature Kit — worked example

The **SignatureEquipment**, **SignatureAbilities**, and **Element** bullets are a character's *durable loadout* — the gear and powers the engine keeps consistent every time they appear, so a knight famed for a holy sword doesn't quietly end up swinging a plain spear three sessions later. They're optional; omit them for characters with no signature kit. Here is a fully-filled character showing them in use:

```markdown
### CHARACTER -- John Roleplay
**Aliases:** The Paladin of Abalon, Sir John
**Appearance:** A broad-shouldered knight in gleaming silver plate chased with gold filigree, over a white tabard bearing a radiant sun sigil. Close-cropped brown hair, earnest blue eyes, a squared jaw. At his hip rests a longsword whose blade glows faintly with an inner light.
**Disposition:** Earnest, righteous, unfailingly courteous.
**Personality:** John is a storybook paladin — brave to a fault and a touch naive. He believes the best of everyone until proven otherwise, speaks in oaths and vows, and cannot abide cruelty to the weak. His conviction is wholly genuine, never smug.
**Voice:** Formal and warm, fond of oaths ("By the light of Abalon..."). Speaks plainly, never coarsely. Addresses others as "friend" or "good sir/lady".
**Status:** Alive
**Faction:** The Knights of Abalon
**Goals:** To uphold the Light and shield the innocent — and to prove himself worthy of the blade Ekkusukalibah.
**StoryRelevance:** A wandering paladin and steadfast ally; the moral compass of any party and a living link to the holy realm of Abalon.
**Example Output:** "By the light of Abalon, I swear it: no harm shall come to these people while I draw breath. Stand behind me, friend."
**Affinity:** 65
**SignatureEquipment:** [Ekkusukalibah (radiant longsword), blessed silver plate, kite shield]
**SignatureAbilities:** [holy smite, lay on hands, divine shield]
**Element:** light
**PersonalityHex:** drive:+2, diligence:+2, boldness:+2, warmth:+3, empathy:+3, composure:+1
**Traits:** [faithful, loyal, honorable, protective, oath-bound]
Once a squire of Abalon, John drew the radiant blade Ekkusukalibah from its resting stone and swore to carry the Light into the world. He now wanders in search of those who need a shield.
**Wandering: true**
**Intro Boost: light, holy, paladin, oath, Abalon, undead**
```

---

## Example of a Completed Generation (Cyber-Noir Setting)
*(You can use this as reference or upload this directly just to test it out!)*

```markdown
# Neo-Veridya

## 1. WORLD OVERVIEW
### OVERVIEW -- Core Premise
Neo-Veridya is a sprawling, rain-slicked metropolis where advanced cybernetics collide with highly illegal blood-magic. The city is controlled by three massive corporatocracies, while the lower levels drown in neon and organized crime. 
**Tone:** GRIM, NOIR, CYBERPUNK.

## 2. FACTIONS
### FACTION -- The Crimson Syndicate
**Type:** Organized Crime / Magic Cartel
**Key Members:** Jax "The Bleeder" Vance
**Stance:** Hostile to Corpos, allied with the lower wards.
The syndicate controls the flow of "Sanguine," a magical narcotic that enhances reflexes but slowly crystallizes the user's blood. They operate out of the sunken districts.

## 3. LOCATIONS
### LOCATION -- Layer Zero
**Type:** Slums / Black Market
**Status:** Lawless
The lowest level of Neo-Veridya. Constant acid rain and blocked out sun. It is a labyrinth of junk-tech stalls, illegal cyber-docs, and sanctuary for those fleeing the CorpEnforcers.

## 4. CHARACTERS
### CHARACTER -- Jax Vance
**Aliases:** The Bleeder, Mr. Vance
**Appearance:** Tall, gaunt. One glowing red biosynthetic eye, pale skin, sharply dressed in a maroon trenchcoat.
**Disposition:** Ruthless, calculating, falsely polite.
**Personality:** Jax is charming in a cold, transactional way. He treats every interaction as a negotiation and every person as a resource. Rarely raises his voice.
**Voice:** Soft, deliberate, never rushed. Uses formal language even with street thugs. Often ends sentences with a quiet question that isn't really a question.
**Status:** Alive
**Faction:** The Crimson Syndicate
**Goals:** To monopolize the Sanguine trade and buy his way into the upper echelons.
**StoryRelevance:** Central antagonist and potential uneasy ally. Controls most of the underworld's information flow.
**Example Output:** "I don't deal in threats, friend. I deal in arrangements. Now — shall we be reasonable?"
**Affinity:** 20
Jax is the undisputed king of Layer Zero. He rarely gets his own hands dirty, preferring to manipulate others through debt and addiction.
**Location: Layer Zero**
**Intro Boost: sanguine, syndicate, drug, debt, underworld**

### CHARACTER -- Mira Solenne
**Aliases:** The Ghost, Mira
**Appearance:** Slight build, close-cropped silver hair, a faded CorpSec tattoo on her left wrist she tries to hide. Always wears grey.
**Disposition:** Guarded, perceptive, quietly haunted.
**Personality:** Mira trusts nobody by default but warms slowly. She has a dry sense of humour she rarely lets out. Hates waste — of people, of resources, of potential.
**Voice:** Clipped and efficient. Rarely uses contractions when stressed. Long silences between sentences.
**Status:** Alive
**Faction:** None (ex-CorpSec)
**Goals:** To find evidence that CorpSec knowingly covered up the Layer Zero massacre.
**StoryRelevance:** Key contact for investigation arcs. Knows CorpSec protocols and can get the party into restricted areas.
**Example Output:** "I've seen what they do to loose ends. Don't ask me to trust you. Ask me to work with you. That I can do."
**Affinity:** 50
Former CorpSec investigator who went dark after a case led somewhere she wasn't supposed to look.
**Wandering: true**
**Intro Boost: corpse, massacre, evidence, investigation, CorpSec**

## 5. POWER SYSTEM & RULES
### POWER_SYSTEM -- Haemomancy & Chrome
Magic in Neo-Veridya requires blood—either drawn from the caster or a victim. Tech enhancements (Chrome) suppress magical ability. The more machine you become, the less magic you can wield.

## 6. ENGINE SEED TAGS
### SYSTEM -- Engine Seeds

**── TIER 1: SURPRISE ENGINE ──**
**Surprise Types:** STREET_BRAWL, FOUND_CREDCHIP, OVERHEARD_DEAL, DRONE_MALFUNCTION, VENDOR_DISPUTE, ADDICT_SCENE, CORP_PROPAGANDA_BROADCAST, RAIN_SURGE, STRANGER_COLLAPSES, URCHIN_PICKPOCKET
**Surprise Tones:** MUNDANE, GRIM, AMUSING, TENSE, NEON_DRENCHED, CHAOTIC, BITTERSWEET, AWKWARD

**── TIER 2: ENCOUNTER ENGINE ──**
**Encounter Types:** HOSTILE_PRESENCE, PATROL_CONFRONTATION, TERRITORIAL_THREAT, AMBUSH_LAID, DESPERATE_ATTACKER, CORNERED_ENTITY, RIVAL_CLAIM, SCAVENGING_PREDATOR, TRAP_TRIGGERED, ENVIRONMENTAL_THREAT
**Encounter Tones:** TENSE, DESPERATE, SUDDEN, GRIM, CALCULATED, PREDATORY, CHAOTIC, CLINICAL

**── TIER 3: WORLD ENGINE ──**
**World Event Who:** the Crimson Syndicate, a CorpSec board faction, a rogue ripperdoc collective, the Sanguine cartels, an offworld investor bloc, a Layer Zero squatter council
**World Event What:** seized a transit chokepoint, choked off a district's blood supply, bought out a rival clinic chain, assassinated a district administrator, lifted a quarantine early, published a rival's stolen ledgers
**World Event Why:** to corner the Sanguine trade, to bury an audit before it lands, for a decade-old betrayal, to force a price war, because a debt finally came due, to keep Chrome and magic apart
**World Event Where:** in the lower processing vaults, across a flooded sub-district, at the old transit hub, inside a decommissioned med-facility, on the rooftop black markets, along the Syndicate's neutral ground
```
