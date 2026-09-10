// The pure half of player-resolved actions: argument parsing, the tool result the model reads
// back, and which resolution tool getToolDefinitions offers.
import { describe, it, expect } from 'vitest';
import {
    parseRequestOutcomeArgs,
    formatPlayerOutcomeResult,
    formatPlayerOutcomeDeclined,
    outcomeHappens,
    getToolDefinitions,
} from '../toolHandlers';
import { OUTCOME_DIFFICULTIES, PLAYER_OUTCOMES } from '../../../types';
import type { PlayerOutcome } from '../../../types';

const ARGS = {
    reason: 'Forcing the shutter before the patrol rounds the corner.',
    difficulty: 'hard' as const,
    failure_means: 'the frame gives loudly and they hear it',
};

const toolNames = (tools: unknown[]) =>
    tools.map((t) => (t as { function?: { name?: string } }).function?.name);

const findTool = (tools: unknown[], name: string) =>
    tools.find((t) => (t as { function?: { name?: string } }).function?.name === name) as
        {
            function: {
                name: string;
                description: string;
                parameters: { required: string[]; properties: Record<string, { enum?: readonly string[] }> };
            };
        } | undefined;

describe('parseRequestOutcomeArgs', () => {
    it('parses a well-formed call and trims', () => {
        expect(parseRequestOutcomeArgs(JSON.stringify({ ...ARGS, difficulty: ' hard ' }))).toEqual(ARGS);
    });

    it('returns null on malformed JSON rather than throwing mid-turn', () => {
        expect(parseRequestOutcomeArgs('{not json')).toBeNull();
    });

    it('returns null when reason is missing — there is nothing to show the player', () => {
        expect(parseRequestOutcomeArgs(JSON.stringify({ difficulty: 'hard', failure_means: 'x' }))).toBeNull();
    });

    it.each(['moderate', 'DEADLY', '', undefined, 7])(
        'coerces an unusable difficulty (%p) to average rather than dropping the request',
        (difficulty) => {
            // A model that invents "moderate" has still asked a real question about a real
            // action. Swallowing the call silently ends the turn mid-attempt, which is strictly
            // worse than resolving it at even odds.
            const parsed = parseRequestOutcomeArgs(JSON.stringify({ ...ARGS, difficulty }));
            expect(parsed?.difficulty).toBe('average');
        },
    );

    it('tolerates a missing failure cost rather than dropping the request', () => {
        const parsed = parseRequestOutcomeArgs(JSON.stringify({ reason: 'Climb.', difficulty: 'easy' }));
        expect(parsed).toEqual({ reason: 'Climb.', difficulty: 'easy', failure_means: '' });
    });

    it.each(OUTCOME_DIFFICULTIES)('accepts %s', (difficulty) => {
        expect(parseRequestOutcomeArgs(JSON.stringify({ ...ARGS, difficulty }))?.difficulty).toBe(difficulty);
    });
});

describe('outcomeHappens', () => {
    it.each([
        ['fail', false],
        ['fail_with_consequence', false],
        ['success', true],
        ['success_with_consequence', true],
    ] as const)('%s -> %s', (outcome, expected) => {
        expect(outcomeHappens(outcome)).toBe(expected);
    });
});

