import type {
    GameContext, LoreChunk, InventoryProposal, ConditionProposal, RollFrequency,
    OutcomeDifficulty, PlayerOutcome,
} from '../../types';
import { OUTCOME_DIFFICULTIES } from '../../types';
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

export type ProposeConditionHandlerResult = {
    toolResult: string;
    proposal: ConditionProposal;
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

// ── Player-resolved action (request_outcome) ──────────────────────────
//
// The only resolution tool. The engine does not resolve: it asks the player, suspends
// generation, and resumes with the outcome the player picked. (An engine-rolled
// `roll_dice` tool used to live above this; it decided outcomes itself and named
// an outcome band, both of which the writer read straight back out.)
//
// This tool used to ask for a DIE and a numeric BAR (`2d6`, `7+`), and the player typed
// a total. That coupled the engine to one family of rulesets, and it put a number in the
// prompt for the writer to read straight back out — the exact failure design goal 6
// forbids. What travels now is a difficulty LABEL the GM estimates and one of four
// outcomes the player picks. Nothing on this path is numeric.
//
// The load-bearing property is unchanged: `difficulty` / `failure_means` are declared
// in the CALL, before the model can see the answer. The terms are committed to
// sight-unseen, which is what makes a player-supplied outcome trustworthy —
// there is nothing left to fudge after the fact.

/**
 * Threshold paragraphs, selected by `context.rollFrequency`. Each is a threshold for
 * what deserves resolving, never a quota — the expected cadence is a consequence of the
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
        'without asking.',
    critical:
        'WHEN TO ASK — decisive moments only. Ask ONLY for a conflict that could genuinely go ' +
        'either way, a confrontation that settles something, or an attempt that by rights should ' +
        'not be possible. Ordinary resistance — haggling, routine locks, most persuasion, a fight ' +
        'against outmatched opposition — resolves in the fiction, without asking.',
};

const ROLL_NEVER_ASK =
    'NEVER ask for movement, routine professional competence, ambient description, obvious ' +
    'perception, a friendly conversation, or anything that cannot reasonably fail. NEVER ask ' +
    'again on an unchanged approach — a fresh attempt needs a changed method, a new resource, ' +
    'new information, or changed circumstances.';

/**
 * The difficulty ladder, spelled out so the estimate is calibrated rather than improvised.
 *
 * `trivial` and `impossible` sit slightly awkwardly against ROLL_NEVER_ASK, which forbids
 * asking about anything that cannot reasonably fail. They are kept because both do occur —
 * a gimme that nonetheless carries real stakes, and a long shot the player insists on
 * attempting — but the last line exists to stop them becoming a licence to ask more often.
 */
const DIFFICULTY_GUIDANCE = [
    'DIFFICULTY — estimate it BEFORE you call, and pick exactly one:',
    '- `trivial` — would come off but for freak mischance.',
    '- `easy` — favoured. Most attempts of this kind land.',
    '- `average` — genuinely even. It could go either way.',
    '- `hard` — against the odds. The attempt is a stretch.',
    '- `impossible` — should not work by rights. Only something extraordinary gets there.',
    'Judge the ACTION against the fiction — the opposition, the tools to hand, the footing, ' +
        'what the character has already established they can do. Do not pick a difficulty to ' +
        'steer the answer you want, and do not soften a hard thing because the player committed ' +
        'to it. `trivial` and `impossible` are for the rare gimme that still carries real stakes ' +
        'and the long shot the player insists on — never a reason to ask when the rules above ' +
        'say do not ask.',
].join('\n');

const ROLL_PROTOCOL = [
    'PROTOCOL — follow exactly:',
    '1. Decide `difficulty` and `failure_means` BEFORE calling. Both are BINDING: you commit ' +
        'to them without knowing the answer, and you must honour them once it arrives.',
    '2. Call `request_outcome`, then STOP. Do not narrate the outcome, do not assume one, and ' +
        'do not write both branches.',
    '3. The player resolves it however their table does — dice, cards, an oracle, a coin — and ' +
        'reports ONE of four outcomes: `fail`, `fail_with_consequence`, `success`, ' +
        '`success_with_consequence`. You receive it as `outcome`. The engine resolves nothing, ' +
        'rolls nothing, and tracks no stats.',
    '4. Honour it exactly. Either `fail` means the attempted action DOES NOT HAPPEN — it is not ' +
        'achieved by another route in the same breath, and it is not a near-miss that lands ' +
        'anyway. Either `success` means it FUNDAMENTALLY DOES happen; carry the scene on from ' +
        'there. `with consequence` means a cost rides along with that result, and on a failure ' +
        'that cost is the `failure_means` you already named.',
    '4a. A `with consequence` result may also carry a specific `consequence` chosen by the ' +
        'player. When it does, that is the cost — weave it into the same beat as a twist or ' +
        'complication landing alongside the outcome, never instead of it and never deferred. ' +
        'You do not choose it and you do not substitute your own.',
    '5. Never ask again for the same attempt, never move the difficulty to suit the answer, ' +
        'never soften a failure or inflate a success.',
    '6. Difficulty and outcome labels belong in the request block ONLY. The narration that ' +
        'follows is pure fiction: name no difficulty, no outcome label, no die, no total, no ' +
        'threshold, no bonus, and no faculty, skill or attribute. Show the cause in the world — ' +
        'a mechanism recently oiled, a man who turned — never the mechanic behind it.',
    '7. Consequence tables in the world lore, where present, govern what a failure and what a ' +
        'consequence actually cost.',
].join('\n');

function buildRequestOutcomeDescription(frequency: RollFrequency): string {
    return [
        'Ask the PLAYER to resolve an uncertain action. You state what is attempted, how hard ' +
            'you judge it, and what a failure costs; the player reports which of four outcomes ' +
            'came up. Use this for an action whose outcome is genuinely in doubt.',
        ROLL_FREQUENCY_GUIDANCE[frequency],
        ROLL_NEVER_ASK,
        DIFFICULTY_GUIDANCE,
        ROLL_PROTOCOL,
    ].join('\n\n');
}

function buildRequestOutcomeTool(frequency: RollFrequency) {
    return {
        type: 'function' as const,
        function: {
            name: 'request_outcome',
            description: buildRequestOutcomeDescription(frequency),
            parameters: {
                type: 'object' as const,
                properties: {
                    reason: {
                        type: 'string' as const,
                        description: "One in-fiction line naming what is attempted and against what, e.g. 'Forcing the shutter before the patrol rounds the corner.'",
                    },
                    difficulty: {
                        type: 'string' as const,
                        enum: OUTCOME_DIFFICULTIES,
                        description: "How hard you judge the attempt, committed up front and binding once stated. A label only: no dice, no die size, no threshold, and no number.",
                    },
                    failure_means: {
                        type: 'string' as const,
                        description: "What a failure costs, committed up front. One concrete line, no numbers, e.g. 'the frame gives loudly and they hear it'.",
                    },
                },
                required: ['reason', 'difficulty', 'failure_means'],
            },
        },
    } as const;
}

export type RequestOutcomeArgs = {
    reason: string;
    difficulty: OutcomeDifficulty;
    failure_means: string;
};

/**
 * Parses a `request_outcome` call. Returns null when the arguments are unusable, which the
 * caller treats as "nothing was asked" rather than failing the turn.
 *
 * An unrecognised `difficulty` coerces to 'average' instead of dropping the request. The
 * schema requires one of the five, but a model that invents "moderate" has still asked a
 * real question about a real action, and swallowing it silently ends the turn mid-attempt.
 * Same reasoning as the old parser tolerating a missing bar.
 */
export function parseRequestOutcomeArgs(toolArguments: string): RequestOutcomeArgs | null {
    let raw: Record<string, unknown> = {};
    try { raw = JSON.parse(toolArguments); } catch { return null; }
    const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
    const reason = str(raw.reason);
    if (!reason) return null;
    return {
        reason,
        difficulty: coerceDifficulty(raw.difficulty),
        failure_means: str(raw.failure_means),
    };
}

function coerceDifficulty(v: unknown): OutcomeDifficulty {
    const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
    return (OUTCOME_DIFFICULTIES as readonly string[]).includes(s)
        ? (s as OutcomeDifficulty)
        : 'average';
}

/** Any `success*` means the attempted action happens. The rider never changes that. */
export function outcomeHappens(outcome: PlayerOutcome): boolean {
    return outcome === 'success' || outcome === 'success_with_consequence';
}

/**
 * The tool result handed back once the player picks an outcome. It restates the terms the
 * model committed to, at maximum recency, so the narration cannot drift from them.
 *
 * `action_happens` is derived rather than left implicit. The model no longer has an
 * unarguable numeric comparison to check itself against — a verdict on a label it authored
 * itself is much easier to talk around — so the fail/success split is spelled out as a
 * boolean, and the binding text names the specific failure mode: narrating a miss that
 * quietly achieves the thing anyway.
 *
 * `consequence` is whatever stood in the modal's Consequence field: drawn from the campaign's
 * authored list, rerolled, or typed by the player. It is honoured ONLY on a `_with_consequence`
 * outcome, and only when non-empty — so a campaign with no list keeps exactly the old
 * behaviour, and text left in the field cannot leak into a plain fail or success.
 *
 * No tier or band mapping happens anywhere on this path, and nothing numeric appears at all.
 */
export function formatPlayerOutcomeResult(
    args: RequestOutcomeArgs,
    outcome: PlayerOutcome,
    consequence = '',
): string {
    const happens = outcomeHappens(outcome);
    const rider = outcome.endsWith('_with_consequence');
    const stated = rider ? consequence.trim() : '';
    return JSON.stringify({
        reason: args.reason,
        difficulty: args.difficulty,
        failure_means: args.failure_means || '(unstated)',
        outcome,
        action_happens: happens,
        ...(stated ? { consequence: stated } : {}),
        source: 'player-resolved',
        binding:
            'The player resolved this and it is final. ' +
            (happens
                ? 'The attempted action FUNDAMENTALLY HAPPENS — carry the scene on from there, and do not inflate it beyond what was attempted. '
                : 'The attempted action DOES NOT HAPPEN. Do not achieve it by another route in the same breath, do not write a near-miss that lands anyway, and do not soften it. ') +
            (stated
                ? 'A specific `consequence` is supplied. Weave it into THIS SAME BEAT as a twist or ' +
                  'complication landing alongside the outcome — not instead of it, and not deferred ' +
                  'to a later scene. It does not change whether the action happened. Render it as ' +
                  'cause in the world and do not quote its label back. '
                : rider
                    ? 'A cost rides along with that result; on a failure that cost is `failure_means` as you stated it. '
                    : 'No consequence rides along; do not add one. ') +
            'Do not ask again for this attempt, and do not move the difficulty to suit the answer. ' +
            'Narrate the result as cause in the world: name no difficulty, no outcome label, no ' +
            'die, no total, no threshold, and no skill or attribute in the prose.',
    });
}

// ── Body state (propose_condition_change) ─────────────────────────────
//
// Sibling of propose_inventory_change, and deliberately the same shape: offered every
// turn, staged for the player, never applied by the engine on its own.
//
// It exists because a narrated wound had nowhere durable to live. `status` is a liveness
// enum that cannot say "hurt", and `condition` — the field the payload block renders —
// had no writer at all. Between them a wound survived only as long as the raw chat
// history did.
//
// The two axes are kept apart on purpose. Fold them together and the model starts
// writing "wounded" into status, which is the vocabulary for whether you are alive.

const PROPOSE_CONDITION_TOOL = {
    type: 'function' as const,
    function: {
        name: 'propose_condition_change',
        description:
            "Propose a change to the player character's body state when the fiction materially changes it: they take a wound, a wound worsens, a wound is treated or heals, or they die, go missing, or are taken into custody. This only *proposes* — the player must confirm before anything changes, so keep narrating the scene as you wrote it and do not treat the change as recorded yet. " +
            "Use `condition` for injury: name what is wrong, WHERE it is, and what it stops them doing — 'gash across the left forearm; favours the right hand', not 'wounded' and never a number, a hit-point, or a severity score. Replace the whole clause each time rather than appending, and send an EMPTY STRING to clear it when the fiction treats or heals them. " +
            "Use `status` ONLY for whether they are alive, dead, missing, or held — never for injury. " +
            "Do not call this for scrapes, fatigue, or anything the next scene would not still care about.",
        parameters: {
            type: 'object' as const,
            properties: {
                condition: {
                    type: 'string' as const,
                    description: "The injury, as one short clause: what, where, and what it limits. Empty string clears it (treated or healed). Omit if only status is changing.",
                },
                status: {
                    type: 'string' as const,
                    enum: ['Alive', 'Deceased', 'Missing', 'Unknown', 'In Custody'],
                    description: "Liveness only. Omit if only the injury is changing.",
                },
                reason: {
                    type: 'string' as const,
                    description: "One in-fiction line naming what caused this, e.g. 'Took the guard's knife across the forearm forcing the shutter.'",
                },
            },
            required: ['reason'],
        },
    },
} as const;

/**
 * The player dismissed the request. The model is told to leave the attempt unresolved
 * rather than picking an outcome for it.
 */
export function formatPlayerOutcomeDeclined(args: RequestOutcomeArgs): string {
    return JSON.stringify({
        reason: args.reason,
        difficulty: args.difficulty,
        outcome: null,
        action_happens: null,
        source: 'player-declined',
        binding:
            'Nothing was resolved. Do NOT pick an outcome yourself or resolve the attempt by ' +
            'chance. Leave it open — end on the moment before it resolves, or let the fiction ' +
            'move around it.',
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
     * When set, offer `request_outcome` with its "when to ask" threshold selected by this
     * value. When absent, NO resolution tool is offered — and because every "ask the player"
     * imperative lives in that tool's description, that is also how the model stops being
     * told to ask.
     *
     * The key still reads `playerRollFrequency` because the campaign field it comes from is
     * still `rollFrequency`: renaming a persisted key would cost a save migration for no
     * behavioural gain, and "how readily to ask" is unchanged by this rework.
     */
    playerRollFrequency?: RollFrequency;
}): unknown[] {
    const tools: unknown[] = [...BASE_TOOLS];
    if (opts.playerRollFrequency) {
        tools.push(buildRequestOutcomeTool(opts.playerRollFrequency));
    }
    // Both proposal tools are combat-independent — always offered. Neither mutates
    // anything on its own, so there is no state for a gate to protect.
    tools.push(PROPOSE_INVENTORY_TOOL);
    tools.push(PROPOSE_CONDITION_TOOL);
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


const VALID_STATUSES = new Set<string>(['Alive', 'Deceased', 'Missing', 'Unknown', 'In Custody']);

/** Cap on the injury clause. Long enough for "what, where, what it limits"; short enough
 *  that it cannot turn into a medical report the writer has to wade through. */
const CONDITION_MAXLEN = 160;

/**
 * Handles `propose_condition_change`. Pure parsing + clamping — no LLM call, no mutation.
 * Returns a normalized {@link ConditionProposal} for the caller to stage for confirmation.
 *
 * Total function, like its inventory sibling: malformed JSON yields `{}` and falls through
 * to the defaults rather than throwing and killing the turn.
 *
 * The empty string is meaningful and must survive parsing — it is how the model says
 * "treated, clear it". Only `undefined` means "not proposing a condition change", which is
 * why this checks `'condition' in args` rather than truthiness.
 */
export function handleProposeConditionTool(
    toolArguments: string
): ProposeConditionHandlerResult {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(toolArguments); } catch { /* ignore */ }

    let condition: string | undefined;
    if ('condition' in args && typeof args.condition === 'string') {
        const trimmed = args.condition.replace(/\s+/g, ' ').trim();
        condition = trimmed.length > CONDITION_MAXLEN ? trimmed.slice(0, CONDITION_MAXLEN).trim() : trimmed;
    }

    const rawStatus = typeof args.status === 'string' ? args.status.trim() : '';
    const status = VALID_STATUSES.has(rawStatus)
        ? (rawStatus as ConditionProposal['status'])
        : undefined;

    const reason = typeof args.reason === 'string' && args.reason.trim()
        ? args.reason.trim()
        : 'The fiction changed the character\'s condition.';

    const proposal: ConditionProposal = { condition, status, reason };

    return {
        toolResult: JSON.stringify({
            status: 'staged',
            condition,
            pcStatus: status,
            binding:
                'This change is PENDING the player\'s confirmation and is not recorded yet. ' +
                'Carry on narrating the scene exactly as you wrote it, but do not refer to this ' +
                'as tracked state. The character block you receive next turn is the authority on ' +
                'what was actually recorded.',
        }),
        proposal,
    };
}

