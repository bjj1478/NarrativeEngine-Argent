// `addNpcFromSelection` is the ONLY production caller of `generateNPCProfile`, and its two
// trailing parameters are positional with defaults. Dropping them was silent: generation kept
// working, so nothing failed — it just quietly ran with `existingLedger: undefined` and
// `matureMode: false`, which disabled the reserved-name guard and made the Mature Mode setting
// inert for every newly generated NPC regardless of the toggle.
//
// These tests exist because that class of bug has no other detector. A positional argument
// that is merely absent produces no type error and no runtime error.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addNpcFromSelection } from '../manualAdd';
import type { AddNpcDeps } from '../manualAdd';
import type { NPCEntry, ChatMessage, EndpointConfig } from '../../../types';

const generateNPCProfileMock = vi.fn();
const updateExistingNPCsMock = vi.fn();

vi.mock('../../npcGeneration', () => ({
    generateNPCProfile: (...a: unknown[]) => generateNPCProfileMock(...a),
    updateExistingNPCs: (...a: unknown[]) => updateExistingNPCsMock(...a),
}));

const provider = { endpoint: 'http://x', modelName: 'm' } as EndpointConfig;

const LEDGER = [
    { id: 'n1', name: 'Karen' },
    { id: 'n2', name: 'Thormund' },
] as NPCEntry[];

const baseDeps = (over: Partial<AddNpcDeps> = {}): AddNpcDeps => ({
    rawText: 'Alice',
    ledger: LEDGER,
    messages: [{ id: 'm1', role: 'assistant', content: 'Alice steps in.', timestamp: 1 }] as ChatMessage[],
    campaignId: 'camp1',
    storyProvider: provider,
    updateProvider: provider,
    addNPC: vi.fn(),
    updateNPC: vi.fn(),
    ...over,
});

// generateNPCProfile(provider, history, npcName, addNPCToStore, existingLedger, matureMode, rng)
const callArgs = () => generateNPCProfileMock.mock.calls[0];
const LEDGER_ARG = 4;
const MATURE_ARG = 5;

describe('addNpcFromSelection — create path argument threading', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('forwards the ledger, so the reserved-name guard can actually see the roster', async () => {
        const res = await addNpcFromSelection(baseDeps());
        expect(res).toMatchObject({ ok: true, kind: 'created', name: 'Alice' });
        expect(callArgs()[LEDGER_ARG]).toEqual(LEDGER);
    });

    it('forwards matureMode: true so the setting reaches the trait and want draws', async () => {
        await addNpcFromSelection(baseDeps({ matureMode: true }));
        expect(callArgs()[MATURE_ARG]).toBe(true);
    });

    it('forwards matureMode: false', async () => {
        await addNpcFromSelection(baseDeps({ matureMode: false }));
        expect(callArgs()[MATURE_ARG]).toBe(false);
    });

    // Absent must read as OFF, not as undefined: `generateNPCProfile` has a `= false` default,
    // so undefined would happen to work — but passing it explicitly is what keeps the gate
    // legible at the call site instead of hidden in a parameter default two files away.
    it('reads an absent matureMode as OFF rather than passing undefined through', async () => {
        await addNpcFromSelection(baseDeps());
        expect(callArgs()[MATURE_ARG]).toBe(false);
    });

    it('still passes provider, history, name and the store writer', async () => {
        const addNPC = vi.fn();
        const deps = baseDeps({ addNPC });
        await addNpcFromSelection(deps);
        const args = callArgs();
        expect(args[0]).toBe(provider);
        expect(args[1]).toBe(deps.messages);
        expect(args[2]).toBe('Alice');
        expect(args[3]).toBe(addNPC);
    });

    it('reports an error instead of generating when no story provider is configured', async () => {
        const res = await addNpcFromSelection(baseDeps({ storyProvider: undefined }));
        expect(res.ok).toBe(false);
        expect(generateNPCProfileMock).not.toHaveBeenCalled();
    });

    it('surfaces a generation failure rather than claiming the NPC was created', async () => {
        generateNPCProfileMock.mockRejectedValueOnce(new Error('model refused'));
        const res = await addNpcFromSelection(baseDeps());
        expect(res).toMatchObject({ ok: false, kind: 'error' });
        expect(res.message).toMatch(/model refused/);
    });
});

describe('addNpcFromSelection — the non-create branches are untouched by this', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('an existing name routes to update, not generation', async () => {
        const res = await addNpcFromSelection(baseDeps({ rawText: 'Karen' }));
        expect(res).toMatchObject({ ok: true, kind: 'updated', name: 'Karen' });
        expect(updateExistingNPCsMock).toHaveBeenCalledTimes(1);
        expect(generateNPCProfileMock).not.toHaveBeenCalled();
    });

    it('an unreadable selection generates nothing', async () => {
        const res = await addNpcFromSelection(baseDeps({ rawText: '   ' }));
        expect(res).toMatchObject({ ok: false, kind: 'empty' });
        expect(generateNPCProfileMock).not.toHaveBeenCalled();
    });
});
