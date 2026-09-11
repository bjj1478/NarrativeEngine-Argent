import { describe, it, expect } from 'vitest';
import type { AppSettings, SceneStakes, ResponseLength } from '../../../../types';
import { RESPONSE_LENGTHS } from '../../../../types';
import { isThinkingEnabled } from '../../stable';
import { formatAskGmBrief } from '../../../ooc/askGmHandoff';
import { buildAbsoluteCommandBlock } from '../../../turn/absoluteCommand';
import { assembleContributions } from '../assemble';
import { createFinalUserRegistry, GM_REMINDER, beatBudgetLine } from '../builtins';
import type { FinalUserModuleInput } from '../builtins';

/**
 * WO-P2-02 characterization guard.
 *
 * `buildPayload` used to assemble the final user message with a hand-written array plus four
 * inline precedence conditionals. That expression is reproduced verbatim below as `legacy()` —
 * the oracle — and compared against the registry-driven assembly across EVERY combination of
 * the flags that drove it (64 cases).
 *
 * If the migration changed the prompt by so much as one character, in any reachable
 * configuration, this fails.
 *
 * DELIBERATE DIVERGENCE — the [BEAT BUDGET] line, which the legacy expression had no concept
 * of. It is now its own contribution (`writer.length`, order 210), so it sits between the CoT
 * invocation and the Director Brief, and — unlike the invocation it used to ride on — it ships
 * whether or not thinking is enabled. The oracle below reproduces that placement and calls the
 * SAME `beatBudgetLine` helper the contribution uses — as it already does for `GM_REMINDER` —
 * because this test's job is to pin assembly, precedence and ordering, not to re-type the block
 * text. The pacing text itself is covered by the 'beat budget' describe block at the bottom of
 * this file. It also pins the debug-trace sequence, which the old code emitted
 * in a different source order (watchdog → director → absolute) than the new code sorts by
 * (director → watchdog → absolute); the two agree only because the Director Brief and the
 * watchdog nudge are mutually exclusive, and that is asserted here rather than assumed.
 */

// ─── the oracle: payloadBuilder.ts @ 08a5a08..HEAD, lines 193-291, verbatim ──────────────────
function legacy(input: FinalUserModuleInput): { text: string; traceSources: string[] } {
    const absoluteCommandBlock = buildAbsoluteCommandBlock(input.absoluteCommand);
    const hasAbsolute = absoluteCommandBlock !== '';

    const gmReminderActive = hasAbsolute ? '' : GM_REMINDER;

    const writerCotNudge = !isThinkingEnabled(input.settings)
        ? ''
        : hasAbsolute
            ? 'Work through the [WRITER REASONING FRAMEWORK] only where it does not conflict with [USER ABSOLUTE COMMAND]. Where they conflict, discard the framework step and follow the command.'
            : 'Work through the [WRITER REASONING FRAMEWORK] in your reasoning before writing.';

    // Response Length is its own contribution now, ordered immediately after the invocation and
    // NOT gated on thinking — a turn can get the budget without the framework.
    const beatBudget = beatBudgetLine(input.responseLength, input.sceneStakes, input.timeskipDetected);

    const watchdogNudgeActive =
        input.watchdogNudge && !input.directorBrief && !hasAbsolute ? input.watchdogNudge : '';

    const directorBriefBlock = input.directorBrief ? `[DIRECTOR BRIEF]\n${input.directorBrief}` : '';

    const askGmBrief = formatAskGmBrief(input.nextTurnOocBrief);

    const text = [
        input.volatileBlock, writerCotNudge, beatBudget, directorBriefBlock, gmReminderActive,
        watchdogNudgeActive, askGmBrief, input.userMessage, absoluteCommandBlock,
    ].filter(Boolean).join('\n\n');

    // Legacy trace emission order, in source order.
    const traceSources: string[] = [];
    if (watchdogNudgeActive) traceSources.push('Watchdog');
    if (directorBriefBlock) traceSources.push('Director');
    if (absoluteCommandBlock) traceSources.push('Absolute Command');

    return { text, traceSources };
}

// ─── the migration under test ────────────────────────────────────────────────────────────────
function migrated(input: FinalUserModuleInput): { text: string; traceSources: string[] } {
    const assembled = assembleContributions(createFinalUserRegistry().collect(input));
    return { text: assembled.text, traceSources: assembled.traces.map((t) => t.source) };
}

// ─── settings fixtures ───────────────────────────────────────────────────────────────────────
const thinkingOn = {
    debugMode: true,
    contextLimit: 8192,
    activePresetId: 'preset_1',
    providers: [{ id: 'prov_a', modelName: 'anything', thinkingEffort: 'medium' }],
    presets: [{ id: 'preset_1', storyAIProviderId: 'prov_a' }],
} as unknown as AppSettings;

const thinkingOff = { debugMode: true, contextLimit: 8192 } as unknown as AppSettings;

