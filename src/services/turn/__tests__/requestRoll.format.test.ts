// The pure half of player-rolled resolution: argument parsing, the tool result the model
// reads back, and which dice tool getToolDefinitions offers.
import { describe, it, expect } from 'vitest';
import {
    parseRequestRollArgs,
    formatPlayerRollResult,
    formatPlayerRollDeclined,
    getToolDefinitions,
} from '../toolHandlers';

const ARGS = {
    dice: '2d6',
    reason: 'Forcing the shutter before the patrol rounds the corner.',
    success_on: '7+',
    failure_means: 'the frame gives loudly and they hear it',
};

const toolNames = (tools: unknown[]) =>
    tools.map((t) => (t as { function?: { name?: string } }).function?.name);

const findTool = (tools: unknown[], name: string) =>
    tools.find((t) => (t as { function?: { name?: string } }).function?.name === name) as
        { function: { name: string; description: string; parameters: { required: string[] } } } | undefined;

describe('parseRequestRollArgs', () => {
    it('parses a well-formed call and trims', () => {
        expect(parseRequestRollArgs(JSON.stringify({ ...ARGS, dice: '  2d6 ' }))).toEqual(ARGS);
    });

    it('returns null on malformed JSON rather than throwing mid-turn', () => {
        expect(parseRequestRollArgs('{not json')).toBeNull();
    });

    it.each(['dice', 'reason'])('returns null when %s is missing', (key) => {
        const partial: Record<string, string> = { ...ARGS };
        delete partial[key];
        expect(parseRequestRollArgs(JSON.stringify(partial))).toBeNull();
    });

    it('tolerates a missing bar rather than dropping the roll', () => {
        // A stated bar is required by the schema, but a model that omits it should still get
        // its roll — the alternative is silently swallowing the request.
        const parsed = parseRequestRollArgs(JSON.stringify({ dice: '1d20', reason: 'Climb.' }));
        expect(parsed).toEqual({ dice: '1d20', reason: 'Climb.', success_on: '', failure_means: '' });
    });
});

describe('formatPlayerRollResult', () => {
    it("carries the player's total and restates the bar the GM committed to", () => {
        const out = JSON.parse(formatPlayerRollResult(ARGS, 11));
        expect(out).toMatchObject({ player_total: 11, success_on: '7+', source: 'player-rolled' });
        expect(out.binding).toMatch(/final/i);
    });

    it('never maps the total to a tier or band', () => {
        // The whole point: the number and the bar the model already stated are the entire
        // resolution. A tier here would reintroduce the vocabulary that leaked into prose.
        const out = JSON.parse(formatPlayerRollResult(ARGS, 11));
        expect(out).not.toHaveProperty('tier');
        expect(out).not.toHaveProperty('band');
    });

    it('forbids restating the number in the prose', () => {
        expect(JSON.parse(formatPlayerRollResult(ARGS, 11)).binding).toMatch(/do not restate/i);
    });

    it('marks an unstated bar rather than inventing one', () => {
        const out = JSON.parse(formatPlayerRollResult({ ...ARGS, success_on: '' }, 4));
        expect(out.success_on).toBe('(unstated)');
    });

    it('passes a miss through unsoftened', () => {
        expect(JSON.parse(formatPlayerRollResult(ARGS, 3)).player_total).toBe(3);
    });
});

describe('formatPlayerRollDeclined', () => {
    it('tells the model no roll happened and forbids inventing one', () => {
        const out = JSON.parse(formatPlayerRollDeclined(ARGS));
        expect(out.player_total).toBeNull();
        expect(out.source).toBe('player-declined');
        expect(out.binding).toMatch(/do not invent/i);
    });
});

describe('getToolDefinitions — request_roll is the only dice tool', () => {
    it('offers request_roll when a frequency is given', () => {
        const names = toolNames(getToolDefinitions({ playerRollFrequency: 'contested' }));
        expect(names).toContain('request_roll');
    });

    // Ask To Roll off. There is no engine-rolled tool to fall back to any more, and because
    // every "ask for a roll" imperative lives in request_roll's own description, withholding
    // the tool is also what stops the model being told to ask.
    it('offers no dice tool at all when no frequency is given', () => {
        const names = toolNames(getToolDefinitions({}));
        expect(names).not.toContain('request_roll');
        expect(names).not.toContain('roll_dice');
    });

    it('never offers the retired engine-rolled roll_dice, in either mode', () => {
        expect(toolNames(getToolDefinitions({ playerRollFrequency: 'contested' }))).not.toContain('roll_dice');
        expect(toolNames(getToolDefinitions({}))).not.toContain('roll_dice');
    });

    it('requires the bar up front, which is what makes a player-supplied number trustworthy', () => {
        const tool = findTool(getToolDefinitions({ playerRollFrequency: 'contested' }), 'request_roll');
        expect(tool!.function.parameters.required).toEqual(['dice', 'reason', 'success_on', 'failure_means']);
    });

    it('exposes no category param — that enum is what leaked "Perception" into the prose', () => {
        const tool = findTool(getToolDefinitions({ playerRollFrequency: 'contested' }), 'request_roll');
        expect(Object.keys((tool!.function.parameters as unknown as { properties: object }).properties)).not.toContain('category');
    });

    it.each([
        ['contested', /any contested action/i],
        ['consequential', /consequential actions only/i],
        ['critical', /decisive moments only/i],
    ] as const)('the %s threshold selects its own guidance', (frequency, expected) => {
        const tool = findTool(getToolDefinitions({ playerRollFrequency: frequency }), 'request_roll');
        expect(tool!.function.description).toMatch(expected);
    });

    it('always forbids naming the mechanic in the narration', () => {
        const tool = findTool(getToolDefinitions({ playerRollFrequency: 'critical' }), 'request_roll');
        expect(tool!.function.description).toMatch(/no faculty, skill or attribute/i);
    });
});
