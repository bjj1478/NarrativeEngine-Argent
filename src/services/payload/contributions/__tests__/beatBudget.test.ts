import { describe, it, expect } from 'vitest';
import { beatBudgetLine } from '../builtins';
import { extractAndStripSceneStakes } from '../../../turn/sceneStakesTag';

describe('beatBudgetLine — flexible stakes', () => {
    it.each(['tense', 'dangerous'] as const)('%s lets a player-chosen retreat settle the scene', (stakes) => {
        const line = beatBudgetLine('flexible', stakes);
        expect(line).toContain('that choice is the resolution');
        expect(line).toContain('let the pressure ease and the scene settle');
        // The closing clauses every variant carries stay intact.
        expect(line).toMatch(/This overrides any length or paragraph guidance in the rules\.\]$/);
    });

    it('dangerous still forbids resolving the danger for the player', () => {
        expect(beatBudgetLine('flexible', 'dangerous')).toContain("never resolve the danger on the player's behalf");
    });

    it('calm and fixed lengths carry no de-escalation clause', () => {
        expect(beatBudgetLine('flexible', 'calm')).not.toContain('that choice is the resolution');
        expect(beatBudgetLine('short', 'dangerous')).not.toContain('that choice is the resolution');
    });
});

// Upstream now ASKS the GM for the stakes tag (desktop saw 0 tags in ~1,200 archived
// scenes before that, so stakes came only from the fallback classifier and every lite
// scene read 'calm'). These branches therefore start running in earnest. This covers the
// whole hop — a tagged reply in, the next turn's budget out — not just the line shaping.
describe('scene-stakes tag → next turn\'s beat budget', () => {
    const reply = [
        'The blade stops a finger from your throat.',
        '',
        '[[SCENE_STAKES: dangerous]]',
    ].join('\n');

    it('strips the tag from the bubble and carries the reading into the budget', () => {
        const { displayText, stakes } = extractAndStripSceneStakes(reply);

        // The tag is metadata: it must never survive into what the player reads.
        expect(displayText).not.toContain('SCENE_STAKES');
        expect(displayText).toBe('The blade stops a finger from your throat.');
        expect(stakes).toBe('dangerous');

        // `stakes` is what lands on context.lastSceneStakes and drives the next turn.
        const line = beatBudgetLine('flexible', stakes);
        expect(line).toContain('The scene is dangerous');
        expect(line).toContain('that choice is the resolution');
    });

    it('an untagged reply falls back to calm, so the budget never carries the clause', () => {
        const { displayText, stakes } = extractAndStripSceneStakes('Nothing happens.');

        expect(displayText).toBe('Nothing happens.');
        expect(stakes).toBe('calm');
        expect(beatBudgetLine('flexible', stakes)).not.toContain('that choice is the resolution');
    });
});
