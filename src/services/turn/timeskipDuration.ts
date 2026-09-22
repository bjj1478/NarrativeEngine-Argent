import { ticksForDuration } from '../npc/agency/agencyTimeskip';

/**
 * Duration units the Skip Time picker offers.
 */
export type TimeskipUnit = 'days' | 'weeks' | 'months' | 'years';

export const TIMESKIP_UNITS: readonly TimeskipUnit[] = ['days', 'weeks', 'months', 'years'];

/**
 * Weeks per unit. Deliberately the same constants the phrase detector already
 * uses (`agencyTimeskipRun.ts` — months `× 4.345`, years `× 52`, days `/ 7`), so a
 * skip picked from the UI and the same skip typed as a phrase resolve identically.
 */
const WEEKS_PER_UNIT: Record<TimeskipUnit, number> = {
    days: 1 / 7,
    weeks: 1,
    months: 4.345,
    years: 52,
};

export type TimeskipDuration = {
    /** Whole in-world days, for `context.worldDay`. */
    readonly days: number;
    /** Fractional weeks, for the agency simulation curve. */
    readonly weeks: number;
    /** Simulation tick budget — the shared currency between the NPC and arc engines. */
    readonly ticks: number;
};

/**
 * Convert a picked amount + unit into every representation the turn needs.
 *
 * All three are derived here, once, rather than at each call site: `days` advances
 * the calendar, `weeks` drives `ticksForDuration`, and `ticks` is handed to both the
 * NPC simulation and the arc mod. Recomputing any of them downstream is how the two
 * clocks drifted apart in the first place.
 *
 * `ticks` is computed at ARM time on purpose. The arc compute track runs before the
 * agency track on a skip turn (`postTurnPipeline.ts` awaits the post-turn tracks
 * before starting the sequential ones), so a count read out of `runTimeskip`'s result
 * would not exist yet and arcs would react a turn late.
 */
export function timeskipDuration(amount: number, unit: TimeskipUnit): TimeskipDuration {
    if (!Number.isFinite(amount) || amount <= 0) return { days: 0, weeks: 0, ticks: 0 };
    const weeks = amount * WEEKS_PER_UNIT[unit];
    return {
        days: Math.max(1, Math.round(weeks * 7)),
        weeks,
        ticks: ticksForDuration(weeks),
    };
}

/**
 * The phrase form of a picked duration, e.g. `3 months later`.
 *
 * Chosen to match the existing `TIMESKIP_PATTERNS` table: the armed state is what
 * actually drives the skip, so this is belt-and-braces — if the armed path ever
 * fails, the message still reads naturally and the legacy detector still catches it.
 */
export function timeskipPhrase(amount: number, unit: TimeskipUnit): string {
    const rounded = Number.isInteger(amount) ? String(amount) : String(amount);
    const noun = amount === 1 ? unit.replace(/s$/, '') : unit;
    return `${rounded} ${noun} later.`;
}
