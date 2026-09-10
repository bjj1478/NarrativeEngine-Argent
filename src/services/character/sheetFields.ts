import type { PlayerCharacter } from '../../types';

/**
 * Which parts of the player-character record the Sheet tab authors.
 *
 * The Sheet's form state is seeded from the WHOLE PC record, so saving it used to write
 * the whole record back — and any background write that landed while the panel was open
 * was silently undone by a snapshot taken when it opened. `activeTraits` was the sharpest
 * case: the trait scan maintains it every bookkeeping interval, and the Sheet never shows
 * it, so a save could only ever roll it backwards.
 *
 * This lives outside the component so it can be tested directly, and because exporting a
 * helper from a `.tsx` component module breaks fast refresh.
 */

/**
 * Every field `PCEditForm` binds an input to. Anything absent is engine-owned and must
 * never travel in a Sheet save: `activeTraits` (trait scan), `legacyNotes` (frozen
 * storage), `pcMeta`, and the agency state — `relationMeter`, `pressure`, `goalRecords`,
 * `agencyActivity`, `skillRung`, `lastUpdateScene`.
 */
const SHEET_OWNED_FIELDS = [
    'name', 'status', 'condition', 'tier', 'faction', 'aliases', 'storyRelevance',
    'disposition', 'personality', 'voice', 'exampleOutput', 'signatureKit', 'traits',
    'personalityHex', 'wants', 'region', 'haunt', 'relations', 'behavioralTriggers',
    'hardBoundaries', 'softBoundaries', 'appearance', 'visualProfile', 'portrait',
] as const satisfies readonly (keyof PlayerCharacter)[];

/**
 * Narrow a Sheet form snapshot to the fields that tab authors, so a save patches instead
 * of replacing. Keys the user never touched are still sent — they carry the values the
 * form loaded — but every one of them is a field the Sheet is the rightful author of.
 *
 * Absent keys stay absent rather than becoming an explicit `undefined`: the patch is
 * applied with a spread, so writing `undefined` would erase the stored value.
 */
export function pickSheetFields(form: Partial<PlayerCharacter>): Partial<PlayerCharacter> {
    const patch: Partial<PlayerCharacter> = {};
    for (const key of SHEET_OWNED_FIELDS) {
        if (key in form) {
            // Index-assignment across a heterogeneous key union; the list is constrained to
            // `keyof PlayerCharacter` by the `satisfies` above.
            (patch as Record<string, unknown>)[key] = form[key];
        }
    }
    return patch;
}
