import type { PostTurnTrack, SequentialTrackContext } from '../types';

export const repressionTrack: PostTurnTrack<SequentialTrackContext> = {
    id: 'track.repression',
    name: 'Inner Repression Booking',
    description: 'Books once-per-turn repression pressure for on-stage hex NPCs.',
    toggleable: false,
    defaultEnabled: true,
    trigger: 'automatic',
    callsModel: false,
    shouldRun: () => true,
    async run(ctx) {
        // The payload reaction menu (world.ts read path) MASKS a hostile impulse on every render but
        // intentionally drops the repression `event`, because payload assembly re-runs within a turn
        // and would double-count. THIS is the single authoritative booking site: roll repression once
        // per on-stage hex NPC and persist the pressure delta, so the build-up → burst dynamic actually
        // fires (without this, repressionPressure never accrues and the feature is inert). Zero LLM;
        // pure dice. Ungated (mirrors the menu, which is shown on every tier). Never inside payload.
        try {
            const { buildReactionMenu, contextsForStakes } = await import('../../../npc/reactionMenu');
            const { applyRepressionToMenu, bookRepression } = await import('../../../npc/reactionRepression');
            const onStageSet = new Set(ctx.onStageIds);
            const matureMode = ctx.settings.matureMode ?? false;
            // Same stakes-derived contexts the payload path uses, so the menu this books
            // repression against is the menu the model was actually shown. Hardcoding
            // 'peaceful' here scored the accrual off a different table than the prompt's.
            const contexts = contextsForStakes(ctx.state.context.lastSceneStakes);
            // Repression only ever engages on the peaceful half, so a tense scene (both halves)
            // still represses — mirrors buildReactionMenuLine.
            const repressionContext = contexts.includes('peaceful') ? 'peaceful' as const : 'dangerous' as const;
            for (const npc of ctx.npcLedger) {
                if (!onStageSet.has(npc.id) || !npc.personalityHex) continue;
                const rng = Math.random; // one fresh roll per turn per NPC — that IS the once-per-turn accrual
                const relationshipMemoryEnabled = ctx.state.context.relationshipMemory === true;
                const menu = relationshipMemoryEnabled
                    ? buildReactionMenu(npc, contexts, rng, matureMode, true)
                    : buildReactionMenu(npc, contexts, rng, matureMode);
                const { event } = applyRepressionToMenu(menu, npc, repressionContext, rng);
                if (!event) continue; // nothing repressible this turn
                const patch = bookRepression(npc, event, ctx.state.context.relationshipMemory === true);
                if (Object.keys(patch).length > 0) ctx.callbacks.updateNPC(npc.id, patch);
            }
        } catch (err) {
            console.warn('[RepressionBooking] Failed (non-fatal):', err);
        }
    },
};