describe('formatPlayerOutcomeResult', () => {
    it("carries the player's pick and restates the terms the GM committed to", () => {
        const out = JSON.parse(formatPlayerOutcomeResult(ARGS, 'success'));
        expect(out).toMatchObject({
            outcome: 'success',
            difficulty: 'hard',
            failure_means: ARGS.failure_means,
            source: 'player-resolved',
        });
        expect(out.binding).toMatch(/final/i);
    });

    it.each([
        ['fail', false],
        ['fail_with_consequence', false],
        ['success', true],
        ['success_with_consequence', true],
    ] as const)('derives action_happens for %s', (outcome, happens) => {
        expect(JSON.parse(formatPlayerOutcomeResult(ARGS, outcome)).action_happens).toBe(happens);
    });

    // Design goal 6 — numbers never reach the writer. The old `player_total` was literally a
    // number in the prompt for the writer to read straight back out; this path has none.
    it.each(PLAYER_OUTCOMES)('puts no number anywhere in the result (%s)', (outcome) => {
        const out = JSON.parse(formatPlayerOutcomeResult(ARGS, outcome)) as Record<string, unknown>;
        for (const value of Object.values(out)) {
            expect(typeof value).not.toBe('number');
        }
        expect(out).not.toHaveProperty('player_total');
        expect(out).not.toHaveProperty('dice');
        expect(out).not.toHaveProperty('success_on');
    });

    it('never maps the outcome to a tier or band', () => {
        // The whole point: the outcome the player picked and the terms the model already
        // stated are the entire resolution. A tier here would reintroduce the vocabulary
        // that leaked into prose.
        const out = JSON.parse(formatPlayerOutcomeResult(ARGS, 'success'));
        expect(out).not.toHaveProperty('tier');
        expect(out).not.toHaveProperty('band');
    });

    // The binding text is the ONLY defence left against a softened failure. The model no
    // longer has an unarguable numeric comparison to check itself against — a verdict on a
    // difficulty label it authored itself is far easier to talk around — so the specific
    // failure mode is named explicitly, and these assertions are what keep it named.
    it.each(['fail', 'fail_with_consequence'] as const)('%s forbids the action happening anyway', (outcome) => {
        const binding = JSON.parse(formatPlayerOutcomeResult(ARGS, outcome)).binding as string;
        expect(binding).toMatch(/DOES NOT HAPPEN/);
        expect(binding).toMatch(/near-miss/i);
        expect(binding).toMatch(/another route/i);
    });

    it.each(['success', 'success_with_consequence'] as const)('%s states the action happens', (outcome) => {
        expect(JSON.parse(formatPlayerOutcomeResult(ARGS, outcome)).binding).toMatch(/FUNDAMENTALLY HAPPENS/);
    });

    it('names the stated cost as the consequence on a rider outcome', () => {
        expect(JSON.parse(formatPlayerOutcomeResult(ARGS, 'fail_with_consequence')).binding)
            .toMatch(/failure_means/);
    });

    it('forbids inventing a consequence when none was reported', () => {
        expect(JSON.parse(formatPlayerOutcomeResult(ARGS, 'success')).binding)
            .toMatch(/No consequence rides along/i);
    });

    it('forbids naming the mechanic in the prose', () => {
        const binding = JSON.parse(formatPlayerOutcomeResult(ARGS, 'success')).binding as string;
        expect(binding).toMatch(/name no difficulty/i);
        expect(binding).toMatch(/no skill or attribute/i);
    });

    it('marks an unstated cost rather than inventing one', () => {
        const out = JSON.parse(formatPlayerOutcomeResult({ ...ARGS, failure_means: '' }, 'fail'));
        expect(out.failure_means).toBe('(unstated)');
    });

    it('passes a failure through unsoftened', () => {
        expect(JSON.parse(formatPlayerOutcomeResult(ARGS, 'fail')).outcome).toBe('fail');
    });
});

// The Consequence field. It is honoured ONLY on a `_with_consequence` outcome and only when
// non-empty, which is what keeps two things true at once: a campaign with no authored list
// behaves exactly as it did before the field existed, and text left sitting in the field
// cannot leak into a plain fail or success.
describe('formatPlayerOutcomeResult — the supplied consequence', () => {
    const COST = 'Noise — Not discovery, attention. A patrol changes its route.';

    it.each(['fail_with_consequence', 'success_with_consequence'] as const)(
        '%s carries the consequence and orders it woven into the same beat',
        (outcome) => {
            const out = JSON.parse(formatPlayerOutcomeResult(ARGS, outcome, COST));
            expect(out.consequence).toBe(COST);
            expect(out.binding).toMatch(/twist or complication/i);
            expect(out.binding).toMatch(/alongside the outcome/i);
            expect(out.binding).toMatch(/not instead of it/i);
            // A consequence must not be filed away for later — that is how a cost quietly
            // stops being a cost.
            expect(out.binding).toMatch(/not deferred/i);
        },
    );

    it('trims the field so a stray newline never reaches the prompt', () => {
        expect(JSON.parse(formatPlayerOutcomeResult(ARGS, 'fail_with_consequence', `  ${COST}\n`)).consequence)
            .toBe(COST);
    });

    it('states that the consequence does not change whether the action happened', () => {
        expect(JSON.parse(formatPlayerOutcomeResult(ARGS, 'success_with_consequence', COST)).binding)
            .toMatch(/does not change whether the action happened/i);
    });

    it('forbids quoting the label back into the prose', () => {
        expect(JSON.parse(formatPlayerOutcomeResult(ARGS, 'fail_with_consequence', COST)).binding)
            .toMatch(/do not quote its label/i);
    });

    it.each(['fail', 'success'] as const)(
        '%s ignores the field entirely and still forbids adding a cost',
        (outcome) => {
            const out = JSON.parse(formatPlayerOutcomeResult(ARGS, outcome, COST));
            expect(out).not.toHaveProperty('consequence');
            expect(out.binding).toMatch(/No consequence rides along; do not add one/i);
        },
    );

    it.each(['', '   '])(
        'a rider with a blank field (%p) falls back to the GM-stated cost, unchanged',
        (blank) => {
            const out = JSON.parse(formatPlayerOutcomeResult(ARGS, 'fail_with_consequence', blank));
            expect(out).not.toHaveProperty('consequence');
            expect(out.binding).toMatch(/A cost rides along/i);
            expect(out.binding).toMatch(/failure_means/);
        },
    );

    it('defaults to the blank-field behaviour when the argument is omitted', () => {
        // The third parameter is optional so every pre-existing caller keeps working.
        const out = JSON.parse(formatPlayerOutcomeResult(ARGS, 'fail_with_consequence'));
        expect(out).not.toHaveProperty('consequence');
        expect(out.binding).toMatch(/A cost rides along/i);
    });

    it.each([
        ['fail', false],
        ['fail_with_consequence', false],
        ['success', true],
        ['success_with_consequence', true],
    ] as const)('a consequence never moves action_happens for %s', (outcome, happens) => {
        expect(JSON.parse(formatPlayerOutcomeResult(ARGS, outcome, COST)).action_happens).toBe(happens);
    });

    it('adds no number, even carrying a consequence', () => {
        const out = JSON.parse(formatPlayerOutcomeResult(ARGS, 'fail_with_consequence', COST)) as Record<string, unknown>;
        for (const value of Object.values(out)) expect(typeof value).not.toBe('number');
    });
});

