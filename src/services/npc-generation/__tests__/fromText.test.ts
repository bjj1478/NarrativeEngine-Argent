import { describe, it, expect } from 'vitest';
import type { NPCEntry } from '../../../types';
import { parseNPCFromText, extractNPCFromText, buildFromTextPrompt } from '../fromText';
import { TRAIT_VOCAB } from '../../npc/agency/agencyPools';

const fixedRng = () => 0.5;

function baseNpc(overrides: Partial<NPCEntry> = {}): NPCEntry {
    return {
        id: 'npc-1', name: 'Senna', aliases: '', appearance: 'tall', faction: 'Guild', storyRelevance: '',
        disposition: 'Wary', status: 'Alive', goals: '', voice: 'soft alto', personality: 'watchful', exampleOutput: '',
        affinity: 70, pcRelation: 1,
        personalityHex: { drive: 1, diligence: 1, boldness: 1, warmth: 1, empathy: 1, composure: 1 },
        traits: ['loyal'],
        wants: { short: ['rest'], medium: ['find her brother'], long: 'lead the guild' },
        ...overrides,
    } as NPCEntry;
}

const defaultTrait = TRAIT_VOCAB.find(t => t.tier === 'default')!.text;
const matureTrait = TRAIT_VOCAB.find(t => t.tier === 'mature')?.text;

describe('parseNPCFromText — create mode', () => {
    it('clamps absolute hex values and fills omitted axes', () => {
        const patch = parseNPCFromText({ name: 'Vorin', personalityHex: { boldness: 9, empathy: -7, warmth: 1.4 } }, { rng: fixedRng });
        expect(patch.personalityHex).toMatchObject({ boldness: 3, empathy: -3, warmth: 1 });
        for (const v of Object.values(patch.personalityHex!)) expect(v).toBeGreaterThanOrEqual(-3);
        expect(Object.keys(patch.personalityHex!)).toHaveLength(6);
    });

    it('filters traits to the controlled vocabulary and the maturity gate', () => {
        const traits = ['definitely-not-a-trait', defaultTrait.toUpperCase(), ...(matureTrait ? [matureTrait] : [])];
        const patch = parseNPCFromText({ name: 'Vorin', traits }, { matureMode: false, rng: fixedRng });
        expect(patch.traits).toEqual([defaultTrait]);
    });

    it('coerces array-shaped string fields', () => {
        const patch = parseNPCFromText({ name: 'Vorin', aliases: ['The Red', 'Captain'] }, { rng: fixedRng });
        expect(patch.aliases).toBe('The Red, Captain');
    });

    it('homes agency fields for a new record', () => {
        const patch = parseNPCFromText({ name: 'Vorin', wants: { medium: ['take the pass'], long: 'rule Ironwall' } }, { rng: fixedRng });
        expect(patch.populated).toBe(true);
        expect(patch.pcRelation).toBe(0);
        expect(patch.affinity).toBe(50);
        expect(patch.status).toBe('Alive');
        expect(patch.wants?.medium).toEqual(['take the pass']);
        expect(patch.wants?.short.length).toBeGreaterThan(0);
        expect(patch.wantsProvenance).toBe('inferred');
        expect(patch.goalRecords?.length).toBeGreaterThan(0);
    });
});

describe('parseNPCFromText — refine mode', () => {
    it('touches only supplied fields and never engine-owned ones', () => {
        const existing = baseNpc();
        const patch = parseNPCFromText({
            voice: 'gravelly, clipped',
            affinity: 5, pcRelation: -3, drives: { coreWant: 'x' },
            wants: { short: ['steal'], long: 'avenge her brother' },
            personalityHex: { composure: -2 },
        }, { existing, rng: fixedRng });

        expect(patch.voice).toBe('gravelly, clipped');
        expect(patch).not.toHaveProperty('personality');
        expect(patch).not.toHaveProperty('affinity');
        expect(patch).not.toHaveProperty('pcRelation');
        expect(patch).not.toHaveProperty('drives');
        expect(patch).not.toHaveProperty('populated');
        expect(patch.wants).toEqual({ short: ['rest'], medium: ['find her brother'], long: 'avenge her brother' });
        expect(patch.personalityHex).toEqual({ drive: 1, diligence: 1, boldness: 1, warmth: 1, empathy: 1, composure: -2 });
    });

    it('leaves the hex alone when the text gives no axes', () => {
        const patch = parseNPCFromText({ voice: 'loud' }, { existing: baseNpc(), rng: fixedRng });
        expect(patch).not.toHaveProperty('personalityHex');
    });

    it('prompt carries the current sheet and the source text', () => {
        const prompt = buildFromTextPrompt('She hates the rain.', { existing: baseNpc() });
        expect(prompt).toContain('[CURRENT SHEET]');
        expect(prompt).toContain('She hates the rain.');
    });
});

describe('extractNPCFromText', () => {
    it('runs through the injected model call', async () => {
        const patch = await extractNPCFromText(undefined, 'Vorin is a brave captain.', {
            rng: fixedRng,
            modelCall: async () => JSON.stringify({ name: 'Vorin', personality: 'brave' }),
        });
        expect(patch.name).toBe('Vorin');
    });

    it('rejects empty text and nameless new NPCs', async () => {
        await expect(extractNPCFromText(undefined, '   ', {})).rejects.toThrow();
        await expect(extractNPCFromText(undefined, 'someone', {
            rng: fixedRng,
            modelCall: async () => JSON.stringify({ personality: 'odd' }),
        })).rejects.toThrow(/name/);
    });

    it('throws when the model never returns valid JSON', async () => {
        await expect(extractNPCFromText(undefined, 'text', {
            modelCall: async () => 'not json at all {',
        })).rejects.toThrow();
    });
});
