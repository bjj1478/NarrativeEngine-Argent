// The consequence draw behind the outcome modal's Consequence field. `context.consequences` is
// hand-authored and lore-seeded, so the properties worth locking are the ones that protect the
// player's data: never invent, never return something that is not in the list, and never hand
// back an empty field when the list has entries.
import { describe, it, expect } from 'vitest';
import { pickRandomConsequence } from '../consequencePicker';

const LIST = [
    'Noise — Not discovery, attention. A patrol changes its route.',
    'Trace — You are through, but you left something.',
    'Time — It works, but it took longer than you had.',
];

describe('pickRandomConsequence', () => {
    it('returns an empty string when the campaign has no list', () => {
        expect(pickRandomConsequence([])).toBe('');
        expect(pickRandomConsequence(undefined)).toBe('');
    });

    it('treats a list of blanks as empty rather than drawing whitespace', () => {
        expect(pickRandomConsequence(['', '   ', '\n'])).toBe('');
    });

    it('trims entries so a stray newline never reaches the prompt', () => {
        expect(pickRandomConsequence(['  Noise — a patrol turns.  '])).toBe('Noise — a patrol turns.');
    });

    it('only ever returns a member of the list', () => {
        for (let i = 0; i < 30; i++) {
            expect(LIST).toContain(pickRandomConsequence(LIST));
        }
    });

    it('is deterministic under an injected rng', () => {
        expect(pickRandomConsequence(LIST, () => 0)).toBe(LIST[0]);
        expect(pickRandomConsequence(LIST, () => 0.5)).toBe(LIST[1]);
        expect(pickRandomConsequence(LIST, () => 0.9)).toBe(LIST[2]);
    });

    it('stays in range at the very top of the rng range, rather than returning undefined', () => {
        // Math.random() never returns 1, but a caller-supplied rng might, and indexing off the
        // end would put `undefined` into the field and from there into the prompt.
        expect(LIST).toContain(pickRandomConsequence(LIST, () => 1));
    });

    describe('reroll (the `exclude` argument)', () => {
        it('never returns the entry already in the field', () => {
            for (const current of LIST) {
                for (const v of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
                    expect(pickRandomConsequence(LIST, () => v, current)).not.toBe(current);
                }
            }
        });

        it('still returns a real entry when excluding', () => {
            const got = pickRandomConsequence(LIST, () => 0, LIST[0]);
            expect(LIST).toContain(got);
        });

        // Rerolling a one-item list is a no-op and should read as one. Blanking the field
        // instead would look like the feature broke.
        it('returns the only entry even when it is the excluded one', () => {
            expect(pickRandomConsequence([LIST[0]], Math.random, LIST[0])).toBe(LIST[0]);
        });

        it('falls back to the whole pool when every entry is excluded', () => {
            // A list of duplicates. Returning '' here would punish the data rather than the bug.
            const dupes = ['Same cost.', 'Same cost.'];
            expect(pickRandomConsequence(dupes, () => 0, 'Same cost.')).toBe('Same cost.');
        });

        it('ignores an exclude that is not in the list', () => {
            expect(LIST).toContain(pickRandomConsequence(LIST, () => 0, 'something the player typed'));
        });
    });
});
