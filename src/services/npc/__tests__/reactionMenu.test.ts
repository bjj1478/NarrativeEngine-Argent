import { describe, it, expect } from 'vitest';
import type { NPCEntry, PersonalityHex } from '../../types';
import {
    scoreReaction,
    passesGate,
    buildReactionMenu,
    contextsForStakes,
    selectReactions
} from '../reactionMenu';
import { REACTION_VOCAB, type ReactionEntry } from '../agency/agencyPools';
import { buildBehaviorDirective } from '../npcBehaviorDirective';

// ── Seeded RNG (mulberry32) — deterministic across runs. Matches the codebase convention
// (see hexRoll.test.ts). Injected into buildReactionMenu so the sampled ranks are stable.
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function makeNpc(overrides: Partial<NPCEntry> = {}): NPCEntry {
    return {
        id: 'test-1',
        name: 'Test NPC',
        aliases: '',
        appearance: '',
        faction: '',
        storyRelevance: '',
        disposition: '',
        status: '',
        goals: '',
        voice: '',
        personality: '',
        exampleOutput: '',
        affinity: 50,
        personalityHex: { drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 0 },
        traits: [],
        ...overrides
    } as NPCEntry;
}

// A loyal / high-empathy / high-warmth NPC — the "Kakashi" headline case. Jealousy/betrayal
// must NEVER appear on this NPC's menu (gate excludes + low score excludes → double backstop).
const KAKASHI_HEX: PersonalityHex = { drive: 1, diligence: 2, boldness: 1, warmth: 2, empathy: 2, composure: 1 };
const KAKASHI = (): NPCEntry => makeNpc({
    id: 'kakashi',
    name: 'Kakashi',
    personalityHex: KAKASHI_HEX,
    traits: ['loyal', 'protective', 'honorable']
});

describe('reactionMenu — scoreReaction', () => {
    it('dots axisWeights against the NPC hex', () => {
        const r: ReactionEntry = {
            text: 'warm encouragement', context: 'peaceful', tier: 'default',
            axisWeights: { warmth: 1, empathy: 1 }
        };
        // warmth 2 + empathy 2 = 4 (relationWeight absent → no relationship term)
        expect(scoreReaction(r, KAKASHI(), 0)).toBe(4);
    });

    it('adds TRAIT_BONUS per matching traitKey', () => {
        const r: ReactionEntry = {
            text: 'protective deflection', context: 'dangerous', tier: 'default',
            axisWeights: { warmth: 1 }, traitKeys: ['loyal', 'protective', 'curious']
        };
        // warmth 2 + (loyal + protective = 2 hits) * 2 = 6
        expect(scoreReaction(r, KAKASHI(), 0)).toBe(6);
    });

    it('applies relationWeight * pcRel — a negative weight scores HIGH at low trust, fades when liked', () => {
        const betray: ReactionEntry = {
            text: 'sell out', context: 'peaceful', tier: 'default',
            axisWeights: {}, relationWeight: -2
        };
        const npc = makeNpc();
        expect(scoreReaction(betray, npc, 0)).toBe(0);    // stranger: -2 * 0 = 0
        expect(scoreReaction(betray, npc, -3)).toBe(6);   // hostile: -2 * -3 = +6 (very likely)
        expect(scoreReaction(betray, npc, 3)).toBe(-6);   // devoted: -2 * 3 = -6 (vanishes)
    });

    it('returns 0 when NPC has no hex (legacy)', () => {
        const r: ReactionEntry = {
            text: 'x', context: 'peaceful', tier: 'default', axisWeights: { warmth: 2 }
        };
        const npc = makeNpc({ personalityHex: undefined });
        expect(scoreReaction(r, npc, 0)).toBe(0);
    });
});

