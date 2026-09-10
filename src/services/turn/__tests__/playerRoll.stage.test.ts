/* eslint-disable @typescript-eslint/no-explicit-any */
// Player-rolled resolution — the mid-turn suspend.
//
// `request_roll` is the only tool that suspends generation: the GM states the dice and the
// bar, the turn stops, and it resumes with the number the player typed. These tests cover the
// three things that can go wrong around an unbounded human wait, all of which are silent
// failures if unguarded:
//
//   1. the turn never resumes (a rejected or abandoned promise hangs it with isStreaming true)
//   2. Stop is pressed while the modal is open (the half-written turn must stay recoverable)
//   3. a stale resolution lands after a NEWER turn began (it would write into that turn's
//      bubble, because updateLastAssistant scans back to the last assistant message)
//
// plus the three-way mode resolution that decides which dice tool — if any — is offered.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runTurn } from '../turnOrchestrator';
import type { TurnState, TurnCallbacks } from '../turnOrchestrator';
import type { ChatMessage } from '../../../types';

const updateLastAssistantMessageMock = vi.fn();
const updateLastAssistantMock = vi.fn();
const addMessageMock = vi.fn();
const setPipelinePhaseMock = vi.fn();
const setStreamingMock = vi.fn();
const getToolDefinitionsMock = vi.fn(() => [] as unknown[]);
const sendMessageMock = vi.fn();

vi.mock('../pendingCommit', () => ({
    capturePendingTurnSnapshot: vi.fn(),
    findPendingCommitMessage: () => null,
    findRetryableMessage: () => null,
}));

vi.mock('../../chatEngine', () => ({
    buildPayload: () => ({ messages: [{ role: 'user', content: 'PAYLOAD' }], trace: [], debugSections: [] }),
    sendMessage: (...args: unknown[]) => sendMessageMock(...args),
}));

vi.mock('../contextGatherer', () => ({
    gatherContext: vi.fn(async () => ({
        archiveRecall: [], recommendedNPCNames: [], timelineEvents: [], relevantLore: [],
        semanticArchiveIds: [], semanticLoreIds: [], inventoryCategories: [], profileFields: [],
        deepContextSummary: '', semanticFactText: '', relevantRules: [], rulesManifest: '',
        elevatedScenes: [], elevatedSceneRankedIds: [], slottedRagSnippets: [],
    })),
}));

vi.mock('../directorWatchdog', () => ({
    buildWatchdogDossier: vi.fn(() => ({ signals: [], dossierText: '', nudgeText: '' })),
}));

vi.mock('../directorBrief', () => ({
    runDirectorBrief: vi.fn(async () => null),
    lastAssistantContent: vi.fn(() => ''),
    clearDirectorBriefCache: vi.fn(),
}));

vi.mock('../../lib/payloadSanitizer', () => ({ sanitizePayloadForApi: (p: unknown[]) => p }));

vi.mock('../sceneStakesTag', () => ({
    extractAndStripSceneStakes: (t: string) => ({ displayText: t, stakes: 'calm' as const }),
}));

