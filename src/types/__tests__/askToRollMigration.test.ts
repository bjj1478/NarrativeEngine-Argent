import { describe, it, expect } from 'vitest';
import { migrateLegacyContext } from '../gamecontext';
import type { GameContext } from '../gamecontext';

/**
 * `diceFairnessActive` changed meaning when the three dice modes collapsed to two: it used to
 * select the engine-pre-rolled `[DICE OUTCOMES]` pool, it now selects player-rolled resolution.
 *
 * The field is REQUIRED on GameContext, so every save on disk carries an explicit value that
 * wins the `{...base, ...ctx}` spread — a changed default cannot reach existing campaigns. The
 * migration is the only thing that can, which is why it gets its own tests.
 */
const ctx = (over: Record<string, unknown>) => migrateLegacyContext(over as Partial<GameContext>);

describe('Ask To Roll migration', () => {
    it('carries a fork-era player-roll campaign to ON', () => {
        // How "player rolls, ON" was stored for the few days the flag existed. Read literally
        // under the new semantics this says "no dice", so without the migration the campaign
        // silently loses dice — this is the case that actually exists on disk.
        const out = ctx({ diceFairnessActive: false, playerRollActive: true });
        expect(out.diceFairnessActive).toBe(true);
    });

    it('leaves a pre-fork pool-mode campaign ON', () => {
        // `true` already reads as ON under the new meaning; nothing to do.
        expect(ctx({ diceFairnessActive: true }).diceFairnessActive).toBe(true);
    });

    it('leaves a deliberate engine-rolled campaign OFF', () => {
        // `false` + `playerRollActive: false` was the legacy engine-rolled mode. The engine no
        // longer rolls on the model's behalf, so no-dice is the honest outcome rather than
        // silently promoting it to a mode the player never chose.
        const out = ctx({ diceFairnessActive: false, playerRollActive: false });
        expect(out.diceFairnessActive).toBe(false);
    });

    it('drops the superseded flag so a stale value cannot be mistaken for a live setting', () => {
        const out = ctx({ diceFairnessActive: false, playerRollActive: true });
        expect('playerRollActive' in out).toBe(false);
    });

    it('is idempotent — a second pass cannot flip an OFF back on', () => {
        // Self-limiting by construction: the condition reads `playerRollActive` and the
        // migration deletes it, so the flip cannot re-fire. This matters because
        // campaignSlice re-runs the migration on EVERY updateContext, not just on load.
        const once = ctx({ diceFairnessActive: false, playerRollActive: true });
        expect(once.diceFairnessActive).toBe(true);

        const off = ctx({ ...once, diceFairnessActive: false });
        expect(off.diceFairnessActive).toBe(false);
        expect(ctx({ ...off }).diceFairnessActive).toBe(false);
    });

    it('defaults a brand-new empty context to ON', () => {
        expect(ctx({}).diceFairnessActive).toBe(true);
    });
});
