import type {
    AiTier,
    ArchiveChapter,
    ArchiveIndexEntry,
    InventoryItem,
    LocationEntry,
    LocationSuggestion,
    ChatMessage,
    CondenserState,
    DivergenceRegister,
    GameContext,
    LoreChunk,
    NPCEntry,
    PlayerCharacter,
    ProviderConfig,
    EndpointConfig,
    SemanticFact,
    TimelineEvent,
    ThinkingEffort,
    TravelState,
} from '../../types';
import { llmCall, type LLMCallPriority } from '../../utils/llmCall';
import { extractJson } from '../infrastructure/jsonExtract';
import { MissingProviderRoleError } from '../providerRoles';
import type { TurnCallbacks, TurnState } from './turnOrchestrator';
import { createReactiveReadHub, disposeCampaignSubscriptions, type ReactiveReadHub, type ReactiveStoreLike } from '../mods/reactiveReads';

/**
 * Service roles a turn can broker a model call for.
 *
 * `raw-auxiliary` / `raw-summariser` are LEGACY ALIASES. They existed only to opt
 * out of the silent Story fallback that `auxiliary` / `summariser` used to apply.
 * Every required role is now explicitly assigned and resolution never substitutes,
 * so they resolve identically to their base role. They are kept because the mod
 * surface is additive-only within API generation 1 (`docs/MODDING.md` §"Compatibility
 * and the frozen surface") — they cannot be removed until the generation bumps.
 */
export type ModelRole =
    | 'story'
    | 'director'
    | 'extraction'
    | 'utility'
    | 'auxiliary'
    | 'summariser'
    | 'raw-auxiliary'
    | 'raw-summariser';
/** Hand-maintained: NOT derived from the union. Keep in sync with `ModelRole`,
 *  `server/lib/modLoader.js` (COMPUTE_MODEL_ROLES) and `docs/narrative-mod-api.d.ts`. */
export const MODEL_ROLES: readonly ModelRole[] = [
    'story',
    'director',
    'extraction',
    'utility',
    'auxiliary',
    'summariser',
    'raw-auxiliary',
    'raw-summariser',
];
export const MODEL_JSON_RETRY_SUFFIX = '\n\nIMPORTANT: Your previous response was not valid JSON. Respond with ONLY valid JSON. No markdown fences, no comments, no trailing commas, no extra text before or after the JSON.';

export type ModelRequest = {
    prompt: string;
    signal?: AbortSignal;
    maxTokens?: number;
    temperature?: number;
    priority?: LLMCallPriority;
    trackingLabel?: string;
    timeoutMs?: number;
    thinkingEffort?: ThinkingEffort;
};

export type ModelResponse = {
    content: string;
};
/** Completed responses are sufficient for every measured consumer; incremental model.stream chunks have no consumer. */
export type ModelJsonOptions = {
    retries?: number;
};
export type ModelCall = (role: ModelRole, request: ModelRequest) => Promise<ModelResponse>;
export async function callModelJson(
    role: ModelRole,
    request: ModelRequest,
    call: ModelCall,
    options: ModelJsonOptions = {},
): Promise<unknown> {
    const requestedRetries = typeof options.retries === 'number' && Number.isFinite(options.retries) ? Math.floor(options.retries) : 1;
    const retries = Math.min(1, Math.max(0, requestedRetries));
    let response = await call(role, request);
    try {
        return JSON.parse(extractJson(response.content));
    } catch (firstError) {
        if (retries === 0) throw firstError;
        response = await call(role, {
            ...request,
            prompt: request.prompt + '\n\n' + response.content + MODEL_JSON_RETRY_SUFFIX,
        });
        return JSON.parse(extractJson(response.content));
    }
}

