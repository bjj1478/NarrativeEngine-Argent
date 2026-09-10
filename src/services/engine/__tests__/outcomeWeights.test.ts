// The "Decide for me" fallback. Argent's non-goals allow the engine to resolve for the player
// only as "an explicit opt-in fallback", so the properties worth locking are that the weights
// are a well-formed distribution, that the difficulty the GM committed to is the only input,
// and that the ladder actually leans the way it claims to.
import { describe, it, expect } from 'vitest';
import { OUTCOME_WEIGHTS, pickWeightedOutcome } from '../outcomeWeights';
import { OUTCOME_DIFFICULTIES, PLAYER_OUTCOMES } from '../../../types';
import type { OutcomeDifficulty, PlayerOutcome } from '../../../types';

/** Deterministic stand-in for Math.random, cycling through the given values. */
const seq = (...values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
};

describe('OUTCOME_WEIGHTS', () => {
    it.each(OUTCOME_DIFFICULTIES)('%s is a complete distribution summing to 100', (difficulty) => {
        const weights = OUTCOME_WEIGHTS[difficulty];
        expect(Object.keys(weights).sort()).toEqual([...PLAYER_OUTCOMES].sort());
        expect(PLAYER_OUTCOMES.reduce((sum, o) => sum + weights[o], 0)).toBe(100);
    });

    it('has an entry for every difficulty the tool can send', () => {
        expect(Object.keys(OUTCOME_WEIGHTS).sort()).toEqual([...OUTCOME_DIFFICULTIES].sort());
    });

    it('never zeroes an outcome — no difficulty forecloses a result entirely', () => {
        for (const difficulty of OUTCOME_DIFFICULTIES) {
            for (const outcome of PLAYER_OUTCOMES) {
                expect(OUTCOME_WEIGHTS[difficulty][outcome]).toBeGreaterThan(0);
            }
        }
    });

    it('leans harder toward failure as the ladder gets harder', () => {
        const failWeight = (d: OutcomeDifficulty) =>
            OUTCOME_WEIGHTS[d].fail + OUTCOME_WEIGHTS[d].fail_with_consequence;
        // OUTCOME_DIFFICULTIES is ordered easiest to hardest, and this is what relies on it.
        const ladder = OUTCOME_DIFFICULTIES.map(failWeight);
        for (let i = 1; i < ladder.length; i++) {
            expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
        }
    });

    it('favours success on trivial and failure on impossible', () => {
        expect(OUTCOME_WEIGHTS.trivial.success).toBeGreaterThan(OUTCOME_WEIGHTS.trivial.fail);
        expect(OUTCOME_WEIGHTS.impossible.fail).toBeGreaterThan(OUTCOME_WEIGHTS.impossible.success);
    });

    it('is even at average — the label means "could go either way"', () => {
        const weights = OUTCOME_WEIGHTS.average;
        for (const outcome of PLAYER_OUTCOMES) {
            expect(weights[outcome]).toBe(25);
        }
    });
});

describe('pickWeightedOutcome', () => {
    it('is deterministic for a given rng', () => {
        // average is 25/25/25/25 over PLAYER_OUTCOMES in order, so each quarter of the range
        // selects exactly one bucket.
        const picks = [0, 0.3, 0.6, 0.9].map((v) => pickWeightedOutcome('average', () => v));
        expect(picks).toEqual([...PLAYER_OUTCOMES]);
    });

    it('returns the first bucket at the bottom of the range', () => {
        expect(pickWeightedOutcome('hard', () => 0)).toBe(PLAYER_OUTCOMES[0]);
    });

    it('returns a valid outcome at the very top of the range, not undefined', () => {
        // Math.random() never returns 1, but a caller-supplied rng might, and falling off the
        // end of the loop would hand the orchestrator `undefined` as an outcome.
        for (const difficulty of OUTCOME_DIFFICULTIES) {
            expect(PLAYER_OUTCOMES).toContain(pickWeightedOutcome(difficulty, () => 1));
        }
    });

    it('falls back to average weights for an unknown difficulty', () => {
        const unknown = 'moderate' as unknown as OutcomeDifficulty;
        expect(pickWeightedOutcome(unknown, () => 0.3)).toBe(pickWeightedOutcome('average', () => 0.3));
    });

    it.each(OUTCOME_DIFFICULTIES)('only ever returns one of the four outcomes (%s)', (difficulty) => {
        const rng = seq(0, 0.05, 0.2, 0.44, 0.5, 0.71, 0.88, 0.99);
        for (let i = 0; i < 8; i++) {
            expect(PLAYER_OUTCOMES).toContain(pickWeightedOutcome(difficulty, rng));
        }
    });

    it('actually skews with the difficulty over many draws', () => {
        // Deterministic sweep across the whole range rather than a real rng, so this cannot
        // flake: 100 evenly-spaced draws reproduce the distribution exactly.
        const share = (difficulty: OutcomeDifficulty, of: PlayerOutcome[]) => {
            let hits = 0;
            for (let i = 0; i < 100; i++) {
                if (of.includes(pickWeightedOutcome(difficulty, () => i / 100))) hits++;
            }
            return hits;
        };
        const fails: PlayerOutcome[] = ['fail', 'fail_with_consequence'];
        expect(share('trivial', fails)).toBe(10);
        expect(share('impossible', fails)).toBe(85);
    });
});
