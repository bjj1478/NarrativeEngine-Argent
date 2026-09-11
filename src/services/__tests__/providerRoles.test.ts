import { describe, expect, it } from 'vitest';
import type { AIPreset, LLMProvider, TurnCallbacks, TurnState } from '../../types';
import { buildHostFacade, MODEL_ROLES, type ModelRole } from '../turn/hostFacade';
import {
    PROVIDER_ROLES,
    REQUIRED_PROVIDER_ROLES,
    MissingProviderRoleError,
    findUnassignedRequiredRoles,
} from '../providerRoles';
import { migrateSettings } from '../../store/slices/settingsHelpers';

function endpoint(modelName: string) {
    return { endpoint: 'http://localhost', apiKey: '', modelName };
}

/**
 * A TurnState with every role assigned to a distinctly-named endpoint, so a call
 * that silently borrows another role's model is visible in the assertion.
 */
function makeState(over: Partial<TurnState> = {}): TurnState {
    return {
        input: 'hi',
        displayInput: 'hi',
        settings: { presets: [], providers: [] } as never,
        context: {} as never,
        messages: [],
        condenser: {} as never,
        loreChunks: [],
        npcLedger: [],
        archiveIndex: [],
        activeCampaignId: 'camp',
        provider: endpoint('story'),
        getMessages: () => [],
        getFreshProvider: () => endpoint('story'),
        getUtilityEndpoint: () => endpoint('utility'),
        getDirectorEndpoint: () => endpoint('director'),
        getExtractionEndpoint: () => endpoint('extraction'),
        getFreshAuxiliaryProvider: () => endpoint('auxiliary'),
        getRawAuxiliaryProvider: () => endpoint('auxiliary'),
        getRawSummariserProvider: () => endpoint('summariser'),
        chapters: [],
        ...over,
    } as unknown as TurnState;
}

const noopCallbacks = new Proxy({}, { get: () => () => undefined }) as TurnCallbacks;

describe('provider roles — no role substitutes for another', () => {
    it.each([
        ['story', 'story'],
        ['director', 'director'],
        ['extraction', 'extraction'],
        ['utility', 'utility'],
        ['auxiliary', 'auxiliary'],
        ['summariser', 'summariser'],
    ] as const)('role %s resolves to its own assignment', async (role, expected) => {
        const seen: string[] = [];
        const facade = buildHostFacade(makeState(), noopCallbacks, {
            modelCall: async (_role, _request, resolved) => {
                seen.push(resolved?.modelName ?? 'none');
                return { content: '' };
            },
        });
        await facade.model.call(role as ModelRole, { prompt: 'x' });
        expect(seen).toEqual([expected]);
    });

    // The whole point of the split: a cheap model on one slot must never be reached
    // for another slot's work, and an unassigned slot must not silently borrow Story.
    it.each([
        ['director', 'getDirectorEndpoint'],
        ['extraction', 'getExtractionEndpoint'],
        ['utility', 'getUtilityEndpoint'],
    ] as const)('role %s throws when unassigned rather than falling back to story', async (role, getter) => {
        const facade = buildHostFacade(
            makeState({ [getter]: () => undefined } as Partial<TurnState>),
            noopCallbacks,
        );
        await expect(facade.model.call(role as ModelRole, { prompt: 'x' }))
            .rejects.toBeInstanceOf(MissingProviderRoleError);
    });

    it('reports a role unavailable when it resolves to nothing, not merely when the getter is absent', () => {
        // These two answers used to disagree: a getter that exists but returns
        // undefined reported "available" and then threw when called.
        const facade = buildHostFacade(
            makeState({ getUtilityEndpoint: () => undefined }),
            noopCallbacks,
        );
        expect(facade.model.available('utility')).toBe(false);
        expect(facade.model.available('extraction')).toBe(true);
    });

    it('keeps raw-* aliases resolving identically to their base role', async () => {
        const seen: Array<string | undefined> = [];
        const facade = buildHostFacade(makeState(), noopCallbacks, {
            modelCall: async (_role, _request, resolved) => {
                seen.push(resolved?.modelName);
                return { content: '' };
            },
        });
        await facade.model.call('auxiliary', { prompt: 'x' });
        await facade.model.call('raw-auxiliary', { prompt: 'x' });
        await facade.model.call('summariser', { prompt: 'x' });
        await facade.model.call('raw-summariser', { prompt: 'x' });
        expect(seen).toEqual(['auxiliary', 'auxiliary', 'summariser', 'summariser']);
    });

    it('declares every ModelRole in MODEL_ROLES', () => {
        // MODEL_ROLES is hand-maintained rather than derived from the union, and the
        // sandbox boundary rejects anything missing from it.
        expect([...MODEL_ROLES].sort()).toEqual([
            'auxiliary', 'director', 'extraction', 'raw-auxiliary',
            'raw-summariser', 'story', 'summariser', 'utility',
        ]);
    });
});

