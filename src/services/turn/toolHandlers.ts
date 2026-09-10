import type { GameContext, LoreChunk, InventoryProposal, RollFrequency } from '../../types';
import { searchLoreByQuery } from '../lore/loreRetriever';
import { uid } from '../../utils/uid';

// ── Constants ─────────────────────────────────────────────────────────
const MAX_NOTEBOOK_OPS = 5;
const MAX_NOTEBOOK_NOTES = 50;

// ── Types ─────────────────────────────────────────────────────────────

export type ToolContext = {
    loreChunks: LoreChunk[];
    notebook: GameContext['notebook'];
};

export type LoreHandlerResult = {
    toolResult: string;
};

export type NotebookHandlerResult = {
    toolResult: string;
    updatedNotebook: GameContext['notebook'];
};

export type ProposeInventoryHandlerResult = {
    toolResult: string;
    proposal: InventoryProposal;
};

// ── Tool Definitions (JSON schemas for LLM tools array) ───────────────

const BASE_TOOLS = [
    {
        type: 'function' as const,
        function: {
            name: 'query_campaign_lore',
            description: 'Search the Game Master notes for specific lore, rules, characters, or locations. Do NOT call this sequentially or spam it. If no relevant lore is found, immediately proceed with the narrative response. IMPORTANT: You MUST use the standard JSON tool call format. NEVER output raw XML <|DSML|> tags in your response text.',
            parameters: {
                type: 'object' as const,
                properties: { query: { type: 'string' as const, description: 'The specific search query' } },
                required: ['query'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'update_scene_notebook',
            description: 'Update the scene notebook for tracking temporary state — timers, NPC positions, environmental conditions, combat state. Actions: add (create note), remove (delete by text match), clear (wipe all). Max 50 notes, max 5 actions per call. Use sparingly — only for volatile scene state that changes within a scene.',
            parameters: {
                type: 'object' as const,
                properties: {
                    actions: {
                        type: 'array' as const,
                        items: {
                            type: 'object' as const,
                            properties: {
                                op: { type: 'string' as const, enum: ['add', 'remove', 'clear'] },
                                text: { type: 'string' as const, description: 'Note text (ignored for clear op)' },
                            },
                            required: ['op'],
                        },
                        description: 'Array of notebook actions to perform (max 5)',
                        maxItems: 5,
                    },
                },
                required: ['actions'],
            },
        },
    },
] as const;

// ── Player-rolled resolution (request_roll) ───────────────────────────
//
// The only dice tool. The engine does not roll: it asks the player, suspends
// generation, and resumes with the number the player typed. (An engine-rolled
// `roll_dice` tool used to live above this; it decided outcomes itself and named
// an outcome band, both of which the writer read straight back out.)
//
// The load-bearing property is that `success_on` / `failure_means` are declared
// in the CALL, before the model can see the number. The bar is committed to
// sight-unseen, which is what makes a player-supplied number trustworthy —
// there is nothing left to fudge after the fact.

/**
 * Threshold paragraphs, selected by `context.rollFrequency`. Each is a threshold for
 * what deserves dice, never a quota — the expected cadence is a consequence of the
 * threshold and is deliberately not stated to the model as a target.
 */
const ROLL_FREQUENCY_GUIDANCE: Record<RollFrequency, string> = {
    contested:
        'WHEN TO ASK — any contested action. Ask whenever the action meets real resistance: ' +
        'persuasion against a genuine want, a lock, a fight, a risky climb, a lie someone might ' +
        'catch. Resistance is the test; do not wait for the outcome to also be dramatic.',
    consequential:
        'WHEN TO ASK — consequential actions only. Ask ONLY when failure would impose a real, ' +
        'lasting cost: a wound, a burnt relationship, a door closed for good, time lost that ' +
        'matters. Friction that would merely inconvenience the player resolves in the fiction, ' +
        'without dice.',
    critical:
        'WHEN TO ASK — decisive moments only. Ask ONLY for a conflict that could genuinely go ' +
        'either way, a confrontation that settles something, or an attempt that by rights should ' +
        'not be possible. Ordinary resistance — haggling, routine locks, most persuasion, a fight ' +
        'against outmatched opposition — resolves in the fiction, without dice.',
};

const ROLL_NEVER_ASK =
    'NEVER ask for a roll for movement, routine professional competence, ambient description, ' +
    'obvious perception, a friendly conversation, or anything that cannot reasonably fail. NEVER ' +
    'ask for a repeat roll on an unchanged approach — a fresh attempt needs a changed method, a ' +
    'new resource, new information, or changed circumstances.';

const ROLL_PROTOCOL = [
    'PROTOCOL — follow exactly:',
    '1. Decide the bar BEFORE calling. `success_on` and `failure_means` are BINDING: you commit ' +
        'to them without knowing the number, and you must honour them once it arrives.',
    '2. Call `request_roll`, then STOP. Do not narrate the outcome, do not invent or assume a ' +
        'number, and do not write both branches.',
    '3. The player rolls physical dice and types their total, including any bonus they judge ' +
        'applies. You receive it as `player_total`. The engine rolls nothing and tracks no stats.',
    '4. Compare `player_total` to the `success_on` you already stated, and narrate that outcome. ' +
        'Never re-roll, never move the bar, never soften a miss or inflate a hit.',
    '5. Dice, totals, thresholds and bonuses belong in the request block ONLY. The narration that ' +
        'follows is pure fiction: name no die, no total, no threshold, no bonus, and no faculty, ' +
        'skill or attribute. Show the cause in the world — a mechanism recently oiled, a man who ' +
        'turned — never the mechanic behind it.',
    '6. Use the die your Action Resolution rules specify. Consequence tables in the world lore, ' +
        'where present, govern what a miss actually costs.',
].join('\n');

function buildRequestRollDescription(frequency: RollFrequency): string {
    return [
        'Ask the PLAYER to roll physical dice and report the result. Use this for an action whose ' +
            'outcome is uncertain and worth resolving with dice.',
        ROLL_FREQUENCY_GUIDANCE[frequency],
        ROLL_NEVER_ASK,
        ROLL_PROTOCOL,
    ].join('\n\n');
}

function buildRequestRollTool(frequency: RollFrequency) {
    return {
        type: 'function' as const,
        function: {
            name: 'request_roll',
            description: buildRequestRollDescription(frequency),
            parameters: {
                type: 'object' as const,
                properties: {
                    dice: {
                        type: 'string' as const,
                        description: "Dice for the player to roll, NdM form, e.g. '2d6' or '1d20'. Shown verbatim; the engine never rolls it.",
                    },
                    reason: {
                        type: 'string' as const,
                        description: "One in-fiction line naming what is attempted and against what, e.g. 'Forcing the shutter before the patrol rounds the corner.'",
                    },
                    success_on: {
                        type: 'string' as const,
                        description: "The bar to beat, stated BEFORE the number exists and binding once stated, e.g. '7+' or '12 or higher'.",
                    },
                    failure_means: {
                        type: 'string' as const,
                        description: "What a miss costs, committed up front. One concrete line, no numbers, e.g. 'the frame gives loudly and the patrol hears it'.",
                    },
                },
                required: ['dice', 'reason', 'success_on', 'failure_means'],
            },
        },
    } as const;
}

export type RequestRollArgs = {
    dice: string;
    reason: string;
    success_on: string;
    failure_means: string;
};

/**
 * Parses a `request_roll` call. Returns null when the arguments are unusable, which the
 * caller treats as "no roll was requested" rather than failing the turn.
 */
export function parseRequestRollArgs(toolArguments: string): RequestRollArgs | null {
    let raw: Record<string, unknown> = {};
    try { raw = JSON.parse(toolArguments); } catch { return null; }
    const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
    const dice = str(raw.dice);
    const reason = str(raw.reason);
    if (!dice || !reason) return null;
    return { dice, reason, success_on: str(raw.success_on), failure_means: str(raw.failure_means) };
}

/**
 * The tool result handed back once the player types their total. It restates the bar the
 * model committed to, at maximum recency, so the outcome cannot drift from it.
 *
 * No tier or band mapping happens anywhere on this path — `mapTier` is deliberately NOT
 * called. The number and the bar the model already stated are the whole resolution.
 */
export function formatPlayerRollResult(args: RequestRollArgs, playerTotal: number): string {
    return JSON.stringify({
        dice: args.dice,
        reason: args.reason,
        success_on: args.success_on || '(unstated)',
        failure_means: args.failure_means || '(unstated)',
        player_total: playerTotal,
        source: 'player-rolled',
        binding:
            'The player rolled this and it is final. Judge it against success_on exactly as you ' +
            'stated it, then narrate the result as cause in the world. Do not restate the number, ' +
            'the dice, the threshold, or any skill or attribute name in the prose.',
    });
}

/**
 * The player dismissed the request. The model is told to leave the attempt unresolved
 * rather than inventing a number for it.
 */
export function formatPlayerRollDeclined(args: RequestRollArgs): string {
    return JSON.stringify({
        dice: args.dice,
        reason: args.reason,
        player_total: null,
        source: 'player-declined',
        binding:
            'No roll happened. Do NOT invent a number or resolve the attempt by chance. Leave the ' +
            'outcome open — end on the moment before it resolves, or let the fiction move around it.',
    });
}

import { normalizeLocationTag } from '../../types';

const PROPOSE_INVENTORY_TOOL = {
    type: 'function' as const,
    function: {
        name: 'propose_inventory_change',
        description:
            "Propose adding, removing, equipping, or relocating an item in the player's inventory when the fiction materially changes their gear (loot found, a weapon gifted/bought/broken, gear stashed at base or retrieved). This only *proposes* — the player must confirm before anything changes. Supply bounded labels ONLY; the engine sets all numbers (damage dice, bonus, AC). NEVER output damageDice, bonus, hp, or AC. Default quality to 'common'. Default location tag to 'inventory'.",
        parameters: {
            type: 'object' as const,
            properties: {
                name:            { type: 'string' as const, description: 'Item name.' },
                op:              { type: 'string' as const, enum: ['grant', 'remove', 'equip', 'relocate'], description: "Operation. Default 'grant'." },
                kind:            { type: 'string' as const, enum: ['weapon', 'armor', 'consumable', 'misc'], description: "Item kind. Default 'misc'." },
                quality:         { type: 'string' as const, enum: ['common', 'uncommon', 'rare', 'epic', 'legendary'], description: "Rarity/quality tier. Default 'common'." },
                scalingStat:     { type: 'string' as const, enum: ['PWR', 'SPD', 'WIL'], description: "Scaling stat for weapons. Default 'PWR'." },
                range:           { type: 'string' as const, enum: ['Close', 'Reach', 'Ranged'], description: "Weapon range. Default 'Close'." },
                properties:      { type: 'array' as const, items: { type: 'string' as const }, description: 'Flavor tags, e.g. ["fire","heavy"].' },
                equip:           { type: 'boolean' as const, description: 'Equip on confirm (weapons/armor). Default false.' },
                description:     { type: 'string' as const, description: 'Short flavor text.' },
                fromLocationTag: { type: 'string' as const, description: 'Source location tag for relocate op (e.g. "player base").' },
                locationTag:     { type: 'string' as const, description: 'Destination/target location tag (e.g. "inventory", "player base"). Default "inventory".' },
            },
            required: ['name'],
        },
    },
} as const;

export function getToolDefinitions(opts: {
    /**
     * When set, offer `request_roll` with its "when to ask" threshold selected by this value.
     * When absent, NO dice tool is offered — and because every "ask for a roll" imperative
     * lives in that tool's description, that is also how the model stops being told to ask.
     */
    playerRollFrequency?: RollFrequency;
}): unknown[] {
    const tools: unknown[] = [...BASE_TOOLS];
    if (opts.playerRollFrequency) {
        tools.push(buildRequestRollTool(opts.playerRollFrequency));
    }
    // propose_inventory_change is combat-independent — always offered.
    tools.push(PROPOSE_INVENTORY_TOOL);
    return tools;
}

export const TOOL_DEFINITIONS = BASE_TOOLS;

// ── Handlers ──────────────────────────────────────────────────────────

/**
 * Handles `query_campaign_lore` tool calls.
 * Returns the tool result string only — caller handles payload/message dispatch.
 */
export function handleLoreTool(
    toolArguments: string,
    ctx: ToolContext
): LoreHandlerResult {
    let query = '';
    try { query = JSON.parse(toolArguments).query || ''; } catch { /* Ignore */ }

    let toolResult = 'No relevant lore found.';
    if (query) {
        const found = searchLoreByQuery(ctx.loreChunks, query);
        if (found.length > 0) {
            toolResult = found.map(c => `### ${c.header}\n${c.content}`).join('\n\n');
        }
    }

    return { toolResult };
}

/**
 * Handles `update_scene_notebook` tool calls.
 * Returns the tool result string and mutated notebook — caller handles payload/message dispatch.
 */
export function handleNotebookTool(
    toolArguments: string,
    ctx: ToolContext
): NotebookHandlerResult {
    let notebookActions: { op: string; text?: string }[] = [];
    try { notebookActions = JSON.parse(toolArguments).actions || []; } catch { /* Ignore */ }

    const currentNotebook = [...(ctx.notebook ?? [])];
    let opsCount = 0;

    for (const action of notebookActions) {
        if (opsCount >= MAX_NOTEBOOK_OPS) break;
        if (action.op === 'add' && action.text && currentNotebook.length < MAX_NOTEBOOK_NOTES) {
            currentNotebook.push({ id: uid(), text: action.text.trim(), timestamp: Date.now() });
        } else if (action.op === 'remove' && action.text) {
            const searchLower = action.text.toLowerCase().trim();
            const idx = currentNotebook.findIndex(n => n.text.toLowerCase().includes(searchLower));
            if (idx !== -1) currentNotebook.splice(idx, 1);
        } else if (action.op === 'clear') {
            currentNotebook.length = 0;
        }
        opsCount++;
    }

    const toolResult = `Notebook updated. ${currentNotebook.length} notes active.`;
    console.log(`[Notebook] Updated: ${currentNotebook.length} notes active (${opsCount} ops)`);

    return { toolResult, updatedNotebook: currentNotebook };
}

const VALID_OPS = new Set<string>(['grant', 'remove', 'equip', 'relocate']);
const VALID_KINDS = new Set<string>(['weapon', 'armor', 'consumable', 'misc']);
const VALID_QUALITIES = new Set<string>(['common', 'uncommon', 'rare', 'epic', 'legendary']);
const VALID_SCALING_STATS = new Set<string>(['PWR', 'SPD', 'WIL']);
const VALID_RANGES = new Set<string>(['Close', 'Reach', 'Ranged']);

/**
 * Handles `propose_inventory_change` tool calls. Pure parsing + clamping — no LLM
 * call, no mutation. Returns a normalized {@link InventoryProposal} for the caller
 * to stage for user confirmation (the player must confirm before the delta applies).
 * Numeric weapon/armor stats (damageDice, bonus, AC) are intentionally NOT parsed —
 * the engine (Phase 7) owns all numbers; the GM only supplies bounded labels.
 */
export function handleProposeInventoryTool(
    toolArguments: string
): ProposeInventoryHandlerResult {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(toolArguments); } catch { /* ignore */ }

    const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : 'Unknown Item';

    const rawOp = typeof args.op === 'string' ? args.op : '';
    const op: InventoryProposal['op'] = VALID_OPS.has(rawOp) ? (rawOp as InventoryProposal['op']) : 'grant';

    const rawKind = typeof args.kind === 'string' ? args.kind : '';
    const kind: InventoryProposal['kind'] = VALID_KINDS.has(rawKind) ? (rawKind as InventoryProposal['kind']) : 'misc';

    const rawQuality = typeof args.quality === 'string' ? args.quality : '';
    const quality: InventoryProposal['quality'] = VALID_QUALITIES.has(rawQuality) ? (rawQuality as InventoryProposal['quality']) : 'common';

    const rawScalingStat = typeof args.scalingStat === 'string' ? args.scalingStat : '';
    const scalingStat: InventoryProposal['scalingStat'] = VALID_SCALING_STATS.has(rawScalingStat) ? (rawScalingStat as InventoryProposal['scalingStat']) : 'PWR';

    const rawRange = typeof args.range === 'string' ? args.range : '';
    const range: InventoryProposal['range'] = VALID_RANGES.has(rawRange) ? (rawRange as InventoryProposal['range']) : 'Close';

    let properties: string[] = [];
    if (Array.isArray(args.properties)) {
        properties = args.properties.filter((p: unknown): p is string => typeof p === 'string').map(p => p.trim()).filter(Boolean);
    }

    const equip = typeof args.equip === 'boolean' ? args.equip : false;
    const description = typeof args.description === 'string' ? args.description : '';

    const fromLocationTag = typeof args.fromLocationTag === 'string' && args.fromLocationTag.trim()
        ? normalizeLocationTag(args.fromLocationTag)
        : undefined;

    const locationTag = typeof args.locationTag === 'string' && args.locationTag.trim()
        ? normalizeLocationTag(args.locationTag)
        : 'inventory';

    const proposal: InventoryProposal = {
        name, op, kind, quality, scalingStat, range, properties, equip, description,
        fromLocationTag, locationTag
    };

    return {
        toolResult: JSON.stringify({ status: 'staged', name, op, kind, quality, fromLocationTag, locationTag }),
        proposal,
    };
}

