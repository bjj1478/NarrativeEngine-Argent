import type { SemanticFact, NPCEntry, CharacterTrait, CharacterProfileState, SceneEventType } from '../../types';
import { CORE_FLOOR_TRAITS } from '../../types';
import { countTokens } from '../infrastructure/tokenizer';
import { PROPER_NOUN_STOP_WORDS } from '../../utils/stopWords';

export function extractContextEntities(
    input: string,
    recentMessages: { content?: string | null }[],
    npcLedger: NPCEntry[]
): Set<string> {
    const entities = new Set<string>();

    for (const npc of npcLedger) {
        if (npc.archived) continue;
        if (npc.name) entities.add(npc.name.toLowerCase());
        if (npc.aliases) {
            npc.aliases.split(',').map(a => a.trim().toLowerCase()).filter(Boolean)
                .forEach(a => entities.add(a));
        }
    }

    const text = input + ' ' + recentMessages.slice(-5)
        .map(m => (typeof m.content === 'string' ? m.content : '')).join(' ');
    const matches = text.match(/[A-Z][A-Za-z]{2,}(?:\s[A-Z][A-Za-z]{2,})*/g) || [];
    for (const match of matches) {
        if (!PROPER_NOUN_STOP_WORDS.has(match)) {
            entities.add(match.toLowerCase());
        }
    }

    return entities;
}

export function queryFacts(
    facts: SemanticFact[],
    input: string,
    recentMessages: { content?: string | null }[],
    npcLedger: NPCEntry[],
    tokenBudget = 500
): SemanticFact[] {
    const entities = extractContextEntities(input, recentMessages, npcLedger);
    const scored = facts.map(fact => {
        let score = 0;
        const sLower = fact.subject.toLowerCase();
        const oLower = fact.object.toLowerCase();

        for (const entity of entities) {
            if (entity === sLower) score += fact.importance;
            else if (entity === oLower) score += fact.importance * 0.8;
            else if (sLower.includes(entity) || entity.includes(sLower)) score += 2;
            else if (oLower.includes(entity) || entity.includes(oLower)) score += 1.5;
        }

        return { fact, score };
    });

    const selected = scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score);

    const result: SemanticFact[] = [];
    let tokens = 0;
    for (const { fact } of selected) {
        const factTokens = countTokens(formatFactLine(fact));
        if (tokens + factTokens > tokenBudget) break;
        result.push(fact);
        tokens += factTokens;
    }
    return result;
}

function formatFactLine(fact: SemanticFact): string {
    return `\u25b8 ${fact.subject} \u2014${fact.predicate}\u2192 ${fact.object} [${fact.importance}]`;
}

