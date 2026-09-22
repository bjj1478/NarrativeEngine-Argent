import { describe, it, expect } from 'vitest';
import { resolveManualRoll } from '../engineRolls';
import { buildDefaultDiceSystem, buildLegacyDiceSystem } from '../../../types';
import type { DiceSystemConfig, ManualRollRequest } from '../../../types';

const SYS: DiceSystemConfig = buildDefaultDiceSystem();
// The default system is a percentile ladder, so the die under test is a skill
// rating rather than a polyhedral. The gate mechanics below are the same either
// way — that is the point of these tests.
const rating = SYS.dieTypes.find(d => d.id === 'dt_decent')!;

const LEGACY: DiceSystemConfig = buildLegacyDiceSystem();

describe('resolveManualRoll — generalized 3-gate', () => {
    it('none: rolls exactly one die and maps to a tier', () => {
        const req: ManualRollRequest = { dieTypeId: rating.id, rollDef: { modifier: 'none', count: 1, aggregation: 'pick_one' } };
        const r = resolveManualRoll(req, SYS);
        expect(r.rolls).toHaveLength(1);
        expect(r.faceValue).toBe(r.rolls[0]);
        expect(r.tier).toBeTypeOf('string');
        expect(r.tier!.length).toBeGreaterThan(0);
    });

    it('adv: rolls two dice and takes the higher', () => {
        const req: ManualRollRequest = { dieTypeId: rating.id, rollDef: { modifier: 'adv', count: 2, aggregation: 'pick_one' } };
        const r = resolveManualRoll(req, SYS);
        expect(r.rolls).toHaveLength(2);
        expect(r.faceValue).toBe(Math.max(r.rolls[0], r.rolls[1]));
    });

    it('disadv: rolls two dice and takes the lower', () => {
        const req: ManualRollRequest = { dieTypeId: rating.id, rollDef: { modifier: 'disadv', count: 2, aggregation: 'pick_one' } };
        const r = resolveManualRoll(req, SYS);
        expect(r.rolls).toHaveLength(2);
        expect(r.faceValue).toBe(Math.min(r.rolls[0], r.rolls[1]));
    });

    it('faceValue is always 1..100 for a rating', () => {
        const req: ManualRollRequest = { dieTypeId: rating.id, rollDef: { modifier: 'none', count: 1, aggregation: 'pick_one' } };
        for (let i = 0; i < 50; i++) {
            const r = resolveManualRoll(req, SYS);
            expect(r.faceValue).toBeGreaterThanOrEqual(1);
            expect(r.faceValue).toBeLessThanOrEqual(100);
        }
    });

    it('maps 100 to Fumble (the top of the ladder is the worst result)', () => {
        const orig = Math.random;
        Math.random = () => 0.9999;
        try {
            const req: ManualRollRequest = { dieTypeId: rating.id, rollDef: { modifier: 'none', count: 1, aggregation: 'pick_one' } };
            const r = resolveManualRoll(req, SYS);
            expect(r.faceValue).toBe(100);
            expect(r.tier).toBe('Fumble');
        } finally {
            Math.random = orig;
        }
    });

    it('maps 01 to Triumph', () => {
        const orig = Math.random;
        Math.random = () => 0.0;
        try {
            const req: ManualRollRequest = { dieTypeId: rating.id, rollDef: { modifier: 'none', count: 1, aggregation: 'pick_one' } };
            const r = resolveManualRoll(req, SYS);
            expect(r.faceValue).toBe(1);
            expect(r.tier).toBe('Triumph');
        } finally {
            Math.random = orig;
        }
    });

    it('names the die by notation and rating, not by concatenation', () => {
        // `${count}${name}` used to render this as "1DECENT", which reached both
        // the [RESOLVED ROLL] prompt tag and the player's own chat bubble.
        const req: ManualRollRequest = { dieTypeId: rating.id, rollDef: { modifier: 'none', count: 1, aggregation: 'pick_one' } };
        expect(resolveManualRoll(req, SYS).detail).toBe('1d100 (DECENT)');
    });

    it('total_all: sums the dice and ignores modifier', () => {
        const req: ManualRollRequest = { dieTypeId: rating.id, rollDef: { modifier: 'adv', count: 3, aggregation: 'total_all' } };
        const orig = Math.random;
        Math.random = () => 0.5; // each die = 51
        try {
            const r = resolveManualRoll(req, SYS);
            expect(r.rolls).toHaveLength(3);
            expect(r.faceValue).toBe(153); // 51+51+51
        } finally {
            Math.random = orig;
        }
    });
});

describe('resolveManualRoll — a legacy campaign keeps its polyhedrals', () => {
    it('d6 die type: faceValue is 1..6', () => {
        const d6 = LEGACY.dieTypes.find(d => d.name === 'd6')!;
        const req: ManualRollRequest = { dieTypeId: d6.id, rollDef: { modifier: 'none', count: 1, aggregation: 'pick_one' } };
        for (let i = 0; i < 50; i++) {
            const r = resolveManualRoll(req, LEGACY);
            expect(r.faceValue).toBeGreaterThanOrEqual(1);
            expect(r.faceValue).toBeLessThanOrEqual(6);
        }
    });

    it('d6 maps a 6 to Success (top band)', () => {
        const d6 = LEGACY.dieTypes.find(d => d.name === 'd6')!;
        const orig = Math.random;
        Math.random = () => 0.9999;
        try {
            const req: ManualRollRequest = { dieTypeId: d6.id, rollDef: { modifier: 'none', count: 1, aggregation: 'pick_one' } };
            const r = resolveManualRoll(req, LEGACY);
            expect(r.faceValue).toBe(6);
            expect(r.tier).toBe('Success');
        } finally {
            Math.random = orig;
        }
    });

    it('a die whose name IS its notation is not annotated twice', () => {
        const d20 = LEGACY.dieTypes.find(d => d.name === 'd20')!;
        const req: ManualRollRequest = { dieTypeId: d20.id, rollDef: { modifier: 'none', count: 1, aggregation: 'pick_one' } };
        expect(resolveManualRoll(req, LEGACY).detail).toBe('1d20');
    });
});

describe('resolveManualRoll — legacy string modes', () => {
    it('falls back gracefully when diceSystem is null', () => {
        const r = resolveManualRoll('1d20', null);
        expect(r.tier).toBeTypeOf('string');
        expect(r.faceValue).toBeGreaterThanOrEqual(1);
        expect(r.faceValue).toBeLessThanOrEqual(20);
    });

    it('legacy string adv mode still works', () => {
        const r = resolveManualRoll('adv', SYS);
        expect(r.rolls).toHaveLength(2);
        expect(r.faceValue).toBe(Math.max(r.rolls[0], r.rolls[1]));
        expect(r.detail).toBe('Advantage');
    });

    it('resolves against the campaign\'s own d20 rather than a baked-in copy', () => {
        // The lookup used to key on the die being NAMED "d20". A campaign that
        // renames it — or has none at all — silently got the hardcoded table
        // instead of its own bands.
        const custom = buildLegacyDiceSystem();
        const d20 = custom.dieTypes.find(d => d.id === 'dt_d20')!;
        d20.name = 'Percentile-ish';
        d20.bands = [{ id: 'only', label: 'OnlyBand', min: 1, max: 20 }];

        expect(resolveManualRoll('1d20', custom).tier).toBe('OnlyBand');
    });
});
