import { describe, it, expect } from 'vitest';
import { extractEngineSeeds } from '../loreEngineSeeder';
import { chunkLoreFile } from '../loreChunker';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures are real markdown run through chunkLoreFile, not hand-built LoreChunks.
// The previous version of this suite constructed chunks with a legacy
// `[CHUNK: FACTION] Name — Sub` header shape that chunkLoreFile no longer emits,
// which is exactly why the `FACTION` / `in or around LOCATION` placeholder bug
// survived in production while the tests stayed green.
// ─────────────────────────────────────────────────────────────────────────────

const seedsFor = (markdown: string) => extractEngineSeeds(chunkLoreFile(markdown));

const WORLD_EVENT_ROWS = `
## 9. ENGINE SEED TAGS
### SYSTEM -- Engine Seeds
**World Event Who:** a major faction, a rogue splinter group, a desperate individual
**World Event What:** declared open hostilities, formed an alliance, seized a depot
**World Event Why:** to seize power, for vengeance, to protect a secret
**World Event Where:** in a neighboring city, along the trade road, in a forgotten ruin
`;

const QUEST_HOOK_ROWS = `
## 9. ENGINE SEED TAGS
### SYSTEM -- Engine Seeds
**Quest Hook Who:** a frightened merchant, a local guard, a travelling hermit
**Quest Hook What:** spotted raiders near, claims something was found at, says a person vanished from
**Quest Hook Where:** on the northern road, near the old ruins, at the river crossing
**Quest Hook Why:** and a reward is offered, and locals are too frightened to act, hinting at treasure
`;

describe('extractEngineSeeds — empty / no-input cases', () => {
    it('no chunks -> every field empty', () => {
        expect(extractEngineSeeds([])).toEqual({
            surpriseTypes: [], surpriseTones: [], encounterTypes: [], encounterTones: [],
            worldWho: [], worldWhere: [], worldWhy: [], worldWhat: [],
            consequences: [],
        });
    });

    it('prose with no seed rows and no parseable entities -> every field empty', () => {
        const seed = seedsFor('## 1. WORLD OVERVIEW\n### OVERVIEW -- Nothing\nJust some prose.\n');
        expect(seed.worldWho).toEqual([]);
        expect(seed.worldWhat).toEqual([]);
    });
});

describe('extractEngineSeeds — canonical World Event rows', () => {
    it('maps each row straight through to its own slot', () => {
        const seed = seedsFor(WORLD_EVENT_ROWS);
        expect(seed.worldWho).toEqual(['a major faction', 'a rogue splinter group', 'a desperate individual']);
        expect(seed.worldWhat).toEqual(['declared open hostilities', 'formed an alliance', 'seized a depot']);
        expect(seed.worldWhy).toEqual(['to seize power', 'for vengeance', 'to protect a secret']);
        expect(seed.worldWhere).toEqual(['in a neighboring city', 'along the trade road', 'in a forgotten ruin']);
    });

    it('does not split a phrase on an internal slash', () => {
        const seed = seedsFor(`### SYSTEM -- Engine Seeds\n**World Event Why:** to seize power/control, for gold\n`);
        expect(seed.worldWhy).toEqual(['to seize power/control', 'for gold']);
    });
});

describe('extractEngineSeeds — Quest Hook alias swaps where/why', () => {
    // The tag prints `${who} ${what} ${why} ${where}`. Quest Hook rows are authored
    // in rumour order (who/what/where/why), so Where must land in the `why` slot and
    // Why in the `where` slot for the emitted sentence to read correctly.
    it('routes Quest Hook Where into the why slot and Quest Hook Why into the where slot', () => {
        const seed = seedsFor(QUEST_HOOK_ROWS);
        expect(seed.worldWho).toEqual(['a frightened merchant', 'a local guard', 'a travelling hermit']);
        expect(seed.worldWhy).toEqual(['on the northern road', 'near the old ruins', 'at the river crossing']);
        expect(seed.worldWhere).toEqual(['and a reward is offered', 'and locals are too frightened to act', 'hinting at treasure']);
    });

    it('the swap makes who+what+why+where read in rumour order', () => {
        const s = seedsFor(QUEST_HOOK_ROWS);
        const sentence = `${s.worldWho[0]} ${s.worldWhat[0]} ${s.worldWhy[0]} ${s.worldWhere[0]}`;
        expect(sentence).toBe('a frightened merchant spotted raiders near on the northern road and a reward is offered');
    });
});