describe('findUnassignedRequiredRoles', () => {
    const providers = [{ id: 'p1', label: 'P1', endpoint: '', apiKey: '', modelName: 'm' }] as LLMProvider[];

    function preset(over: Partial<AIPreset> = {}): AIPreset {
        return {
            id: 'preset',
            name: 'Preset',
            ...Object.fromEntries(REQUIRED_PROVIDER_ROLES.map(r => [r.presetField, 'p1'])),
            storyAIProviderId: 'p1',
            ...over,
        } as AIPreset;
    }

    it('returns nothing when every required slot resolves', () => {
        expect(findUnassignedRequiredRoles(preset(), providers)).toEqual([]);
    });

    it('flags a required slot that is empty', () => {
        const missing = findUnassignedRequiredRoles(preset({ directorAIProviderId: '' }), providers);
        expect(missing.map(r => r.key)).toEqual(['director']);
    });

    it('flags a required slot pointing at a provider that no longer exists', () => {
        const missing = findUnassignedRequiredRoles(preset({ extractionAIProviderId: 'deleted' }), providers);
        expect(missing.map(r => r.key)).toEqual(['extraction']);
    });

    it('ignores optional slots', () => {
        const missing = findUnassignedRequiredRoles(
            preset({ imageAIProviderId: '', visionAIProviderId: '' }),
            providers,
        );
        expect(missing).toEqual([]);
    });

    it('treats a missing preset as every required role unassigned', () => {
        expect(findUnassignedRequiredRoles(undefined, providers)).toEqual(REQUIRED_PROVIDER_ROLES);
    });
});

describe('migration backfills required slots', () => {
    it('fills unassigned required slots from Story and leaves optional slots empty', () => {
        const migrated = migrateSettings({
            providers: [{ id: 'p1', label: 'P1', endpoint: 'http://x', apiKey: '', modelName: 'm' }],
            presets: [{ id: 'preset', name: 'Old', storyAIProviderId: 'p1' }],
            activePresetId: 'preset',
        });
        const preset = migrated.presets[0];

        for (const role of REQUIRED_PROVIDER_ROLES) {
            expect(preset[role.presetField], `${role.key} should be backfilled`).toBe('p1');
        }
        for (const role of PROVIDER_ROLES.filter(r => !r.required)) {
            expect(preset[role.presetField], `${role.key} should stay unset`).toBe('');
        }
        expect(findUnassignedRequiredRoles(preset, migrated.providers)).toEqual([]);
    });

    it('preserves explicit assignments rather than overwriting them with Story', () => {
        const migrated = migrateSettings({
            providers: [
                { id: 'p1', label: 'P1', endpoint: 'http://x', apiKey: '', modelName: 'm' },
                { id: 'p2', label: 'P2', endpoint: 'http://y', apiKey: '', modelName: 'n' },
            ],
            presets: [{ id: 'preset', name: 'Old', storyAIProviderId: 'p1', utilityAIProviderId: 'p2' }],
            activePresetId: 'preset',
        });
        expect(migrated.presets[0].utilityAIProviderId).toBe('p2');
        expect(migrated.presets[0].extractionAIProviderId).toBe('p1');
    });

    it('arms the utility notice only when utility was actually unassigned', () => {
        const backfilled = migrateSettings({
            providers: [{ id: 'p1', label: 'P1', endpoint: 'http://x', apiKey: '', modelName: 'm' }],
            presets: [{ id: 'preset', name: 'Old', storyAIProviderId: 'p1' }],
            activePresetId: 'preset',
        });
        expect(backfilled.utilityRoleBackfillNoticePending).toBe(true);

        const alreadySet = migrateSettings({
            providers: [{ id: 'p1', label: 'P1', endpoint: 'http://x', apiKey: '', modelName: 'm' }],
            presets: [{ id: 'preset', name: 'Old', storyAIProviderId: 'p1', utilityAIProviderId: 'p1' }],
            activePresetId: 'preset',
        });
        expect(alreadySet.utilityRoleBackfillNoticePending).toBe(false);
    });

    it('does not re-arm the notice once the user has dismissed it', () => {
        // migrateSettings runs on every load, so a sticky dismissal matters.
        const migrated = migrateSettings({
            providers: [{ id: 'p1', label: 'P1', endpoint: 'http://x', apiKey: '', modelName: 'm' }],
            presets: [{ id: 'preset', name: 'Old', storyAIProviderId: 'p1' }],
            activePresetId: 'preset',
            utilityRoleBackfillNoticePending: false,
        });
        expect(migrated.utilityRoleBackfillNoticePending).toBe(false);
    });
});