export interface FacadeData {
    readonly archiveIndex: ArchiveIndexEntry[];
    readonly context: GameContext;
    readonly npcLedger: NPCEntry[];
    readonly messages: ChatMessage[];
    readonly activeCampaignId: string | null;
    readonly input: string;
    readonly loreChunks: LoreChunk[];
    readonly onStageNpcIds: string[];
    readonly divergenceRegister: DivergenceRegister;
    readonly timeline: TimelineEvent[];
    readonly condenser: CondenserState;
    readonly semanticFacts: SemanticFact[];
    /**
     * Phase 4.0 / `API.md` §8.6 item 6 — the host's chapter list, projected
     * to `ModChapter` by `buildModContext`. The raw `ArchiveChapter` shape
     * is internal (`API.md` §4.4 — the archive/LOD subsystem is the least
     * settled part of the app and freezing it mid-flight is a real cost);
     * the projection stays here so the mod surface never sees the raw type.
     */
    readonly chapters: ArchiveChapter[];
}

export interface FacadeConfig {
    readonly aiTier: AiTier | undefined;
    readonly contextLimit: number;
    readonly archiveRecallDepth: 'lean' | 'standard' | 'deep';
    readonly autoArchiveStaleNPCsTurns: number;
    readonly divergenceScanBudget: number;
    readonly enableArchivePlanner: boolean;
    readonly lodElevateScenes: number;
    readonly lodImportanceBonus: number;
    readonly lodSlottedMaxPerScene: number;
    readonly lodSummaryChapters: number;
}

export interface FacadeWrites {
    readonly updateContext: (patch: Partial<GameContext>) => void;
    readonly updateNPC: (id: string, patch: Partial<NPCEntry>) => void;
    readonly addMessage: (msg: ChatMessage) => void;
    readonly setDivergenceRegister: (register: DivergenceRegister) => void;
    readonly addNpcSuggestions: (names: string[], context?: string) => void;
    readonly archiveNPC: (id: string, turn: number, reason: string) => void;
    readonly restoreNPC: (id: string) => void;
    readonly onDirectorBriefPhase: (phase: 'running' | 'done') => void;
    readonly updatePlayerCharacter: (patch: Partial<PlayerCharacter>) => void;
    readonly setInventoryItems: (items: InventoryItem[]) => void;
    readonly setLocationLedger: (locations: LocationEntry[]) => void;
    readonly addLocationSuggestions: (suggestions: LocationSuggestion[]) => void;
    /**
     * Phase 8.2 §3 — request a pre-operation backup of the whole campaign.
     * Fires the same POST `/campaigns/:id/backup` with `{ trigger, isAuto:
     * true }` that `preOpBackup` (`campaignSlice.ts:47-54`) fires for the
     * host's own delete paths. The host keeps the endpoint, the `isAuto`
     * flag and any rate limiting.
     *
     * Why this is not the escalation D2 declined: D2 declined a *schema
     * system* (new grammar in the manifest, a server-side validator, a
     * format reopened after it was frozen). This is ten lines wrapping an
     * endpoint that already exists, it is not enemy-shaped (two core paths
     * use the same call today: `pre-delete-location` at `campaignSlice.ts:540`
     * and `pre-delete-npc` at `:713`), and without it a mod that deletes a
     * year of a user's monsters has no undo while core's own delete paths
     * do. The API freeze is 9.2; 8.2 is still inside the window where a
     * primitive can be added deliberately.
     *
     * Synchronous and void, like every other write on this surface: the
     * POST is fire-and-forget (the host's `preOpBackup` `.catch`es and
     * logs), and a promise here would promise a durability we do not
     * deliver (API.md §1.2).
     */
    readonly requestBackup: (trigger: string) => void;
}

export interface HostFacade {
    readonly data: FacadeData;
    readonly config: FacadeConfig;
    readonly write: FacadeWrites;
    readonly model: {
        call(role: ModelRole, req: ModelRequest): Promise<ModelResponse>;
        callJson(role: ModelRole, req: ModelRequest, options?: ModelJsonOptions): Promise<unknown>;
        available(role: ModelRole): boolean;
    };
    readonly table: {
        read(name: string): Promise<unknown>;
        write(name: string, rows: unknown): Promise<void>;
        subscribe?(name: string, listener: (rows: unknown) => void): () => void;
    };
    readonly subscribe?: (key: string, listener: (value: unknown) => void) => () => void;
    readonly signal: AbortSignal;
    refresh(): HostFacade;
    log(...args: unknown[]): void;
}

