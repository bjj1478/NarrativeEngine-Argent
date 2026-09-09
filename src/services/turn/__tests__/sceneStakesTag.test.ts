import { describe, it, expect } from 'vitest';
import { extractAndStripSceneStakes } from '../sceneStakesTag';

/**
 * The receive side of the scene-stakes tag. All of this existed before anything ASKED the
 * writer for the tag (see the note in stable.ts); these cases cover what became reachable
 * the moment the prompt started requesting it on every turn.
 */
describe('extractAndStripSceneStakes', () => {
    it('reads the stakes and strips the tag from the display text', () => {
        const { displayText, stakes } = extractAndStripSceneStakes(
            'The guard raises the alarm.\n[[SCENE_STAKES: dangerous]]',
        );
        expect(stakes).toBe('dangerous');
        expect(displayText).toBe('The guard raises the alarm.');
    });

    it('is case- and whitespace-tolerant on the value', () => {
        expect(extractAndStripSceneStakes('x\n[[SCENE_STAKES:  Tense  ]]').stakes).toBe('tense');
    });

    it('reads as calm when no tag is present, leaving the prose untouched', () => {
        const text = 'A quiet afternoon in the orchard.';
        expect(extractAndStripSceneStakes(text)).toEqual({ displayText: text, stakes: 'calm' });
    });

    // `\s*\S+\s*` matched neither pattern once the value contained a space, so the tag
    // survived into the player's prose. A requested tag gets malformed often enough that
    // this had to become a strip, not a miss.
    it('strips a multi-word value it cannot parse, rather than leaving it in the prose', () => {
        const { displayText, stakes } = extractAndStripSceneStakes(
            'The rope creaks.\n[[SCENE_STAKES: very tense]]',
        );
        expect(displayText).toBe('The rope creaks.');
        expect(displayText).not.toContain('SCENE_STAKES');
        // Unparseable reads as calm — the classifier fallback owns this case.
        expect(stakes).toBe('calm');
    });

    it('strips EVERY copy, not just the first', () => {
        const { displayText, stakes } = extractAndStripSceneStakes(
            '[[SCENE_STAKES: tense]]\nHe steps back.\n[[SCENE_STAKES: tense]]',
        );
        expect(stakes).toBe('tense');
        expect(displayText).toBe('He steps back.');
        expect(displayText).not.toContain('SCENE_STAKES');
    });

    it('strips a valid tag alongside a garbled one', () => {
        const { displayText, stakes } = extractAndStripSceneStakes(
            '[[SCENE_STAKES: no idea]]\nShe waits.\n[[SCENE_STAKES: dangerous]]',
        );
        expect(stakes).toBe('dangerous');
        expect(displayText).toBe('She waits.');
    });

    // The strip regex is global, so it carries a lastIndex. It must only ever be used via
    // String.match/replace, which reset it — never RegExp.test/exec, which would make the
    // second identical call behave differently from the first.
    it('is not stateful across calls', () => {
        const text = 'Boots on gravel.\n[[SCENE_STAKES: tense]]';
        const first = extractAndStripSceneStakes(text);
        const second = extractAndStripSceneStakes(text);
        expect(second).toEqual(first);
    });
});
