import type { HexAxis, NPCEntry, PersonalityHex, SceneStakes } from '../../types';
import { REACTION_VOCAB, type ReactionEntry } from './agency/agencyPools';
import { pcRelationOf } from './affinityAccess';

// Re-export so existing import sites (`reactionRepression.ts`) keep working.
// The implementation lives in `affinityAccess.ts` — the one accessor every
// affinity reader goes through (WO-4 §2).
export { pcRelationOf };

// NPC Generation Refit (Phase 2 §9.1) — engine-built reaction menu.
//
// The story AI is a sycophant: asked "how does X react?" it invents the gentlest, most
// agreeable reaction. Fix: the engine builds the menu of allowed reactions from the NPC's
// fixed hex+traits; the AI only picks which one fits the moment. Out-of-character reactions
// never appear on the menu, so the AI cannot reach for them (jealousy is never offered to a
// loyal/high-empathy Kakashi).
//
// Pure engine, no LLM call. Runs per on-stage NPC per turn. Inject `rng` for deterministic
// tests (matches the codebase convention — see agencyWantDraw.ts / hexRoll.ts).

// Config constants (tunable per §9.1):
const CANDIDATE_POOL = 5;             // eligibility frontier ("made the top 5")
const SAMPLE_COUNT   = 2;             // surfaced besides rank-1
const SAMPLE_RANKS   = [1, 2, 3] as const; // 0-based indices into the top pool (= ranks 2–4)
const TRAIT_BONUS    = 2;             // per matching traitKey
const RELATION_CLOSE = 2;             // pcRelation >= this counts as a "close" bond (loyalty gates engage)

export type ReactionContext = 'peaceful' | 'dangerous';

/**
 * Which halves of the table a scene may draw from.
 *
 * `SceneStakes` is ternary and `ReactionContext` is binary, so `tense` is the only real
 * decision. It maps to BOTH: a standoff can plausibly produce a warm plea or a drawn weapon,
 * and letting scoring plus the trait gates choose between them is the whole point of the menu.
 * Collapsing tense onto one side loses that — onto `peaceful` and the dark half stays dark
 * (only an explicitly `dangerous` tag would ever reach it, which is rare in play), onto
 * `dangerous` and warmth, mercy and secret-sharing vanish the moment a scene tightens.
 *
 * Absent stakes read as `calm`, matching `agencyEngine`'s `?? 'calm'`.
 */
export function contextsForStakes(stakes?: SceneStakes): ReactionContext[] {
    switch (stakes) {
        case 'dangerous': return ['dangerous'];
        case 'tense':     return ['peaceful', 'dangerous'];
        default:          return ['peaceful'];
    }
}

/**
 * Why a reaction did not make the menu, and how everything that did was scored. Built on the
 * way through `selectReactions` so the log reports what actually happened rather than a second
 * implementation's guess at it.
 */
export type ReactionDiagnostics = {
    npcId: string;
    npcName: string;
    contexts: ReactionContext[];
    matureMode: boolean;
    pcRel: number;
    hex: PersonalityHex | undefined;
    traits: string[];
    /** Entries excluded before scoring, each with the rule that excluded them. */
    excluded: { text: string; reason: string }[];
    /** Everything that survived, highest first, flagged with whether it reached the menu. */
    scored: { text: string; score: number; tier: string; context: ReactionContext; surfaced: boolean }[];
    menu: string[];
};

/**
 * Fit score for a reaction against an NPC's hex+traits AND their relationship to the PC.
 * = Σ axisWeights[a] * hex[a]            (personality fit)
 *   + (relationWeight ?? 0) * pcRel      (relationship fit — a NEGATIVE weight, e.g. betrayal,
 *                                          scores HIGH at low/neutral trust and fades when liked)
 *   + (|traitKeys ∩ traits|) * TRAIT_BONUS.
 * Higher = more in-character right now. Pure: no mutation, no I/O.
 */
