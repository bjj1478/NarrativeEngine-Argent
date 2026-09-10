import { describe, it, expect } from 'vitest';
import { pickSheetFields } from '../../../services/character/sheetFields';
import type { PlayerCharacter, CharacterTrait } from '../../../types';

/**
 * The Sheet tab authors part of the PC record; background tracks author the rest. Its form
 * state is seeded from the WHOLE record, so a save used to write the whole record back —
 * meaning any background write that landed while the panel was open was silently undone.
 */

const trait = (id: string): CharacterTrait => ({
    id, subject: 'Sabrita', category: 'party_facts', text: 'Fled the coven at seventeen.',
    importance: 7, eventTags: [], sceneEstablished: '004', superseded: false, source: 'llm',
});

const fullRecord = (): Partial<PlayerCharacter> => ({
    id: 'pc1',
    name: 'Sabrita',
    status: 'Alive',
    condition: 'gash across the left forearm',
    appearance: 'lean, dark-haired',
    faction: 'none',
    signatureKit: { equipment: ['Belt Knife'], abilities: [] },
    // Engine-owned — present in `form` only because it was seeded from the record.
    activeTraits: [trait('t1')],
    legacyNotes: 'frozen blob from an upgrade',
    pcMeta: { archetype: 'hedge-witch' },
    relationMeter: 3,
    skillRung: 2,
    lastUpdateScene: 12,
});

describe('pickSheetFields', () => {
    it('keeps every field the Sheet form actually edits', () => {
        const patch = pickSheetFields(fullRecord());
        expect(patch.name).toBe('Sabrita');
        expect(patch.status).toBe('Alive');
        expect(patch.condition).toBe('gash across the left forearm');
        expect(patch.appearance).toBe('lean, dark-haired');
        expect(patch.signatureKit).toEqual({ equipment: ['Belt Knife'], abilities: [] });
    });

    it('never carries the narrative record the trait scan owns', () => {
        // The regression this exists for: the trait scan writes `activeTraits` in the
        // background, and a Sheet save with a stale snapshot would roll it back.
        const patch = pickSheetFields(fullRecord());
        expect(patch).not.toHaveProperty('activeTraits');
    });

    it('never carries engine-owned or frozen state', () => {
        const patch = pickSheetFields(fullRecord());
        for (const key of ['legacyNotes', 'pcMeta', 'relationMeter', 'skillRung', 'lastUpdateScene', 'id']) {
            expect(patch).not.toHaveProperty(key);
        }
    });

    it('omits keys the form never had rather than writing undefined over them', () => {
        // A patch is merged with a spread, so an explicit `undefined` would erase the
        // stored value. Absent keys must stay absent.
        const patch = pickSheetFields({ name: 'Sabrita' });
        expect(Object.keys(patch)).toEqual(['name']);
    });

    it('passes an emptied condition through, because that is how a wound is cleared', () => {
        const patch = pickSheetFields({ ...fullRecord(), condition: '' });
        expect(patch.condition).toBe('');
        expect('condition' in patch).toBe(true);
    });
});