export interface HostFacadeTableAdapter {
    read(name: string): Promise<unknown>;
    write(name: string, rows: unknown): Promise<void>;
    subscribe?(name: string, listener: (rows: unknown) => void): () => void;
}

export interface HostFacadeBuildOptions {
    signal?: AbortSignal;
    getState?: () => TurnState;
    getCallbacks?: () => TurnCallbacks;
    updatePlayerCharacter?: (patch: Partial<PlayerCharacter>) => void;
    modelCall?: (role: ModelRole, request: ModelRequest, endpoint: EndpointConfig | ProviderConfig | undefined) => Promise<ModelResponse>;
    table?: HostFacadeTableAdapter;
    reactiveStore?: ReactiveStoreLike;
    getLocationState?: () => {
        readonly currentPlaceId: string | null;
        readonly currentFeature: string | null;
        readonly ledger: readonly LocationEntry[];
        /** WO 6.2 — the active journey state, read from the live `GameContext`. */
        readonly travel?: TravelState | null;
        /** WO 6.2 — the in-game day counter, read from the live `GameContext`. */
        readonly worldDay?: number;
    readonly travelMode?: GameContext['travelMode'];
    };
}

type FacadeSettings = {
    aiTier?: AiTier;
    contextLimit: number;
    archiveRecallDepth?: 'lean' | 'standard' | 'deep';
    autoArchiveStaleNPCsTurns?: number;
    divergenceScanBudget?: number;
    enableArchivePlanner?: boolean;
    lodElevateScenes?: number;
    lodImportanceBonus?: number;
    lodSlottedMaxPerScene?: number;
    lodSummaryChapters?: number;
};

const facadeModelAvailability = new WeakMap<object, ReadonlySet<ModelRole>>();

// Phase 8.2 §7 flag #6 — `TABLE_ROUTES` and the bare-name `routeFor` lookup
// are gone. Every production caller of `facade.table.read/write` passes a
// `mod.`-prefixed name: `modContext.ts`'s `resolveOwnTableName` rewrites
// every mod request to `mod.<own-id>.<name>` and throws on anything else
// (`modContext.ts:797-811`), and `readFacadeData` (`hostFacade.ts:299-317`)
// reads `state.*` directly, not via `facade.table.read`. The four remaining
// routes (`archive`, `divergence`, `locations`, `npcs`) had no production
// consumer — verified by ENEMY_SEAM §9 row 9 and re-verified by the lack of
// test breakage when the map is removed. A bare (non-`mod.`-prefixed) name
// reaching `buildDefaultTableAdapter` now throws an explicit error so a
// future caller that assumes a host route exists fails loudly rather than
// silently hitting a `fetch` to a URL that was never wired.

function cloneAndFreeze<T>(value: T, seen = new WeakMap<object, unknown>()): T {
    if (value === null || typeof value !== 'object') return value;
    const objectValue = value as object;
    const existing = seen.get(objectValue);
    if (existing) return existing as T;

    const clone: unknown[] | Record<string, unknown> = Array.isArray(value) ? [] : {};
    seen.set(objectValue, clone);
    if (Array.isArray(value)) {
        const arrayClone = clone as unknown[];
        for (const item of value) arrayClone.push(cloneAndFreeze(item, seen));
    } else {
        const objectClone = clone as Record<string, unknown>;
        for (const [key, item] of Object.entries(value)) {
            objectClone[key] = cloneAndFreeze(item, seen);
        }
    }
    Object.freeze(clone);
    return clone as T;
}