describe('extractEngineSeeds — both label sets present', () => {
    it('World Event wins and Quest Hook rows are not merged in', () => {
        const seed = seedsFor(`${WORLD_EVENT_ROWS}\n${QUEST_HOOK_ROWS.split('\n').slice(3).join('\n')}`);
        expect(seed.worldWho).toEqual(['a major faction', 'a rogue splinter group', 'a desperate individual']);
        expect(seed.worldWhere).toEqual(['in a neighboring city', 'along the trade road', 'in a forgotten ruin']);
        expect(seed.worldWho).not.toContain('a frightened merchant');
    });
});

describe('extractEngineSeeds — explicit rows suppress the heuristics', () => {
    it('a curated who list is not polluted by faction headers', () => {
        const seed = seedsFor(`
## 2. FACTIONS
### FACTION -- The Zhentarim (Black Network)
**Key Members:** Merchants, spies, and officials
Body prose.
${WORLD_EVENT_ROWS}`);
        expect(seed.worldWho).toEqual(['a major faction', 'a rogue splinter group', 'a desperate individual']);
        expect(seed.worldWho).not.toContain('The Zhentarim');
    });

    it('a curated where list is not polluted by location headers', () => {
        const seed = seedsFor(`
## 3. LOCATIONS
### LOCATION -- Waterdeep (The Crown of the North)
**Type:** City
Body prose.
${WORLD_EVENT_ROWS}`);
        expect(seed.worldWhere).not.toContain('in or around Waterdeep');
    });
});

describe('extractEngineSeeds — heuristic WHO (no explicit rows)', () => {
    const factionDoc = `
## 2. FACTIONS
### FACTION -- The Zhentarim (Black Network)
**Type:** Mercantile network
**Key Members:** Laeral Silverhand (Waterdeep), informants, spies, and the rulers of other member cities
Body prose about the network.
`;

    it('strips the TYPE -- prefix instead of yielding the literal "FACTION"', () => {
        const seed = seedsFor(factionDoc);
        expect(seed.worldWho).toContain('The Zhentarim');
        expect(seed.worldWho).not.toContain('FACTION');
    });

    it('drops connective tails and bare role plurals from Key Members', () => {
        const seed = seedsFor(factionDoc);
        expect(seed.worldWho).toContain('Laeral Silverhand');
        expect(seed.worldWho).not.toContain('informants');
        expect(seed.worldWho).not.toContain('spies');
        expect(seed.worldWho).not.toContain('and the rulers of other member cities');
    });

    it('drops half-parenthetical fragments produced by splitting prose on commas', () => {
        const seed = seedsFor(`
## 2. FACTIONS
### FACTION -- The Faithful
**Key Members:** evangelical leaders (Franklin Graham, Joel Osteen)
Body.
`);
        expect(seed.worldWho).not.toContain('evangelical leaders (Franklin Graham');
        expect(seed.worldWho).not.toContain('Joel Osteen)');
    });
});

describe('extractEngineSeeds — heuristic WHERE (no explicit rows)', () => {
    it('yields the location name, not the literal "LOCATION"', () => {
        const seed = seedsFor(`
## 3. LOCATIONS
### LOCATION -- Waterdeep (The Crown of the North)
**Type:** Great northern metropolis
Body prose.
`);
        expect(seed.worldWhere).toEqual(['in or around Waterdeep']);
        expect(seed.worldWhere).not.toContain('in or around LOCATION');
    });
});

describe('extractEngineSeeds — heuristic WHY (no explicit rows)', () => {
    it('never emits a doubled preposition when Goals already begins with "To"', () => {
        const seed = seedsFor(`
## 2. FACTIONS
### FACTION -- The Guild
**Goals:** To seize the docks.
Body.
`);
        expect(seed.worldWhy).toEqual(['to seize the docks']);
        expect(seed.worldWhy.some(w => w.startsWith('to to'))).toBe(false);
    });

    it('ignores character Goals — they are personal motives, not world causes', () => {
        const seed = seedsFor(`
## 4. CHARACTERS
### CHARACTER -- Aldric
**Status:** Alive
**Goals:** To avenge his brother.
Body.
`);
        expect(seed.worldWhy).toEqual([]);
    });

    it('drops a Goals clause too long to read as a why fragment rather than truncating it', () => {
        const seed = seedsFor(`
## 2. FACTIONS
### FACTION -- The Guild
**Goals:** Balance the city's economic interests with its alliance obligations while managing the growing tensions between magical regulation and free trade.
Body.
`);
        expect(seed.worldWhy).toEqual([]);
    });

    it('keeps only the first sentence of a multi-sentence Goals line', () => {
        const seed = seedsFor(`
## 2. FACTIONS
### FACTION -- The Guild
**Goals:** Hold the docks. Then take the customs house.
Body.
`);
        expect(seed.worldWhy).toEqual(['to hold the docks']);
    });
});

