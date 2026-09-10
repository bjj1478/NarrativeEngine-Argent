import { PLAYER_OUTCOMES } from '../../types';
import type { OutcomeDifficulty, PlayerOutcome } from '../../types';

/**
 * The "Decide for me" fallback behind the outcome modal.
 *
 * Argent's non-goals forbid the engine resolving for the player "beyond an explicit opt-in
 * fallback" — this is that fallback and nothing more. It exists because the modal has no dice
 * expression to roll any more: the old button rolled the stated NdM locally, and with the die
 * gone there was nothing left for a player with no dice to hand to press.
 *
 * The difficulty the GM already committed to is the only input. That matters: the weights are
 * read off a label chosen BEFORE the GM could see the answer, so this path cannot be steered
 * any more than the manual one can.
 *
 * Kept in src/services/engine/ rather than packages/engine/ on purpose. The shared package is
 * consumed by the mobile app, which has no ask-for-outcome path at all, and its boundary gate
 * exists to stop app-only concerns leaking into it.
 */
export const OUTCOME_WEIGHTS: Record<OutcomeDifficulty, Record<PlayerOutcome, number>> = {
    trivial:    { fail:  5, fail_with_consequence:  5, success_with_consequence: 25, success: 65 },
    easy:       { fail: 12, fail_with_consequence: 13, success_with_consequence: 25, success: 50 },
    average:    { fail: 25, fail_with_consequence: 25, success_with_consequence: 25, success: 25 },
    hard:       { fail: 35, fail_with_consequence: 30, success_with_consequence: 20, success: 15 },
    impossible: { fail: 55, fail_with_consequence: 30, success_with_consequence: 10, success:  5 },
};

/**
 * Picks one outcome at random, weighted by the stated difficulty.
 *
 * `rng` is injectable so the caller — and the tests — can be deterministic. It must return
 * a value in [0, 1); the final bucket also catches the degenerate `rng() === 1` case rather
 * than falling off the end and returning undefined.
 */
export function pickWeightedOutcome(
    difficulty: OutcomeDifficulty,
    rng: () => number = Math.random,
): PlayerOutcome {
    const weights = OUTCOME_WEIGHTS[difficulty] ?? OUTCOME_WEIGHTS.average;
    const total = PLAYER_OUTCOMES.reduce((sum, o) => sum + weights[o], 0);
    let roll = rng() * total;
    for (const outcome of PLAYER_OUTCOMES) {
        roll -= weights[outcome];
        if (roll < 0) return outcome;
    }
    return PLAYER_OUTCOMES[PLAYER_OUTCOMES.length - 1];
}
