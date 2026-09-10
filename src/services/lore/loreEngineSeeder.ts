import type { LoreChunk, EngineSeed } from '../../types';
import { extractEntityName } from './loreChunker';

// ── Tier 3 grammar ─────────────────────────────────────────────────────
// The world tag is concatenated as `[WORLD_EVENT: ${who} ${what} ${why} ${where}]`
// (src/services/engine/engineRolls.ts). So the canonical authoring grammar is:
//   who   — bare noun phrase          ("a major faction")
//   what  — past-tense verb phrase    ("declared open hostilities")
//   why   — a to…/because… clause     ("to seize power")
//   where — a prepositional phrase    ("in a neighboring city")
// `**World Event <Field>:**` rows are authored in that grammar and map 1:1.
//
// `**Quest Hook <Field>:**` is the legacy label (still the majority of the shipped
// compendium). Its rows are authored in rumour order — who + what + WHERE + WHY
// ("a frightened merchant / spotted raiders near / on the northern road / and a
// reward is offered"). Mapping those 1:1 would emit "…raiders near and a reward is
// offered on the northern road". So the alias routes Quest Hook *Where* into the
// `why` slot and Quest Hook *Why* into the `where` slot: the slots are positional,
// and this is the swap that makes the sentence come out in rumour order.

type WorldField = 'worldWho' | 'worldWhat' | 'worldWhere' | 'worldWhy';
type SeedField =
    | 'surpriseTypes' | 'surpriseTones' | 'encounterTypes' | 'encounterTones'
    | WorldField;

const ENUM_FIELDS: [RegExp, SeedField][] = [
    [/\*\*Surprise Types:\*\*\s*(.+)/i, 'surpriseTypes'],
    [/\*\*Surprise Tones:\*\*\s*(.+)/i, 'surpriseTones'],
    [/\*\*Encounter Types:\*\*\s*(.+)/i, 'encounterTypes'],
    [/\*\*Encounter Tones:\*\*\s*(.+)/i, 'encounterTones'],
];

// Canonical Tier 3 labels — field name maps straight through.
const WORLD_EVENT_FIELDS: [RegExp, WorldField][] = [
    [/\*\*World Event Who:\*\*\s*(.+)/i, 'worldWho'],
    [/\*\*World Event What:\*\*\s*(.+)/i, 'worldWhat'],
    [/\*\*World Event Where:\*\*\s*(.+)/i, 'worldWhere'],
    [/\*\*World Event Why:\*\*\s*(.+)/i, 'worldWhy'],
];

// Legacy Tier 3 labels — note the deliberate Where↔Why slot swap (see above).
const QUEST_HOOK_FIELDS: [RegExp, WorldField][] = [
    [/\*\*Quest Hook Who:\*\*\s*(.+)/i, 'worldWho'],
    [/\*\*Quest Hook What:\*\*\s*(.+)/i, 'worldWhat'],
    [/\*\*Quest Hook Where:\*\*\s*(.+)/i, 'worldWhy'],
    [/\*\*Quest Hook Why:\*\*\s*(.+)/i, 'worldWhere'],
];

// ── Value cleaning ─────────────────────────────────────────────────────

/** Enum-ish lists (TYPES/TONES) may separate with a comma or a slash. */
function splitEnum(raw: string): string[] {
    return raw.split(/[,/]+/).map(s => s.trim().replace(/[.;]+$/, '')).filter(Boolean);
}

/**
 * Phrase lists (who/what/why/where) split on commas only — a slash is meaningful
 * inside a phrase ("a major faction/organization", "to seize power/control").
 */
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

/** Drop a trailing "(qualifier)" so tags stay short in the emitted sentence. */
function stripTrailingParenthetical(name: string): string {
    return name.replace(/\s*\([^()]*\)\s*$/, '').trim();
}

/**
 * `**Key Members:**` is a prose line split on commas, so it yields fragments that
 * are not actors: connective tails ("and the rulers of other member cities"),
 * bare role plurals ("informants", "spies"), and halves of a parenthetical that
 * contained its own comma ("evangelical leaders (Franklin Graham" / "Joel Osteen)").
 * Keep only entries that name someone — i.e. carry a capitalised token.
 */
function cleanMemberName(raw: string): string | null {
    let s = raw.trim().replace(/^(?:and|or)\s+/i, '').replace(/[.;]+$/, '').trim();
    if (s.length < 3) return null;
    if (!hasBalancedParens(s)) return null;
    if (!/[A-Z]/.test(s)) return null;
    s = stripTrailingParenthetical(s);
    return s.length >= 3 ? s : null;
}