// ─── the matrix ──────────────────────────────────────────────────────────────────────────────
const AXES = {
    settings: [['thinking-on', thinkingOn], ['thinking-off', thinkingOff]] as const,
    directorBrief: [['brief', 'Press the confrontation.'], ['no-brief', undefined]] as const,
    watchdogNudge: [['nudge', '[STAGE NOTE] Kira has been agreeing too readily.'], ['no-nudge', undefined]] as const,
    absoluteCommand: [['command', 'Keep it under 200 words.'], ['no-command', undefined]] as const,
    nextTurnOocBrief: [['ooc', 'Focus on the sister subplot.'], ['no-ooc', undefined]] as const,
    volatileBlock: [['world', '[WORLD STATE]\nThe tavern is emptying.'], ['no-world', '']] as const,
};

interface Case { label: string; input: FinalUserModuleInput }

function matrix(): Case[] {
    const cases: Case[] = [];
    for (const [sName, settings] of AXES.settings) {
        for (const [dName, directorBrief] of AXES.directorBrief) {
            for (const [wName, watchdogNudge] of AXES.watchdogNudge) {
                for (const [aName, absoluteCommand] of AXES.absoluteCommand) {
                    for (const [oName, nextTurnOocBrief] of AXES.nextTurnOocBrief) {
                        for (const [vName, volatileBlock] of AXES.volatileBlock) {
                            cases.push({
                                label: [sName, dName, wName, aName, oName, vName].join(' · '),
                                input: {
                                    settings,
                                    userMessage: 'I push the door open.',
                                    volatileBlock,
                                    directorBrief,
                                    watchdogNudge,
                                    absoluteCommand,
                                    nextTurnOocBrief,
                                },
                            });
                        }
                    }
                }
            }
        }
    }
    return cases;
}

describe('WO-P2-02 — final user message is byte-identical after the registry migration', () => {
    const cases = matrix();

    it('covers all 64 flag combinations', () => {
        expect(cases).toHaveLength(64);
    });

    it.each(cases.map((c) => [c.label, c.input] as const))(
        'assembled text matches the legacy expression — %s',
        (_label, input) => {
            expect(migrated(input).text).toBe(legacy(input).text);
        },
    );

    it.each(cases.map((c) => [c.label, c.input] as const))(
        'debug traces match the legacy sequence — %s',
        (_label, input) => {
            expect(migrated(input).traceSources).toEqual(legacy(input).traceSources);
        },
    );

    it('the Director Brief and the watchdog nudge are never both traced (why the reorder is safe)', () => {
        for (const { input } of cases) {
            const sources = migrated(input).traceSources;
            expect(sources.includes('Director') && sources.includes('Watchdog')).toBe(false);
        }
    });
});

describe('WO-P2-02 — precedence rules survive as declared suppression', () => {
    const base: FinalUserModuleInput = {
        settings: thinkingOff,
        userMessage: 'I wait.',
        volatileBlock: '',
    };

    it('an Absolute Command removes GM_REMINDER and the watchdog nudge', () => {
        const assembled = assembleContributions(createFinalUserRegistry().collect({
            ...base, watchdogNudge: '[STAGE NOTE] x', absoluteCommand: 'Be terse.',
        }));

        expect(assembled.included).not.toContain('gm.reminder');
        expect(assembled.included).not.toContain('watchdog.nudge');
        expect(assembled.suppressed).toEqual(
            expect.arrayContaining([{ id: 'watchdog.nudge', by: 'absolute.command' }]),
        );
    });

    it('a Director Brief supersedes the watchdog nudge but leaves GM_REMINDER standing', () => {
        const assembled = assembleContributions(createFinalUserRegistry().collect({
            ...base, watchdogNudge: '[STAGE NOTE] x', directorBrief: 'Push harder.',
        }));

        expect(assembled.included).toContain('gm.reminder');
        expect(assembled.included).not.toContain('watchdog.nudge');
    });

    it('the player message and Absolute Command survive a hostile enablement map', () => {
        // Structural modules ignore the predicate — a corrupt settings entry must never be
        // able to delete the player's own input from the prompt.
        const registry = createFinalUserRegistry();
        const specs = registry.collect(
            { ...base, absoluteCommand: 'Be terse.' },
            { isEnabled: () => false },
        );

        const ids = specs.map((s) => s.id);
        expect(ids).toContain('user.message');
        expect(ids).toContain('absolute.command');
        expect(ids).not.toContain('gm.reminder');
    });

    it('every built-in is unbounded, which is what keeps the migration byte-identical', () => {
        const specs = createFinalUserRegistry().collect({ ...base, directorBrief: 'x' });
        expect(specs.every((s) => s.budget === undefined)).toBe(true);
    });
});