vi.mock('../../components/Toast', () => ({
    toast: { warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Test doubles for the request_roll helpers. The real ones are pure and covered separately
// in requestRoll.format.test.ts; here we only need them to behave, so this file does not have
// to import toolHandlers (which drags in the lore retriever).
vi.mock('../toolHandlers', () => ({
    getToolDefinitions: (...args: unknown[]) => getToolDefinitionsMock(...(args as [])),
    parseRequestRollArgs: (raw: string) => {
        try {
            const o = JSON.parse(raw);
            if (!o.dice || !o.reason) return null;
            return {
                dice: o.dice, reason: o.reason,
                success_on: o.success_on ?? '', failure_means: o.failure_means ?? '',
            };
        } catch { return null; }
    },
    formatPlayerRollResult: (args: any, total: number) =>
        JSON.stringify({ ...args, player_total: total, source: 'player-rolled' }),
    formatPlayerRollDeclined: (args: any) =>
        JSON.stringify({ ...args, player_total: null, source: 'player-declined' }),
}));

// Only request_roll resolves; every other name falls through to the final-answer path.
vi.mock('../toolRegistry', () => ({
    resolveToolHandler: (name: string) =>
        name === 'request_roll'
            ? () => ({ toolResult: '{"source":"fallback"}', accumulation: 'append', traceResult: true })
            : null,
}));

const ROLL_ARGS = JSON.stringify({
    dice: '2d6',
    reason: 'Forcing the shutter before the patrol rounds the corner.',
    success_on: '7+',
    failure_means: 'the frame gives loudly and they hear it',
});

function baseState(over: Partial<Record<string, unknown>> = {}): TurnState {
    return {
        input: 'I force the shutter', displayInput: 'I force the shutter',
        settings: { debugMode: false, aiTier: 'lite', contextLimit: 8192 } as any,
        context: { diceFairnessActive: true, rollFrequency: 'contested' } as any,
        messages: [], condenser: { condensedUpToIndex: -1 },
        loreChunks: [], npcLedger: [], archiveIndex: [], activeCampaignId: 'camp1',
        provider: { endpoint: 'http://x', modelName: 'm' } as any,
        getMessages: () => [] as ChatMessage[],
        getFreshProvider: () => ({ endpoint: 'http://x', modelName: 'm' } as any),
        getUtilityEndpoint: () => undefined,
        getFreshAuxiliaryProvider: () => ({ endpoint: 'http://aux', modelName: 'aux' } as any),
        onStageNpcIds: [], timeline: [], chapters: [], pinnedChapterIds: [],
        clearPinnedChapters: () => {}, setChapters: () => {},
        incrementBookkeepingTurnCounter: () => 0, resetBookkeepingTurnCounter: () => {},
        autoBookkeepingInterval: 5, getFreshContext: () => ({}) as any,
        sampling: undefined, deepSearchThisTurn: false,
        armedRoll: null, armedLoot: null, armedOneShot: null, absoluteCommand: null,
        ...over,
    } as any as TurnState;
}

function baseCallbacks(over: Partial<TurnCallbacks> = {}): TurnCallbacks {
    const noop = () => {};
    return {
        onCheckingNotes: noop,
        addMessage: (...a: unknown[]) => addMessageMock(...a),
        updateLastAssistant: (...a: unknown[]) => updateLastAssistantMock(...a),
        updateLastMessage: noop,
        updateLastAssistantMessage: (...a: unknown[]) => updateLastAssistantMessageMock(...a),
        updateContext: noop, setArchiveIndex: noop, updateNPC: noop, addNPC: noop,
        setCondensed: noop,
        setStreaming: (...a: unknown[]) => setStreamingMock(...a),
        setPipelinePhase: (...a: unknown[]) => setPipelinePhaseMock(...a),
        archiveNPC: noop, restoreNPC: noop,
        ...over,
    } as any as TurnCallbacks;
}

/**
 * Drives one request_roll call, then a plain final answer on the resume.
 *
 * The mock AWAITS onDone, which the real llmService does not do (it discards the promise).
 * That is a deliberate test convenience: it makes the suspend/resume ordering deterministic
 * instead of racing. The "turn resumes" assertion below still goes through the real 800ms
 * timer, so the resume path itself is not faked.
 */
function wireRequestRollThenAnswer(args = ROLL_ARGS): void {
    let call = 0;
    sendMessageMock.mockImplementation(
        async (_p: unknown, _m: unknown, _c: unknown, onDone: (t: string, tc?: unknown) => unknown) => {
            call++;
            if (call === 1) {
                await onDone('You get the pry bar seated.', { id: 'tc_1', name: 'request_roll', arguments: args });
            } else {
                await onDone('The frame lets go, quiet as a knuckle crack.');
            }
        },
    );
}

const toolMessages = () =>
    addMessageMock.mock.calls
        .map((c) => c[0] as { role?: string; content?: string; name?: string })
        .filter((m) => m.role === 'tool');

describe('player-rolled resolution — the mid-turn suspend', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getToolDefinitionsMock.mockReturnValue([]);
    });
    afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

    it('asks the player, with the bar the GM committed to before seeing the number', async () => {
        wireRequestRollThenAnswer();
        const asked: unknown[] = [];
        await runTurn(
            baseState(),
            baseCallbacks({ requestPlayerRoll: async (req) => { asked.push(req); return 11; } }),
            new AbortController(),
        );

        expect(asked).toEqual([{
            dice: '2d6',
            reason: 'Forcing the shutter before the patrol rounds the corner.',
            successOn: '7+',
            failureMeans: 'the frame gives loudly and they hear it',
        }]);
    });

    it("feeds the player's total back as the tool result", async () => {
        wireRequestRollThenAnswer();
        await runTurn(baseState(), baseCallbacks({ requestPlayerRoll: async () => 11 }), new AbortController());

        const tool = toolMessages();
        expect(tool).toHaveLength(1);
        expect(tool[0].name).toBe('request_roll');
        expect(JSON.parse(tool[0].content!)).toMatchObject({ player_total: 11, source: 'player-rolled', success_on: '7+' });
    });

    // The suspend branch shows the pre-roll narration before blocking, and the shared
    // tool path re-composes the same string afterwards. Assigning `accumulatedContent` in
    // BOTH places appended that paragraph twice — into the bubble, and from there into
    // every later prompt's history window. Every write is checked, not just the last, so
    // neither half of the pair can regress unnoticed.
    it('shows the pre-roll narration exactly once, never twice', async () => {
        wireRequestRollThenAnswer();
        await runTurn(baseState(), baseCallbacks({ requestPlayerRoll: async () => 11 }), new AbortController());

        const writes = updateLastAssistantMock.mock.calls.map((c) => c[0] as string);
        expect(writes.length).toBeGreaterThan(0);
        for (const text of writes) {
            expect(text.split('You get the pry bar seated.').length - 1).toBe(1);
        }
    });
});

describe('player-rolled resolution — guards around an unbounded human wait', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getToolDefinitionsMock.mockReturnValue([]);
    });
    afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

    it('a dismissed request leaves the attempt unresolved instead of inventing a number', async () => {
        wireRequestRollThenAnswer();
        await runTurn(baseState(), baseCallbacks({ requestPlayerRoll: async () => null }), new AbortController());

        expect(JSON.parse(toolMessages()[0].content!)).toMatchObject({
            player_total: null,
            source: 'player-declined',
        });
    });

    it('a REJECTED request does not hang the turn — it degrades to no roll', async () => {
        // onDone's promise is discarded by llmService, so an unhandled rejection here would
        // strand the turn with isStreaming stuck true and no Retry button.
        wireRequestRollThenAnswer();
        await runTurn(
            baseState(),
            baseCallbacks({ requestPlayerRoll: async () => { throw new Error('modal unmounted'); } }),
            new AbortController(),
        );

        expect(JSON.parse(toolMessages()[0].content!)).toMatchObject({ source: 'player-declined' });
    });

    it('resumes generation after the roll comes back', async () => {
        vi.useFakeTimers();
        wireRequestRollThenAnswer();
        await runTurn(baseState(), baseCallbacks({ requestPlayerRoll: async () => 11 }), new AbortController());

        expect(sendMessageMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(900);   // the real 800ms resume timer
        expect(sendMessageMock).toHaveBeenCalledTimes(2);
    });

    it('Stop pressed during the wait stamps the bubble retryable and writes nothing further', async () => {
        const abort = new AbortController();
        wireRequestRollThenAnswer();
        await runTurn(
            baseState(),
            baseCallbacks({ requestPlayerRoll: async () => { abort.abort(); return null; } }),
            abort,
        );

        // No tool message: we bailed before the shared path ran.
        expect(toolMessages()).toHaveLength(0);
        // Without this stamp the half-written turn is unrecoverable AND commitPendingTurn
        // discards the snapshot on the next send.
        const stamps = updateLastAssistantMessageMock.mock.calls.filter(
            (c) => (c[0] as { retryable?: boolean }).retryable === true,
        );
        expect(stamps).toHaveLength(1);
    });

    it('a resolution that lands after a NEWER turn began is discarded', async () => {
        // The dangerous case: handleStop clears isStreaming, so the player can start another
        // turn with the modal still open. updateLastAssistant scans back to the LAST assistant
        // message, so a late write would land in the new turn's bubble.
        let release: ((v: number | null) => void) | null = null;
        const held = new Promise<number | null>((res) => { release = res; });

        wireRequestRollThenAnswer();
        const first = runTurn(
            baseState(),
            baseCallbacks({ requestPlayerRoll: () => held }),
            new AbortController(),
        );
        await Promise.resolve();

        // A second turn supersedes the first while it is suspended.
        sendMessageMock.mockImplementation(
            async (_p: unknown, _m: unknown, _c: unknown, onDone: (t: string) => unknown) => { await onDone('Next turn.'); },
        );
        await runTurn(baseState({ input: 'something else' }), baseCallbacks(), new AbortController());

        addMessageMock.mockClear();
        release!(11);
        await first;

        // The stale roll must not have produced a tool message in the new turn.
        expect(toolMessages()).toHaveLength(0);
    });
});

