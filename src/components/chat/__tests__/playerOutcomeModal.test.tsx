import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlayerOutcomeModal } from '../PlayerOutcomeModal';
import { PLAYER_OUTCOMES } from '../../../types';
import type { PlayerOutcomeRequest } from '../../../types';

/**
 * The modal generation suspends behind. Two properties are load-bearing:
 *
 *  1. It must ALWAYS hand back a value, because a promise the orchestrator is awaiting hangs
 *     the turn with `isStreaming` stuck true. Every affordance here settles it.
 *  2. It must show the terms the GM committed to, and nothing numeric. The difficulty is the
 *     whole honesty anchor now that the die and the bar are gone.
 */
const request: PlayerOutcomeRequest = {
    reason: 'Forcing the shutter before the patrol rounds the corner.',
    difficulty: 'hard',
    failureMeans: 'the frame gives loudly and they hear it',
};

const CONSEQUENCES = [
    'Noise — Not discovery, attention. A patrol changes its route.',
    'Trace — You are through, but you left something.',
];

const onSubmit = vi.fn();
const onDecline = vi.fn();

const renderModal = (over: Partial<PlayerOutcomeRequest> = {}, consequences: string[] = []) =>
    render(
        <PlayerOutcomeModal
            request={{ ...request, ...over }}
            consequences={consequences}
            onSubmit={onSubmit}
            onDecline={onDecline}
        />,
    );

const field = () => screen.getByRole('textbox') as HTMLTextAreaElement;
const rerollButton = () => screen.getByRole('button', { name: /reroll/i });

describe('PlayerOutcomeModal', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('shows the terms the GM committed to before it could see the answer', () => {
        renderModal();
        expect(screen.getByText('hard')).toBeTruthy();
        expect(screen.getByText(/Forcing the shutter/)).toBeTruthy();
        expect(screen.getByText(/the frame gives loudly/)).toBeTruthy();
    });

    it('offers all four outcomes and no number input', () => {
        const { container } = renderModal();
        expect(screen.getByRole('button', { name: /^1\s*Fail$/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Fail with consequence/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Success with consequence/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /^4\s*Success$/ })).toBeTruthy();
        // The old modal's free-text total is gone; the player never types a number again.
        expect(container.querySelector('input')).toBeNull();
    });

    // All four outcomes stay available whether or not the campaign has authored any
    // consequences — the player can always type one, so nothing is gated on the list.
    it('offers all four outcomes even with no consequences authored', () => {
        renderModal({}, []);
        expect(screen.getAllByRole('button', { name: /Fail|Success/ })).toHaveLength(4);
        for (const b of screen.getAllByRole('button', { name: /Fail|Success/ })) {
            expect((b as HTMLButtonElement).disabled).toBe(false);
        }
    });

    it.each(PLAYER_OUTCOMES.map((o, i) => [o, i] as const))(
        'clicking option %s submits it with the field text',
        (outcome, index) => {
            renderModal({}, [CONSEQUENCES[0]]);
            fireEvent.click(screen.getAllByRole('button')[index]);
            expect(onSubmit).toHaveBeenCalledWith(outcome, CONSEQUENCES[0]);
        },
    );

    it.each(PLAYER_OUTCOMES.map((o, i) => [String(i + 1), o] as const))(
        'pressing %s submits %s with the field text',
        (key, outcome) => {
            renderModal({}, [CONSEQUENCES[0]]);
            fireEvent.keyDown(window, { key });
            expect(onSubmit).toHaveBeenCalledWith(outcome, CONSEQUENCES[0]);
        },
    );

    it('ignores keys outside 1-4 rather than submitting something arbitrary', () => {
        renderModal();
        for (const key of ['0', '5', 'Enter', 'Escape', 'a']) {
            fireEvent.keyDown(window, { key });
        }
        expect(onSubmit).not.toHaveBeenCalled();
        expect(onDecline).not.toHaveBeenCalled();
    });

    it('unbinds its keys on unmount so a resolved request cannot answer a later one', () => {
        const { unmount } = renderModal();
        unmount();
        fireEvent.keyDown(window, { key: '1' });
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('"Leave it open" declines rather than picking an outcome', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: /Leave it open/ }));
        expect(onDecline).toHaveBeenCalledTimes(1);
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('"Decide for me" always submits a real outcome, carrying the field text', () => {
        renderModal({}, [CONSEQUENCES[0]]);
        fireEvent.click(screen.getByRole('button', { name: /Decide for me/ }));
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(PLAYER_OUTCOMES).toContain(onSubmit.mock.calls[0][0]);
        expect(onSubmit.mock.calls[0][1]).toBe(CONSEQUENCES[0]);
    });

    it('renders every difficulty label the tool can send', () => {
        for (const difficulty of ['trivial', 'easy', 'average', 'hard', 'impossible'] as const) {
            const { unmount } = renderModal({ difficulty });
            expect(screen.getByText(difficulty)).toBeTruthy();
            unmount();
        }
    });

    it('omits the failure line when the GM stated no cost, rather than showing an empty row', () => {
        renderModal({ failureMeans: '' });
        expect(screen.queryByText('if it fails')).toBeNull();
    });

    it('focuses the first option so the modal is reachable without a mouse', () => {
        renderModal();
        expect(document.activeElement).toBe(screen.getAllByRole('button')[0]);
    });
});