// ─── Response Length ─────────────────────────────────────────────────────────────────────────
describe('beat budget — the player picks the length, flexible follows the scene', () => {
    const thinking: FinalUserModuleInput = {
        settings: thinkingOn,
        userMessage: 'I wait.',
        volatileBlock: '',
    };

    /** The [BEAT BUDGET] line as actually emitted, from its own contribution. */
    const lengthText = (input: FinalUserModuleInput): string =>
        createFinalUserRegistry().collect(input).find((s) => s.id === 'writer.length')?.text ?? '';

    const cotText = (input: FinalUserModuleInput): string =>
        createFinalUserRegistry().collect(input).find((s) => s.id === 'writer.cot')?.text ?? '';

    // The marker itself is load-bearing — Example_Setup/ and Custom_Setup/ rulesets say "when a
    // [BEAT BUDGET] line is present it is the cap". Renaming it breaks the user's own files.
    it('always carries the [BEAT BUDGET] marker the rulesets key off', () => {
        for (const length of RESPONSE_LENGTHS) {
            expect(lengthText({ ...thinking, responseLength: length })).toContain('[BEAT BUDGET:');
        }
    });

    it.each([
        ['short', /1 beat, \d+-\d+ words/],
        ['medium', /2-3 beats, \d+-\d+ words/],
        ['long', /3-5 beats, \d+-\d+ words/],
    ] as const)('%s selects its own fixed budget', (length, expected) => {
        expect(lengthText({ ...thinking, responseLength: length })).toMatch(expected);
    });

    it.each(['short', 'medium', 'long'] as const)('a fixed %s ignores the scene stakes entirely', (length) => {
        // The point of choosing a length is that the scene cannot talk you out of it.
        const calm = lengthText({ ...thinking, responseLength: length, sceneStakes: 'calm' });
        const dangerous = lengthText({ ...thinking, responseLength: length, sceneStakes: 'dangerous' });
        expect(calm).toBe(dangerous);
    });

    it.each([
        ['calm', /2-3 beats, \d+-\d+ words/],
        ['tense', /1 beat, \d+-\d+ words/],
        ['dangerous', /1 beat, \d+-\d+ words/],
    ] as const)('flexible maps a %s scene onto its budget', (stakes, expected) => {
        expect(lengthText({ ...thinking, responseLength: 'flexible', sceneStakes: stakes })).toMatch(expected);
    });

    it('flexible reaches the long budget only on a time skip', () => {
        const skip = lengthText({ ...thinking, responseLength: 'flexible', sceneStakes: 'dangerous', timeskipDetected: true });
        expect(skip).toMatch(/3-5 beats, \d+-\d+ words/);
        // …and a fixed setting is not overridden by one.
        expect(lengthText({ ...thinking, responseLength: 'short', timeskipDetected: true })).toContain('1 beat');
    });

    it('an absent responseLength reads as flexible', () => {
        expect(lengthText({ ...thinking, sceneStakes: 'tense' }))
            .toBe(lengthText({ ...thinking, responseLength: 'flexible', sceneStakes: 'tense' }));
    });

    it('absent stakes reads as calm, matching extractAndStripSceneStakes own fallback', () => {
        expect(lengthText({ ...thinking, responseLength: 'flexible', sceneStakes: undefined }))
            .toBe(lengthText({ ...thinking, responseLength: 'flexible', sceneStakes: 'calm' }));
    });

    // The `?? ` defaults guard null/undefined only. A value outside the union at runtime — an
    // older save, a hand-edited context — indexes the record to `undefined` and would put the
    // literal string "undefined" in the prompt.
    it('a stakes value outside the union reads as calm, never the string "undefined"', () => {
        const text = lengthText({ ...thinking, responseLength: 'flexible', sceneStakes: 'urgent' as SceneStakes });
        expect(text).toBe(lengthText({ ...thinking, responseLength: 'flexible', sceneStakes: 'calm' }));
        expect(text).not.toContain('undefined');
    });

    it('a responseLength outside the union still emits a real budget', () => {
        const text = lengthText({ ...thinking, responseLength: 'epic' as ResponseLength, sceneStakes: 'calm' });
        expect(text).toContain('[BEAT BUDGET:');
        expect(text).not.toContain('undefined');
    });

    // The regression this split exists to prevent: the budget used to ride on the CoT
    // invocation, so a thinking-off campaign was sent no length guidance at all.
    it('ships with thinking OFF, when the reasoning framework does not', () => {
        const off = { ...thinking, settings: thinkingOff, responseLength: 'medium' as const };
        expect(cotText(off)).toBe('');
        expect(lengthText(off)).toMatch(/2-3 beats, \d+-\d+ words/);
    });

    it('an Absolute Command overrides the framework but NOT the pacing', () => {
        // A command changes what the writer reasons about; it is not a licence to run long.
        const input = { ...thinking, responseLength: 'flexible' as const, sceneStakes: 'dangerous' as const, absoluteCommand: 'Be terse.' };
        expect(cotText(input)).toContain('USER ABSOLUTE COMMAND');
        expect(lengthText(input)).toContain('1 beat');
    });

    it('never states a padding-friendly quota', () => {
        for (const length of RESPONSE_LENGTHS) {
            for (const stakes of ['calm', 'tense', 'dangerous'] as const) {
                const text = lengthText({ ...thinking, responseLength: length, sceneStakes: stakes });
                expect(text).not.toContain('5-8');
                expect(text).toContain('Never pad');
            }
        }
    });
});
