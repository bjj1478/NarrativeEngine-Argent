import { describe, it, expect, vi } from 'vitest';
import { handleProposeConditionTool, getToolDefinitions } from '../toolHandlers';
import { resolveToolHandler, TOOL_REGISTRY } from '../toolRegistry';
import { applyConditionProposal } from '../../character/applyConditionProposal';
import type { ConditionProposal, PlayerCharacter } from '../../../types';

/**
 * `propose_condition_change` — the per-turn body-state proposal.
 *
 * Covered harder than its inventory sibling deliberately: that one shipped with a single
 * parser assertion and no coverage of the registry hop, the staging callback, or the apply
 * logic, and this mirrors the same pipeline.
 */

const toolNames = (tools: unknown[]) =>
    tools.map(t => (t as { function: { name: string } }).function.name);

describe('handleProposeConditionTool', () => {
    it('parses a wound with all three fields', () => {
        const { proposal } = handleProposeConditionTool(JSON.stringify({
            condition: 'gash across the left forearm; favours the right hand',
            reason: 'Took the guard\'s knife forcing the shutter.',
        }));
        expect(proposal.condition).toBe('gash across the left forearm; favours the right hand');
        expect(proposal.status).toBeUndefined();
        expect(proposal.reason).toContain('shutter');
    });

    it('keeps an empty condition, because that is how healing is expressed', () => {
        // The distinction that matters: `undefined` means "not proposing a condition
        // change", `''` means "treated — clear it". Truthiness testing would collapse them.
        const { proposal } = handleProposeConditionTool(JSON.stringify({
            condition: '',
            reason: 'The wound was stitched and bound at the waystation.',
        }));
        expect(proposal.condition).toBe('');
        expect('condition' in proposal).toBe(true);
    });

    it('omits condition entirely when the call does not mention it', () => {
        const { proposal } = handleProposeConditionTool(JSON.stringify({
            status: 'In Custody',
            reason: 'Taken by the watch at the north gate.',
        }));
        expect(proposal.condition).toBeUndefined();
        expect(proposal.status).toBe('In Custody');
    });

    it('drops a status outside the closed vocabulary', () => {
        const { proposal } = handleProposeConditionTool(JSON.stringify({
            status: 'wounded',
            reason: 'x',
        }));
        // "wounded" is a condition, not a liveness value. Rejecting it here is what stops
        // the two axes collapsing into one.
        expect(proposal.status).toBeUndefined();
    });

    it('survives malformed JSON without throwing', () => {
        const { proposal } = handleProposeConditionTool('{"condition": "bleeding"');
        expect(proposal.condition).toBeUndefined();
        expect(proposal.status).toBeUndefined();
        expect(proposal.reason).toBeTruthy();
    });

    it('collapses whitespace and caps a runaway condition', () => {
        const { proposal } = handleProposeConditionTool(JSON.stringify({
            condition: '  deep   gash\n\nacross the arm  ' + 'x'.repeat(400),
            reason: 'r',
        }));
        expect(proposal.condition!.length).toBeLessThanOrEqual(160);
        expect(proposal.condition).not.toContain('\n');
        expect(proposal.condition).toContain('deep gash across the arm');
    });

    it('tells the model the change is staged, not recorded', () => {
        const { toolResult } = handleProposeConditionTool(JSON.stringify({
            condition: 'cracked ribs', reason: 'Thrown against the well.',
        }));
        const parsed = JSON.parse(toolResult);
        expect(parsed.status).toBe('staged');
        expect(parsed.condition).toBe('cracked ribs');
        expect(parsed.binding).toMatch(/PENDING/);
        // The block sent next turn is what actually reports the outcome, since Apply and
        // Dismiss are both invisible to the model.
        expect(parsed.binding).toMatch(/next turn/);
    });
});

describe('propose_condition_change — tool wiring', () => {
    it('is offered on every turn, like the inventory proposal', () => {
        expect(toolNames(getToolDefinitions({}))).toContain('propose_condition_change');
        expect(toolNames(getToolDefinitions({ playerRollFrequency: 'contested' })))
            .toContain('propose_condition_change');
    });

    it('is registered and guarded by validateToolRegistry', () => {
        expect(resolveToolHandler('propose_condition_change')).toBeTypeOf('function');
        expect(Object.keys(TOOL_REGISTRY)).toContain('propose_condition_change');
    });

    it('returns the proposal on its own dispatch channel, not the inventory one', () => {
        const handler = resolveToolHandler('propose_condition_change')!;
        const result = handler({
            arguments: JSON.stringify({ condition: 'burned hand', reason: 'r' }),
            loreChunks: [],
            notebook: [],
        });
        expect(result.conditionProposal?.condition).toBe('burned hand');
        expect(result.proposal).toBeUndefined();
        expect(result.accumulation).toBe('append');
        expect(result.traceResult).toBe(false);
    });
});

describe('applyConditionProposal', () => {
    const run = (proposal: ConditionProposal) => {
        const update = vi.fn();
        const summary = applyConditionProposal(proposal, update);
        return { update, summary, patch: update.mock.calls[0]?.[0] as Partial<PlayerCharacter> };
    };

    it('writes only the keys the proposal named', () => {
        // The single-key-patch rule: the trait scan and the drift check write this same
        // record concurrently, so anything not named here must not be sent.
        const { patch } = run({ condition: 'sprained ankle', reason: 'r' });
        expect(patch).toEqual({ condition: 'sprained ankle' });
    });

    it('clears the condition on an empty string', () => {
        const { patch, summary } = run({ condition: '', reason: 'Bound and rested.' });
        expect(patch).toEqual({ condition: '' });
        expect(summary).toBe('Condition cleared');
    });

    it('writes status alone when only status changed', () => {
        const { patch } = run({ status: 'Missing', reason: 'r' });
        expect(patch).toEqual({ status: 'Missing' });
    });

    it('writes both axes when both changed', () => {
        const { patch } = run({ condition: 'crushed leg', status: 'In Custody', reason: 'r' });
        expect(patch).toEqual({ condition: 'crushed leg', status: 'In Custody' });
    });

    it('writes nothing when the proposal named no change', () => {
        const { update, summary } = run({ reason: 'r' });
        expect(update).not.toHaveBeenCalled();
        expect(summary).toBeNull();
    });
});