describe('extractEngineSeeds — heuristic WHAT (no explicit rows)', () => {
    it('does not use chunk.summary — it is a mid-word 100-char prose cut', () => {
        const seed = seedsFor(`
## 7. EVENTS
### EVENT -- The Spellplague
A catastrophic disruption of magic that transformed regions, creatures, and magical practice across the whole of the continent for generations.
`);
        expect(seed.worldWhat).toEqual([]);
    });

    it('still names an arc header', () => {
        const seed = seedsFor(`
## 7. EVENTS
### EVENT -- The Great War Arc
Body prose describing the arc.
`);
        expect(seed.worldWhat).toEqual(['initiated The Great War Arc']);
    });
});

describe('extractEngineSeeds — no genre-blind synthetic types', () => {
    it('a power_system chunk does not inject MAGIC_FLUCTUATION / POWER_ANOMALY', () => {
        const seed = seedsFor(`
## 5. POWER SYSTEM & RULES
### POWER_SYSTEM -- The Absence of Magic
There is no magic in this world.
`);
        expect(seed.surpriseTypes).toEqual([]);
        expect(seed.encounterTypes).toEqual([]);
    });

    it('a rules/mechanic chunk does not inject MECHANIC_SHIFT / SYSTEM_GLITCH', () => {
        const seed = seedsFor(`
## 5. POWER SYSTEM & RULES
### MECHANIC -- Social Consequence Table
A table of consequences.
`);
        expect(seed.surpriseTypes).toEqual([]);
        expect(seed.encounterTypes).toEqual([]);
    });
});

describe('extractEngineSeeds — enum rows', () => {
    it('parses Surprise/Encounter types and tones and strips trailing punctuation', () => {
        const seed = seedsFor(`
### SYSTEM -- Engine Seeds
**Surprise Types:** WEATHER_SHIFT, ODD_SOUND, NPC_QUIRK
**Surprise Tones:** CURIOUS, EERIE, MUNDANE.
**Encounter Types:** AMBUSH, PATROL_CONFRONTATION, MAGICAL_HAZARD
**Encounter Tones:** TENSE, GRIM, SUDDEN
`);
        expect(seed.surpriseTypes).toEqual(['WEATHER_SHIFT', 'ODD_SOUND', 'NPC_QUIRK']);
        expect(seed.surpriseTones).toEqual(['CURIOUS', 'EERIE', 'MUNDANE']);
        expect(seed.encounterTypes).toEqual(['AMBUSH', 'PATROL_CONFRONTATION', 'MAGICAL_HAZARD']);
        expect(seed.encounterTones).toEqual(['TENSE', 'GRIM', 'SUDDEN']);
    });
});

describe('extractEngineSeeds — **Tone:** on an OVERVIEW chunk', () => {
    // `### OVERVIEW -- <title>` classifies as `misc`, so this used to be dead and
    // the template-mandated **Tone:** line never reached either tone list.
    it('seeds both tone lists when no explicit tone rows exist', () => {
        const seed = seedsFor(`
## 1. WORLD OVERVIEW
### OVERVIEW -- The Sword Coast
Prose about the region.
**Tone:** EPIC, POLITICAL, HEROIC.
`);
        expect(seed.surpriseTones).toEqual(['EPIC', 'POLITICAL', 'HEROIC']);
        expect(seed.encounterTones).toEqual(['EPIC', 'POLITICAL', 'HEROIC']);
    });

    it('explicit tone rows win over the overview Tone line', () => {
        const seed = seedsFor(`
## 1. WORLD OVERVIEW
### OVERVIEW -- The Sword Coast
Prose.
**Tone:** EPIC, POLITICAL

### SYSTEM -- Engine Seeds
**Surprise Tones:** AMUSING, AWKWARD, MUNDANE
`);
        expect(seed.surpriseTones).toEqual(['AMUSING', 'AWKWARD', 'MUNDANE']);
    });
});

