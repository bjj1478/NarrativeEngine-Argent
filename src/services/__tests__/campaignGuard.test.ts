/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatMessage, GameContext } from '../../types';
import type { TurnState, TurnCallbacks } from '../turn/turnOrchestrator';

// ── Mocks ──────────────────────────────────────────────────────────────
// The guard reads useAppStore.getState().activeCampaignId. We mock the store
// so tests can flip the active campaign mid-flight to simulate the race.
let mockActiveCampaignId: string | null = 'campaign-1';
const mockUpdatePlayerCharacter = vi.fn();
vi.mock('../../store/useAppStore', () => ({
    useAppStore: {
        getState: () => ({
            activeCampaignId: mockActiveCampaignId,
            setCharacterProfileData: vi.fn(),
            setInventoryItems: vi.fn(),
            // Trait scan writes the PC record through this, not through updateContext.
            updatePlayerCharacter: mockUpdatePlayerCharacter,
        }),
    },
}));

vi.mock('../llm/apiClient', () => ({
    api: {
        archive: {
            append: vi.fn(),
            getIndex: vi.fn().mockResolvedValue([]),
            patchEvents: vi.fn().mockResolvedValue(undefined),
            fetchScenes: vi.fn().mockResolvedValue([]),
            patchWitnesses: vi.fn().mockResolvedValue(undefined),
        },
        timeline: { get: vi.fn().mockResolvedValue([]) },
        chapters: {
            list: vi.fn().mockResolvedValue([]),
            seal: vi.fn().mockResolvedValue(null),
            update: vi.fn().mockResolvedValue(null),
        },
    },
}));

// NOTE: backgroundQueue is NOT mocked — we use the real queue so the guard
// closures actually execute and we can assert drop/pass behavior.