export function scoreReaction(r: ReactionEntry, npc: NPCEntry, pcRel: number): number {
    const hex: PersonalityHex | undefined = npc.personalityHex;
    let score = 0;
    if (hex) {
        const axes = Object.keys(r.axisWeights) as HexAxis[];
        for (const a of axes) {
            const w = r.axisWeights[a];
            if (typeof w === 'number') score += w * (hex[a] ?? 0);
        }
    }
    score += (r.relationWeight ?? 0) * pcRel;
    const traits = npc.traits ?? [];
    if (r.traitKeys && r.traitKeys.length > 0 && traits.length > 0) {
        const traitSet = new Set(traits);
        let hits = 0;
        for (const k of r.traitKeys) if (traitSet.has(k)) hits++;
        score += hits * TRAIT_BONUS;
    }
    return score;
}

/**
 * Hard include/exclude gate (trait-based, reuses the trait-hook vocabulary).
 * - `requireTraitAny`: if present, NPC must have ≥1 of the listed traits, else fail.
 * - `forbidTraitAny`: UNCONDITIONAL exclude — NPC must have NONE of the listed traits.
 * - `forbidTraitWhenClose`: RELATIONSHIP-scoped exclude — NPC must have NONE of these *only when
 *   the bond is close* (pcRel >= RELATION_CLOSE). Mirrors the `loyal` hook "won't betray
 *   Close/Devoted": a loyal NPC can still betray a stranger, never a trusted ally.
 * - `mature` tier entries fail unless `matureMode` is true (mirrors agencyWantDraw gating).
 * Returns true when the reaction is eligible for the NPC.
 */
export function passesGate(r: ReactionEntry, npc: NPCEntry, pcRel: number, matureMode: boolean): boolean {
    if (r.tier === 'mature' && !matureMode) return false;
    const traits = npc.traits ?? [];
    const traitSet = new Set(traits);
    const gate = r.gate;
    if (gate) {
        if (gate.requireTraitAny && gate.requireTraitAny.length > 0) {
            const hasAny = gate.requireTraitAny.some(t => traitSet.has(t));
            if (!hasAny) return false;
        }
        if (gate.forbidTraitAny && gate.forbidTraitAny.length > 0) {
            const hasAny = gate.forbidTraitAny.some(t => traitSet.has(t));
            if (hasAny) return false;
        }
        if (gate.forbidTraitWhenClose && gate.forbidTraitWhenClose.length > 0 && pcRel >= RELATION_CLOSE) {
            const hasAny = gate.forbidTraitWhenClose.some(t => traitSet.has(t));
            if (hasAny) return false;
        }
    }
    return true;
}

/**
 * Build the reaction menu the story AI must pick from.
 *
 * 1. filter REACTION_VOCAB by `context` and `passesGate`
 * 2. score survivors, sort desc, take top `CANDIDATE_POOL`
 * 3. result = `[ top[0] ]` (ALWAYS) + `SAMPLE_COUNT` sampled (via injected `rng`) from
 *    `SAMPLE_RANKS` (i.e. ranks 2–4)
 * 4. dedupe; if the pool is short, return what exists (never throw)
 *
 * Returns the reaction *texts* (short behavioural moves) for the directive line.
 */
export function buildReactionMenu(
    npc: NPCEntry,
    context: ReactionContext | ReactionContext[],
    rng: () => number = Math.random,
    matureMode: boolean = false,
    relationshipMemoryEnabled = false,
): string[] {
    return selectReactions(npc, context, rng, matureMode, relationshipMemoryEnabled).menu;
}

/**
 * The selection itself, plus the diagnostics the reaction log reports.
 *
 * `buildReactionMenu` delegates here rather than the log re-deriving anything: a second
 * implementation of the gate-and-score walk would drift from this one, and a log that lies
 * about why a reaction was excluded is worse than no log.
 *
 * `context` accepts a list so a `tense` scene can draw from both halves of the table — see
 * `contextsForStakes`.
 */
