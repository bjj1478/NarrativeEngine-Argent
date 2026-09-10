import type { LoreChunk, EngineSeed, CharacterIntroEntry } from '../../types';

// ── Tier 3 grammar ─────────────────────────────────────────────────────
// The world tag is concatenated as `[WORLD_EVENT: ${who} ${what} ${why} ${where}]`.
// Canonical authoring grammar:
//   who   — bare noun phrase          ("a major faction")
//   what  — past-tense verb phrase    ("declared open hostilities")
//   why   — a to…/because… clause     ("to seize power")
//   where — a prepositional phrase    ("in a neighboring city")
// `**World Event <Field>:**` rows are authored in that grammar and map 1:1.
//
// `**Quest Hook <Field>:**` is the legacy label. Its rows are authored in rumour
// order — who + what + WHERE + WHY — so the alias routes Quest Hook *Where* into
// the `why` slot and Quest Hook *Why* into the `where` slot. The slots are
// positional; this swap is what makes the sentence come out in rumour order.
// Keep in sync with src/services/lore/loreEngineSeeder.ts.

type WorldField = 'worldWho' | 'worldWhat' | 'worldWhere' | 'worldWhy';
type SeedField =
    | 'surpriseTypes' | 'surpriseTones' | 'encounterTypes' | 'encounterTones'
    | WorldField | 'consequences';

const ENUM_FIELDS: [RegExp, SeedField][] = [
    [/\*\*Surprise Types:\*\*\s*(.+)/i, 'surpriseTypes'],
    [/\*\*Surprise Tones:\*\*\s*(.+)/i, 'surpriseTones'],
    [/\*\*Encounter Types:\*\*\s*(.+)/i, 'encounterTypes'],
    [/\*\*Encounter Tones:\*\*\s*(.+)/i, 'encounterTones'],
];

const WORLD_EVENT_FIELDS: [RegExp, WorldField][] = [
    [/\*\*World Event Who:\*\*\s*(.+)/i, 'worldWho'],
    [/\*\*World Event What:\*\*\s*(.+)/i, 'worldWhat'],
    [/\*\*World Event Where:\*\*\s*(.+)/i, 'worldWhere'],
    [/\*\*World Event Why:\*\*\s*(.+)/i, 'worldWhy'],
];

const QUEST_HOOK_FIELDS: [RegExp, WorldField][] = [
    [/\*\*Quest Hook Who:\*\*\s*(.+)/i, 'worldWho'],
    [/\*\*Quest Hook What:\*\*\s*(.+)/i, 'worldWhat'],
    [/\*\*Quest Hook Where:\*\*\s*(.+)/i, 'worldWhy'],
    [/\*\*Quest Hook Why:\*\*\s*(.+)/i, 'worldWhere'],
];

/**
 * Strip a `TYPE -- Name` / `TYPE — Name` prefix off a chunk header. The previous
 * version split on `[—–]` only, so it missed the double-hyphen dialect that every
 * shipped lore document actually uses.
 */
function extractEntityName(header: string): string {
    const name = header.replace(/\[CHUNK:\s*[A-Z_]+[—\-\s]*\]/i, '').trim();
    const prefixMatch = name.match(/^[A-Z][A-Z_\s]*(?:--|[—–])\s*(.+)/);
    if (prefixMatch) return prefixMatch[1].trim();
    return name.split(/[—–]/)[0].trim();
}

// ── Consequences ───────────────────────────────────────────────────────
// World-specific costs of a miss. Whole phrases, not tags — they carry their own
// commas, so they are never comma-split. Two authored shapes are accepted:
//
//   1. A `**Consequences:**` block whose entries are one per line, optionally
//      bulleted. The block ends at the first blank line or the next `**Field:**`.
//   2. The `| The miss | What it costs |` markdown tables that already exist under
//      `MECHANIC -- … Consequence Table` headers. The two columns are joined as
//      "Label — cost" so the label (Noise, Trace, Pinned) survives as the handle.
//
// Nothing draws from these yet; extraction only has to be faithful.

