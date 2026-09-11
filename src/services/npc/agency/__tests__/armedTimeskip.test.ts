import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { TurnCallbacks, TurnState } from '../../../turn/turnOrchestrator';

const runTimeskip = vi.fn(() => ({
    deltas: [],
    narration: '',
    updatedNPCs: [],
    ticksConsumed: 0,
}));

// Spy on the simulation entry point so we can assert exactly which duration reached
// it. `detectTimeskip` stays real — the point is which of the two wins.
vi.mock('../agencyTimeskipRun', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../agencyTimeskipRun')>();
    return { ...actual, runTimeskip };
});

const { runAgencyTick } = await import('../agencyEngine');

function makeState(over: Partial<TurnState> = {}): TurnState {
    return {
        settings: { aiTier: 'pro' },
        context: { agencyTick: 0, lastSceneStakes: 'calm' },
        getRawSummariserProvider: () => ({ endpoint: 'http://x', apiKey: '', modelName: 'm' }),
        ...over,
    } as unknown as TurnState;
}

const callbacks = new Proxy({}, { get: () => () => undefined }) as TurnCallbacks;

const npcLedger = [
    {
        id: 'npc_1',
        name: 'Ingrid',
        tier: 'supporting',
        populated: true,
        goalRecords: [{ id: 'g1', state: 'active', horizon: 'short', lastAdvancedTick: 0 }],
    },
] as never;

describe('armed timeskip — explicit beats phrasing', () => {
    beforeEach(() => runTimeskip.mockClear());

    it('runs the skip with exactly the armed duration', () => {
        runAgencyTick(
            makeState({ armedTimeskip: { days: 91, weeks: 13, ticks: 6 } }),
            callbacks,
            npcLedger,
            'I winter over at the forge.',
        );
        expect(runTimeskip).toHaveBeenCalledTimes(1);
        expect(runTimeskip.mock.calls[0][0]).toMatchObject({ weeks: 13 });
    });

    it('wins over a phrase in the same message rather than double-counting it', () => {
        // The composed message deliberately contains a detectable phrase; the armed
        // value is the authority, so the phrase must not override or stack.
        runAgencyTick(
            makeState({ armedTimeskip: { days: 7, weeks: 1, ticks: 2 } }),
            callbacks,
            npcLedger,
            '3 months later. I rebuild the forge.',
        );
        expect(runTimeskip).toHaveBeenCalledTimes(1);
        expect(runTimeskip.mock.calls[0][0]).toMatchObject({ weeks: 1 });
    });

    it('runs an explicit skip whose phrasing would be rejected as ambiguous', () => {
        // "a season later" is detected then dropped by the ambiguity guard. An
        // explicit pick has nothing to disambiguate, so it must still run.
        runAgencyTick(
            makeState({ armedTimeskip: { days: 91, weeks: 13, ticks: 6 } }),
            callbacks,
            npcLedger,
            'a season later',
        );
        expect(runTimeskip).toHaveBeenCalledTimes(1);
        expect(runTimeskip.mock.calls[0][0]).toMatchObject({ weeks: 13 });
    });

    it('still honours a typed phrase when nothing is armed', () => {
        runAgencyTick(makeState(), callbacks, npcLedger, '3 weeks later, the forge cooled');
        expect(runTimeskip).toHaveBeenCalledTimes(1);
        expect(runTimeskip.mock.calls[0][0]).toMatchObject({ weeks: 3 });
    });

    it('does not run a skip on an ordinary turn', () => {
        runAgencyTick(makeState(), callbacks, npcLedger, 'I look around the room.');
        expect(runTimeskip).not.toHaveBeenCalled();
    });

    it('does not run a skip when the tier blocks it', () => {
        // The gate is the real `tierAllows` now, not a stub that always returned true.
        runAgencyTick(
            makeState({
                settings: { aiTier: 'lite' } as never,
                armedTimeskip: { days: 91, weeks: 13, ticks: 6 },
            }),
            callbacks,
            npcLedger,
            'winter passes',
        );
        expect(runTimeskip).not.toHaveBeenCalled();
    });
});
