import { Dices, Search, NotebookPen, Wrench, Backpack, HeartPulse } from 'lucide-react';
import type { ChatMessage } from '../../types';

type ToolCall = NonNullable<ChatMessage['tool_calls']>[number];

type Props = {
    toolCalls: ChatMessage['tool_calls'];
    /** Raw JSON/string result of the tool, resolved from the matching `tool` role message. */
    toolResult?: string;
};

function safeParse(raw: string | undefined): Record<string, unknown> {
    if (!raw) return {};
    try { return JSON.parse(raw) ?? {}; } catch { return {}; }
}

function DiceChip({ args, result }: { args: Record<string, unknown>; result: Record<string, unknown> }) {
    const dice = (result.dice ?? args.dice ?? '1d20') as string;
    const reason = (result.reason ?? args.reason ?? '') as string;
    const total = result.result;
    const tier = result.tier as string | undefined;
    return (
        <>
            <Dices size={11} className="text-amber-400 shrink-0" />
            <span className="text-amber-400/90 font-semibold">{dice}</span>
            {reason && <span className="text-text-dim/80 truncate">· {reason}</span>}
            {total !== undefined && (
                <span className="ml-auto flex items-center gap-1 shrink-0 tabular-nums">
                    <span className="text-text-primary font-bold">{String(total)}</span>
                    {tier && <span className="text-amber-400/70 uppercase">{tier}</span>}
                </span>
            )}
        </>
    );
}

/**
 * Player-resolved action (`request_outcome`). Deliberately NOT DiceChip: that one reads
 * `result.result` / `result.tier`, and this path maps no tier and carries no number at all.
 * Without its own branch this fell through to the generic wrench chip, which printed the raw
 * tool name into the transcript.
 *
 * Three states, keyed on whether the matching `tool` message exists yet. The orchestrator
 * stamps `tool_calls` BEFORE it suspends and adds the tool message only once the player
 * answers, so "no result" is precisely "still waiting on the player".
 */
const OUTCOME_CHIP_LABELS: Record<string, string> = {
    fail: 'fail',
    fail_with_consequence: 'fail + cost',
    success_with_consequence: 'success + cost',
    success: 'success',
};

function PlayerOutcomeChip({ args, result, hasResult }: {
    args: Record<string, unknown>;
    result: Record<string, unknown>;
    hasResult: boolean;
}) {
    const difficulty = (result.difficulty ?? args.difficulty ?? '') as string;
    const reason = (result.reason ?? args.reason ?? '') as string;
    const outcome = typeof result.outcome === 'string' ? result.outcome : null;
    const happens = result.action_happens === true;
    return (
        <>
            <Dices size={11} className="text-terminal shrink-0" />
            <span className="text-terminal/90 font-semibold">
                {difficulty ? `Resolve · ${difficulty}` : 'Resolve'}
            </span>
            {reason && <span className="text-text-dim/80 truncate">· {reason}</span>}
            <span className="ml-auto flex items-center gap-1 shrink-0">
                {!hasResult ? (
                    <span className="text-terminal/70 uppercase">waiting for you</span>
                ) : !outcome ? (
                    <span className="text-text-dim/60 uppercase">unresolved</span>
                ) : (
                    <span className={`font-bold uppercase ${happens ? 'text-terminal' : 'text-amber-400'}`}>
                        {OUTCOME_CHIP_LABELS[outcome] ?? outcome}
                    </span>
                )}
            </span>
        </>
    );
}

/**
 * LEGACY `request_roll` — the pre-Argent-outcome shape, kept only so saved transcripts still
 * render. That tool asked for a die and a numeric bar and came back with `player_total`;
 * nothing emits it any more. Dropping this branch would send every archived roll through the
 * generic wrench chip, which prints the raw tool name — exactly the machinery goal 1 wants
 * off the page.
 */
function LegacyPlayerRollChip({ args, result, hasResult }: {
    args: Record<string, unknown>;
    result: Record<string, unknown>;
    hasResult: boolean;
}) {
    const dice = (result.dice ?? args.dice ?? '') as string;
    const reason = (result.reason ?? args.reason ?? '') as string;
    const total = result.player_total;
    const declined = hasResult && (total === null || total === undefined);
    return (
        <>
            <Dices size={11} className="text-terminal shrink-0" />
            <span className="text-terminal/90 font-semibold">{dice ? `Roll ${dice}` : 'Roll'}</span>
            {reason && <span className="text-text-dim/80 truncate">· {reason}</span>}
            <span className="ml-auto flex items-center gap-1 shrink-0 tabular-nums">
                {!hasResult ? (
                    <span className="text-terminal/70 uppercase">waiting for your roll</span>
                ) : declined ? (
                    <span className="text-text-dim/60 uppercase">no roll</span>
                ) : (
                    <span className="text-text-primary font-bold">{String(total)}</span>
                )}
            </span>
        </>
    );
}