/**
 * The Consequence field. Engine draws, player approves or overrides, model renders — so the
 * properties that matter are that the draw happens, that the player can always beat it, and
 * that having an editable field on this surface has not armed the keyboard shortcuts against
 * the player.
 */
describe('PlayerOutcomeModal — the Consequence field', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('is labelled, and opens pre-populated from the campaign list', () => {
        renderModal({}, CONSEQUENCES);
        expect(screen.getByText('Consequence')).toBeTruthy();
        expect(CONSEQUENCES).toContain(field().value);
    });

    it('opens blank when the campaign has authored none', () => {
        renderModal({}, []);
        expect(field().value).toBe('');
    });

    it('reroll draws a different entry', () => {
        renderModal({}, CONSEQUENCES);
        const first = field().value;
        fireEvent.click(rerollButton());
        expect(field().value).not.toBe(first);
        expect(CONSEQUENCES).toContain(field().value);
    });

    it('reroll on a one-item list keeps that item rather than blanking the field', () => {
        renderModal({}, [CONSEQUENCES[0]]);
        fireEvent.click(rerollButton());
        expect(field().value).toBe(CONSEQUENCES[0]);
    });

    it('reroll is disabled, with an explanation, when there is nothing to draw', () => {
        renderModal({}, []);
        const btn = rerollButton() as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
        expect(btn.title).toMatch(/no consequences authored/i);
    });

    it('is editable, and the typed value is what gets submitted', () => {
        renderModal({}, CONSEQUENCES);
        fireEvent.change(field(), { target: { value: 'The rope frays where you cannot see it.' } });
        fireEvent.click(screen.getByRole('button', { name: /Fail with consequence/ }));
        expect(onSubmit).toHaveBeenCalledWith(
            'fail_with_consequence', 'The rope frays where you cannot see it.');
    });

    it('lets the player type one even when the campaign has no list', () => {
        renderModal({}, []);
        fireEvent.change(field(), { target: { value: 'Hand-written cost.' } });
        fireEvent.click(screen.getByRole('button', { name: /Success with consequence/ }));
        expect(onSubmit).toHaveBeenCalledWith('success_with_consequence', 'Hand-written cost.');
    });

    it('does not re-draw over an edit when the component re-renders', () => {
        const { rerender } = renderModal({}, CONSEQUENCES);
        fireEvent.change(field(), { target: { value: 'Mine.' } });
        rerender(
            <PlayerOutcomeModal
                request={request}
                consequences={CONSEQUENCES}
                onSubmit={onSubmit}
                onDecline={onDecline}
            />,
        );
        expect(field().value).toBe('Mine.');
    });

    // The regression that matters most here. The 1-4 shortcuts are bound on `window`, so
    // without a guard on the event target, typing a digit into this field would submit an
    // outcome and end the turn — silently, and with the wrong answer.
    it.each(['1', '2', '3', '4'])('typing %s in the field does NOT submit an outcome', (key) => {
        renderModal({}, CONSEQUENCES);
        const el = field();
        el.focus();
        fireEvent.keyDown(el, { key });
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('keeps the shortcuts working outside the field', () => {
        renderModal({}, CONSEQUENCES);
        fireEvent.keyDown(window, { key: '1' });
        expect(onSubmit).toHaveBeenCalledWith('fail', field().value);
    });

    it('declining ignores the field entirely', () => {
        renderModal({}, CONSEQUENCES);
        fireEvent.click(screen.getByRole('button', { name: /Leave it open/ }));
        expect(onDecline).toHaveBeenCalledTimes(1);
        expect(onSubmit).not.toHaveBeenCalled();
    });
});