describe('dice mode resolution — Ask To Roll is the one switch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getToolDefinitionsMock.mockReturnValue([]);
        sendMessageMock.mockImplementation(
            async (_p: unknown, _m: unknown, _c: unknown, onDone: (t: string) => unknown) => { await onDone('GM text.'); },
        );
    });
    afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

    const optsFor = async (context: Record<string, unknown>, over: Partial<TurnCallbacks> = {}) => {
        await runTurn(baseState({ context }), baseCallbacks({ requestPlayerRoll: async () => 9, ...over }), new AbortController());
        return getToolDefinitionsMock.mock.calls[0]?.[0] as unknown as {
            playerRollFrequency?: string;
        };
    };

    it('Ask To Roll ON offers request_roll', async () => {
        const opts = await optsFor({ diceFairnessActive: true, rollFrequency: 'contested' });
        expect(opts.playerRollFrequency).toBe('contested');
    });

    it('passes the campaign frequency through', async () => {
        const opts = await optsFor({ diceFairnessActive: true, rollFrequency: 'critical' });
        expect(opts.playerRollFrequency).toBe('critical');
    });

    it("an absent rollFrequency reads as 'contested'", async () => {
        const opts = await optsFor({ diceFairnessActive: true });
        expect(opts.playerRollFrequency).toBe('contested');
    });

    it('an absent diceFairnessActive reads as ON, not off', async () => {
        // Only an explicit `false` means no dice. A context that never set the field — a bare
        // fixture, a partially-migrated save — must still get dice rather than silently losing them.
        const opts = await optsFor({});
        expect(opts.playerRollFrequency).toBe('contested');
    });

    it('Ask To Roll OFF offers no dice tool at all', async () => {
        const opts = await optsFor({ diceFairnessActive: false });
        expect(opts.playerRollFrequency).toBeUndefined();
    });

    // The invariant that matters most here, and the one whose absence caused the original bug:
    // the tools array is part of the PROMPT, so it must be a function of campaign context alone.
    // A caller with no roll UI (the base-app gate, a facade run, a test) has to send the same
    // tools the app sends, or it freezes a payload no user ever sees. The old code degraded to
    // the engine-rolled tool here, silently and invisibly.
    it('offers request_roll even with no UI to suspend into — tools follow context, not callbacks', async () => {
        const opts = await optsFor({ diceFairnessActive: true }, { requestPlayerRoll: undefined });
        expect(opts.playerRollFrequency).toBe('contested');
    });

    it('a manually armed "dice me" roll suppresses the dice tool', async () => {
        // The resolved number is already asserted into the payload; offering the tool as well
        // would let the model roll a second time for the same action.
        await runTurn(
            baseState({ context: { diceFairnessActive: true }, armedRoll: '1d20' }),
            baseCallbacks({ requestPlayerRoll: async () => 9 }),
            new AbortController(),
        );
        const opts = getToolDefinitionsMock.mock.calls[0]?.[0] as unknown as { playerRollFrequency?: string };
        expect(opts.playerRollFrequency).toBeUndefined();
    });
});
