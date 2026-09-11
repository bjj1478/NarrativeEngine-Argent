import { describe, expect, it } from 'vitest';
import { timeskipDuration, timeskipPhrase, TIMESKIP_UNITS } from '../timeskipDuration';
import { detectTimeskip } from '../../npc/agency/agencyTimeskipRun';
import { ticksForDuration } from '../../npc/agency/agencyTimeskip';

describe('timeskipDuration', () => {
    it('converts each unit to the weeks the phrase detector uses', () => {
        // Same constants as TIMESKIP_PATTERNS, so a picked skip and the same skip
        // typed by hand resolve identically.
        expect(timeskipDuration(7, 'days').weeks).toBeCloseTo(1, 5);
        expect(timeskipDuration(1, 'weeks').weeks).toBe(1);
        expect(timeskipDuration(1, 'months').weeks).toBeCloseTo(4.345, 5);
        expect(timeskipDuration(1, 'years').weeks).toBe(52);
    });

    it('keeps days and weeks in agreement', () => {
        for (const unit of TIMESKIP_UNITS) {
            for (const amount of [1, 3, 12]) {
                const d = timeskipDuration(amount, unit);
                expect(d.days).toBe(Math.max(1, Math.round(d.weeks * 7)));
            }
        }
    });

    it('derives ticks from the same curve the agency engine spends', () => {
        for (const unit of TIMESKIP_UNITS) {
            for (const amount of [1, 5, 40]) {
                const d = timeskipDuration(amount, unit);
                expect(d.ticks).toBe(ticksForDuration(d.weeks));
            }
        }
    });

    it('never yields a zero-day skip for a positive amount', () => {
        // "1 day later" is 1/7 of a week — it must still move the calendar by a day
        // even though the simulation curve rounds its tick budget to zero.
        const oneDay = timeskipDuration(1, 'days');
        expect(oneDay.days).toBe(1);
        expect(oneDay.ticks).toBe(0);
    });

    it('returns an empty duration for a non-positive or non-finite amount', () => {
        for (const bad of [0, -3, NaN, Infinity]) {
            expect(timeskipDuration(bad, 'weeks')).toEqual({ days: 0, weeks: 0, ticks: 0 });
        }
    });
});

describe('timeskipPhrase', () => {
    it('singularises the unit at one', () => {
        expect(timeskipPhrase(1, 'weeks')).toBe('1 week later.');
        expect(timeskipPhrase(3, 'weeks')).toBe('3 weeks later.');
        expect(timeskipPhrase(1, 'months')).toBe('1 month later.');
    });

    it('produces a phrase the legacy detector still recognises', () => {
        // Belt-and-braces: the armed state drives the skip, but if that path ever
        // broke the composed message should degrade to today's behaviour, not to
        // nothing. Every unit the picker offers must round-trip.
        for (const unit of TIMESKIP_UNITS) {
            for (const amount of [1, 3]) {
                const detected = detectTimeskip(timeskipPhrase(amount, unit));
                expect(detected, `${amount} ${unit}`).not.toBeNull();
                expect(detected && 'weeks' in detected ? detected.weeks : 0)
                    .toBeCloseTo(timeskipDuration(amount, unit).weeks, 3);
            }
        }
    });
});
