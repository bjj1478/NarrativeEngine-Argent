/**
 * The default dice system is a Delta Green style percentile ladder: five skill
 * ratings, all d100, differing only in where the success threshold sits.
 *
 * Two things are worth locking down. First that every generated table is a
 * legal one — `validateBands` rejects any gap or overlap, and a rating whose
 * bands do not tile 1..100 silently yields `Unmapped` in the prompt. Second
 * that a campaign which predates the stored `diceSystem` is NOT dragged onto
 * the new ladder mid-play; that is the regression this file exists to catch.
 */
import { describe, it, expect } from 'vitest';
import {
    buildDefaultDiceSystem,
    buildLegacyDiceSystem,
    buildRatingBands,
    migrateLegacyContext,
    DEFAULT_RATING_ID,
    type GameContext,
} from '../gamecontext';
import { validateBands, mapTier } from '@narrative/engine';

const RATINGS: Record<string, number> = {
    BAD: 10, DECENT: 20, GOOD: 40, GREAT: 60, 'WORLD-CLASS': 80,
};

describe('default dice system — the percentile ladder', () => {
    it('ships exactly the five skill ratings, all d100', () => {
        const sys = buildDefaultDiceSystem();
        expect(sys.dieTypes.map(d => d.name)).toEqual(['BAD', 'DECENT', 'GOOD', 'GREAT', 'WORLD-CLASS']);
        for (const d of sys.dieTypes) expect(d.faces).toBe(100);
    });

    it('starts every category on DECENT', () => {
        const sys = buildDefaultDiceSystem();
        expect(sys.categories.map(c => c.name))
            .toEqual(['Combat', 'Perception', 'Stealth', 'Social', 'Movement', 'Knowledge']);
        for (const c of sys.categories) expect(c.dieTypeId).toBe(DEFAULT_RATING_ID);
        expect(sys.dieTypes.find(d => d.id === DEFAULT_RATING_ID)?.name).toBe('DECENT');
    });

    it('every rating tiles 1..100 with no gap or overlap', () => {
        for (const die of buildDefaultDiceSystem().dieTypes) {
            expect(validateBands(die.bands, die.faces)).toEqual({ valid: true });
        }
    });

    it('never emits a label the rules text does not describe', () => {
        const allowed = new Set(['Triumph', 'Success', 'Failure', 'Fumble']);
        for (const die of buildDefaultDiceSystem().dieTypes) {
            for (const b of die.bands) expect(allowed).toContain(b.label);
        }
    });
});

describe('buildRatingBands — the Delta Green rule', () => {
    it.each(Object.entries(RATINGS))('%s: at or under %d succeeds, above it fails', (name, threshold) => {
        const die = { id: 'x', name, faces: 100, bands: buildRatingBands(threshold) };
        // A non-double at or under the threshold succeeds; above it, fails.
        expect(mapTier(threshold, die)).toBe(threshold % 11 === 0 ? 'Triumph' : 'Success');
        expect(mapTier(threshold + 1, die)).toBe((threshold + 1) % 11 === 0 ? 'Fumble' : 'Failure');
    });

    it.each(Object.entries(RATINGS))('%s: doubles crit at or under, fumble above', (name, threshold) => {
        const die = { id: 'x', name, faces: 100, bands: buildRatingBands(threshold) };
        for (const double of [11, 22, 33, 44, 55, 66, 77, 88, 99]) {
            expect(mapTier(double, die)).toBe(double <= threshold ? 'Triumph' : 'Fumble');
        }
    });

    it.each(Object.entries(RATINGS))('%s: 01 always triumphs and 100 always fumbles', (name, threshold) => {
        const die = { id: 'x', name, faces: 100, bands: buildRatingBands(threshold) };
        expect(mapTier(1, die)).toBe('Triumph');
        expect(mapTier(100, die)).toBe('Fumble');
    });

    it('coalesces runs instead of emitting one band per face', () => {
        // 100 separate bands would validate, but would be unreadable in the
        // Engines tab and pointless to store.
        expect(buildRatingBands(20).length).toBeLessThan(25);
    });
});

describe('legacy saves keep the system they were played on', () => {
    it('a save carrying its own diceSystem is returned untouched', () => {
        const mine = buildDefaultDiceSystem();
        mine.categories[0].dieTypeId = 'dt_world_class';
        const out = migrateLegacyContext({ diceSystem: mine } as Partial<GameContext>);
        expect(out.diceSystem).toBe(mine);
        expect(out.diceSystem.categories[0].dieTypeId).toBe('dt_world_class');
    });

    it('a save with only a legacy diceConfig lands on d20, not the new ladder', () => {
        const out = migrateLegacyContext({
            diceConfig: { catastrophe: 2, failure: 6, success: 15, triumph: 19, crit: 20 },
        } as Partial<GameContext>);

        const d20 = out.diceSystem.dieTypes.find(d => d.id === 'dt_d20');
        expect(d20, 'legacy campaigns must still get a d20').toBeDefined();
        expect(out.diceSystem.categories.every(c => c.dieTypeId === 'dt_d20')).toBe(true);
        expect(mapTier(1, d20!)).toBe('Catastrophe');
        expect(mapTier(20, d20!)).toBe('Narrative Boon');
    });

    it('carries the old thresholds across rather than resetting them', () => {
        const out = migrateLegacyContext({
            diceConfig: { catastrophe: 4, failure: 9, success: 14, triumph: 18, crit: 20 },
        } as Partial<GameContext>);
        const d20 = out.diceSystem.dieTypes.find(d => d.id === 'dt_d20')!;
        expect(mapTier(4, d20)).toBe('Catastrophe');
        expect(mapTier(5, d20)).toBe('Failure');
        expect(mapTier(14, d20)).toBe('Success');
        expect(mapTier(18, d20)).toBe('Triumph');
    });

    it('a save with neither still gets the legacy set, never the new one', () => {
        const out = migrateLegacyContext({} as Partial<GameContext>);
        expect(out.diceSystem.dieTypes.map(d => d.name)).toEqual(buildLegacyDiceSystem().dieTypes.map(d => d.name));
    });
});