/**
 * `**Goals:**` / `**Motivations:**` are authored as prose. Take the first sentence
 * only, and drop it outright if it is still too long to read as a clause — a
 * mid-word truncation is worse than falling back to the curated defaults.
 */
const CLAUSE_MAX = 80;
function firstClause(raw: string): string | null {
    const first = raw.trim().split(/(?<=[.!?])\s+/)[0].replace(/[.;]+$/, '').trim();
    if (!first || first.length > CLAUSE_MAX) return null;
    return first;
}

// ── Extraction ─────────────────────────────────────────────────────────

export function extractEngineSeeds(chunks: LoreChunk[]): EngineSeed {
    const sets: Record<SeedField, Set<string>> = {
        surpriseTypes: new Set(), surpriseTones: new Set(),
        encounterTypes: new Set(), encounterTones: new Set(),
        worldWho: new Set(), worldWhat: new Set(),
        worldWhere: new Set(), worldWhy: new Set(),
    };

    // A field supplied by an explicit row is authoritative: the heuristics below
    // never top it up. Merging a curated 20-entry table with header-derived guesses
    // is what put "FACTION" and "in or around LOCATION" in front of users.
    const explicit = new Set<SeedField>();

    // ── Pass 1: enum rows + canonical World Event rows ──
    for (const chunk of chunks) {
        for (const [pattern, field] of ENUM_FIELDS) {
            const m = chunk.content.match(pattern);
            if (m) { splitEnum(m[1]).forEach(v => sets[field].add(v)); explicit.add(field); }
        }
        for (const [pattern, field] of WORLD_EVENT_FIELDS) {
            const m = chunk.content.match(pattern);
            if (m) { splitPhrases(m[1]).forEach(v => sets[field].add(v)); explicit.add(field); }
        }
    }

    // ── Pass 2: Quest Hook alias, only for slots World Event did not fill ──
    // Files carrying both label sets (world_lore_transia.md) keep the canonical
    // rows and are not double-counted.
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

    // ── Pass 3: heuristics, for documents with no explicit rows at all ──
    for (const chunk of chunks) {
        const text = chunk.content;

        // WHO — faction names and their named members.
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

        // WHERE — location names, plus proper nouns from the overview.
        if (!explicit.has('worldWhere')) {
            if (chunk.category === 'location') {
                const name = stripTrailingParenthetical(extractEntityName(chunk.header));
                if (name) sets.worldWhere.add(`in or around ${name}`);
            } else if (chunk.category === 'world_overview') {
                const places = text.match(/in (the )?([A-Z][a-z]+(\s[A-Z][a-z]+)*)/g);
                if (places) places.forEach(p => sets.worldWhere.add(p));
            }
        }

        // WHY — a faction's or event's stated goal, as a single clause.
        // Character goals are personal motives, not world-event causes, so they
        // are skipped: they are what produced the "to to …" run-ons.
        if (!explicit.has('worldWhy') && chunk.category !== 'character') {
            const goals = text.match(/\*\*Goals:\*\*\s*(.+)/i);
            if (goals) {
                const clause = firstClause(goals[1]);
                // The authored line often already begins "To …"; strip it before
                // prefixing so the slot cannot come out as "to to …".
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

        // WHAT — named arcs only. `chunk.summary` used to feed this slot, but it is
        // structurally a 100-char mid-word cut of the first prose line, and a noun
        // phrase where the grammar needs a past-tense verb phrase.
        if (!explicit.has('worldWhat') && chunk.category === 'event') {
            if (chunk.header.toLowerCase().includes('arc')) {
                const name = extractEntityName(chunk.header);
                if (name) sets.worldWhat.add(`initiated ${name}`);
            }
        }

        // TONES — the overview's **Tone:** line seeds both tone lists. The header
        // test is needed because `### OVERVIEW -- <title>` classifies as `misc`
        // (classifyCategory only matches the literal string "WORLD OVERVIEW"),
        // which left the template-mandated **Tone:** line dead for every world file.
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

    return {
        surpriseTypes: Array.from(sets.surpriseTypes),
        surpriseTones: Array.from(sets.surpriseTones),
        encounterTypes: Array.from(sets.encounterTypes),
        encounterTones: Array.from(sets.encounterTones),
        worldWho: Array.from(sets.worldWho),
        worldWhere: Array.from(sets.worldWhere),
        worldWhy: Array.from(sets.worldWhy),
        worldWhat: Array.from(sets.worldWhat),
    };
}
