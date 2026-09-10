import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolCallChips } from '../ToolCallChips';
import type { ChatMessage } from '../../../types';

/**
 * The `request_outcome` chip. Without its own branch, `ChipBody` falls through to the generic
 * wrench chip, whose label is the raw tool name — so the transcript would literally read
 * `request_outcome`, which is exactly the machinery goal 1 wants off the page.
 *
 * The three states are keyed on whether the matching `tool` message exists yet. The
 * orchestrator stamps `tool_calls` BEFORE it suspends and adds the tool message only once
 * the player answers, so "no result" means "still waiting on the player".
 */
const outcomeCall = (): ChatMessage['tool_calls'] => ([{
    id: 'tc_1',
    type: 'function' as const,
    function: {
        name: 'request_outcome',
        arguments: JSON.stringify({
            reason: 'Forcing the shutter before the patrol rounds the corner.',
            difficulty: 'hard',
            failure_means: 'the frame gives loudly and they hear it',
        }),
    },
}]);

const result = (extra: Record<string, unknown>) => JSON.stringify({
    reason: 'Forcing the shutter.',
    difficulty: 'hard',
    ...extra,
});

describe('ToolCallChips — request_outcome', () => {
    it('shows the difficulty and the reason, and never the raw tool name', () => {
        render(<ToolCallChips toolCalls={outcomeCall()} />);
        expect(screen.getByText('Resolve · hard')).toBeTruthy();
        expect(screen.getByText(/Forcing the shutter/)).toBeTruthy();
        expect(screen.queryByText('request_outcome')).toBeNull();
    });

    it('reads as awaiting the player while no tool result exists', () => {
        render(<ToolCallChips toolCalls={outcomeCall()} />);
        expect(screen.getByText('waiting for you')).toBeTruthy();
    });

    it.each([
        ['success', true, 'success'],
        ['success_with_consequence', true, 'success + cost'],
        ['fail', false, 'fail'],
        ['fail_with_consequence', false, 'fail + cost'],
    ] as const)('shows %s once it comes back', (outcome, happens, label) => {
        render(
            <ToolCallChips
                toolCalls={outcomeCall()}
                toolResult={result({ outcome, action_happens: happens, source: 'player-resolved' })}
            />,
        );
        expect(screen.getByText(label)).toBeTruthy();
        expect(screen.queryByText('waiting for you')).toBeNull();
    });

    it('never shows a number — nothing numeric exists on this path', () => {
        const { container } = render(
            <ToolCallChips
                toolCalls={outcomeCall()}
                toolResult={result({ outcome: 'success', action_happens: true })}
            />,
        );
        expect(container.textContent).not.toMatch(/\d/);
    });

    it('reads as "unresolved" when the player declined, rather than picking one', () => {
        render(
            <ToolCallChips
                toolCalls={outcomeCall()}
                toolResult={result({ outcome: null, action_happens: null, source: 'player-declined' })}
            />,
        );
        expect(screen.getByText('unresolved')).toBeTruthy();
    });

    it('a malformed request still resolves to "unresolved", never a fabricated outcome', () => {
        render(
            <ToolCallChips
                toolCalls={outcomeCall()}
                toolResult={JSON.stringify({ outcome: null, source: 'malformed-request' })}
            />,
        );
        expect(screen.getByText('unresolved')).toBeTruthy();
    });
});

/**
 * The legacy branch. Nothing emits `request_roll` any more, but saved transcripts are full of
 * it, and dropping the branch would send every archived roll through the generic wrench chip
 * that prints the raw tool name.
 */
describe('ToolCallChips — legacy request_roll', () => {
    const rollCall = (): ChatMessage['tool_calls'] => ([{
        id: 'tc_legacy',
        type: 'function' as const,
        function: {
            name: 'request_roll',
            arguments: JSON.stringify({ dice: '2d6', reason: 'Forcing the shutter.', success_on: '7+' }),
        },
    }]);

    it('still renders an archived roll as a chip, never as the raw tool name', () => {
        render(<ToolCallChips toolCalls={rollCall()} />);
        expect(screen.getByText('Roll 2d6')).toBeTruthy();
        expect(screen.queryByText('request_roll')).toBeNull();
    });

    it("still shows the player's total", () => {
        render(
            <ToolCallChips
                toolCalls={rollCall()}
                toolResult={JSON.stringify({ dice: '2d6', player_total: 11, source: 'player-rolled' })}
            />,
        );
        expect(screen.getByText('11')).toBeTruthy();
    });

    it('still reads as "no roll" for an archived decline', () => {
        render(
            <ToolCallChips
                toolCalls={rollCall()}
                toolResult={JSON.stringify({ dice: '2d6', player_total: null, source: 'player-declined' })}
            />,
        );
        expect(screen.getByText('no roll')).toBeTruthy();
    });
});
