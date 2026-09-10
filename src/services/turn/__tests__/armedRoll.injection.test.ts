/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// `rollEngines` is the Surprise/Encounter/World-Event engine and is unrelated to dice — stub it
// to silence its DC churn. `resolveManualRoll` still returns a `tier` (mobile reads it through
// the shared engine package); these tests assert the desktop no longer puts it on the page.
const resolveManualRollMock = vi.fn();
vi.mock('../../engine/engineRolls', () => ({
    rollEngines: () => ({ appendToInput: '', updatedDCs: {} }),
    resolveManualRoll: (...a: unknown[]) => resolveManualRollMock(...a),
}));

import { resolveEngineRolls } from '../turnStages';

const ctxFor = () => ({ finalInput: 'I force the shutter', displayInputFinal: 'I force the shutter', historyInput: '' } as any);
const stateFor = (armedRoll: unknown) => ({ context: { diceSystem: null }, armedRoll } as any);
const callbacks = { setPipelinePhase: vi.fn(), updateContext: vi.fn() } as any;

describe('armed "dice me" roll — the injected fact', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resolveManualRollMock.mockReturnValue({ tier: 'Triumph', faceValue: 17, detail: '1d20', rolls: [17] });
    });

    it('carries the number and the player\'s stated reason, and never the tier', () => {
        const ctx = ctxFor();
        resolveEngineRolls(ctx, stateFor({ dieTypeId: 'dt_d20', rollDef: {}, reason: 'forcing the shutter' }), callbacks);

        expect(ctx.finalInput).toContain('17');
        expect(ctx.finalInput).toContain('for: forcing the shutter');
        // The whole point of the change: the engine no longer decides what the number is worth.
        expect(ctx.finalInput).not.toContain('Triumph');
        // ...and it defers that judgement to the ruleset rather than asserting an outcome.
        expect(ctx.finalInput).toMatch(/Action Resolution rules/);
    });

    // "Dice me" is the one path on which a number still reaches the writer, so its binding
    // has to carry the same prose boundary the request_outcome result does. The two are
    // worded in parallel deliberately; these are the shared clauses.
    it('forbids the prose from restating the number, matching the request_outcome binding', () => {
        const ctx = ctxFor();
        resolveEngineRolls(ctx, stateFor({ dieTypeId: 'dt_d20', rollDef: {}, reason: 'a hard climb' }), callbacks);
        expect(ctx.finalInput).toMatch(/Do not restate the number/);
        expect(ctx.finalInput).toMatch(/final/i);
        expect(ctx.finalInput).toMatch(/skill or attribute/i);
    });

    it('reads cleanly with no reason given', () => {
        const ctx = ctxFor();
        resolveEngineRolls(ctx, stateFor({ dieTypeId: 'dt_d20', rollDef: {} }), callbacks);
        expect(ctx.finalInput).toContain('the player rolled 1d20 and got 17');
        expect(ctx.finalInput).not.toContain('for:');
        expect(ctx.finalInput).not.toContain('undefined');
    });

    it('survives the legacy string-shaped armed roll, which has no reason field', () => {
        const ctx = ctxFor();
        resolveEngineRolls(ctx, stateFor('1d20'), callbacks);
        expect(ctx.finalInput).toContain('got 17');
        expect(ctx.finalInput).not.toContain('undefined');
    });

    it('shows the player their own number and reason, without a tier', () => {
        const ctx = ctxFor();
        resolveEngineRolls(ctx, stateFor({ dieTypeId: 'dt_d20', rollDef: {}, reason: 'forcing the shutter' }), callbacks);
        expect(ctx.displayInputFinal).toContain('🎲 1d20 → 17 — forcing the shutter');
        expect(ctx.displayInputFinal).not.toContain('Triumph');
    });

    // The tag is appended to finalInput only, BELOW the historyInput snapshot, so it reaches
    // this turn's prompt and never the persisted transcript. history.ts has nothing to strip.
    it('never enters the history snapshot', () => {
        const ctx = ctxFor();
        resolveEngineRolls(ctx, stateFor({ dieTypeId: 'dt_d20', rollDef: {}, reason: 'x' }), callbacks);
        expect(ctx.historyInput).not.toContain('RESOLVED ROLL');
        expect(ctx.finalInput).toContain('RESOLVED ROLL');
    });

    it('injects nothing at all when no roll was armed', () => {
        const ctx = ctxFor();
        resolveEngineRolls(ctx, stateFor(null), callbacks);
        expect(ctx.finalInput).toBe('I force the shutter');
        expect(resolveManualRollMock).not.toHaveBeenCalled();
    });
});