const CONSEQUENCE_HEADER = /^\s*\*\*Consequences:\*\*\s*(.*)$/i;
/** A markdown table row: leading pipe, cells, trailing pipe. */
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
/** The `|---|---|` separator under a table header. */
const TABLE_RULE = /^[\s|:-]+$/;
/** Another `**Field:**` line, which terminates a consequence block. */
const NEXT_FIELD = /^\s*\*\*[^*]+:\*\*/;

function cleanPhrase(raw: string): string {
    return raw
        .replace(/^\s*[-*+]\s+/, '')   // bullet
        .replace(/^\s*\d+[.)]\s+/, '') // numbered
        .replace(/\*\*/g, '')
        .trim();
}

/** Entries from an explicit `**Consequences:**` block, one per line. */
function consequencesFromBlock(lines: string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        const header = lines[i].match(CONSEQUENCE_HEADER);
        if (!header) continue;

        // A value on the header line itself is the first entry.
        const inline = cleanPhrase(header[1] ?? '');
        if (inline) out.push(inline);

        for (let j = i + 1; j < lines.length; j++) {
            const line = lines[j];
            if (!line.trim()) break;              // blank line ends the block
            if (NEXT_FIELD.test(line)) break;     // next field ends the block
            if (/^\s*#{1,6}\s/.test(line)) break; // next header ends the block
            const phrase = cleanPhrase(line);
            if (phrase) out.push(phrase);
        }
    }
    return out;
}

/** A heading row that names a cost column — the table identifies itself. */
const COST_HEADING = /what it costs|the cost|cost\b/i;

/**
 * Entries from a two-column consequence table.
 *
 * A table qualifies two ways, because the headers in the wild do not all say the word:
 * the Sword Coast's fourth table is `MECHANIC -- Magic Backlash Table`, which names no
 * consequence at all and is only recognisable by sitting under `## 5A. CONSEQUENCE
 * TABLES` and by its own `| The miss | What it costs |` heading row. Either signal is
 * enough; an unrelated table (prices, a timeline) matches neither and is left alone.
 */
function consequencesFromTable(header: string, parentSection: string, lines: string[]): string[] {
    const namedConsequence = /consequence/i.test(`${header} ${parentSection}`);
    const out: string[] = [];
    let headingCells: string[] | null = null;

    for (const line of lines) {
        const row = line.match(TABLE_ROW);
        if (!row) { headingCells = null; continue; }  // a gap ends the table
        if (TABLE_RULE.test(row[1])) continue;

        const cells = row[1].split('|').map(c => cleanPhrase(c)).filter(Boolean);
        if (cells.length < 2) continue;

        // First row of a table is its column headings ("The miss", "What it costs").
        if (!headingCells) { headingCells = cells; continue; }

        // Take the table only if its name or its own heading row vouches for it.
        if (!namedConsequence && !headingCells.some(c => COST_HEADING.test(c))) continue;

        const [label, ...rest] = cells;
        const cost = rest.join(' ').trim();
        if (!cost) continue;
        out.push(label ? `${label} — ${cost}` : cost);
    }
    return out;
}

function splitEnum(raw: string): string[] {
    return raw.split(/[,/]+/).map(s => s.trim().replace(/[.;]+$/, '')).filter(Boolean);
}