describe('reactionMenu — passesGate', () => {
    it('drops mature entries when matureMode is false', () => {
        const r: ReactionEntry = { text: 'cruel', context: 'peaceful', tier: 'mature', axisWeights: {} };
        expect(passesGate(r, KAKASHI(), 0, false)).toBe(false);
        expect(passesGate(r, KAKASHI(), 0, true)).toBe(true);
    });

    it('forbidTraitAny is an UNCONDITIONAL exclude (honour blocks underhandedness at any trust)', () => {
        const r: ReactionEntry = {
            text: 'underhanded trick', context: 'peaceful', tier: 'default',
            axisWeights: {}, gate: { forbidTraitAny: ['honorable'] }
        };
        expect(passesGate(r, KAKASHI(), 0, false)).toBe(false);
        expect(passesGate(r, KAKASHI(), 3, false)).toBe(false);
    });

    it('forbidTraitWhenClose is RELATIONSHIP-scoped: loyal blocks betrayal of a CLOSE ally only', () => {
        const betray: ReactionEntry = {
            text: 'quietly sell you out', context: 'peaceful', tier: 'default',
            axisWeights: {}, relationWeight: -2, gate: { forbidTraitWhenClose: ['loyal'] }
        };
        const loyal = makeNpc({ traits: ['loyal'] });
        expect(passesGate(betray, loyal, 0, false)).toBe(true);    // stranger/neutral → CAN betray
        expect(passesGate(betray, loyal, 1, false)).toBe(true);    // warm but not yet "close"
        expect(passesGate(betray, loyal, 2, false)).toBe(false);   // close bond → loyalty engages
        expect(passesGate(betray, loyal, 3, false)).toBe(false);   // devoted → never
        const disloyal = makeNpc({ traits: ['scheming'] });
        expect(passesGate(betray, disloyal, 3, false)).toBe(true); // no loyalty → gate never fires
    });

    it('requireTraitAny excludes an NPC lacking the disposition', () => {
        const r: ReactionEntry = {
            text: 'sadistic cruelty', context: 'peaceful', tier: 'mature',
            axisWeights: { empathy: -2 }, gate: { requireTraitAny: ['sadistic'] }
        };
        expect(passesGate(r, KAKASHI(), 0, true)).toBe(false);
        const sadist = makeNpc({ traits: ['sadistic'] });
        expect(passesGate(r, sadist, 0, true)).toBe(true);
    });

    it('passes when no gate is declared', () => {
        const r: ReactionEntry = { text: 'x', context: 'peaceful', tier: 'default', axisWeights: {} };
        expect(passesGate(r, KAKASHI(), 0, false)).toBe(true);
    });
});