describe('request_outcome description — the consequence clause', () => {
    it('warns the model a player-chosen consequence may arrive, and that it does not pick it', () => {
        const tool = findTool(getToolDefinitions({ playerRollFrequency: 'contested' }), 'request_outcome');
        expect(tool!.function.description).toMatch(/may also carry a specific `consequence`/i);
        expect(tool!.function.description).toMatch(/You do not choose it/i);
    });
});

describe('formatPlayerOutcomeDeclined', () => {
    it('tells the model nothing was resolved and forbids picking for itself', () => {
        const out = JSON.parse(formatPlayerOutcomeDeclined(ARGS));
        expect(out.outcome).toBeNull();
        expect(out.action_happens).toBeNull();
        expect(out.source).toBe('player-declined');
        expect(out.binding).toMatch(/do not pick an outcome yourself/i);
        expect(out.binding).toMatch(/by chance/i);
    });
});

describe('getToolDefinitions — request_outcome is the only resolution tool', () => {
    it('offers request_outcome when a frequency is given', () => {
        const names = toolNames(getToolDefinitions({ playerRollFrequency: 'contested' }));
        expect(names).toContain('request_outcome');
    });

    // Ask To Resolve off. Because every "ask the player" imperative lives in the tool's own
    // description, withholding the tool is also what stops the model being told to ask.
    it('offers no resolution tool at all when no frequency is given', () => {
        const names = toolNames(getToolDefinitions({}));
        expect(names).not.toContain('request_outcome');
        expect(names).not.toContain('request_roll');
        expect(names).not.toContain('roll_dice');
    });

    it('never offers the retired dice tools, in either mode', () => {
        for (const opts of [{ playerRollFrequency: 'contested' as const }, {}]) {
            const names = toolNames(getToolDefinitions(opts));
            expect(names).not.toContain('roll_dice');
            expect(names).not.toContain('request_roll');
        }
    });

    it('requires the terms up front, which is what makes a player-supplied outcome trustworthy', () => {
        const tool = findTool(getToolDefinitions({ playerRollFrequency: 'contested' }), 'request_outcome');
        expect(tool!.function.parameters.required).toEqual(['reason', 'difficulty', 'failure_means']);
    });

    it('constrains difficulty to the five labels', () => {
        const tool = findTool(getToolDefinitions({ playerRollFrequency: 'contested' }), 'request_outcome');
        expect(tool!.function.parameters.properties.difficulty.enum).toEqual([...OUTCOME_DIFFICULTIES]);
    });

    it('exposes no dice, bar, or category param — the system-specific machinery is gone', () => {
        const tool = findTool(getToolDefinitions({ playerRollFrequency: 'contested' }), 'request_outcome');
        const props = Object.keys(tool!.function.parameters.properties);
        expect(props).not.toContain('dice');
        expect(props).not.toContain('success_on');
        expect(props).not.toContain('category');
    });

    it.each([
        ['contested', /any contested action/i],
        ['consequential', /consequential actions only/i],
        ['critical', /decisive moments only/i],
    ] as const)('the %s threshold selects its own guidance', (frequency, expected) => {
        const tool = findTool(getToolDefinitions({ playerRollFrequency: frequency }), 'request_outcome');
        expect(tool!.function.description).toMatch(expected);
    });

    it('spells out the difficulty ladder so the estimate is calibrated, not improvised', () => {
        const tool = findTool(getToolDefinitions({ playerRollFrequency: 'contested' }), 'request_outcome');
        for (const difficulty of OUTCOME_DIFFICULTIES) {
            expect(tool!.function.description).toContain(difficulty);
        }
    });

    it('names all four outcomes so the model knows what can come back', () => {
        const tool = findTool(getToolDefinitions({ playerRollFrequency: 'contested' }), 'request_outcome');
        for (const outcome of PLAYER_OUTCOMES as readonly PlayerOutcome[]) {
            expect(tool!.function.description).toContain(outcome);
        }
    });

    it('always forbids naming the mechanic in the narration', () => {
        const tool = findTool(getToolDefinitions({ playerRollFrequency: 'critical' }), 'request_outcome');
        expect(tool!.function.description).toMatch(/no faculty, skill or attribute/i);
    });

    it('tells the model to stop after calling, and not to write both branches', () => {
        const tool = findTool(getToolDefinitions({ playerRollFrequency: 'contested' }), 'request_outcome');
        expect(tool!.function.description).toMatch(/then STOP/);
        expect(tool!.function.description).toMatch(/both branches/i);
    });
});
