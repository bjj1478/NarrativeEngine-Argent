import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AppSettings, GameContext } from '../../../types';
import type { TurnState } from '../turnOrchestrator';
import type { OpenAIMessage } from '../../llm/llmService';

// Response Length on swipes / Smart Retry: the cached payload still carries the turn's own
// [BEAT BUDGET] line, so a dropdown change made after sending rides at the tail instead.

const sendMessageMock = vi.fn();
vi.mock('../../chatEngine', () => ({
    sendMessage: (...args: unknown[]) => sendMessageMock(...args),
}));

import { useAppStore } from '../../../store/useAppStore';
import { capturePendingTurnSnapshot, clearPendingTurnSnapshot, getSwipeLengthOverride } from '../pendingCommit';
import { generateSwipeVariant } from '../swipeGeneration';
import { beatBudgetLine } from '../../payload/contributions/builtins';

const snapshotWith = (sent: AppSettings['responseLength'], lastSceneStakes?: GameContext['lastSceneStakes'], displayInput = 'I wait.') => {
    const state = {
        settings: { responseLength: sent } as AppSettings,
        getMessages: () => [],
        getFreshContext: () => ({ lastSceneStakes } as GameContext),
        activeCampaignId: 'c1',
        npcLedger: [],
    } as unknown as TurnState;
    capturePendingTurnSnapshot(state, [], displayInput);
};

const setCurrent = (responseLength: AppSettings['responseLength']) =>
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, responseLength } });

describe('getSwipeLengthOverride', () => {
    afterEach(() => clearPendingTurnSnapshot());

    it('is undefined with no pending turn', () => {
        setCurrent('short');
        expect(getSwipeLengthOverride()).toBeUndefined();
    });

    it('is undefined when the dropdown still matches what the turn was sent with', () => {
        snapshotWith('medium');
        setCurrent('medium');
        expect(getSwipeLengthOverride()).toBeUndefined();
    });

    it('treats an absent setting as flexible on both sides', () => {
        snapshotWith(undefined);
        setCurrent('flexible');
        expect(getSwipeLengthOverride()).toBeUndefined();
    });

    it('returns the new fixed budget after a change', () => {
        snapshotWith('long');
        setCurrent('short');
        expect(getSwipeLengthOverride()).toBe(beatBudgetLine('short', undefined));
    });

    it('switching to flexible reads the turn\'s stakes and time skip', () => {
        snapshotWith('long', 'dangerous');
        setCurrent('flexible');
        expect(getSwipeLengthOverride()).toBe(beatBudgetLine('flexible', 'dangerous'));

        snapshotWith('short', 'calm', '3 weeks later, we reach the coast.');
        expect(getSwipeLengthOverride()).toBe(beatBudgetLine('flexible', 'calm', true));
    });
});

describe('generateSwipeVariant — lengthOverride', () => {
    beforeEach(() => {
        sendMessageMock.mockReset();
        sendMessageMock.mockImplementation((_p, _msgs, _onChunk, onDone) => onDone('text'));
    });

    const sentMessages = (): OpenAIMessage[] => sendMessageMock.mock.calls[0][1] as OpenAIMessage[];
    const base = { provider: { endpoint: 'x', apiKey: '', modelName: 'm' } as never, cachedPayload: [{ role: 'user', content: 'hi' }] as OpenAIMessage[], temperature: 0.8 };

    it('appends a replacement budget line at the tail', async () => {
        await generateSwipeVariant({ ...base, lengthOverride: '[BEAT BUDGET: test]' }, () => {});
        const last = sentMessages().at(-1)!;
        expect(last.role).toBe('system');
        expect(last.content).toContain('replacing the earlier [BEAT BUDGET] line: [BEAT BUDGET: test]');
    });

    it('adds nothing without an override', async () => {
        await generateSwipeVariant(base, () => {});
        expect(sentMessages().some(m => String(m.content).includes('BEAT BUDGET'))).toBe(false);
    });
});