export function selectReactions(
    npc: NPCEntry,
    context: ReactionContext | ReactionContext[],
    rng: () => number = Math.random,
    matureMode: boolean = false,
    relationshipMemoryEnabled = false,
): { menu: string[]; diag: ReactionDiagnostics } {
    const contexts = Array.isArray(context) ? context : [context];
    const pcRel = npc.personalityHex ? pcRelationOf(npc, relationshipMemoryEnabled) : 0;
    const diag: ReactionDiagnostics = {
        npcId: npc.id,
        npcName: npc.name,
        contexts,
        matureMode,
        pcRel,
        hex: npc.personalityHex,
        traits: npc.traits ?? [],
        excluded: [],
        scored: [],
        menu: [],
    };

    // Legacy NPC with no hex → no engine menu (directive omits the line).
    if (!npc.personalityHex) {
        diag.excluded.push({ text: '(all)', reason: 'npc has no personalityHex' });
        return { menu: [], diag };
    }

    const eligible: typeof REACTION_VOCAB[number][] = [];
    for (const r of REACTION_VOCAB) {
        if (!contexts.includes(r.context)) continue;   // wrong half of the table; not worth logging
        if (passesGate(r, npc, pcRel, matureMode)) { eligible.push(r); continue; }
        diag.excluded.push({ text: r.text, reason: gateRefusalReason(r, npc, pcRel, matureMode) });
    }
    if (eligible.length === 0) return { menu: [], diag };

    const scored = eligible
        .map(r => ({ r, s: scoreReaction(r, npc, pcRel) }))
        .sort((a, b) => b.s - a.s);
    const top = scored.slice(0, CANDIDATE_POOL).map(x => x.r);

    const result: string[] = [top[0].text];

    // Sample SAMPLE_COUNT distinct entries from SAMPLE_RANKS indices of `top` (ranks 2–4).
    // Indices beyond `top.length-1` are skipped; never throws on short pools.
    const availableIdx = SAMPLE_RANKS.filter(i => i < top.length);
    const want = Math.min(SAMPLE_COUNT, availableIdx.length);
    // Fisher-Yates partial shuffle over availableIdx, then take `want`.
    const idxCopy = availableIdx.slice();
    for (let i = 0; i < want; i++) {
        const j = i + Math.floor(rng() * (idxCopy.length - i));
        [idxCopy[i], idxCopy[j]] = [idxCopy[j], idxCopy[i]];
    }
    const pickedIdx = idxCopy.slice(0, want);

    for (const i of pickedIdx) {
        const text = top[i].text;
        if (!result.includes(text)) result.push(text);
    }

    diag.menu = result;
    diag.scored = scored.map(({ r, s }) => ({
        text: r.text, score: s, tier: r.tier, context: r.context, surfaced: result.includes(r.text),
    }));
    return { menu: result, diag };
}

/**
 * Which clause of `passesGate` refused this entry. Reporting-only — the gate itself is the
 * authority, and this is called ONLY after `passesGate` has already said no, so the fallback
 * at the bottom should be unreachable.
 */
function gateRefusalReason(
    r: ReactionEntry,
    npc: NPCEntry,
    pcRel: number,
    matureMode: boolean,
): string {
    if (r.tier === 'mature' && !matureMode) return 'mature tier, Mature Mode off';
    const traitSet = new Set(npc.traits ?? []);
    const gate = r.gate;
    if (gate?.requireTraitAny?.length && !gate.requireTraitAny.some(t => traitSet.has(t))) {
        return `needs one of: ${gate.requireTraitAny.join(', ')}`;
    }
    if (gate?.forbidTraitAny?.length) {
        const hit = gate.forbidTraitAny.filter(t => traitSet.has(t));
        if (hit.length > 0) return `forbidden by trait: ${hit.join(', ')}`;
    }
    if (gate?.forbidTraitWhenClose?.length && pcRel >= RELATION_CLOSE) {
        const hit = gate.forbidTraitWhenClose.filter(t => traitSet.has(t));
        if (hit.length > 0) return `forbidden while close (rel ${pcRel}) by: ${hit.join(', ')}`;
    }
    return 'gated';
}
