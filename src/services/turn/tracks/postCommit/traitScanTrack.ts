import { scanCharacterTraits } from '../../../characterTraitParser';
import { backgroundQueue } from '../../../infrastructure/backgroundQueue';
import { tierAllows } from '../../aiTier';
import type { PostCommitTrackContext, PostTurnTrack } from '../types';
import { assertStillActive } from '../guarded';

export const traitScanTrack: PostTurnTrack<PostCommitTrackContext> = {
    id: 'track.trait-scan',
    name: 'Trait Scan',
    description: 'Maintains the structured character traits from recent messages.',
    toggleable: true,
    defaultEnabled: true,
    trigger: 'automatic',
    callsModel: true,
    shouldRun: (ctx) => ctx.bookkeepingDue
        && ctx.bkAvailable
        && !!ctx.freshContext.playerCharacter
        && tierAllows(ctx.facade?.config.aiTier ?? ctx.state.settings.aiTier, 'profileScan'),
    async run(ctx) {
        const pc = ctx.freshContext.playerCharacter;
        if (!pc) return;
        const currentTraits = pc.activeTraits ?? [];
        const pcName = pc.name ?? '';
        backgroundQueue.push('Trait-Scan', async () => {
            if (!assertStillActive(ctx.activeCampaignId, 'Trait-Scan')) return;
            const newTraits = await scanCharacterTraits(
                ctx.facade ? undefined : ctx.bkProvider,
                ctx.scanMessages,
                currentTraits,
                pcName,
                ctx.storyModelCall,
            );
            if (!assertStillActive(ctx.activeCampaignId, 'Trait-Scan')) return;
            // MUST be a single-key patch through `updatePlayerCharacter`, never a whole-record
            // write. The background queue runs two jobs at once, so this and PC-Drift are in
            // flight together against the same record; both captured their snapshot before the
            // other had written. `updatePlayerCharacter` re-reads live state and merges inside
            // one synchronous `set`, so a patch naming only the key it owns cannot clobber the
            // other track. Writing `{ ...pc, activeTraits }` here would erase whatever drift
            // had just written to signatureKit / appearance / status / faction / wants.
            if (!ctx.guardedUpdatePlayerCharacter) {
                console.warn('[Auto Bookkeeping] Trait scan has no PC writer on the track context — traits dropped for this turn.');
                return;
            }
            ctx.guardedUpdatePlayerCharacter({ activeTraits: newTraits });
            console.log(`[Auto Bookkeeping] Traits updated at scene #${ctx.sceneId} (${newTraits.filter(t => !t.superseded).length} active)`);
        }).catch(err => console.warn('[Auto Bookkeeping] Trait scan failed:', err));
    },
};
