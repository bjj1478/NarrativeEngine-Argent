import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { ChatMessage, SceneStakes, SwipeVariant } from '../../../types';
import { SceneStakesChip } from '../SceneStakesChip';
import { stakesForMessage } from '../stakesForMessage';

const gm = (extra: Partial<ChatMessage> = {}): ChatMessage =>
    ({ id: 'm1', role: 'assistant', content: 'x', timestamp: 0, ...extra });
const variant = (sceneStakes: SceneStakes, tagPresent: boolean, streaming = false): SwipeVariant =>
    ({ id: 'v', text: 'x', sceneStakes, tagPresent, streaming });

describe('stakesForMessage', () => {
    it('prefers the stakes stamped at commit', () => {
        expect(stakesForMessage(gm({ sceneStakes: 'dangerous' }))).toBe('dangerous');
    });

    it('reads the visible tagged variant while the turn is pending', () => {
        const msg = gm({ swipeSet: [variant('calm', true), variant('tense', true)], swipeActiveIndex: 1 });
        expect(stakesForMessage(msg)).toBe('tense');
    });

    it('shows nothing for an untagged or still-streaming variant', () => {
        expect(stakesForMessage(gm({ swipeSet: [variant('calm', false)] }))).toBeUndefined();
        expect(stakesForMessage(gm({ swipeSet: [variant('tense', true, true)] }))).toBeUndefined();
    });

    it('shows nothing on non-GM messages or pre-feature history', () => {
        expect(stakesForMessage({ ...gm({ sceneStakes: 'tense' }), role: 'user' })).toBeUndefined();
        expect(stakesForMessage(gm())).toBeUndefined();
    });
});

describe('SceneStakesChip', () => {
    it.each([['calm', 'Calm', 1], ['tense', 'Tense', 2], ['dangerous', 'Dangerous', 3]] as const)(
        '%s renders its label and fills %s-of-3 pips', (stakes, label, filled) => {
            const { container } = render(<SceneStakesChip stakes={stakes} />);
            const chip = container.querySelector('[data-ui="msg-stakes"]')!;
            expect(chip.textContent).toBe(label);
            expect(chip.getAttribute('title')).toContain(`Scene read as ${label.toLowerCase()}`);
            const pips = chip.querySelectorAll('span[aria-hidden] > span');
            expect([...pips].filter(p => !p.className.includes('opacity-25'))).toHaveLength(filled);
        });

    it('falls back to calm for an unknown value instead of crashing', () => {
        const { container } = render(<SceneStakesChip stakes={'urgent' as SceneStakes} />);
        expect(container.textContent).toBe('Calm');
    });
});