function readFacadeSettings(settings: FacadeSettings): FacadeConfig {
    return Object.freeze({
        aiTier: settings.aiTier,
        contextLimit: settings.contextLimit,
        archiveRecallDepth: settings.archiveRecallDepth ?? 'standard',
        autoArchiveStaleNPCsTurns: settings.autoArchiveStaleNPCsTurns ?? 0,
        divergenceScanBudget: settings.divergenceScanBudget ?? 0,
        enableArchivePlanner: settings.enableArchivePlanner ?? false,
        lodElevateScenes: settings.lodElevateScenes ?? 2,
        lodImportanceBonus: settings.lodImportanceBonus ?? 2,
        lodSlottedMaxPerScene: settings.lodSlottedMaxPerScene ?? 2,
        lodSummaryChapters: settings.lodSummaryChapters ?? 7,
    });
}

function readFacadeData(state: TurnState): FacadeData {
    return cloneAndFreeze({
        archiveIndex: state.archiveIndex,
        context: state.context,
        npcLedger: state.npcLedger,
        messages: state.messages,
        activeCampaignId: state.activeCampaignId,
        input: state.input,
        loreChunks: state.loreChunks,
        onStageNpcIds: state.onStageNpcIds ?? [],
        divergenceRegister: state.divergenceRegister ?? { entries: [], chapterToggles: {}, categoryToggles: {}, lastUpdatedSceneId: '', lastUpdatedAt: 0, version: 2 },
        timeline: state.timeline ?? [],
        condenser: state.condenser,
        semanticFacts: state.semanticFacts ?? [],
        chapters: state.chapters ?? [],
    });
}

/**
 * Resolve a role to its assigned endpoint, or `undefined` when the slot is unassigned.
 *
 * No role substitutes for another. The `never` arm makes a new `ModelRole` member a
 * compile error here rather than a silent `undefined` at runtime.
 */
function tryResolveEndpoint(state: TurnState, role: ModelRole): EndpointConfig | ProviderConfig | undefined {
    switch (role) {
        case 'story':
            return state.getFreshProvider?.() ?? state.provider;
        case 'director':
            return state.getDirectorEndpoint?.();
        case 'extraction':
            return state.getExtractionEndpoint?.();
        case 'utility':
            return state.getUtilityEndpoint?.();
        // `raw-*` are legacy aliases — nothing substitutes any more, so they and
        // their base role resolve identically.
        case 'auxiliary':
        case 'raw-auxiliary':
            return state.getRawAuxiliaryProvider?.() ?? state.getFreshAuxiliaryProvider?.();
        case 'summariser':
        case 'raw-summariser':
            return state.getRawSummariserProvider?.();
        default: {
            const never: never = role;
            return never;
        }
    }
}

/**
 * Whether the role resolves to an assigned endpoint.
 *
 * Deliberately asks the resolver rather than checking that a getter *exists*: those
 * two answers used to disagree (a state could supply `getUtilityEndpoint: () => undefined`
 * and report the role available, then throw when called). Callers gate optional work on
 * this, so it has to mean "calling this role will work".
 */
function hasConfiguredRole(state: TurnState, role: ModelRole): boolean {
    try {
        return Boolean(tryResolveEndpoint(state, role));
    } catch {
        return false;
    }
}

/**
 * Resolve a role to its assigned endpoint, or throw.
 *
 * Returns a non-optional endpoint: every required slot is explicitly assigned
 * (migration backfills unassigned ones from Story — see `settingsHelpers.migrateSettings`),
 * so an unresolved role is a configuration fault worth failing loudly on, never
 * something to paper over with a substitute.
 */
function resolveEndpoint(state: TurnState, role: ModelRole): EndpointConfig | ProviderConfig {
    const resolved = tryResolveEndpoint(state, role);
    if (!resolved) throw new MissingProviderRoleError(role);
    return resolved;
}