/** Phrase lists split on commas only — a slash is meaningful inside a phrase. */
function splitPhrases(raw: string): string[] {
    return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function hasBalancedParens(s: string): boolean {
    let depth = 0;
    for (const ch of s) {
        if (ch === '(') depth++;
        else if (ch === ')') { depth--; if (depth < 0) return false; }
    }
    return depth === 0;
}

function stripTrailingParenthetical(name: string): string {
    return name.replace(/\s*\([^()]*\)\s*$/, '').trim();
}

function cleanMemberName(raw: string): string | null {
    let s = raw.trim().replace(/^(?:and|or)\s+/i, '').replace(/[.;]+$/, '').trim();
    if (s.length < 3) return null;
    if (!hasBalancedParens(s)) return null;
    if (!/[A-Z]/.test(s)) return null;
    s = stripTrailingParenthetical(s);
    return s.length >= 3 ? s : null;
}

const CLAUSE_MAX = 80;
function firstClause(raw: string): string | null {
    const first = raw.trim().split(/(?<=[.!?])\s+/)[0].replace(/[.;]+$/, '').trim();
    if (!first || first.length > CLAUSE_MAX) return null;
    return first;
}

export function extractEngineSeeds(chunks: LoreChunk[]): EngineSeed {
    const sets: Record<SeedField, Set<string>> = {
        surpriseTypes: new Set(), surpriseTones: new Set(),
        encounterTypes: new Set(), encounterTones: new Set(),
        worldWho: new Set(), worldWhat: new Set(),
        worldWhere: new Set(), worldWhy: new Set(),
        consequences: new Set(),
    };

    // A field supplied by an explicit row is authoritative — the heuristics never
    // top it up.
    const explicit = new Set<SeedField>();

    for (const chunk of chunks) {
        for (const [pattern, field] of ENUM_FIELDS) {
            const m = chunk.content.match(pattern);
            if (m) { splitEnum(m[1]).forEach(v => sets[field].add(v)); explicit.add(field); }
        }
        for (const [pattern, field] of WORLD_EVENT_FIELDS) {
            const m = chunk.content.match(pattern);
            if (m) { splitPhrases(m[1]).forEach(v => sets[field].add(v)); explicit.add(field); }
        }

        // Consequences are never comma-split and have no heuristic fallback.
        const contentLines = chunk.content.split(/\r?\n/);
        for (const phrase of consequencesFromBlock(contentLines)) sets.consequences.add(phrase);
        for (const phrase of consequencesFromTable(chunk.header, chunk.parentSection ?? '', contentLines)) sets.consequences.add(phrase);
    }

    // Quest Hook alias — only for slots the canonical rows did not fill.
    for (const chunk of chunks) {
        for (const [pattern, field] of QUEST_HOOK_FIELDS) {
            if (explicit.has(field)) continue;
            const m = chunk.content.match(pattern);
            if (m) splitPhrases(m[1]).forEach(v => sets[field].add(v));
        }
    }
    for (const [, field] of QUEST_HOOK_FIELDS) {
        if (sets[field].size > 0) explicit.add(field);
    }

    for (const chunk of chunks) {
        const text = chunk.content;

        if (chunk.category === 'faction' && !explicit.has('worldWho')) {
            const name = stripTrailingParenthetical(extractEntityName(chunk.header));
            if (name) sets.worldWho.add(name);

            const members = text.match(/\*\*Key Members:\*\*\s*(.+)/i)
                || text.match(/\*\*Leader:\*\*\s*(.+)/i);
            if (members) {
                for (const part of members[1].split(',')) {
                    const cleaned = cleanMemberName(part);
                    if (cleaned) sets.worldWho.add(cleaned);
                }
            }
        }

        if (!explicit.has('worldWhere')) {
            if (chunk.category === 'location') {
                const name = stripTrailingParenthetical(extractEntityName(chunk.header));
                if (name) sets.worldWhere.add(`in or around ${name}`);
            } else if (chunk.category === 'world_overview') {
                const places = text.match(/in (the )?([A-Z][a-z]+(\s[A-Z][a-z]+)*)/g);
                if (places) places.forEach(p => sets.worldWhere.add(p));
            }
        }

        // Character goals are personal motives, not world-event causes — skipping
        // them is what removes the "to to …" run-ons.
        if (!explicit.has('worldWhy') && chunk.category !== 'character') {
            const goals = text.match(/\*\*Goals:\*\*\s*(.+)/i);
            if (goals) {
                const clause = firstClause(goals[1]);
                if (clause) sets.worldWhy.add(`to ${clause.replace(/^to\s+/i, '').toLowerCase()}`);
            }
            if (chunk.category === 'event' || chunk.category === 'faction') {
                const motive = text.match(/\*\*Motivations?:\*\*\s*(.+)/i);
                if (motive) {
                    const clause = firstClause(motive[1]);
                    if (clause) sets.worldWhy.add(`driven by ${clause.toLowerCase()}`);
                }
            }
        }

        // `chunk.summary` no longer feeds this slot: it is a 100-char mid-word cut
        // of the first prose line, and a noun phrase where a verb phrase is needed.
        if (!explicit.has('worldWhat') && chunk.category === 'event') {
            if (chunk.header.toLowerCase().includes('arc')) {
                const name = extractEntityName(chunk.header);
                if (name) sets.worldWhat.add(`initiated ${name}`);
            }
        }

        // The header test is needed because `### OVERVIEW -- <title>` classifies as
        // `misc`, which left the template-mandated **Tone:** line dead.
        const isOverview = chunk.category === 'world_overview'
            || /^\s*OVERVIEW\b/i.test(chunk.header);
        if (isOverview) {
            const tone = text.match(/\*\*Tone:\*\*\s*(.+)/i);
            if (tone) {
                for (const t of splitEnum(tone[1])) {
                    if (!explicit.has('surpriseTones')) sets.surpriseTones.add(t.toUpperCase());
                    if (!explicit.has('encounterTones')) sets.encounterTones.add(t.toUpperCase());
                }
            }
        }
    }

    const seed: EngineSeed = {
        surpriseTypes: Array.from(sets.surpriseTypes),
        surpriseTones: Array.from(sets.surpriseTones),
        encounterTypes: Array.from(sets.encounterTypes),
        encounterTones: Array.from(sets.encounterTones),
        worldWho: Array.from(sets.worldWho),
        worldWhere: Array.from(sets.worldWhere),
        worldWhy: Array.from(sets.worldWhy),
        worldWhat: Array.from(sets.worldWhat),
        consequences: Array.from(sets.consequences),
        characterIntros: [],
    };

    // --- CHARACTER INTROS (Wandering / Location / Boosted) ---
    const characterChunks = chunks.filter(c => c.category === 'character');
    for (const chunk of characterChunks) {
        const text = chunk.content;
        const name = extractEntityName(chunk.header);
        if (!name) continue;

        const isWandering = /\*\*Wandering:\s*true\*\*/i.test(text);
        const locMatch = text.match(/\*\*Location:\s*\*?\*?([^*]+)\*\*/i);
        const location = locMatch ? locMatch[1].trim() : undefined;
        const boostMatch = text.match(/\*\*Intro Boost:\s*\*?\*?([^*]+)\*\*/i);
        const boostKeywords = boostMatch
            ? boostMatch[1].split(/[,/]+/).map(s => s.trim()).filter(Boolean)
            : undefined;

        if (!isWandering && !location) continue;

        let type: CharacterIntroEntry['type'];
        if (isWandering && location && boostKeywords && boostKeywords.length > 0) {
            type = 'location+boosted';
        } else if (isWandering && boostKeywords && boostKeywords.length > 0) {
            type = 'wandering+boosted';
        } else if (location && boostKeywords && boostKeywords.length > 0) {
            type = 'location+boosted';
        } else if (isWandering && location) {
            type = 'location';
        } else if (isWandering) {
            type = 'wandering';
        } else {
            type = 'location';
        }

        const entry: CharacterIntroEntry = { name, type };
        if (location) entry.location = location;
        if (boostKeywords && boostKeywords.length > 0) entry.boostKeywords = boostKeywords;

        seed.characterIntros.push(entry);
    }

    return seed;
}