describe('extractEngineSeeds — dedupe across chunks', () => {
    it('collapses a repeated faction name', () => {
        const seed = seedsFor(`
## 2. FACTIONS
### FACTION -- The Guild
Body one.

### FACTION -- The Guild
Body two.
`);
        expect(seed.worldWho).toEqual(['The Guild']);
    });
});

describe('extractEngineSeeds — consequences', () => {
    it('reads an explicit **Consequences:** block one phrase per line', () => {
        const seed = seedsFor(`
### SYSTEM -- Engine Seeds
**Consequences:**
- Noise — Not discovery, attention. A patrol changes its route, a dog does not settle.
- Trace — You are through, but you left something: a print, a scratch on a lock.
- Pinned — The way forward is fine; the way back closed behind you.
`);
        expect(seed.consequences).toEqual([
            'Noise — Not discovery, attention. A patrol changes its route, a dog does not settle.',
            'Trace — You are through, but you left something: a print, a scratch on a lock.',
            'Pinned — The way forward is fine; the way back closed behind you.',
        ]);
    });

    it('never splits a phrase on its internal commas or slashes', () => {
        const seed = seedsFor(`
### SYSTEM -- Engine Seeds
**Consequences:**
- The price of their help doubles, or acquires a condition you will not like.
`);
        expect(seed.consequences).toHaveLength(1);
        expect(seed.consequences[0]).toContain(', or acquires');
    });

    it('ends the block at a blank line, not at the end of the chunk', () => {
        const seed = seedsFor(`
### SYSTEM -- Engine Seeds
**Consequences:**
- A patrol changes its route.

Some unrelated prose that follows the block.
`);
        expect(seed.consequences).toEqual(['A patrol changes its route.']);
    });

    it('ends the block at the next **Field:** line', () => {
        const seed = seedsFor(`
### SYSTEM -- Engine Seeds
**Consequences:**
- A patrol changes its route.
**Surprise Tones:** TENSE, GRIM, SUDDEN
`);
        expect(seed.consequences).toEqual(['A patrol changes its route.']);
        expect(seed.surpriseTones).toEqual(['TENSE', 'GRIM', 'SUDDEN']);
    });

    it('harvests a two-column consequence table, joining label and cost', () => {
        const seed = seedsFor(`
## 5A. CONSEQUENCE TABLES
### MECHANIC -- Social Consequence Table

| The miss | What it costs |
|---|---|
| Overreached | They hear the ask underneath the words. The price doubles. |
| Read wrong | You misjudged what they wanted. |
`);
        expect(seed.consequences).toEqual([
            'Overreached — They hear the ask underneath the words. The price doubles.',
            'Read wrong — You misjudged what they wanted.',
        ]);
    });

    it('takes a table whose header omits the word, via its parent section', () => {
        // `MECHANIC -- Magic Backlash Table` names no consequence at all; it is only
        // recognisable by its parent section and its own cost column.
        const seed = seedsFor(`
## 5A. CONSEQUENCE TABLES
### MECHANIC -- Magic Backlash Table

| The miss | What it costs |
|---|---|
| Marked | A visible trace — on you, on the room, on the person you touched. |
`);
        expect(seed.consequences).toEqual([
            'Marked — A visible trace — on you, on the room, on the person you touched.',
        ]);
    });

    it('leaves an unrelated table alone', () => {
        const seed = seedsFor(`
## 6. ECONOMY
### ECONOMY -- Coinage

| Coin | Value |
|---|---|
| Gold | 10 silver |
| Silver | 10 copper |
`);
        expect(seed.consequences).toEqual([]);
    });

    it('does not treat a table heading row as an entry', () => {
        const seed = seedsFor(`
### MECHANIC -- Violence Consequence Table

| The miss | What it costs |
|---|---|
| Position | Your back is to the wrong thing. |
`);
        expect(seed.consequences).not.toContain('The miss — What it costs');
    });

    it('has no default and no heuristic fallback — a world without them gets none', () => {
        const seed = seedsFor(`
## 2. FACTIONS
### FACTION -- The Guild
**Goals:** Hold the docks.
Body prose.
`);
        expect(seed.consequences).toEqual([]);
    });
});
