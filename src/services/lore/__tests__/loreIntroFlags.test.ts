import { describe, it, expect } from 'vitest';
import { parseIntroFlagsFromLore } from '../loreIntroFlags';
import type { LoreChunk } from '../../../types';

const chunk = (over: Partial<LoreChunk>): LoreChunk => ({
    id: 'c1', header: '', content: '', tokens: 0, alwaysInclude: false,
    triggerKeywords: [], scanDepth: 3, category: 'character', linkedEntities: [], priority: 3,
    ...over,
} as LoreChunk);

describe('parseIntroFlagsFromLore', () => {
    it('reads the flags off a real lore block (value inside the bold)', () => {
        const c = chunk({
            header: 'CHARACTER -- Special Agent Diana Reyes',
            content: '**Status:** Alive\n**Wandering: true**\n**Intro Boost: FBI, federal, investigation**',
        });
        expect(parseIntroFlagsFromLore([c])).toEqual([{
            name: 'Special Agent Diana Reyes',
            type: 'wandering',
            boostKeywords: ['FBI', 'federal', 'investigation'],
        }]);
    });

    it('accepts the other bold dialect, with the value outside', () => {
        const c = chunk({ header: 'CHARACTER -- Mira', content: '**Wandering:** true' });
        expect(parseIntroFlagsFromLore([c])).toEqual([{ name: 'Mira', type: 'wandering' }]);
    });

    it('a Location line makes the entry location-bound', () => {
        const c = chunk({ header: 'CHARACTER -- Innkeeper Bran', content: '**Location: Baerlon**' });
        expect(parseIntroFlagsFromLore([c])).toEqual([
            { name: 'Innkeeper Bran', type: 'location', location: 'Baerlon' },
        ]);
    });

    it('unwraps the template\'s bracketed values', () => {
        const c = chunk({
            header: 'CHARACTER -- Tam',
            content: '**Location: [The Winespring Inn]**\n**Intro Boost: [ale, rumour]**',
        });
        expect(parseIntroFlagsFromLore([c])).toEqual([
            { name: 'Tam', type: 'location', location: 'The Winespring Inn', boostKeywords: ['ale', 'rumour'] },
        ]);
    });

    // CharacterIntroEntry['type'] is a two-value union, so one of them has to win. Location is
    // the more specific claim, so it does.
    it('Location wins when a file sets both flags', () => {
        const c = chunk({ header: 'CHARACTER -- Both', content: '**Wandering: true**\n**Location: Caemlyn**' });
        expect(parseIntroFlagsFromLore([c])[0]).toEqual({ name: 'Both', type: 'location', location: 'Caemlyn' });
    });

    it('a character with no intro flags stays out of the pool', () => {
        const c = chunk({ header: 'CHARACTER -- Nobody', content: '**Status:** Alive\n**Goals:** survive' });
        expect(parseIntroFlagsFromLore([c])).toEqual([]);
    });

    it('a boost with no Wandering/Location line is not enough on its own', () => {
        const c = chunk({ header: 'CHARACTER -- Ghost', content: '**Intro Boost: shadow, knife**' });
        expect(parseIntroFlagsFromLore([c])).toEqual([]);
    });

    it('ignores non-character chunks', () => {
        const c = chunk({ category: 'location', header: 'LOCATION -- Baerlon', content: '**Wandering: true**' });
        expect(parseIntroFlagsFromLore([c])).toEqual([]);
    });

    it('dedupes by name, first occurrence winning', () => {
        const a = chunk({ id: 'a', header: 'CHARACTER -- Mat', content: '**Wandering: true**' });
        const b = chunk({ id: 'b', header: 'CHARACTER -- mat', content: '**Location: Ebou Dar**' });
        expect(parseIntroFlagsFromLore([a, b])).toEqual([{ name: 'Mat', type: 'wandering' }]);
    });
});
