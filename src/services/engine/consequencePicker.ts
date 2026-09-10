/**
 * Draws a consequence from the campaign's authored list for the outcome modal.
 *
 * `context.consequences` is authored in Engine Tuning and seeded from the lore file's consequence
 * tables (`loreEngineSeeder.ts`). This is its first consumer: before it, the list was written,
 * lore-seeded, AI-populatable — and read by nothing.
 *
 * The engine only DRAWS. The player sees the draw, can reroll it, and can overwrite it entirely,
 * so nothing here gets the last word on the fiction; and because a consequence is drawn rather
 * than invented, the model does not get to make one up from nothing either.
 *
 * Sibling of `outcomeWeights.ts` and deliberately the same shape: pure, `rng` injectable so the
 * caller and the tests can be deterministic.
 */

/**
 * One consequence at random, or `''` when there is nothing to draw.
 *
 * `exclude` is what makes the reroll button feel like it works — with two or more entries a
 * reroll must not hand back the string already in the field. With exactly one entry it returns
 * that entry regardless: rerolling a one-item list is a no-op, and an empty field would read as
 * a bug rather than as "there is only one".
 */
export function pickRandomConsequence(
    consequences: string[] | undefined,
    rng: () => number = Math.random,
    exclude?: string,
): string {
    const pool = (consequences ?? []).map(c => c.trim()).filter(Boolean);
    if (pool.length === 0) return '';
    if (pool.length === 1) return pool[0];

    const candidates = exclude ? pool.filter(c => c !== exclude) : pool;
    // Every entry matched `exclude` (a list of duplicates). Fall back to the whole pool rather
    // than returning '' — the field having content is more useful than punishing the data.
    const from = candidates.length > 0 ? candidates : pool;
    // `Math.min` guards the degenerate `rng() === 1` case, which would index off the end.
    return from[Math.min(from.length - 1, Math.floor(rng() * from.length))];
}
