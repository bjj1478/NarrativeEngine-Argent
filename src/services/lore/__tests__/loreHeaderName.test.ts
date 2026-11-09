import { describe, it, expect } from 'vitest';
import { chunkHeaderName } from '../loreHeaderName';

// chunkHeaderName is the one place a lore chunk header becomes an entity name. Every dialect
// below appears in a real lore file or in an existing parser test, so all four must hold.
describe('chunkHeaderName', () => {
    it('strips a `TYPE -- ` prefix (the lore_template.md format)', () => {
        expect(chunkHeaderName("LOCATION -- Emond's Field and the Two Rivers"))
            .toBe("Emond's Field and the Two Rivers");
        expect(chunkHeaderName('FACTION -- The Aes Sedai of the White Tower'))
            .toBe('The Aes Sedai of the White Tower');
    });

    it('strips a `TYPE — ` prefix written with an em or en dash', () => {
        expect(chunkHeaderName('LOCATION — Baerlon')).toBe('Baerlon');
        expect(chunkHeaderName('POWER_SYSTEM – The One Power')).toBe('The One Power');
    });

    it('strips the old bracketed `[CHUNK: TYPE]` marker and a trailing epithet', () => {
        expect(chunkHeaderName('[CHUNK: FACTION] The Crimson Hand — A Syndicate'))
            .toBe('The Crimson Hand');
    });

    it('returns a bare header unchanged', () => {
        expect(chunkHeaderName('Harbor District')).toBe('Harbor District');
        expect(chunkHeaderName('Guild')).toBe('Guild');
    });

    // The bug this helper exists to kill: the seeder's old inline regex only handled the
    // bracketed dialect, so `TYPE -- Name` headers seeded the literal type token into the
    // World Event pools ("FACTION", "in or around LOCATION").
    it('never returns the bare type token', () => {
        for (const h of ['LOCATION -- Baerlon', 'FACTION -- The Warders', 'EVENT -- The Breaking Arc']) {
            expect(chunkHeaderName(h)).not.toMatch(/^(LOCATION|FACTION|EVENT)$/);
        }
    });

    // The fallback splits on em/en dash only. Splitting on the plain hyphen too (as the
    // seeder's old copy did) would truncate every hyphenated name.
    it('keeps hyphenated names whole', () => {
        expect(chunkHeaderName('Jean-Luc Picard')).toBe('Jean-Luc Picard');
        expect(chunkHeaderName('CHARACTER -- Jean-Luc Picard')).toBe('Jean-Luc Picard');
    });

    it('tolerates an empty header', () => {
        expect(chunkHeaderName('')).toBe('');
    });
});
