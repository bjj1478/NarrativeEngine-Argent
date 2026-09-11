import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { EnginesTab } from '../EnginesTab';
import { useAppStore } from '../../../store/useAppStore';
import { RESPONSE_LENGTHS } from '../../../types';

/**
 * The Response Length dial, rendered through the real EnginesTab and the real store.
 *
 * Deliberately mounts the whole tab rather than the section in isolation: the thing most
 * likely to break is not the section's markup but its wiring — that it is still mounted, and
 * that clicking an option actually reaches `updateContext`. A section that renders perfectly
 * while unmounted is the failure this is here to catch.
 */

/** The dial lives in its own bordered card; scope queries to it so the assertions do not
 *  accidentally match the neighbouring Ask To Resolve options. */
function dial(): HTMLElement {
    const heading = screen.getByText('Response Length');
    const card = heading.closest('div.border') as HTMLElement | null;
    if (!card) throw new Error('Response Length section did not render inside its card');
    return card;
}

describe('Engine Tuning — Response Length', () => {
    beforeEach(() => {
        useAppStore.setState({ context: { ...useAppStore.getState().context, responseLength: undefined } });
    });

    it('is mounted in the Engine Tuning tab', () => {
        render(<EnginesTab />);
        expect(screen.getByText('Response Length')).toBeTruthy();
    });

    /**
     * The two turn-shape dials sit side by side in one row. This is load-bearing rather than
     * cosmetic: the outer grid auto-flows, and there are an ODD number of engine blocks above
     * them, so without their own spanning row these two land in different rows. Adding or
     * removing an engine block would silently break the pairing, which is exactly the kind of
     * regression nobody notices until they open the tab.
     */
    it('shares a row with Ask To Resolve, in a 2-column pair', () => {
        render(<EnginesTab />);
        const lengthCard = dial();
        const askCard = screen.getByText('Ask To Resolve').closest('div.border') as HTMLElement;
        expect(askCard).toBeTruthy();

        // Same parent => same grid row.
        expect(lengthCard.parentElement).toBe(askCard.parentElement);

        const row = lengthCard.parentElement as HTMLElement;
        expect(row.className).toContain('xl:grid-cols-2');
        // Spans the full width of the outer grid, so the pair gets a row to itself.
        expect(row.className).toContain('xl:col-span-2');
        // Ask To Resolve first, Response Length second.
        expect(Array.from(row.children)).toEqual([askCard, lengthCard]);
    });

    it('offers exactly the four settings, once each', () => {
        render(<EnginesTab />);
        const buttons = within(dial()).getAllByRole('button');
        expect(buttons).toHaveLength(RESPONSE_LENGTHS.length);
        for (const label of ['Follow the scene', 'Short', 'Medium', 'Long']) {
            expect(within(dial()).getAllByText(label)).toHaveLength(1);
        }
    });

    // An existing campaign has no value saved. The dial must still show a selection rather
    // than rendering as if nothing were chosen.
    it('shows flexible as selected when nothing is saved', () => {
        render(<EnginesTab />);
        const selected = within(dial()).getByText('Follow the scene');
        expect(selected.className).toContain('text-terminal');
    });

    it('writes the chosen setting through to the campaign context', () => {
        render(<EnginesTab />);
        fireEvent.click(within(dial()).getByText('Long'));
        expect(useAppStore.getState().context.responseLength).toBe('long');

        fireEvent.click(within(dial()).getByText('Short'));
        expect(useAppStore.getState().context.responseLength).toBe('short');
    });

    it('moves the selection highlight to whatever is chosen', () => {
        render(<EnginesTab />);
        fireEvent.click(within(dial()).getByText('Medium'));
        expect(within(dial()).getByText('Medium').className).toContain('text-terminal');
        expect(within(dial()).getByText('Follow the scene').className).not.toContain('text-terminal');
    });

    // The prompt-side budgets are pinned in finalUserAssemblyGolden; the player-facing copy
    // must NOT restate them. A stated number here reads as a promise the model cannot keep,
    // and invites padding up to it — the same caution the roll-frequency options carry.
    it('never advertises a word or token count to the player', () => {
        render(<EnginesTab />);
        expect(dial().textContent ?? '').not.toMatch(/\d+\s*(words|tokens)/i);
    });
});
