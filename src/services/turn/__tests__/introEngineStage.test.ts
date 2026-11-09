import { describe, it, expect, vi, afterEach } from 'vitest';
import { runIntroEngineStage } from '../turnStages';
import { NPC_INTRO_DEFAULTS, NPC_INTRO_DIE } from '../../npc-generation/charIntroEngine';
import type { TurnContext } from '../turnContext';
import type { TurnState, TurnCallbacks } from '../turnOrchestrator';
import type { NPCEntry } from '../../../types';

// Which ledger NPCs are excluded from the NPC Appearance pool.
//
// This used to be "every name in the ledger", which made the engine impossible to fire on
// desktop: the Engines-tab "Add Candidate" dropdown only offers ledger NPCs, and campaignInit
// imports every lore CHARACTER into the ledger at import time — so every candidate you could
// add was already on the exclusion list. The gate is now `populated`, the ledger's own
// "has been on stage" marker (npcTrack stamps it on first detection in narration).

const alwaysHits = () => vi.spyOn(Math, 'random').mockReturnValue((NPC_INTRO_DIE - 1) / NPC_INTRO_DIE);

const ledgerNpc = (over: Partial<NPCEntry>): NPCEntry =>
    ({ id: 'n1', name: 'Therese Soll', ...over }) as NPCEntry;

const stateWith = (npcLedger: NPCEntry[]): TurnState => ({
    settings: { aiTier: 'max', moduleEnabled: {} },
    context: {
        npcIntroEngineActive: true,
        npcIntroConfig: { ...NPC_INTRO_DEFAULTS, characters: [{ name: 'Therese Soll', type: 'wandering' }] },
    },
    messages: [],
    npcLedger,
    provider: undefined,
    getFreshAuxiliaryProvider: () => undefined,
}) as unknown as TurnState;

const run = async (npcLedger: NPCEntry[]): Promise<string> => {
    const ctx = { finalInput: 'I wait.' } as TurnContext;
    const callbacks = { updateContext: vi.fn() } as unknown as TurnCallbacks;
    await runIntroEngineStage(ctx, stateWith(npcLedger), callbacks);
    return ctx.finalInput;
};

describe('runIntroEngineStage — who counts as already met', () => {
    afterEach(() => vi.restoreAllMocks());

    it('introduces a pooled NPC who is in the ledger but has never been on stage', async () => {
        alwaysHits();
        // A lore-imported NPC: parseNPCsFromLore does not set `populated`.
        expect(await run([ledgerNpc({ populated: undefined })]))
            .toContain('[INTRODUCE CHARACTER: Therese Soll]');
    });

    it('does not re-introduce an NPC we have already met', async () => {
        alwaysHits();
        expect(await run([ledgerNpc({ populated: true })])).toBe('I wait.');
    });

    it('leaves the input alone when the roll misses', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        expect(await run([ledgerNpc({ populated: undefined })])).toBe('I wait.');
    });
});