vi.mock('../archive-memory/importanceRater', () => ({ rateImportance: vi.fn().mockResolvedValue(3) }));
vi.mock('../npc/npcDetector', () => ({
    extractNPCNames: vi.fn().mockReturnValue([]),
    classifyNPCNames: vi.fn().mockReturnValue({ newNames: [], existingNpcs: [] }),
    validateNPCCandidates: vi.fn().mockResolvedValue([]),
}));
vi.mock('../saveFileEngine', () => ({ generateChapterSummary: vi.fn().mockResolvedValue(null) }));
vi.mock('../../components/Toast', () => ({ toast: { info: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('../chatEngine', () => ({
    buildPayload: vi.fn(),
    sendMessage: vi.fn(),
    generateNPCProfile: vi.fn(),
    updateExistingNPCs: vi.fn(),
    backfillNPCDrives: vi.fn(),
}));
vi.mock('../characterTraitParser', () => ({ scanCharacterTraits: vi.fn() }));
vi.mock('../inventoryParser', () => ({ scanInventory: vi.fn() }));
vi.mock('../archive-memory/sceneEventExtractor', () => ({ extractSceneEvents: vi.fn() }));
vi.mock('../campaign-state/divergenceRegister', () => ({ mergeSealEntries: vi.fn(), EMPTY_REGISTER: {} }));
vi.mock('../../store/campaignStore', () => ({ saveDivergenceRegister: vi.fn().mockResolvedValue(undefined) }));

import { runPostTurnPipeline } from '../turn/postTurnPipeline';
import { backgroundQueue } from '../infrastructure/backgroundQueue';
import { scanCharacterTraits } from '../characterTraitParser';
import { scanInventory } from '../inventoryParser';
import { extractSceneEvents } from '../archive-memory/sceneEventExtractor';
import { api } from '../llm/apiClient';

const mockApi = vi.mocked(api);
const mockScanCharacterTraits = vi.mocked(scanCharacterTraits);
const mockScanInventory = vi.mocked(scanInventory);
const mockExtractSceneEvents = vi.mocked(extractSceneEvents);

const ASSISTANT_CONTENT = 'The goblin falls.';
const ALL_MSGS: ChatMessage[] = [{ id: 'm1', role: 'assistant', content: ASSISTANT_CONTENT, timestamp: 1000 }];

const baseContext = (): GameContext => ({
    loreRaw: '', rulesRaw: '', canonState: '', headerIndex: 'index',
    starter: '', continuePrompt: '', inventory: 'sword',
    characterProfile: 'hero', notebook: [],
} as unknown as GameContext);

const makeState = (overrides: Partial<TurnState> = {}): TurnState => ({
    input: 'attack', displayInput: 'attack',
    settings: { aiTier: 'max' } as any,
    context: baseContext(),
    messages: [], condenser: { condensedUpToIndex: -1 },
    loreChunks: [], npcLedger: [], archiveIndex: [],
    activeCampaignId: 'campaign-1',
    provider: { endpoint: 'http://llm', apiKey: '', modelName: 'm' },
    getMessages: vi.fn().mockReturnValue(ALL_MSGS),
    getFreshProvider: vi.fn().mockReturnValue({ endpoint: 'http://llm', apiKey: '', modelName: 'm' }),
    // Bookkeeping/NPC extraction runs on the Extraction slot, not Story.
    getExtractionEndpoint: vi.fn().mockReturnValue({ endpoint: 'http://llm', apiKey: '', modelName: 'm' }),
    getUtilityEndpoint: vi.fn().mockReturnValue(undefined),
    chapters: [], pinnedChapterIds: [], clearPinnedChapters: vi.fn(),
    setChapters: vi.fn(),
    incrementBookkeepingTurnCounter: vi.fn().mockReturnValue(5),
    resetBookkeepingTurnCounter: vi.fn(),
    autoBookkeepingInterval: 5,
    getFreshContext: vi.fn().mockReturnValue(baseContext()),
    ...overrides,
});

const makeCallbacks = (): TurnCallbacks => ({
    onCheckingNotes: vi.fn(),
    addMessage: vi.fn(),
    updateLastAssistant: vi.fn(),
    updateLastMessage: vi.fn(),
    updateLastAssistantMessage: vi.fn(),
    updateContext: vi.fn(),
    getFreshLocationState: vi.fn().mockImplementation(() => ({ activeCampaignId: mockActiveCampaignId, locationLedger: [], context: baseContext() })),
    setCharacterProfileData: vi.fn(),
    setInventoryItems: vi.fn(),
    setLocationLedger: vi.fn(),
    addLocationSuggestions: vi.fn(),
    setArchiveIndex: vi.fn(),
    setTimeline: vi.fn(),
    updateNPC: vi.fn(),
    addNPC: vi.fn(),
    setCondensed: vi.fn(),
    setStreaming: vi.fn(),
    setLoadingStatus: vi.fn(),
    addNpcSuggestions: vi.fn(),
    archiveNPC: vi.fn(),
    restoreNPC: vi.fn(),
});

/** A deferred promise we can resolve manually to control mock async timing. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}

/** Wait for the backgroundQueue to drain all pending + running tasks. */
async function waitForBackgroundDrain(): Promise<void> {
    for (let i = 0; i < 200; i++) {
        if (backgroundQueue.pending === 0 && backgroundQueue.active === 0) return;
        await new Promise(r => setTimeout(r, 10));
    }
    throw new Error('Background queue did not drain');
}

const EMPTY_TRAITS: unknown[] = [];
const PC = { id: 'pc1', name: 'Hero', isPC: true };

describe('Campaign-id guard: race condition regression tests', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockActiveCampaignId = 'campaign-1';
        backgroundQueue.clear('test reset');
    });

    it('drops updateContext when campaign switches during Profile-Scan', async () => {
        mockApi.archive.append.mockResolvedValueOnce({ sceneId: '001' });
        mockApi.archive.getIndex.mockResolvedValueOnce([{ sceneId: '001', events: [] }]);
        mockApi.chapters.list.mockResolvedValueOnce([]);

        // Block Profile-Scan on a deferred so we can switch campaigns mid-flight
        // Trait/Inventory also fire — resolve them quickly (they'll be guarded too)
        const traitDeferred = deferred<typeof EMPTY_TRAITS>();
        mockScanCharacterTraits.mockReturnValueOnce(traitDeferred.promise);
        const invDeferred = deferred<[]>();
        mockScanInventory.mockReturnValueOnce(invDeferred.promise);

        const callbacks = makeCallbacks();
        await runPostTurnPipeline(makeState(), callbacks, ASSISTANT_CONTENT, ALL_MSGS);

        // Switch campaign WHILE scans are still pending in the background
        mockActiveCampaignId = 'campaign-2';
        // Now resolve the scans — the guard should drop all updateContext calls
        traitDeferred.resolve(EMPTY_TRAITS);
        invDeferred.resolve([]);
        await waitForBackgroundDrain();

        // No background-task updateContext should have fired
        const bgContextCalls = callbacks.updateContext.mock.calls.filter(
            ([p]: [any]) => p?.inventoryItems !== undefined,
        );
        expect(bgContextCalls).toHaveLength(0);
        // The trait scan writes the PC record, not the context — guard that path too.
        expect(mockUpdatePlayerCharacter).not.toHaveBeenCalled();
    });


    it('drops updateContext when campaign switches during Inventory-Scan', async () => {
        mockApi.archive.append.mockResolvedValueOnce({ sceneId: '001' });
        mockApi.archive.getIndex.mockResolvedValueOnce([{ sceneId: '001', events: [] }]);
        mockApi.chapters.list.mockResolvedValueOnce([]);
        mockScanCharacterTraits.mockResolvedValueOnce(EMPTY_TRAITS);

        const invDeferred = deferred<{ name: string; qty: number }[]>();
        mockScanInventory.mockReturnValueOnce(invDeferred.promise);

        const callbacks = makeCallbacks();
        await runPostTurnPipeline(makeState(), callbacks, ASSISTANT_CONTENT, ALL_MSGS);

        // Profile + Trait resolve fast, Inventory is still pending — switch now
        mockActiveCampaignId = 'campaign-2';
        invDeferred.resolve([{ name: 'Sword', qty: 1 }]);
        await waitForBackgroundDrain();

        const inventoryCalls = callbacks.updateContext.mock.calls.filter(
            ([p]: [any]) => p?.inventoryItems !== undefined,
        );
        expect(inventoryCalls).toHaveLength(0);
    });

    it('drops updateContext when campaign switches during Trait-Scan', async () => {
        mockApi.archive.append.mockResolvedValueOnce({ sceneId: '001' });
        mockApi.archive.getIndex.mockResolvedValueOnce([{ sceneId: '001', events: [] }]);
        mockApi.chapters.list.mockResolvedValueOnce([]);
        mockScanInventory.mockResolvedValueOnce([]);

        const traitDeferred = deferred<typeof EMPTY_TRAITS>();
        mockScanCharacterTraits.mockReturnValueOnce(traitDeferred.promise);

        const callbacks = makeCallbacks();
        await runPostTurnPipeline(makeState(), callbacks, ASSISTANT_CONTENT, ALL_MSGS);

        mockActiveCampaignId = 'campaign-2';
        traitDeferred.resolve(EMPTY_TRAITS);
        await waitForBackgroundDrain();

        const traitsCalls = callbacks.updateContext.mock.calls.filter(
            ([p]: [any]) => p?.characterProfile !== undefined,
        );
        expect(traitsCalls).toHaveLength(0);
    });

    it('drops setArchiveIndex when campaign switches during Event-Extraction', async () => {
        const indexEntry = { sceneId: '001', events: undefined, witnesses: [], npcsMentioned: [], keywords: [], userSnippet: '', timestamp: 1, npcStrengths: {}, importance: 3, keywordStrengths: {} };
        mockApi.archive.append.mockResolvedValueOnce({ sceneId: '001' });
        mockApi.archive.getIndex.mockResolvedValueOnce([indexEntry]).mockResolvedValueOnce([]);
        mockApi.chapters.list.mockResolvedValueOnce([]);
        mockScanCharacterTraits.mockResolvedValueOnce(EMPTY_TRAITS);
        mockScanInventory.mockResolvedValueOnce([]);

        const eventsDeferred = deferred<any[]>();
        mockExtractSceneEvents.mockReturnValueOnce(eventsDeferred.promise);

        const callbacks = makeCallbacks();
        await runPostTurnPipeline(makeState(), callbacks, ASSISTANT_CONTENT, ALL_MSGS);

        // Switch campaign while Event-Extraction is still pending
        mockActiveCampaignId = 'campaign-2';
        eventsDeferred.resolve([{ subject: 'A', predicate: 'met', object: 'B', summary: 'A met B', importance: 3, sceneId: '001', chapterId: 'CH01', source: 'llm' }]);
        await waitForBackgroundDrain();

        // The synchronous setArchiveIndex (L259, pre-switch) fires once;
        // the background re-fetch should be dropped by the guard.
        expect(callbacks.setArchiveIndex).toHaveBeenCalledTimes(1);
    });

    it('drops setArchiveIndex when campaign switches during Event-Extraction (null activeCampaignId edge)', async () => {
        const indexEntry = { sceneId: '001', events: undefined, witnesses: [], npcsMentioned: [], keywords: [], userSnippet: '', timestamp: 1, npcStrengths: {}, importance: 3, keywordStrengths: {} };
        mockApi.archive.append.mockResolvedValueOnce({ sceneId: '001' });
        mockApi.archive.getIndex.mockResolvedValueOnce([indexEntry]).mockResolvedValueOnce([]);
        mockApi.chapters.list.mockResolvedValueOnce([]);
        mockScanCharacterTraits.mockResolvedValueOnce(EMPTY_TRAITS);
        mockScanInventory.mockResolvedValueOnce([]);

        const eventsDeferred = deferred<any[]>();
        mockExtractSceneEvents.mockReturnValueOnce(eventsDeferred.promise);

        const callbacks = makeCallbacks();
        await runPostTurnPipeline(makeState(), callbacks, ASSISTANT_CONTENT, ALL_MSGS);

        mockActiveCampaignId = null;
        eventsDeferred.resolve([{ subject: 'A', predicate: 'met', object: 'B', summary: 'A met B', importance: 3, sceneId: '001', chapterId: 'CH01', source: 'llm' }]);
        await waitForBackgroundDrain();

        expect(callbacks.setArchiveIndex).toHaveBeenCalledTimes(1);
    });

    it('does not break same-campaign flow: all scans fire updateContext on match', async () => {
        mockApi.archive.append.mockResolvedValueOnce({ sceneId: '001' });
        mockApi.archive.getIndex.mockResolvedValueOnce([{ sceneId: '001', events: [], witnesses: [], npcsMentioned: [], keywords: [], userSnippet: '', timestamp: 1, npcStrengths: {}, importance: 3, keywordStrengths: {} }]);
        mockApi.chapters.list.mockResolvedValueOnce([]);
        // Reset rather than queue: earlier tests leave unconsumed `...Once` values on this
        // mock, and the leftover would answer this scan instead of the value below.
        mockScanCharacterTraits.mockReset();
        mockScanCharacterTraits.mockResolvedValue([{ id: 't1', text: 'brave', superseded: false }]);
        mockScanInventory.mockResolvedValueOnce([{ name: 'Potion', qty: 2 }]);

        const ctx = { ...baseContext(), characterProfileActive: true, playerCharacter: PC };
        const state = makeState({ getFreshContext: vi.fn().mockReturnValue(ctx) });
        const callbacks = makeCallbacks();
        await runPostTurnPipeline(state, callbacks, ASSISTANT_CONTENT, ALL_MSGS);
        await waitForBackgroundDrain();

        const calls = callbacks.updateContext.mock.calls;
        const inventoryPatch = calls.find(([p]: [any]) => p?.inventoryItems !== undefined);
        expect(inventoryPatch).toBeDefined();
        // Traits land on the PC record via a single-key patch, never via updateContext.
        expect(mockUpdatePlayerCharacter).toHaveBeenCalledWith({
            activeTraits: [{ id: 't1', text: 'brave', superseded: false }],
        });
    });
});