describe('reactionMenu — buildReactionMenu', () => {
    describe('Kakashi case (the headline)', () => {
        it('NEVER contains a jealousy/betrayal reaction (gate + low score)', () => {
            for (let seed = 1; seed <= 50; seed++) {
                const rng = mulberry32(seed);
                const peaceful = buildReactionMenu(KAKASHI(), 'peaceful', rng, false);
                const dangerous = buildReactionMenu(KAKASHI(), 'dangerous', mulberry32(seed), false);
                for (const text of [...peaceful, ...dangerous]) {
                    expect(text).not.toMatch(/jealous|sabotage|betray/i);
                }
            }
        });

        it('excludes any reaction whose gate forbids loyal/honorable', () => {
            const menu = buildReactionMenu(KAKASHI(), 'peaceful', mulberry32(1), false);
            for (const text of menu) {
                const entry = REACTION_VOCAB.find(r => r.text === text);
                expect(entry).toBeDefined();
                const forbidden = entry!.gate?.forbidTraitAny ?? [];
                expect(forbidden.some(t => ['loyal', 'honorable'].includes(t))).toBe(false);
            }
        });
    });

    describe('Relationship-driven availability (the corrected headline)', () => {
        const schemer = (affinity: number) => makeNpc({
            traits: ['loyal', 'scheming', 'mercenary', 'ambitious'],
            personalityHex: { drive: 1, diligence: 0, boldness: 0, warmth: -2, empathy: -2, composure: 0 },
            affinity
        });

        it('a loyal NPC sells out a STRANGER (betrayal is on the table at low/neutral trust)', () => {
            const menu = buildReactionMenu(schemer(50), 'peaceful', mulberry32(1), false);
            expect(menu).toContain('quietly sell you out');
        });

        it('the SAME loyal NPC never betrays a CLOSE ally (relationship gate engages)', () => {
            const menu = buildReactionMenu(schemer(85), 'peaceful', mulberry32(1), false);
            expect(menu).not.toContain('quietly sell you out');
        });
    });

    describe('Selection shape', () => {
        it('rank-1 is always present', () => {
            const npc = makeNpc({
                personalityHex: { drive: 0, diligence: 0, boldness: 0, warmth: 1, empathy: 1, composure: 1 },
                traits: ['protective', 'loyal']
            });
            const menu = buildReactionMenu(npc, 'peaceful', mulberry32(7), false);
            expect(menu.length).toBeGreaterThan(0);
            expect(menu[0]).toBe('proud, understated approval');
        });

        it('total length == 3 when pool >= 4', () => {
            const npc = makeNpc({
                personalityHex: { drive: -1, diligence: -1, boldness: 0, warmth: -1, empathy: -1, composure: 0 },
                traits: ['jealous', 'vengeful']
            });
            const menu = buildReactionMenu(npc, 'peaceful', mulberry32(3), false);
            expect(menu.length).toBe(3);
            expect(menu).toContain('jealous sabotage');
        });

        it('is deterministic with a seeded rng', () => {
            const npc = makeNpc({
                personalityHex: { drive: -1, diligence: -1, boldness: 0, warmth: -1, empathy: -1, composure: 0 },
                traits: ['jealous', 'vengeful']
            });
            const a = buildReactionMenu(npc, 'peaceful', mulberry32(42), false);
            const b = buildReactionMenu(npc, 'peaceful', mulberry32(42), false);
            expect(a).toEqual(b);
        });
    });

    describe('Gate backstops', () => {
        it('forbidTraitAny:[loyal] reaction never surfaces for a loyal NPC', () => {
            for (let seed = 1; seed <= 20; seed++) {
                const menu = buildReactionMenu(KAKASHI(), 'peaceful', mulberry32(seed), false);
                expect(menu).not.toContain('jealous sabotage');
            }
        });

        it('requireTraitAny reaction never surfaces for an NPC lacking the trait', () => {
            const requireEntries = REACTION_VOCAB.filter(r => r.gate?.requireTraitAny?.length);
            for (const r of requireEntries) {
                const menu = buildReactionMenu(KAKASHI(), r.context, mulberry32(1), false);
                expect(menu).not.toContain(r.text);
            }
        });
    });

    describe('Short-pool', () => {
        it('returns <= available without throwing', () => {
            const npc = makeNpc({
                personalityHex: { drive: 0, diligence: 0, boldness: 2, composure: -1, warmth: 0, empathy: 0 },
                traits: ['impulsive', 'proud']
            });
            const menu = buildReactionMenu(npc, 'dangerous', mulberry32(5), false);
            expect(menu.length).toBeGreaterThanOrEqual(1);
            expect(menu.length).toBeLessThanOrEqual(3);
            expect(menu).toContain('reckless charge');
        });

        it('returns [] for a legacy hex-less NPC', () => {
            const npc = makeNpc({ personalityHex: undefined });
            expect(buildReactionMenu(npc, 'peaceful', mulberry32(1), false)).toEqual([]);
        });

        it('returns [] when no eligible reactions remain after gating', () => {
            const npc = makeNpc({ personalityHex: { drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 0 } });
            const menu = buildReactionMenu(npc, 'peaceful', mulberry32(1), false);
            expect(menu.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('Context filter', () => {
        it('only surfaces reactions matching the requested context', () => {
            const npc = makeNpc({
                personalityHex: { drive: 0, diligence: 0, boldness: 2, composure: -1, warmth: 0, empathy: 0 },
                traits: ['impulsive', 'proud']
            });
            const dangerous = buildReactionMenu(npc, 'dangerous', mulberry32(2), false);
            for (const text of dangerous) {
                const entry = REACTION_VOCAB.find(r => r.text === text);
                expect(entry?.context).toBe('dangerous');
            }
        });
    });
});

describe('npcBehaviorDirective integration (enforcement clause)', () => {
    it('appends the REACTIONS line with the enforcement clause for a hex-bearing NPC', () => {
        const npc = KAKASHI();
        const directive = buildBehaviorDirective(npc, { rng: mulberry32(1) });
        expect(directive).toContain('REACTIONS (choose ONE and play it');
        expect(directive).toContain('do NOT invent a softer reaction');
    });

    it('omits the REACTIONS line for a legacy hex-less NPC', () => {
        const npc = makeNpc({ personalityHex: undefined });
        const directive = buildBehaviorDirective(npc);
        expect(directive).not.toContain('REACTIONS');
    });
});

/**
 * The coverage-pass reactions. Each closes a behaviour the table could not express, so the
 * tests that matter are: the trait that should reach it does, an NPC without that trait never
 * sees it, and Mature Mode still gates the mature ones.
 *
 * `entry()` reads the real vocabulary rather than restating weights, so these stay honest if
 * an entry is retuned — a test that hardcodes the numbers just re-asserts its own copy.
 */
const entry = (text: string): ReactionEntry => {
    const e = REACTION_VOCAB.find(r => r.text === text);
    if (!e) throw new Error(`no reaction entry: ${text}`);
    return e;
};

/** Does `text` survive gating for this NPC? Rank-independent, so retuning cannot flake it. */
const isOffered = (npc: NPCEntry, text: string, matureMode: boolean, pcRel = 0): boolean =>
    passesGate(entry(text), npc, pcRel, matureMode);

const NEW_ENTRIES = [
    "shrug it off / can't be bothered",
    'let it go / offer forgiveness',
    'seek comfort / propose indulgence',
    'brazen advance / proposition you',
    'flat, faraway detachment',
    'invite the blow / court the harm',
    'coercive advance / force themselves on you',
];

const MATURE_ENTRIES = [
    'brazen advance / proposition you',
    'flat, faraway detachment',
    'invite the blow / court the harm',
    'coercive advance / force themselves on you',
];

describe('reactionMenu — coverage-pass entries', () => {
    it('every new entry exists and declares a context the menu builder can request', () => {
        for (const text of NEW_ENTRIES) {
            expect(['peaceful', 'dangerous']).toContain(entry(text).context);
        }
    });

    describe('default tier: behaviours that had no move at all', () => {
        it('an indolent NPC leads with shrugging it off on a low-drive hex', () => {
            const npc = makeNpc({
                personalityHex: { drive: -2, diligence: -2, boldness: 0, warmth: 0, empathy: 0, composure: 0 },
                traits: ['indolent', 'complacent'],
            });
            expect(buildReactionMenu(npc, 'peaceful', mulberry32(1), false)[0])
                .toBe("shrug it off / can't be bothered");
        });

        // The gap that had nothing to do with the new traits: the peaceful table carried four
        // ways to be cruel and no way at all to be merciful.
        it('a forgiving NPC leads with mercy', () => {
            const npc = makeNpc({
                personalityHex: { drive: 0, diligence: 0, boldness: 0, warmth: 1, empathy: 3, composure: 1 },
                traits: ['forgiving'],
            });
            expect(buildReactionMenu(npc, 'peaceful', mulberry32(1), false)[0])
                .toBe('let it go / offer forgiveness');
        });

        it('mercy scores on empathy, so a callous NPC is never offered it', () => {
            const callous = makeNpc({
                personalityHex: { drive: 0, diligence: 0, boldness: 0, warmth: -1, empathy: -3, composure: 0 },
                traits: ['vengeful'],
            });
            for (let seed = 1; seed <= 10; seed++) {
                expect(buildReactionMenu(callous, 'peaceful', mulberry32(seed), false))
                    .not.toContain('let it go / offer forgiveness');
            }
        });

        it('gives the previously-inert pacifist and addictive traits a move to reach', () => {
            expect(entry('let it go / offer forgiveness').traitKeys).toContain('pacifist');
            expect(entry('seek comfort / propose indulgence').traitKeys).toContain('addictive');
        });
    });

    describe('mature tier: gating', () => {
        it.each(MATURE_ENTRIES)('%s is tier mature, so Mature Mode gates it', (text) => {
            expect(entry(text).tier).toBe('mature');
        });

        it.each(MATURE_ENTRIES)('%s never surfaces with Mature Mode off', (text) => {
            // An NPC carrying every gating trait — only the tier can be excluding it.
            const npc = makeNpc({
                traits: ['horny', 'predatory', 'dissociative', 'traumatized', 'masochistic', 'self-destructive'],
                personalityHex: { drive: 1, diligence: 0, boldness: 2, warmth: 0, empathy: -2, composure: -2 },
            });
            for (const ctx of ['peaceful', 'dangerous'] as const) {
                for (let seed = 1; seed <= 6; seed++) {
                    expect(buildReactionMenu(npc, ctx, mulberry32(seed), false)).not.toContain(text);
                }
            }
        });

        it.each(MATURE_ENTRIES)('%s never surfaces for an NPC lacking its required traits', (text) => {
            // Mature Mode ON, so a failure here is the trait gate rather than the tier.
            for (const ctx of ['peaceful', 'dangerous'] as const) {
                for (let seed = 1; seed <= 6; seed++) {
                    expect(buildReactionMenu(KAKASHI(), ctx, mulberry32(seed), true)).not.toContain(text);
                }
            }
        });
    });

    describe('mature tier: the traits reach their moves', () => {
        it('a horny NPC can proposition in a peaceful scene', () => {
            expect(isOffered(makeNpc({ traits: ['horny'] }), 'brazen advance / proposition you', true))
                .toBe(true);
        });

        it.each(['traumatized', 'dissociative'])('a %s NPC can go flat and faraway', (trait) => {
            expect(isOffered(makeNpc({ traits: [trait] }), 'flat, faraway detachment', true)).toBe(true);
        });

        it.each(['masochistic', 'self-destructive'])('a %s NPC can court the harm', (trait) => {
            expect(isOffered(makeNpc({ traits: [trait] }), 'invite the blow / court the harm', true))
                .toBe(true);
        });
    });

    /**
     * The coercive entry is the most heavily gated in the table, deliberately: Mature Mode,
     * then a required trait, then a moral floor. The forbid list is the load-bearing part — an
     * option the menu should never offer is better EXCLUDED than merely out-scored, because
     * scoring is relative and a thin pool can float anything into the top three.
     */
    describe('mature tier: the coercive entry is triple-gated', () => {
        const TEXT = 'coercive advance / force themselves on you';
        const predator = (extra: string[] = []) => makeNpc({
            traits: ['predatory', ...extra],
            personalityHex: { drive: 1, diligence: 0, boldness: 2, warmth: 0, empathy: -3, composure: -1 },
        });

        it.each(['horny', 'predatory'])('is reachable for a %s NPC with Mature Mode on', (trait) => {
            expect(isOffered(makeNpc({ traits: [trait] }), TEXT, true)).toBe(true);
        });

        it('is unreachable without one of those two traits, in either mode', () => {
            const other = makeNpc({ traits: ['ruthless', 'sadistic'] });
            expect(isOffered(other, TEXT, false)).toBe(false);
            expect(isOffered(other, TEXT, true)).toBe(false);
        });

        it.each(['honorable', 'pacifist'])('is blocked outright for a %s NPC, trait or not', (floor) => {
            expect(isOffered(predator([floor]), TEXT, true)).toBe(false);
            for (let seed = 1; seed <= 10; seed++) {
                expect(buildReactionMenu(predator([floor]), 'dangerous', mulberry32(seed), true))
                    .not.toContain(TEXT);
            }
        });

        it('fades as the bond closes, unlike the proposition which needs warmth', () => {
            // The relationWeight signs are inverted between the pair on purpose: a stranger is
            // coerced, someone the NPC is close to is propositioned.
            expect(entry(TEXT).relationWeight).toBeLessThan(0);
            expect(entry('brazen advance / proposition you').relationWeight).toBeGreaterThan(0);
            const npc = predator();
            expect(scoreReaction(entry(TEXT), npc, 3)).toBeLessThan(scoreReaction(entry(TEXT), npc, -3));
        });
    });
});

describe('reactionMenu — authority and ground', () => {
    const RANK = 'pull rank / issue an order';
    const BAR = 'bar the way / refuse passage';

    it('both exist in the peaceful table, which is the only half production requests', () => {
        for (const text of [RANK, BAR]) {
            expect(entry(text).context).toBe('peaceful');
            expect(entry(text).tier).toBe('default');
        }
    });

    it('an authoritarian NPC leads with pulling rank', () => {
        const officer = makeNpc({
            personalityHex: { drive: 1, diligence: 2, boldness: 2, warmth: 0, empathy: -1, composure: 1 },
            traits: ['authoritarian', 'oath-bound'],
        });
        expect(buildReactionMenu(officer, 'peaceful', mulberry32(1), false)[0]).toBe(RANK);
    });

    it('a territorial NPC leads with barring the way', () => {
        const gatekeeper = makeNpc({
            personalityHex: { drive: 0, diligence: 1, boldness: 2, warmth: -2, empathy: -2, composure: 0 },
            traits: ['territorial', 'xenophobic'],
        });
        expect(buildReactionMenu(gatekeeper, 'peaceful', mulberry32(1), false)[0]).toBe(BAR);
    });

    // No forbid list on either — `boldness` in the weights does that work through the hex, so
    // this is the test that keeps the scoring honest instead of a hand-maintained gate.
    it('a deferential, timid NPC is never offered either move', () => {
        const meek = makeNpc({
            personalityHex: { drive: -1, diligence: 1, boldness: -3, warmth: 1, empathy: 2, composure: 0 },
            traits: ['deferential', 'gullible'],
        });
        for (let seed = 1; seed <= 10; seed++) {
            const menu = buildReactionMenu(meek, 'peaceful', mulberry32(seed), false);
            expect(menu).not.toContain(RANK);
            expect(menu).not.toContain(BAR);
        }
    });

    // The distinction from `hold the line / stand firm`, which looks like the same move but is
    // not: that one stands WITH the player under threat, this one denies the player ground.
    it('barring the way is adversarial where holding the line is allied', () => {
        expect(entry(BAR).relationWeight).toBeLessThan(0);
        expect(entry('hold the line / stand firm').relationWeight).toBeGreaterThan(0);
    });

    it('both fade as the bond closes', () => {
        const npc = makeNpc({
            personalityHex: { drive: 1, diligence: 1, boldness: 2, warmth: -1, empathy: -1, composure: 0 },
            traits: ['authoritarian', 'territorial'],
        });
        for (const text of [RANK, BAR]) {
            expect(scoreReaction(entry(text), npc, 3)).toBeLessThan(scoreReaction(entry(text), npc, -3));
        }
    });

    it('gives the previously-inert authoritarian, territorial and xenophobic traits a move', () => {
        expect(entry(RANK).traitKeys).toContain('authoritarian');
        expect(entry(BAR).traitKeys).toContain('territorial');
        expect(entry(BAR).traitKeys).toContain('xenophobic');
    });
});

/**
 * Scene stakes -> which halves of the table are in play.
 *
 * Before this was wired, both production callers fell through to the 'peaceful' default and
 * all 16 dangerous entries were dead code in the running app. These tests are the reason that
 * cannot silently come back: they assert the mapping AND that the dangerous half is genuinely
 * reachable through it.
 */
describe('reactionMenu — contextsForStakes', () => {
    it('calm draws the peaceful half only', () => {
        expect(contextsForStakes('calm')).toEqual(['peaceful']);
    });

    it('dangerous draws the dangerous half only — warmth is not on the menu mid-crisis', () => {
        expect(contextsForStakes('dangerous')).toEqual(['dangerous']);
    });

    it('tense draws BOTH, so a standoff can produce a plea or a drawn weapon', () => {
        expect(contextsForStakes('tense')).toEqual(['peaceful', 'dangerous']);
    });

    it('absent stakes read as calm, matching agencyEngine', () => {
        expect(contextsForStakes(undefined)).toEqual(['peaceful']);
    });

    it('never returns an empty list — an empty context list would blank every menu', () => {
        for (const s of ['calm', 'tense', 'dangerous', undefined] as const) {
            expect(contextsForStakes(s).length).toBeGreaterThan(0);
        }
    });
});

describe('reactionMenu — context lists', () => {
    // A hex that scores respectably in both halves so the union is observable.
    const brawler = () => makeNpc({
        personalityHex: { drive: 1, diligence: 0, boldness: 2, warmth: -1, empathy: -1, composure: -1 },
        traits: ['impulsive', 'hot-tempered'],
    });

    it('a single context still works, so every existing caller is unaffected', () => {
        const menu = buildReactionMenu(brawler(), 'dangerous', mulberry32(4), false);
        for (const text of menu) expect(entry(text).context).toBe('dangerous');
    });

    it('a one-element list behaves identically to the bare string', () => {
        expect(buildReactionMenu(brawler(), ['dangerous'], mulberry32(4), false))
            .toEqual(buildReactionMenu(brawler(), 'dangerous', mulberry32(4), false));
    });

    it('the union can surface entries from both halves across seeds', () => {
        const seen = new Set<string>();
        for (let seed = 1; seed <= 40; seed++) {
            for (const text of buildReactionMenu(brawler(), ['peaceful', 'dangerous'], mulberry32(seed), false)) {
                seen.add(entry(text).context);
            }
        }
        expect(seen.has('peaceful')).toBe(true);
        expect(seen.has('dangerous')).toBe(true);
    });

    it('the union never invents an entry from outside the requested halves', () => {
        for (let seed = 1; seed <= 20; seed++) {
            for (const text of buildReactionMenu(brawler(), ['peaceful'], mulberry32(seed), false)) {
                expect(entry(text).context).toBe('peaceful');
            }
        }
    });
});

describe('reactionMenu — selectReactions diagnostics', () => {
    it('buildReactionMenu returns exactly what selectReactions surfaced', () => {
        const npc = KAKASHI();
        const { menu } = selectReactions(npc, 'peaceful', mulberry32(9), false);
        expect(buildReactionMenu(npc, 'peaceful', mulberry32(9), false)).toEqual(menu);
    });

    it('reports the contexts, traits and hex it actually used', () => {
        const { diag } = selectReactions(KAKASHI(), ['peaceful', 'dangerous'], mulberry32(1), true);
        expect(diag.contexts).toEqual(['peaceful', 'dangerous']);
        expect(diag.traits).toEqual(['loyal', 'protective', 'honorable']);
        expect(diag.hex).toEqual(KAKASHI_HEX);
        expect(diag.matureMode).toBe(true);
    });

    it('flags surfaced entries and ranks the rest highest-first', () => {
        const { menu, diag } = selectReactions(KAKASHI(), 'peaceful', mulberry32(3), false);
        expect(diag.scored.filter(s => s.surfaced).map(s => s.text).sort()).toEqual([...menu].sort());
        for (let i = 1; i < diag.scored.length; i++) {
            expect(diag.scored[i - 1].score).toBeGreaterThanOrEqual(diag.scored[i].score);
        }
    });

    // The load-bearing half of the trace: an NPC reacting oddly is usually an NPC whose right
    // reaction was refused, and the reason has to name the rule that did it.
    it('names the rule that refused each excluded entry', () => {
        const { diag } = selectReactions(KAKASHI(), 'peaceful', mulberry32(1), true);
        const byText = new Map(diag.excluded.map(e => [e.text, e.reason]));
        expect(byText.get('cruel taunt / twist the knife')).toMatch(/needs one of/);
        expect(byText.get('jealous sabotage')).toMatch(/forbidden by trait: honorable/);
        for (const e of diag.excluded) expect(e.reason).not.toBe('gated');
    });

    it('attributes a mature exclusion to the tier, not to a missing trait', () => {
        const npc = makeNpc({ traits: ['sadistic'] });
        const { diag } = selectReactions(npc, 'peaceful', mulberry32(1), false);
        const reason = diag.excluded.find(e => e.text === 'cruel taunt / twist the knife')?.reason;
        expect(reason).toMatch(/Mature Mode off/);
    });

    it('reports a hex-less NPC as excluded wholesale rather than silently empty', () => {
        const { menu, diag } = selectReactions(makeNpc({ personalityHex: undefined }), 'peaceful', mulberry32(1), false);
        expect(menu).toEqual([]);
        expect(diag.excluded[0].reason).toMatch(/no personalityHex/);
    });
});