export function formatFactsForContext(facts: SemanticFact[]): string {
    if (facts.length === 0) return '';
    const sorted = [...facts].sort((a, b) => b.importance - a.importance);
    const lines = sorted.map(formatFactLine);
    return `[SEMANTIC MEMORY - ${sorted.length} verified facts]\n${lines.join('\n')}\n[END SEMANTIC MEMORY]`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PC Trait Retrieval (WO-G)
// ─────────────────────────────────────────────────────────────────────────────
//
// Sibling of queryFacts. Scores PC traits by entity match × importance, filters
// the extended tier by scene tags (planner eventTypes), caps at a token budget.
//
// Core floor (CORE_FLOOR_TRAITS = 5): top N highest-importance non-superseded
// traits are ALWAYS injected regardless of entity match or scene tags — the
// "GM is never starved" guarantee.
//
// Extended tier: remaining non-superseded traits are scored by entity match ×
// importance, then filtered by eventTags ∩ plannerEventTypes. Traits with no
// tags, or when plannerEventTypes is empty, bypass the tag filter (fault
// tolerance — missing planner output degrades to "inject best by score").

/** Caller-supplied gates for {@link formatTraitsForContext}. */
export type FormatTraitsOptions = {
    /**
     * Emit the PC's stat block. Defaults to FALSE — the caller must opt in, normally by
     * asking whether the turn's recommender put `'stats'` in `profileFields`.
     */
    includeStats?: boolean;
};

export type SelectedTraits = {
    core: CharacterTrait[];
    extended: CharacterTrait[];
};

export function queryTraits(
    traits: CharacterTrait[],
    userMessage: string,
    recentMessages: { content?: string | null }[],
    npcLedger?: NPCEntry[],
    plannerEventTypes?: SceneEventType[],
    tokenBudget = 400,
    coreFloor: number = CORE_FLOOR_TRAITS,
): SelectedTraits {
    if (!traits || traits.length === 0) return { core: [], extended: [] };

    const active = traits.filter(t => !t.superseded);
    if (active.length === 0) return { core: [], extended: [] };

    const sortedByImportance = [...active].sort((a, b) => b.importance - a.importance);
    const core = sortedByImportance.slice(0, coreFloor);
    const coreIds = new Set(core.map(t => t.id));

    const extendedCandidates = active.filter(t => !coreIds.has(t.id));
    if (extendedCandidates.length === 0) return { core, extended: [] };

    const entities = extractContextEntities(userMessage, recentMessages, npcLedger ?? []);
    const plannerTags = plannerEventTypes && plannerEventTypes.length > 0
        ? new Set(plannerEventTypes)
        : null;

    const scored = extendedCandidates.map(trait => {
        let score = 0;
        const tLower = trait.text.toLowerCase();
        const sLower = trait.subject.toLowerCase();

        if (entities.has(sLower)) score += trait.importance;
        for (const entity of entities) {
            if (tLower.includes(entity)) score += 2;
            if (sLower.includes(entity) || entity.includes(sLower)) score += 1.5;
        }

        if (plannerTags && trait.eventTags.length > 0) {
            const hasIntersection = trait.eventTags.some(tag => plannerTags.has(tag));
            if (!hasIntersection) {
                score = 0;
            }
        }

        if (score === 0 && trait.importance >= 7) {
            score = trait.importance * 0.1;
        }

        return { trait, score };
    });

    const matched = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
    const extended: CharacterTrait[] = [];
    let usedTokens = 0;

    for (const t of core) {
        usedTokens += countTokens(formatTraitLine(t));
    }

    for (const { trait } of matched) {
        const line = formatTraitLine(trait);
        const tokens = countTokens(line);
        if (usedTokens + tokens > tokenBudget) break;
        extended.push(trait);
        usedTokens += tokens;
    }

    if (extended.length > 0) {
        console.log(`[TraitMemory] Core ${core.length} + extended ${extended.length}/${extendedCandidates.length} (~${usedTokens} tokens)`);
    }

    return { core, extended };
}

function formatTraitLine(trait: CharacterTrait): string {
    return `\u25b8 [${trait.category}] ${trait.text} [imp:${trait.importance}${trait.eventTags.length > 0 ? ` tags:${trait.eventTags.join(',')}` : ''}]`;
}

export function formatTraitsForContext(
    profile: CharacterProfileState,
    selected: SelectedTraits,
    opts: FormatTraitsOptions = {},
): string {
    // WO-A rewrite 2 §2: strengthened the persona label so the LLM treats this
    // block as the human's player character (the protagonist), not just a
    // generic "character profile" blob. The legacy `[CHARACTER PROFILE]`
    // marker is kept as the second line so existing tests + any external
    // parsers that grep for it still match.
    const parts: string[] = [
        '[PLAYER CHARACTER — the human you are playing with]',
        '[CHARACTER PROFILE]',
    ];

    const id = profile.identity;
    const idParts: string[] = [];
    if (id.name) idParts.push(id.name);
    if (id.race) idParts.push(id.race);
    if (id.class) idParts.push(id.class);
    if (id.archetype) idParts.push(id.archetype);
    if (id.level !== undefined) idParts.push(`Level ${id.level}`);
    if (idParts.length > 0) parts.push(idParts.join(' | '));

    // Stats are gated, and default to OFF. This block used to emit every stat on the sheet
    // unconditionally — `PWR 14 | SPD 12` — while the traits three lines below went through
    // full relevance selection. That asymmetry was the bug: the writer got a set of bare
    // numbers no rule claimed, banded, or forbade it from reading back out into the prose.
    //
    // The gate is the caller's, because the authority already exists: the recommender's
    // `profileFields` decides this for the smart-bookkeeping branch (contextMinifier's
    // `minifySelectedProfile`, `want('stats')`). Now both branches answer to it.
    //
    // Defaulting to false makes omission the failure mode, matching that branch — where an
    // absent `profileFields` yields no profile block at all — and the engine's standing
    // convention that an unknown fact does not satisfy a condition.
    if (opts.includeStats && profile.stats) {
        const s = profile.stats;
        const statParts = Object.entries(s).map(([k, v]) => `${k.toUpperCase()} ${v}`);
        if (statParts.length > 0) parts.push(statParts.join(' | '));
    }

    if (selected.core.length > 0) {
        parts.push('Core:');
        for (const t of selected.core) parts.push(formatTraitLine(t));
    }

    if (selected.extended.length > 0) {
        parts.push('Scene-relevant:');
        for (const t of selected.extended) parts.push(formatTraitLine(t));
    }

    parts.push('[END CHARACTER PROFILE]');
    return parts.join('\n');
}