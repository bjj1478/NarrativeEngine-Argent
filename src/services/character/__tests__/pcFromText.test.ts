import { describe, it, expect } from 'vitest';
import type { PlayerCharacter } from '../../../types';
import { parsePCFromText, extractPCFromText, buildPCFromTextPrompt } from '../pcFromText';
import { TRAIT_VOCAB } from '../../npc/agency/agencyPools';

function basePc(overrides: Partial<PlayerCharacter> = {}): PlayerCharacter {
    return {
        id: 'pc-1', name: 'Aria', aliases: '', appearance: 'short', faction: 'Wardens', storyRelevance: '',
        disposition: 'Curious', status: 'Alive', goals: '', voice: 'quick', personality: 'restless', exampleOutput: '',
        affinity: 50, isPC: true,
        personalityHex: { drive: 1, diligence: 1, boldness: 1, warmth: 1, empathy: 1, composure: 1 },
        traits: ['loyal'],
        wants: { short: ['eat'], medium: ['find the map'], long: 'reach the sea' },
        ...overrides,
    } as PlayerCharacter;
}

const defaultTraits = TRAIT_VOCAB.filter(t => t.tier === 'default').map(t => t.text);
const matureTrait = TRAIT_VOCAB.find(t => t.tier === 'mature')?.text;

describe('parsePCFromText — create mode', () => {
    it('clamps read hex axes and zero-fills the rest with no heuristic', () => {
        const patch = parsePCFromText({ name: 'Kael', personalityHex: { boldness: 9, empathy: -7, warmth: 1.4 } });
        expect(patch.personalityHex).toEqual({ drive: 0, diligence: 0, boldness: 3, warmth: 1, empathy: -3, composure: 0 });
    });

    it('leaves the hex unset when the text grounds no axes', () => {
        const patch = parsePCFromText({ name: 'Kael', personality: 'brave, kind, calm and driven' });
        expect(patch).not.toHaveProperty('personalityHex');
    });

    it('filters traits to the controlled vocabulary, maturity gate and cap', () => {
        const traits = ['not-a-trait', defaultTraits[0].toUpperCase(), ...(matureTrait ? [matureTrait] : []), ...defaultTraits.slice(1, 8)];
        const patch = parsePCFromText({ name: 'Kael', traits }, { matureMode: false });
        expect(patch.traits?.[0]).toBe(defaultTraits[0]);
        expect(patch.traits).toHaveLength(5);
        if (matureTrait) expect(patch.traits).not.toContain(matureTrait);
    });

    it('sets PC defaults and never writes engine-owned fields', () => {
        const patch = parsePCFromText({
            name: 'Kael', affinity: 5, pcRelation: 2, drives: { coreWant: 'x' },
            wants: { short: ['steal'], medium: ['take the pass'], long: 'rule Ironwall' },
        });
        expect(patch).toMatchObject({ isPC: true, tier: 'recurring', status: 'Alive' });
        for (const k of ['affinity', 'pcRelation', 'drives', 'goalRecords', 'fieldTags', 'skillRung', 'populated']) {
            expect(patch).not.toHaveProperty(k);
        }
        expect(patch.wants).toEqual({ short: [], medium: ['take the pass'], long: 'rule Ironwall' });
        expect(patch.wantsProvenance).toBe('inferred');
    });

    it('does not invent wants the text lacks', () => {
        const patch = parsePCFromText({ name: 'Kael' });
        expect(patch).not.toHaveProperty('wants');
    });

    it('merges visual profile and coerces array-shaped strings', () => {
        const patch = parsePCFromText({ name: 'Kael', aliases: ['The Red', 'Captain'], visualProfile: { eyeColor: 'green' } });
        expect(patch.aliases).toBe('The Red, Captain');
        expect(patch.visualProfile?.eyeColor).toBe('green');
    });
});

describe('parsePCFromText — refine mode', () => {
    it('touches only supplied fields, keeps short wants and merges hex', () => {
        const existing = basePc();
        const patch = parsePCFromText({
            voice: 'gravelly',
            wants: { short: ['steal'], long: 'avenge her brother' },
            personalityHex: { composure: -2 },
        }, { existing });
        expect(patch.voice).toBe('gravelly');
        expect(patch).not.toHaveProperty('personality');
        expect(patch).not.toHaveProperty('isPC');
        expect(patch).not.toHaveProperty('status');
        expect(patch.wants).toEqual({ short: ['eat'], medium: ['find the map'], long: 'avenge her brother' });
        expect(patch.personalityHex).toEqual({ drive: 1, diligence: 1, boldness: 1, warmth: 1, empathy: 1, composure: -2 });
    });

    it('prompt carries the current sheet and the source text', () => {
        const prompt = buildPCFromTextPrompt('She hates the rain.', { existing: basePc() });
        expect(prompt).toContain('[CURRENT SHEET]');
        expect(prompt).toContain('PLAYER CHARACTER');
        expect(prompt).toContain('She hates the rain.');
    });
});

describe('extractPCFromText', () => {
    it('runs through the injected model call', async () => {
        const patch = await extractPCFromText(undefined, 'Kael is a brave captain.', {
            modelCall: async () => JSON.stringify({ name: 'Kael', personality: 'brave' }),
        });
        expect(patch.name).toBe('Kael');
    });

    it('retries once on invalid JSON', async () => {
        let calls = 0;
        const patch = await extractPCFromText(undefined, 'text', {
            modelCall: async () => (++calls === 1 ? 'nope {' : JSON.stringify({ name: 'Kael' })),
        });
        expect(calls).toBe(2);
        expect(patch.name).toBe('Kael');
    });

    it('rejects empty text and nameless new characters', async () => {
        await expect(extractPCFromText(undefined, '   ', {})).rejects.toThrow();
        await expect(extractPCFromText(undefined, 'someone', {
            modelCall: async () => JSON.stringify({ personality: 'odd' }),
        })).rejects.toThrow(/name/);
    });

    it('allows a nameless patch when refining', async () => {
        const patch = await extractPCFromText(undefined, 'She sings.', {
            existing: basePc(),
            modelCall: async () => JSON.stringify({ voice: 'melodic' }),
        });
        expect(patch.voice).toBe('melodic');
    });

    it('throws when the model never returns valid JSON', async () => {
        await expect(extractPCFromText(undefined, 'text', {
            modelCall: async () => 'not json at all {',
        })).rejects.toThrow();
    });
});
