import type { NPCEntry, ChatMessage, EndpointConfig, ProviderConfig } from '../../types';
import { generateNPCProfile, updateExistingNPCs } from '../npcGeneration';
import { resolveNpcSelection } from './npcManualResolve';

export type AddNpcResult = {
    ok: boolean;
    kind: 'created' | 'updated' | 'ambiguous' | 'empty' | 'error';
    name?: string;
    message: string;
    matches?: string[];
};

export type AddNpcDeps = {
    rawText: string;
    ledger: NPCEntry[];
    messages: ChatMessage[];
    campaignId: string;
    storyProvider?: EndpointConfig | ProviderConfig;
    updateProvider?: EndpointConfig | ProviderConfig;
    addNPC: (npc: NPCEntry) => void;
    updateNPC: (id: string, patch: Partial<NPCEntry>) => void;
    /** `settings.matureMode`. Gates the mature tier of the trait and want pools during
     *  generation, exactly as it already gates the per-turn reaction menu. Injected rather
     *  than read from the store so this stays a pure service; absent reads as OFF. */
    matureMode?: boolean;
};

export async function addNpcFromSelection(deps: AddNpcDeps): Promise<AddNpcResult> {
    const resolution = resolveNpcSelection(deps.rawText, deps.ledger);

    switch (resolution.kind) {
        case 'empty':
            return { ok: false, kind: 'empty', message: 'Couldn’t read a name from the selection.' };

        case 'ambiguous': {
            const matches = resolution.matches.map(m => m.name);
            return {
                ok: false,
                kind: 'ambiguous',
                name: resolution.name,
                matches,
                message: `Multiple "${resolution.name}" in the ledger (${matches.join(', ')}). No change made — highlight a fuller name.`,
            };
        }

        case 'update': {
            if (!deps.updateProvider) return { ok: false, kind: 'error', message: 'No AI provider configured.' };
            try {
                await updateExistingNPCs(deps.updateProvider, deps.messages, [resolution.npc], deps.updateNPC);
                return { ok: true, kind: 'updated', name: resolution.npc.name, message: `Updated ${resolution.npc.name}.` };
            } catch (e) {
                return { ok: false, kind: 'error', message: `Update failed: ${e instanceof Error ? e.message : String(e)}` };
            }
        }

        case 'create': {
            if (!deps.storyProvider) return { ok: false, kind: 'error', message: 'No AI provider configured.' };
            try {
                // `existingLedger` and `matureMode` are positional and were both being dropped.
                // Omitting them silently disabled two guards that generation already implements:
                // the roster/reserved-name contrast that stops the model reusing a name already
                // in the ledger, and the mature-tier gate on the trait and want draws — which
                // made Mature Mode inert for every newly generated NPC no matter the setting.
                await generateNPCProfile(
                    deps.storyProvider, deps.messages, resolution.name, deps.addNPC,
                    deps.ledger, deps.matureMode ?? false,
                );
                return { ok: true, kind: 'created', name: resolution.name, message: `Added ${resolution.name} to the ledger.` };
            } catch (e) {
                return { ok: false, kind: 'error', message: `Add failed: ${e instanceof Error ? e.message : String(e)}` };
            }
        }
    }
}