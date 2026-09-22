import type { ChatMessage, SceneStakes } from '../../types';

/**
 * The stakes the engine read for this GM reply, shown in the bubble header so the player can
 * see how the scene was classified — and, with the Flexible response length, why the next
 * reply runs short or long.
 *
 * Source, in order: the stamp written at commit (`msg.sceneStakes`, which includes the utility
 * classifier's answer when the writer omitted the tag), else the visible swipe variant's own
 * tag while the turn is still pending. An untagged pending variant shows nothing: its stakes
 * are not known until commit, and "calm" there would be a guess presented as a reading.
 */
export function stakesForMessage(msg: ChatMessage): SceneStakes | undefined {
    if (msg.role !== 'assistant') return undefined;
    if (msg.sceneStakes) return msg.sceneStakes;
    const variant = msg.swipeSet?.[msg.swipeActiveIndex ?? 0];
    if (!variant || variant.streaming || !variant.tagPresent) return undefined;
    return variant.sceneStakes;
}