function LoreChip({ args, result }: { args: Record<string, unknown>; result?: string }) {
    const query = (args.query ?? '') as string;
    const found = result ? !/^no relevant lore/i.test(result.trim()) : undefined;
    return (
        <>
            <Search size={11} className="text-ice shrink-0" />
            <span className="text-ice/90 font-semibold">Searched archives</span>
            {query && <span className="text-text-dim/80 truncate">· “{query}”</span>}
            {found !== undefined && (
                <span className={`ml-auto shrink-0 uppercase ${found ? 'text-emerald-500/80' : 'text-text-dim/60'}`}>
                    {found ? 'hit' : 'none'}
                </span>
            )}
        </>
    );
}

function NotebookChip({ args }: { args: Record<string, unknown> }) {
    const actions = Array.isArray(args.actions) ? args.actions as { op?: string }[] : [];
    const ops = actions.map(a => a.op).filter(Boolean) as string[];
    return (
        <>
            <NotebookPen size={11} className="text-terminal shrink-0" />
            <span className="text-terminal/90 font-semibold">Scene notes</span>
            {ops.length > 0 && <span className="text-text-dim/80 truncate">· {ops.join(', ')}</span>}
        </>
    );
}

/**
 * Staged proposals — inventory and body state. Both read as prose rather than as the raw
 * function name; before this they fell through to the generic wrench chip, which printed
 * `propose_inventory_change` into the transcript. That is the exact wart PlayerRollChip
 * exists to avoid, per the note at the top of this file.
 *
 * Both say "proposes" rather than announcing the change, because neither is applied until
 * the player clicks Apply on the banner.
 */
function InventoryProposalChip({ args }: { args: Record<string, unknown> }) {
    const op = typeof args.op === 'string' ? args.op : 'grant';
    const name = typeof args.name === 'string' ? args.name : 'an item';
    return (
        <>
            <Backpack size={11} className="text-amber-400 shrink-0" />
            <span className="text-amber-400/90 font-semibold">Inventory</span>
            <span className="text-text-dim/80 truncate">· proposes {op} {name}</span>
        </>
    );
}

function ConditionProposalChip({ args }: { args: Record<string, unknown> }) {
    const condition = typeof args.condition === 'string' ? args.condition.trim() : undefined;
    const status = typeof args.status === 'string' ? args.status : undefined;
    // An empty-string condition is the model saying "treated, clear it".
    const label = status
        ? status
        : condition === ''
            ? 'recovered'
            : condition || 'a change';
    return (
        <>
            <HeartPulse size={11} className="text-amber-400 shrink-0" />
            <span className="text-amber-400/90 font-semibold">Condition</span>
            <span className="text-text-dim/80 truncate">· proposes {label}</span>
        </>
    );
}

function ChipBody({ call, toolResult }: { call: ToolCall; toolResult?: string }) {
    const name = call.function.name;
    const args = safeParse(call.function.arguments);
    if (name === 'roll_dice') return <DiceChip args={args} result={safeParse(toolResult)} />;
    if (name === 'request_outcome') {
        return <PlayerOutcomeChip args={args} result={safeParse(toolResult)} hasResult={toolResult !== undefined} />;
    }
    if (name === 'request_roll') {
        return <LegacyPlayerRollChip args={args} result={safeParse(toolResult)} hasResult={toolResult !== undefined} />;
    }
    if (name === 'query_campaign_lore') return <LoreChip args={args} result={toolResult} />;
    if (name === 'update_scene_notebook') return <NotebookChip args={args} />;
    if (name === 'propose_inventory_change') return <InventoryProposalChip args={args} />;
    if (name === 'propose_condition_change') return <ConditionProposalChip args={args} />;
    return (
        <>
            <Wrench size={11} className="text-text-dim shrink-0" />
            <span className="text-text-dim font-semibold">{name}</span>
        </>
    );
}

/**
 * Tool-call chips (WO-11.6) — render dice rolls / lore lookups / notebook edits
 * as clean chips instead of raw system text. Desktop port of mobile's
 * ToolCallChips. The tool result is resolved by the caller (ChatArea maps
 * `tool_call_id` → the matching `tool` role message content) and passed in.
 */
export function ToolCallChips({ toolCalls, toolResult }: Props) {
    if (!toolCalls || toolCalls.length === 0) return null;
    return (
        <div className="flex flex-col gap-1 mb-2">
            {toolCalls.map(call => (
                <div
                    key={call.id}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-sm bg-void-darker border border-border/60 text-[10px] tracking-wide font-mono"
                    title={`tool_call: ${call.function.name}`}
                >
                    <ChipBody call={call} toolResult={toolResult} />
                </div>
            ))}
        </div>
    );
}