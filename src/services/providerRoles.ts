import type { AIPreset, LLMProvider } from '../types';

/**
 * The provider-role slots a preset assigns models to.
 *
 * One source of truth for the slot list. Before this existed the eight slots were
 * hand-repeated in nine places (preset type, store getters, `removeProvider` orphan
 * cleanup, two migration paths, `defaultPreset`, new-preset defaults, and the settings
 * UI), which is how the Director ended up sharing a slot labelled "NPC Classification".
 * Anything that needs to walk the slots should walk `PROVIDER_ROLES`.
 */
export type ProviderRoleKey =
    | 'story'
    | 'director'
    | 'extraction'
    | 'auxiliary'
    | 'utility'
    | 'summarizer'
    | 'image'
    | 'vision';

export type ProviderRoleSpec = {
    readonly key: ProviderRoleKey;
    /** The `AIPreset` field holding this slot's provider id. */
    readonly presetField: PresetProviderField;
    readonly label: string;
    readonly description: string;
    /**
     * Required slots must resolve to a provider; an unassigned one throws rather than
     * borrowing another slot's model. Optional slots gate a feature instead — leaving
     * them unset disables that feature visibly, which is explicit rather than hidden.
     */
    readonly required: boolean;
};

export type PresetProviderField = Extract<keyof AIPreset, `${string}AIProviderId`>;

export const PROVIDER_ROLES: readonly ProviderRoleSpec[] = [
    {
        key: 'story',
        presetField: 'storyAIProviderId',
        label: 'Story AI — GM Narration',
        description: 'Writes the prose the player reads: narration, Scene Continue, swipes and Ask GM. Also invents new content — encounter tags, complications, arcs and the overworld.',
        required: true,
    },
    {
        key: 'director',
        presetField: 'directorAIProviderId',
        label: 'Director AI — Scene Direction',
        description: 'Runs the Director Brief: audits the last turn and issues the directives that steer the next GM reply. Blocking and in-turn, so latency here is felt directly.',
        required: true,
    },
    {
        key: 'extraction',
        presetField: 'extractionAIProviderId',
        label: 'Extraction AI — Structured Data',
        description: 'Reads scenes and reports structured facts: importance rating, inventory/location/trait scans, NPC detection and updates, scene events. Never writes prose — a small fast model suits this.',
        required: true,
    },
    {
        key: 'auxiliary',
        presetField: 'auxiliaryAIProviderId',
        label: 'Worldbuilding & Lore AI',
        description: 'Lore formatting, expansion and import, the World Primer, and AI-guided character creation.',
        required: true,
    },
    {
        key: 'utility',
        presetField: 'utilityAIProviderId',
        label: 'Utility AI — Retrieval & Context',
        description: 'Chooses what the GM sees: archive recall, context recommendation, query expansion, reranking, rules and lore indexing, fact clustering. Never writes prose.',
        required: true,
    },
    {
        key: 'summarizer',
        presetField: 'summarizerAIProviderId',
        label: 'Summarizer & Context AI',
        description: 'Chapter summaries, synopsis backfill and divergence pruning, location enrichment, lore-check rewrites and timeskip narration.',
        required: true,
    },
    {
        key: 'image',
        presetField: 'imageAIProviderId',
        label: 'Image Generation AI',
        description: 'NPC portraits and scene illustrations. Leave unset to disable image generation.',
        required: false,
    },
    {
        key: 'vision',
        presetField: 'visionAIProviderId',
        label: 'Vision AI (Reads Images)',
        description: 'Turns an attached image into character-sheet text. Must be a multimodal model. Leave unset to hide "Read Image".',
        required: false,
    },
];

export const REQUIRED_PROVIDER_ROLES: readonly ProviderRoleSpec[] =
    PROVIDER_ROLES.filter(role => role.required);

export const PRESET_PROVIDER_FIELDS: readonly PresetProviderField[] =
    PROVIDER_ROLES.map(role => role.presetField);

export function providerRoleByKey(key: ProviderRoleKey): ProviderRoleSpec {
    const spec = PROVIDER_ROLES.find(role => role.key === key);
    if (!spec) throw new Error(`Unknown provider role: ${key}`);
    return spec;
}

/**
 * Thrown when a required role has no assigned provider. Carries the role so callers
 * can name it; the message is user-facing.
 */
export class MissingProviderRoleError extends Error {
    readonly role: string;
    constructor(role: string) {
        const spec = PROVIDER_ROLES.find(r => r.key === role);
        super(
            spec
                ? `No model assigned to "${spec.label}". Open Settings → Presets and assign a provider to every required slot.`
                : `No model assigned to the "${role}" role. Open Settings → Presets and assign a provider to every required slot.`,
        );
        this.name = 'MissingProviderRoleError';
        this.role = role;
    }
}

/**
 * Required slots on this preset with no resolvable provider. Empty means the preset
 * is runnable. Used by the settings UI to flag slots and by the turn preflight to
 * fail before any work starts, rather than mid-turn.
 */
export function findUnassignedRequiredRoles(
    preset: AIPreset | undefined,
    providers: readonly LLMProvider[],
): readonly ProviderRoleSpec[] {
    if (!preset) return REQUIRED_PROVIDER_ROLES;
    return REQUIRED_PROVIDER_ROLES.filter(role => {
        const id = preset[role.presetField];
        return !id || !providers.some(provider => provider.id === id);
    });
}
