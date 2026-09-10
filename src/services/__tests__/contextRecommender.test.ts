/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/llmCall', () => ({
    llmCall: vi.fn(),
}));
import { llmCall } from '../../utils/llmCall';
import { recommendContext } from '../turn/contextRecommender';
import type { EndpointConfig } from '../../types';

const mockLlmCall = vi.mocked(llmCall);

const endpoint: EndpointConfig = {
    endpoint: 'http://localhost',
    modelName: 'test-model',
} as any;

const emptyResult = {
    relevantNPCNames: [],
    relevantLoreIds: [],
};

describe('recommendContext', () => {
    beforeEach(() => vi.clearAllMocks());

    it('parses a clean JSON object response', async () => {
        // Stray inventoryCategories/profileFields keys are what an older utility model
        // still emits. They are ignored now, not parsed.
        mockLlmCall.mockResolvedValueOnce(
            '{"npcs":["Elara","Brom"],"lore":["lore-01"],"inventoryCategories":["weapon"],"profileFields":["name","hp"]}'
        );

        const result = await recommendContext(endpoint, [], [], [], 'attack the goblin');
        expect(result).toEqual({ relevantNPCNames: ['Elara', 'Brom'], relevantLoreIds: ['lore-01'] });
    });

    it('parses a <think>-wrapped + fenced JSON response', async () => {
        mockLlmCall.mockResolvedValueOnce(
            '<think>I should identify relevant NPCs.</think>\n```json\n' +
            '{"npcs":["Guard Captain"],"lore":["lore-03"]}\n```'
        );

        const result = await recommendContext(endpoint, [], [], [], 'talk to the guard');
        expect(result.relevantNPCNames).toEqual(['Guard Captain']);
        expect(result.relevantLoreIds).toEqual(['lore-03']);
    });

    it('recovers from a truncated JSON response (truncation recovery path)', async () => {
        // Object truncated after a complete `lore` array — the closing brace never arrives.
        mockLlmCall.mockResolvedValueOnce(
            '{"npcs":["Mira"],"lore":["lore-02"],"trailing":["cut'
        );

        const result = await recommendContext(endpoint, [], [], [], 'defend yourself');
        expect(result.relevantNPCNames).toEqual(['Mira']);
        expect(result.relevantLoreIds).toEqual(['lore-02']);
    });

    it('throws when no JSON is found in the response', async () => {
        mockLlmCall.mockResolvedValueOnce('I cannot determine relevance right now.');

        await expect(
            recommendContext(endpoint, [], [], [], 'anything')
        ).rejects.toThrow('No valid JSON in recommender response');
    });

    it('ignores the retired inventoryCategories and profileFields keys entirely', async () => {
        // The recommender no longer selects character-sheet fields or inventory
        // categories — the sheet is gone, and the PC block renders the whole bounded
        // inventory rather than paying a blocking round trip to choose a subset.
        mockLlmCall.mockResolvedValueOnce(
            '{"npcs":["Mira"],"lore":[],"inventoryCategories":["weapon","invalid_cat"],"profileFields":["name","badField"]}'
        );

        const result = await recommendContext(endpoint, [], [], [], 'fight');
        expect(result).toEqual({ relevantNPCNames: ['Mira'], relevantLoreIds: [] });
        expect(result).not.toHaveProperty('inventoryCategories');
        expect(result).not.toHaveProperty('profileFields');
    });

    it('returns empty arrays when JSON fields are absent', async () => {
        mockLlmCall.mockResolvedValueOnce('{}');

        const result = await recommendContext(endpoint, [], [], [], 'wander');
        expect(result).toMatchObject(emptyResult);
    });
});
