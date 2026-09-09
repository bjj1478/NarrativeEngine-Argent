import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolCallChips } from '../ToolCallChips';
import type { ChatMessage } from '../../../types';

/**
 * The `request_roll` chip. Without its own branch, `ChipBody` fell through to the generic
 * wrench chip, whose label is the raw tool name — so the transcript literally read
 * `request_roll`, which is exactly the machinery goal 1 wants off the page.
 *
 * The three states are keyed on whether the matching `tool` message exists yet. The
 * orchestrator stamps `tool_calls` BEFORE it suspends and adds the tool message only once
 * the player answers, so "no result" means "still waiting on the player".
 */
const rollCall = (): ChatMessage['tool_calls'] => ([{
    id: 'tc_1',
    type: 'function' as const,
    function: {
        name: 'request_roll',
        arguments: JSON.stringify({
            dice: '2d6',
            reason: 'Forcing the shutter before the patrol rounds the corner.',
            success_on: '7+',
            failure_means: 'the frame gives loudly and they hear it',
        }),
    },
}]);

describe('ToolCallChips — request_roll', () => {
    it('shows the dice and the reason, and never the raw tool name', () => {
        render(<ToolCallChips toolCalls={rollCall()} />);
        expect(screen.getByText('Roll 2d6')).toBeTruthy();
        expect(screen.getByText(/Forcing the shutter/)).toBeTruthy();
        expect(screen.queryByText('request_roll')).toBeNull();
    });

    it('reads as awaiting the player while no tool result exists', () => {
        render(<ToolCallChips toolCalls={rollCall()} />);
        expect(screen.getByText('waiting for your roll')).toBeTruthy();
    });

    it("shows the player's total once it comes back", () => {
        const result = JSON.stringify({
            dice: '2d6', reason: 'Forcing the shutter.', success_on: '7+',
            player_total: 11, source: 'player-rolled',
        });
        render(<ToolCallChips toolCalls={rollCall()} toolResult={result} />);
        expect(screen.getByText('11')).toBeTruthy();
        expect(screen.queryByText('waiting for your roll')).toBeNull();
    });

    it('reads as "no roll" when the player declined, rather than showing a number', () => {
        const result = JSON.stringify({
            dice: '2d6', reason: 'Forcing the shutter.',
            player_total: null, source: 'player-declined',
        });
        render(<ToolCallChips toolCalls={rollCall()} toolResult={result} />);
        expect(screen.getByText('no roll')).toBeTruthy();
    });

    it('a malformed request still resolves to "no roll", never a fabricated total', () => {
        const result = JSON.stringify({ player_total: null, source: 'malformed-request' });
        render(<ToolCallChips toolCalls={rollCall()} toolResult={result} />);
        expect(screen.getByText('no roll')).toBeTruthy();
    });
});
