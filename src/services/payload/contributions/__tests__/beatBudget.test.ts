import { describe, it, expect } from 'vitest';
import { beatBudgetLine } from '../builtins';

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
