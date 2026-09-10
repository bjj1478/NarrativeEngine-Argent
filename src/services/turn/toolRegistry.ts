import type { GameContext, InventoryProposal } from '../../types';
import {
    handleLoreTool,
    handleNotebookTool,
    handleProposeInventoryTool,
    parseRequestRollArgs,
    formatPlayerRollDeclined,
} from './toolHandlers';

/**
 * Phase 4 — Tool Registry
 *
 * Replaces the imperative `if (toolCall.name === '...') {...}` chain in
 * `turnOrchestrator.ts` with a declarative lookup. Each entry adapts a
 * tool-handler from `toolHandlers.ts` to a uniform {@link ToolDispatchResult}
 * shape; the orchestrator performs the common side-effects (push assistant
 * + tool messages to payload, push trace, schedule retry) and applies any
 * tool-specific side-effects signalled by the handler.
 *
 * Behaviour preservation contract:
 *  - `accumulationMode` mirrors the per-tool overwrite/append behaviour that
 *    existed inline in the orchestrator before Phase 4.
 *  - `traceResult` is `true` for every tool that previously called
 *    `pushToolTrace`. `propose_inventory_change`
 *    previously did NOT call `pushToolTrace` — that is preserved.
 *  - Side-effects (`updateContext`, `stageProposal`) are returned as data
 *    and applied by the orchestrator, not executed here, so the handlers
 *    remain pure and the registry stays free of store/callback knowledge.
 */

export type AccumulationMode = 'overwrite' | 'append';

export type ToolDispatchContext = {
    /** Arguments string passed by the LLM (JSON). */
    arguments: string;
    /** Current lore chunks (for lore queries). */
    loreChunks: import('../../types').LoreChunk[];
    /** Current scene notebook (for notebook mutations). */
    notebook: GameContext['notebook'];
};

export type ToolDispatchResult = {
    /** String content returned to the LLM as the tool message. */
    toolResult: string;
    /** Whether to overwrite or append the engine text to accumulated content. */
    accumulation: AccumulationMode;
    /** Whether to push a payload-trace row for this tool call. */
    traceResult: boolean;
    /** Optional context patch to apply after the tool runs. */
    contextPatch?: Partial<GameContext>;
    /** Optional inventory proposal to stage for user confirmation. */
    proposal?: InventoryProposal;
};

export type ToolHandlerFn = (
    ctx: ToolDispatchContext
) => ToolDispatchResult;

const handleLore: ToolHandlerFn = (ctx) => {
    const { toolResult } = handleLoreTool(ctx.arguments, { loreChunks: ctx.loreChunks, notebook: ctx.notebook });
    return {
        toolResult,
        accumulation: 'overwrite',
        traceResult: true,
    };
};

const handleNotebook: ToolHandlerFn = (ctx) => {
    const { toolResult, updatedNotebook } = handleNotebookTool(ctx.arguments, {
        loreChunks: ctx.loreChunks,
        notebook: ctx.notebook,
    });
    return {
        toolResult,
        accumulation: 'overwrite',
        traceResult: true,
        contextPatch: { notebook: updatedNotebook },
    };
};

/**
 * `request_roll` — the NON-SUSPENDING fallback.
 *
 * The real behaviour lives in `runGenerationStage`, which special-cases this tool by name
 * (as it already does for `query_campaign_lore`), awaits the player's number, and builds the
 * result with `formatPlayerRollResult`. Keeping `ToolHandlerFn` synchronous is deliberate:
 * widening it to return a Promise would break the "handlers are pure, the registry knows
 * nothing of store or callbacks" contract above, AND would silently break the second dispatch
 * site in sceneContinue.ts, which calls handlers synchronously and would push
 * `content: undefined` into a payload.
 *
 * This entry exists so the tool still RESOLVES on any path that cannot suspend — without it,
 * `resolveToolHandler` returns null, the call is dropped, and the turn silently ends mid-action.
 * On such a path we report that no roll happened rather than inventing one.
 */
const handleRequestRoll: ToolHandlerFn = (ctx) => {
    const args = parseRequestRollArgs(ctx.arguments);
    return {
        toolResult: args
            ? formatPlayerRollDeclined(args)
            : JSON.stringify({
                player_total: null,
                source: 'malformed-request',
                binding: 'The roll request was unusable. Do not invent a number; carry on without it.',
            }),
        accumulation: 'append',
        traceResult: true,
    };
};

const handleProposeInventory: ToolHandlerFn = (ctx) => {
    const { toolResult, proposal } = handleProposeInventoryTool(ctx.arguments);
    return {
        toolResult,
        accumulation: 'append',
        traceResult: false,
        proposal,
    };
};

export const TOOL_REGISTRY: Record<string, ToolHandlerFn> = {
    query_campaign_lore: handleLore,
    update_scene_notebook: handleNotebook,
    request_roll: handleRequestRoll,
    propose_inventory_change: handleProposeInventory,
};

/**
 * Look up a tool handler by name. Returns `null` for unknown tools so the
 * orchestrator can fall through to the final-answer path (mirroring the
 * pre-Phase-4 behaviour where an unmatched `toolCall` simply produced the
 * final response).
 */
export function resolveToolHandler(name: string): ToolHandlerFn | null {
    return TOOL_REGISTRY[name] ?? null;
}

/**
 * Module-load validation: fail fast if any registered handler is missing or
 * duplicated. Catches registry typos at startup instead of at first turn.
 */
export function validateToolRegistry(): void {
    const expected = [
        'query_campaign_lore',
        'update_scene_notebook',
        'request_roll',
        'propose_inventory_change',
    ];
    for (const name of expected) {
        const handler = TOOL_REGISTRY[name];
        if (typeof handler !== 'function') {
            throw new Error(`[ToolRegistry] Missing handler for tool "${name}"`);
        }
    }
}

validateToolRegistry();