function buildDefaultTableAdapter(activeCampaignId: string | null, reactiveStore?: ReactiveStoreLike): HostFacadeTableAdapter {
    // Phase 8.2 §7 flag #6 — bare (non-`mod.`-prefixed) names have no
    // production consumer. Every mod request is rewritten to
    // `mod.<own-id>.<name>` by `resolveOwnTableName` (`modContext.ts:797-811`),
    // and `readFacadeData` reads `state.*` directly. A bare name reaching
    // here is a bug or a crafted source; throw explicitly so it fails loudly
    // rather than silently `fetch`-ing a URL that was never wired.
    const assertModName = (name: string): void => {
        if (!name.startsWith('mod.')) {
            throw new Error(`[facade] unknown table: ${name} (host table routes retired in 8.2; only mod.<id>.<name> is supported)`);
        }
        if (!activeCampaignId) {
            throw new Error('[facade] no active campaign');
        }
    };

    return {
        async read(name) {
            const storeState = reactiveStore?.getState() as { modTables?: Record<string, unknown> } | undefined;
            if (name.startsWith('mod.') && storeState?.modTables && Object.prototype.hasOwnProperty.call(storeState.modTables, name)) {
                return storeState.modTables[name];
            }
            assertModName(name);
            // No HTTP fallback for mod tables in the browser — the reactive
            // store is the source of truth for mod-table reads in the live
            // app. A mod table that is not in the store is empty (the mod's
            // `onActivate` hydrates from disk; a read before hydrate returns
            // `undefined`, which the mod's `repairOnRead` turns into `[]` /
            // `DEFAULT`).
            return undefined;
        },
        async write(name, rows) {
            const storeState = reactiveStore?.getState() as { setModTable?: (tableName: string, data: unknown) => void } | undefined;
            if (name.startsWith('mod.') && typeof storeState?.setModTable === 'function') {
                storeState.setModTable(name, rows);
                return;
            }
            assertModName(name);
            // No HTTP fallback for mod tables in the browser — the reactive
            // store's `setModTable` is the write path, and the host's table
            // adapter persists to disk through the store's save plumbing. A
            // write that reaches here without a reactive store is a test
            // fixture or a misconfiguration; throw so it surfaces.
            throw new Error(`[facade] table write failed: ${name} (no reactive store to write through)`);
        },
    };
}

export function buildHostFacade(
    state: TurnState,
    callbacks: TurnCallbacks,
    options: HostFacadeBuildOptions = {},
): HostFacade {
    const data = readFacadeData(state);
    const config = readFacadeSettings(state.settings);
    const reactiveStore = options.reactiveStore;
    const tableAdapter = options.table ?? buildDefaultTableAdapter(state.activeCampaignId, reactiveStore);
    const tableCache = new Map<string, unknown>();
    const tableSourceUnsubscribes = new Map<string, () => void>();
    const detachTableSources = (): void => {
        for (const unsubscribe of tableSourceUnsubscribes.values()) unsubscribe();
        tableSourceUnsubscribes.clear();
    };

    const readReactiveValue = (key: string): unknown => {
        if (key.startsWith('table:')) {
            const name = key.slice('table:'.length);
            const storeState = reactiveStore?.getState() as { modTables?: Record<string, unknown> } | undefined;
            if (storeState?.modTables && Object.prototype.hasOwnProperty.call(storeState.modTables, name)) {
                return cloneAndFreeze(storeState.modTables[name]);
            }
            return cloneAndFreeze(tableCache.get(name));
        }

        const live = reactiveStore?.getState() as Record<string, unknown> | undefined;
        const context = (live?.context ?? data.context) as GameContext;
        switch (key) {
            case 'campaignId': return live?.activeCampaignId ?? data.activeCampaignId;
            case 'playerInput': return live?.input ?? data.input;
            case 'messages': return live?.messages ?? data.messages;
            case 'archiveIndex': return live?.archiveIndex ?? data.archiveIndex;
            case 'timeline': return live?.timeline ?? data.timeline;
            case 'npcLedger': return live?.npcLedger ?? data.npcLedger;
            case 'onStageNpcIds': return live?.onStageNpcIds ?? data.onStageNpcIds;
            case 'loreChunks': return live?.loreChunks ?? data.loreChunks;
            case 'divergenceRegister': return live?.divergenceRegister ?? data.divergenceRegister;
            case 'chapters': return live?.chapters ?? data.chapters;
            case 'playerCharacter': return live?.playerCharacter ?? context.playerCharacter ?? null;
            case 'inventory': return live?.inventoryItems ?? context.inventoryItems;
            case 'location': {
                // Phase 4.0 / `API.md` §8.6 item 7 — the reactive path and
                // the snapshot path (`modContext.ts:457-460`) MUST agree on
                // precedence. The snapshot path prefers the injected
                // `locationState` over `context`; the reactive path used to
                // prefer `context` over the injected state, so a subscriber
                // and a fresh read disagreed. Aligned to the snapshot order
                // (injected state wins) so a subscriber sees the same value
                // a fresh `ctx.data.location` read returns.
                //
                // WO 6.2 — `travel` and `worldDay` ride the same precedence:
                // injected state wins, `context` is the fallback. They are
                // written by the same `updateContext` call that writes
                // `currentPlaceId`, so the `'location'` invalidation the
                // `writeAfter(callbacks.updateContext, ['location', ...])`
                // fires already covers them — no new reactive key.
                const fresh = options.getLocationState?.();
                return {
                    currentPlaceId: fresh?.currentPlaceId ?? context.currentPlaceId ?? null,
                    currentFeature: fresh?.currentFeature ?? context.currentFeature ?? null,
                    ledger: live?.locationLedger ?? fresh?.ledger ?? [],
                    travel: fresh?.travel ?? context.travel ?? null,
                    worldDay: fresh?.worldDay ?? context.worldDay,
                    travelMode: fresh?.travelMode ?? context.travelMode,
                };
            }
            default: return undefined;
        }
    };

    const hub: ReactiveReadHub | undefined = reactiveStore
        ? createReactiveReadHub({
            store: reactiveStore,
            getValue: (key) => cloneAndFreeze(readReactiveValue(key)),
            getCampaignId: () => {
                const current = reactiveStore.getState().activeCampaignId;
                return typeof current === 'string' ? current : null;
            },
            onCampaignChange: (campaignId) => {
                disposeCampaignSubscriptions(campaignId);
                detachTableSources();
            },
        })
        : undefined;

    const notifyForWrite = (keys: readonly string[]): void => {
        for (const key of keys) hub?.invalidate(key);
    };
    const writeAfter = <T extends (...args: never[]) => unknown>(
        fn: T,
        keys: readonly string[],
    ): T => {
        const wrapped = (...args: Parameters<T>): ReturnType<T> => {
            const result = fn(...args) as ReturnType<T>;
            notifyForWrite(keys);
            return result;
        };
        return wrapped as T;
    };
    const write: FacadeWrites = Object.freeze({
        updateContext: writeAfter(callbacks.updateContext, ['location', 'playerCharacter', 'inventory']) as FacadeWrites['updateContext'],
        updateNPC: writeAfter(callbacks.updateNPC, ['npcLedger']) as FacadeWrites['updateNPC'],
        addMessage: writeAfter(callbacks.addMessage, ['messages']) as FacadeWrites['addMessage'],
        setDivergenceRegister: writeAfter(callbacks.setDivergenceRegister ?? (() => undefined), ['divergenceRegister']) as FacadeWrites['setDivergenceRegister'],
        addNpcSuggestions: callbacks.addNpcSuggestions ?? (() => undefined),
        archiveNPC: writeAfter(callbacks.archiveNPC, ['npcLedger']) as FacadeWrites['archiveNPC'],
        restoreNPC: writeAfter(callbacks.restoreNPC, ['npcLedger']) as FacadeWrites['restoreNPC'],
        onDirectorBriefPhase: callbacks.onDirectorBriefPhase ?? (() => undefined),
        updatePlayerCharacter: writeAfter(options.updatePlayerCharacter ?? (() => undefined), ['playerCharacter']) as FacadeWrites['updatePlayerCharacter'],
        setInventoryItems: writeAfter(callbacks.setInventoryItems, ['inventory']) as FacadeWrites['setInventoryItems'],
        setLocationLedger: writeAfter(callbacks.setLocationLedger, ['location']) as FacadeWrites['setLocationLedger'],
        addLocationSuggestions: callbacks.addLocationSuggestions,
        // Phase 8.2 §3 — fire-and-forget like the host's `preOpBackup`. No
        // reactive key to invalidate (a backup does not change in-memory
        // state), so no `writeAfter` wrapper.
        requestBackup: callbacks.requestBackup ?? (() => undefined),
    });
    const call: ModelCall = async (role: ModelRole, request: ModelRequest): Promise<ModelResponse> => {
        // `resolveEndpoint` throws MissingProviderRoleError when the role is unassigned —
        // roles never substitute for one another, so there is nothing to fall back to.
        const endpoint = resolveEndpoint(state, role);
        if (options.modelCall) return options.modelCall(role, request, endpoint);
        const content = await llmCall(endpoint, request.prompt, {
            signal: request.signal,
            maxTokens: request.maxTokens,
            temperature: request.temperature,
            priority: request.priority,
            thinkingEffort: request.thinkingEffort,
            trackingLabel: request.trackingLabel,
            timeoutMs: request.timeoutMs,
        });
        return { content };
    };
    const model = Object.freeze({
        call,
        callJson: (role: ModelRole, request: ModelRequest, jsonOptions?: ModelJsonOptions): Promise<unknown> =>
            callModelJson(role, request, call, jsonOptions),
        available: (role: ModelRole): boolean => hasConfiguredRole(state, role),
    });
    const tableRead = async (name: string): Promise<unknown> => {
        const value = await tableAdapter.read(name);
        tableCache.set(name, cloneAndFreeze(value));
        return cloneAndFreeze(value);
    };
    const tableWrite = async (name: string, rows: unknown): Promise<void> => {
        await tableAdapter.write(name, rows);
        tableCache.set(name, cloneAndFreeze(rows));
        hub?.invalidate(`table:${name}`, cloneAndFreeze(rows));
    };
    const tableSubscribe = (name: string, listener: (rows: unknown) => void): (() => void) => {
        if (!hub) throw new Error('[facade] reactive table subscriptions require a live store');
        if (!tableSourceUnsubscribes.has(name) && tableAdapter.subscribe) {
            tableSourceUnsubscribes.set(name, tableAdapter.subscribe(name, (rows) => {
                tableCache.set(name, cloneAndFreeze(rows));
                hub.invalidate(`table:${name}`, cloneAndFreeze(rows));
            }));
        }
        const unsubscribe = hub.subscribe(`table:${name}`, listener, cloneAndFreeze(readReactiveValue(`table:${name}`)));
        return () => {
            unsubscribe();
            if (hub.getListenerCount(`table:${name}`) === 0) {
                tableSourceUnsubscribes.get(name)?.();
                tableSourceUnsubscribes.delete(name);
            }
        };
    };
    const table: HostFacade['table'] = Object.freeze(hub
        ? { read: tableRead, write: tableWrite, subscribe: tableSubscribe }
        : { read: tableRead, write: tableWrite });
    const signal = options.signal ?? new AbortController().signal;
    const refresh = (): HostFacade => buildHostFacade(
        options.getState?.() ?? state,
        options.getCallbacks?.() ?? callbacks,
        { ...options, reactiveStore, table: tableAdapter },
    );
    const facade: HostFacade = Object.freeze({
        data,
        config,
        write,
        model,
        table,
        ...(hub ? {
            subscribe: (key: string, listener: (value: unknown) => void): (() => void) =>
                hub.subscribe(key, listener, cloneAndFreeze(readReactiveValue(key))),
        } : {}),
        signal,
        refresh,
        log: (...args: unknown[]) => console.log(...args),
    });
    facadeModelAvailability.set(facade, new Set<ModelRole>(
        MODEL_ROLES.filter((role) => hasConfiguredRole(state, role)),
    ));
    return facade;
}

export function hasHostModelRole(facade: HostFacade, role: ModelRole): boolean {
    return facadeModelAvailability.get(facade)?.has(role) === true;
}

export const createHostFacade = buildHostFacade;
