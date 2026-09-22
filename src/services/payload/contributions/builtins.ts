import type { AppSettings, RelationshipStance, SceneStakes, ResponseLength } from '../../../types';
import { isThinkingEnabled, WRITER_COT } from '../stable';
import { formatAskGmBrief } from '../../ooc/askGmHandoff';
import { buildAbsoluteCommandBlock } from '../../turn/absoluteCommand';
import { createContributionRegistry } from './registry';
import type { ContributionModule, ContributionRegistry } from './registry';
import type { ContributionSpec } from './types';
import { renderRelationshipStanceBlock } from '../../npc/relationshipStance';

/**
 * Project 2 / WO-P2-02 — the built-in prompt contributions, as modules.
 *
 * This file is the "default-as-plugin" mechanism from `01_VISION.md`: every system that used to
 * be open-coded inside `buildPayload`'s final-user assembly is now an ordinary registered module
 * producing an ordinary `ContributionSpec`. With all built-ins enabled and no mods installed,
 * the assembled prompt is byte-identical to the pre-Project-2 payload — guarded by
 * `finalUserAssemblyGolden.test.ts`, which replicates the old inline expression as an oracle and
 * compares across every combination of the flags that used to drive it.
 *
 * SCOPE — everything here lands in the final user message, BELOW the Anthropic prompt-cache
 * boundary. Nothing in this file can perturb the cached prefix, which is why the migration
 * carries no cache risk and `payloadCacheStability.test.ts` is untouched.
 *
 * ORDER values are spaced by 100 so a mod can slot between any two built-ins without anything
 * being renumbered. They reproduce the original array order exactly:
 *   volatileBlock · writerCotNudge · directorBriefBlock · gmReminderActive ·
 *   watchdogNudgeActive · askGmBrief · userMessage · absoluteCommandBlock
 */

/**
 * Declarative facts about the current turn that a mod's `when` conditions can test.
 *
 * Deliberately small. Every field here is something `buildPayload` can resolve cheaply and
 * unambiguously from data it already holds — no new queries, no guessing. A fact that is
 * `undefined` causes any condition referencing it to NOT match, which is the defined
 * behaviour rather than an error.
 *
 * `sceneTags` is declared but not populated in v1: there is no unambiguous source for scene
 * tags at payload-assembly time. Conditions on it therefore never match today. Populating it
 * is a follow-up, and the shape is fixed now so doing so is not a breaking change.
 */
export interface TurnFacts {
    /** Names (not ids) of the NPCs on stage this turn. */
    onStageNpcNames?: string[];
    /** Name of the current place, resolved from `context.currentPlaceId`. */
    location?: string;
    /** True when a combat encounter is running this turn. Established by a segment or a mod (7.5 / 5.4). */
    inCombat?: boolean;
    /** Reserved for v1 — see the note above. */
    sceneTags?: string[];
}

/** Everything the built-in modules need. Assembled by `buildPayload` and passed to `collect`. */
export interface FinalUserModuleInput {
    settings: AppSettings;
    /** The player's message for this turn. */
    userMessage: string;
    /** Pre-composed rules + world + segments + volatile state. Its parts trace themselves. */
    volatileBlock: string;
    /**
     * WO-4 §4 — the on-stage NPC↔NPC relations block, split out of the structural
     * `volatile.block` into its own toggleable contribution. Rendered by `buildWorld`
     * (routed through the canonical relation-key resolver) and passed here so a mod
     * can suppress it — the prerequisite for v3 to replace the flat scalar with the
     * stance without the two contradicting each other in the same prompt.
     *
     * Empty string when no on-stage NPC↔NPC edges resolve. With no mods the assembled
     * payload is byte-identical to the pre-split form (the golden test's no-relations
     * fixture passes untouched).
     */
    relationsBlock: string;
    /** WO-5: scene-specific NPC readings; numbers and flat relationship arrows never enter v3. */
    relationshipStances?: readonly RelationshipStance[];
    relationshipStanceBudget?: number;
    /** Scene stakes from the writer's own last [[SCENE_STAKES]] tag; drives the beat budget
     *  when the response length is 'flexible'. */
    sceneStakes?: SceneStakes;
    /** Whether this turn's player message skips time ("3 weeks later", "a month later"). Only 'flexible'
     *  reads it, to reach its longest budget. Computed in payloadBuilder via detectTimeskip. */
    timeskipDetected?: boolean;
    directorBrief?: string;
    watchdogNudge?: string;
    absoluteCommand?: string;
    nextTurnOocBrief?: string;
    /**
     * Condition facts for mod contributions. No built-in reads this — built-ins are driven by
     * their own inputs — but it travels on the same input object so mods and built-ins share
     * one contract rather than needing a second channel.
     */
    facts?: TurnFacts;
}

/**
 * Per-turn beat budget. The player picks the length from the dropdown beside the action box
 * (`settings.responseLength`, global — not part of any ruleset or campaign); only 'flexible'
 * still reads the scene: the stakes the writer tagged last turn (`[[SCENE_STAKES: …]]` →
 * `context.lastSceneStakes`, parsed in sceneStakesTag.ts) and whether the player's message
 * skips time.
 *
 * This replaced the flat "draft 5-8 beats" quota in WRITER_COT and the paragraph scales the
 * rulesets used to carry. It lives here, below the cache boundary, rather than in the stable
 * CoT — see the PACING note in stable.ts for why a per-turn VARYING string must never move up.
 *
 * Lengths are stated in WORDS, not tokens. A model cannot count its own tokens, so a token
 * budget reads as a vague hint and is routinely overshot. The ranges are tuned directly in
 * words against how the writer actually behaves — do not "correct" them into a token figure.
 */
const LENGTH_SPEC = {
    short: '1 beat, 100-200 words',
    medium: '2-3 beats, 250-400 words',
    long: '3-5 beats, 800-1500 words',
} as const;

type FixedLength = keyof typeof LENGTH_SPEC;

/**
 * The tag name is load-bearing: user-authored rulesets (Custom_Setup/) say "when a [BEAT
 * BUDGET] line is present it is the cap". Renaming it would silently break those prompt files.
 *
 * The closing clauses are on every variant on purpose. A stated range invites padding up to
 * it, and padding is the failure mode this exists to kill. The override clause is what makes
 * campaigns whose saved rules still carry an old paragraph scale follow the dropdown.
 */
const budget = (spec: FixedLength, flavour = ''): string =>
    `[BEAT BUDGET: ${LENGTH_SPEC[spec]}.${flavour ? ` ${flavour}` : ''} Never pad to reach the ` +
    'range — under-running it is correct. This overrides any length or paragraph guidance in the rules.]';

/** Stakes flavour, used only by 'flexible'. A fixed setting is a deliberate instruction and
 *  must not be talked out of its length by the scene. */
const FLEXIBLE: Record<SceneStakes, string> = {
    calm: budget('medium', 'The scene is calm, so it may breathe.'),
    tense: budget('short', 'The scene is tense: end the turn the moment a decision faces the player and hand the beat back rather than resolving it for them.'),
    dangerous: budget('short', 'The scene is dangerous: keep it close and physical, end on the moment that demands a response, and never resolve the danger on the player\'s behalf.'),
};

/** Flexible only reaches its longest budget on a time skip — the one case where a reply has
 *  real ground to cover rather than a live scene to hand back. */
const FLEXIBLE_TIMESKIP = budget('long', 'Time has skipped: cover the gap and what the player returns to.');

const FIXED: Record<FixedLength, string> = {
    short: budget('short', 'Land one development only.'),
    medium: budget('medium'),
    long: budget('long', 'There is room to cover real ground — elapsed time, travel, errands and downtime.'),
};

/**
 * Every lookup is written `RECORD[key] ?? fallback`, which is not redundant with the
 * `?? 'flexible'` / `?? 'calm'` defaults: those only catch null/undefined. A value outside the
 * union at RUNTIME — an older save, a hand-edited file — indexes the record to `undefined`
 * and would otherwise be interpolated into the prompt as the literal string "undefined".
 */
export const beatBudgetLine = (
    length: ResponseLength | undefined,
    stakes: SceneStakes | undefined,
    timeskip = false,
): string => {
    const choice = length ?? 'flexible';
    if (choice !== 'flexible') return FIXED[choice as FixedLength] ?? FLEXIBLE[stakes ?? 'calm'] ?? FLEXIBLE.calm;
    if (timeskip) return FLEXIBLE_TIMESKIP;
    return FLEXIBLE[stakes ?? 'calm'] ?? FLEXIBLE.calm;
};

export const GM_REMINDER =
    '[GM REMINDER: NPCs push back when their wants/boundaries are crossed. Do not default to facilitation.]';

/** Ids are part of the contract — `suppresses` references them, and mods may target them. */
export const BUILTIN_IDS = {
    volatileBlock: 'volatile.block',
    relations: 'npc.relations',
    stance: 'npcStance',
    writerCot: 'writer.cot',
    responseLength: 'writer.length',
    directorBrief: 'director.brief',
    gmReminder: 'gm.reminder',
    watchdogNudge: 'watchdog.nudge',
    askGmBrief: 'askgm.brief',
    userMessage: 'user.message',
    absoluteCommand: 'absolute.command',
} as const;

type BuiltinDetails = {
    trigger: string;
    prompt?: string;
    tokenImpact: string;
    quietWhen: string;
};

export type ModuleTokenCap = {
    /** The trackingLabel of the utility call owned by this module. */
    callLabel: string;
    default: number;
    min: number;
    max: number;
};

type Builtin = ContributionModule<FinalUserModuleInput> & {
    explain?: string;
    example?: string;
    details?: BuiltinDetails;
    tokenCap?: ModuleTokenCap;
};

/** Shorthand for a module that contributes exactly one spec (all built-ins do). */
const single = (
    module: Omit<Builtin, 'produce' | 'source' | 'defaultEnabled'> & { defaultEnabled?: boolean },
    render: (input: FinalUserModuleInput) => Omit<ContributionSpec, 'slot' | 'source'>,
): Builtin => ({
    source: 'builtin',
    defaultEnabled: true,
    ...module,
    produce: (input) => [{ ...render(input), slot: 'final-user', source: 'builtin' }],
});

/** True when an Absolute Command is armed this turn. Drives the CoT text variant. */
const hasAbsolute = (input: FinalUserModuleInput): boolean =>
    buildAbsoluteCommandBlock(input.absoluteCommand) !== '';

export const BUILTIN_FINAL_USER_MODULES: readonly Builtin[] = [
    /**
     * Rules + world + any registered volatile segments + volatile state. Structural, not a
     * feature — and its constituent parts already emit their own traces from
     * `buildWorld` / `buildVolatile` / each segment, so it declares none of its own.
     */
    single(
        {
            id: BUILTIN_IDS.volatileBlock,
            name: 'World State',
            description: 'Retrieved rules, world context, subsystem context, and volatile scene state.',
            toggleable: false,
        },
        (input) => ({ id: BUILTIN_IDS.volatileBlock, order: 100, text: input.volatileBlock }),
    ),

    /**
     * WO-4 §4 — on-stage NPC↔NPC relations, split out of the structural `volatile.block`
     * into its own toggleable contribution. The relation lines used to ride inside the
     * `[ACTIVE NPC CONTEXT]` block, which is structural (`toggleable: false`) and listed
     * in `PROTECTED_SUPPRESSION_IDS` — so nothing could switch them off. v3 needs to
     * replace the flat scalar with the stance; without a suppressible seam the two would
     * sit in the same prompt contradicting each other.
     *
     * Rendered by `buildWorld` (routed through the canonical relation-key resolver,
     * `relationResolve.ts`) and passed on `FinalUserModuleInput.relationsBlock`. Empty
     * string when no on-stage NPC↔NPC edges resolve. With no mods the assembled payload
     * is byte-identical to the pre-split form — the golden test's no-relations fixture
     * passes untouched (an empty contribution is dropped before assembly, so the
     * `\n\n` join never fires).
     *
     * `volatile.block` stays protected; only the relationship lines moved out.
     */
    single(
        {
            id: BUILTIN_IDS.relations,
            name: 'On-Stage Relations',
            description: 'Directed NPC↔NPC relationship arrows for on-stage characters.',
            details: {
                "trigger": "Automatic when two or more on-stage NPCs have a non-zero relationship with each other.",
                "prompt": "[ON-STAGE RELATIONS]\nBram→Alden: +2\nAlden→Bram: +1",
                "tokenImpact": "No separate feature cap. One line is sent for each non-zero directed pair; the lines count toward the total prompt context.",
                "quietWhen": "No on-stage NPC pair has a non-zero relationship. NPC Stances also replaces this block when stance text is present."
            },
            explain: 'Tells the writer how the characters in a scene feel about **each other** — not about you. Without it, everyone in a group scene behaves as though they just met.',
            example: `Bram and Alden are both at the table when the innkeeper asks who broke the door.

**On** — Alden covers for Bram without being asked.

**Off** — Alden answers honestly. He has no idea they are friends.`,
        },
        (input) => ({ id: BUILTIN_IDS.relations, order: 150, text: input.relationsBlock ?? '' }),
    ),

    /** WO-5 — the writer-facing replacement for scalar affinity and relation meters. */
    single(
        {
            id: BUILTIN_IDS.stance,
            name: 'NPC Stances',
            description: 'Scene-specific NPC wants, boundaries, and relationship memories.',
            details: {
                "trigger": "Automatic for on-stage NPCs when relationship readings are available.",
                "prompt": "[NPC STANCES]\nSTANCE — Alden · scene 123 · deep\nstatus: guarded\nwon’t: never betray Bram\nwants now: keep the door closed\nhiding: he is afraid\nmanner: clipped\n[END NPC STANCES]",
                "tokenImpact": "The stance call returns up to 1200 output tokens by default (user-adjustable from 400 to 8000). The final prompt allows 320 tokens for each cheap stance and 600 for each deep stance, clamped to 5% of the tokens remaining after rules. Stances are admitted whole in priority order; a stance that does not fit is dropped rather than trimmed. Deep readings are limited to 0 on Lite, 2 on Pro, and 3 on Max; up to 5 memories can feed each reading.",
                "quietWhen": "No NPCs are on stage, relationship readings fail, or there is no stance text to inject. When present, it suppresses On-Stage Relations."
            },
            tokenCap: {
                callLabel: "npc-stance",
                default: 1200,
                min: 400,
                max: 8000,
            },
            explain: 'The deep version, pointed at you. For every character on stage it works out what they want in this exact moment, what they are hiding, what they will refuse, and which memories of you are pulling at them right now. When it has something to say it takes over from On-Stage Relations.',
            example: `She lost a battle to you last week. A year before that, you put a hand on her head at the academy.

**On** — she will not look at you, answers in three words, refuses the food you brought, and eats it after you leave.

**Off** — the writer knows only that she is hostile, and plays her as flatly hostile.`,
        },
        (input) => ({
            id: BUILTIN_IDS.stance,
            order: 150,
            text: renderRelationshipStanceBlock(input.relationshipStances ?? [], input.relationshipStanceBudget),
            budget: input.relationshipStanceBudget,
            suppresses: [BUILTIN_IDS.relations],
        }),
    ),

    /**
     * Per-turn chain-of-thought invocation (thinking-mode only). Deliberately below the cache
     * boundary so thinking-off turns stay byte-identical to the pre-CoT payload. Under an
     * Absolute Command the framework is subordinated rather than invoked flatly.
     *
     * NOTE: this is a text VARIANT, not a suppression — the contribution stays active either
     * way, so it is expressed as a render conditional rather than in `suppresses`.
     */
    single(
        {
            id: BUILTIN_IDS.writerCot,
            name: 'Chain-of-Thought Invocation',
            description: 'Asks the writer to work through the reasoning framework before writing.',
            details: {
                "trigger": "Automatic when the active story provider has Thinking Effort set to Low, Medium, High, or Max.",
                // Rendered from the live constant, not hand-copied, so the Block View can't
                // document a prompt that is no longer sent.
                "prompt": `${WRITER_COT}

Final-turn invocation:
Work through the [WRITER REASONING FRAMEWORK] in your reasoning before writing.`,
                "tokenImpact": "The six-step framework is 467 input tokens in the stable prompt. The normal final-turn invocation is 18 more input tokens. The [BEAT BUDGET] line is not part of this block — it is its own contribution (Response Length) and ships whether or not thinking is on. There is no separate COT output-token cap; the provider/model controls hidden reasoning and answer limits.",
                "quietWhen": "Thinking Effort is Off. An Absolute Command swaps the normal invocation for a 38-token instruction that tells the model to follow the command where they conflict."
            },
            explain: 'Asks the writer to think through the scene before writing it, instead of answering straight away. Only does anything when thinking is switched on for your model — with thinking off it adds nothing at all.',
            example: "Same request: you lie to a character who already knows the truth.\n\n**Without COT** — \"I believe you.\" She reacts to the words and lets the scene move on.\n\n**With COT** — she notices that the lie is known, decides whether to expose it, and lets that choice shape the reply.\n\nThe wording still varies by model; the difference is what the writer considers before answering.",
        },
        (input) => ({
            id: BUILTIN_IDS.writerCot,
            order: 200,
            text: !isThinkingEnabled(input.settings)
                ? ''
                : hasAbsolute(input)
                    ? 'Work through the [WRITER REASONING FRAMEWORK] only where it does not conflict with [USER ABSOLUTE COMMAND]. Where they conflict, discard the framework step and follow the command.'
                    : 'Work through the [WRITER REASONING FRAMEWORK] in your reasoning before writing.',
        }),
    ),

    /**
     * Response Length — the [BEAT BUDGET] line. Ordered immediately after the reasoning
     * framework so the CoT's Step 5 reference lands next to the line it points at.
     *
     * Deliberately NOT gated on thinking. It is a setting the player chose from the composer,
     * and a thinking-off writer needs the length guidance just as much.
     */
    single(
        {
            id: BUILTIN_IDS.responseLength,
            name: 'Response Length',
            description: 'Caps how long a reply runs, in beats and words.',
            toggleable: true,
            details: {
                "trigger": "Every turn. Set it from the length dropdown beside the action box.",
                "prompt": `Short:    ${beatBudgetLine('short', undefined)}
Medium:   ${beatBudgetLine('medium', undefined)}
Long:     ${beatBudgetLine('long', undefined)}
Flexible: ${beatBudgetLine('flexible', 'calm')}`,
                "tokenImpact": "One line, 45-65 input tokens depending on the setting. It caps OUTPUT tokens, which is where it pays for itself.",
                "quietWhen": "The block is switched off here, or a mod suppresses it. Nothing else silences it — unlike the reasoning framework above, it ships with thinking off."
            },
            explain: 'How long a reply should be. Short hands the turn straight back; Long lets a scene cover real ground. Flexible reads the scene instead — quiet scenes get room, pressured ones stay tight, and only a time skip runs long.',
            example: 'Same moment: a guard blocks the gate.\n\n**Short** — one exchange, and the turn is yours again.\n\n**Long** — the guard, the queue behind you, the captain being fetched, the weather turning.\n\n**Flexible** — tight here, because a guard blocking your way is a decision waiting on you.',
        },
        (input) => ({
            id: BUILTIN_IDS.responseLength,
            order: 210,
            text: beatBudgetLine(input.settings.responseLength, input.sceneStakes, input.timeskipDetected),
        }),
    ),

    /** LLM-authored Writer Brief. Supersedes the deterministic watchdog nudge. */
    single(
        {
            id: BUILTIN_IDS.directorBrief,
            name: 'Director Brief',
            description: 'LLM-authored scene directives that steer the next GM reply.',
            details: {
                "trigger": "Automatic on Pro and Max tiers, before the main writer answers; the result is cached for repeated swipes of the same turn.",
                "prompt": "WRITER BRIEF\n- [MANDATORY] <directive> (0–2 lines)\n- [SUGGESTION] <directive> (0–3 lines)",
                "tokenImpact": "A separate utility-AI call has a 180-second timeout and a 1500-token output cap by default (user-adjustable from 400 to 8000). Its input NPC summary is capped at 120 tokens and it reads the last 5 timeline events; the line limits above remain the output contract.",
                "quietWhen": "Lite tier, no provider, timeout, parse failure, or no correction worth making. A successful Brief suppresses the Watchdog nudge."
            },
            tokenCap: {
                callLabel: "director-brief",
                default: 1500,
                min: 400,
                max: 8000,
            },
            explain: 'Before each reply, a second AI reads the scene and writes short directions for the writer — what this beat needs, and what to leave alone. It is the difference between a scene that goes somewhere and one that answers you politely.',
            example: `Direction written for the writer: *"The confession landed. Do not resolve it this turn — let her leave the room."*

**On** — she leaves. It sits with you for three scenes.

**Off** — she talks it through and the tension is spent immediately.`,
        },
        (input) => ({
            id: BUILTIN_IDS.directorBrief,
            order: 300,
            text: input.directorBrief ? `[DIRECTOR BRIEF]\n${input.directorBrief}` : '',
            suppresses: [BUILTIN_IDS.watchdogNudge],
            trace: {
                source: 'Director',
                classification: 'world_context',
                reason: 'LLM-authored Writer Brief from runDirectorBrief (supersedes the deterministic watchdog nudge)',
            },
        }),
    ),

    /** Standing instruction that NPCs have agency. Dropped under an Absolute Command. */
    single(
        {
            id: BUILTIN_IDS.gmReminder,
            name: 'GM Reminder',
            description: 'Standing reminder that NPCs push back rather than facilitate.',
            details: {
                "trigger": "Automatic on every turn while enabled.",
                "prompt": "[GM REMINDER: NPCs push back when their wants/boundaries are crossed. Do not default to facilitation.]",
                "tokenImpact": "24 input tokens when present. It has no output call and no separate cap.",
                "quietWhen": "An Absolute Command suppresses it for that turn. Otherwise it is deliberately always present, even in a quiet scene."
            },
            explain: 'A single standing line reminding the writer that characters push back when you cross what they want, instead of going along with it. It is the cheapest guard against everyone becoming agreeable.',
            example: `You tell the gate guard to let you through.

**On** — he asks who you are, and refuses.

**Off** — he steps aside.`,
        },
        () => ({ id: BUILTIN_IDS.gmReminder, order: 400, text: GM_REMINDER }),
    ),

    /** Deterministic NPC-agency nudge. Superseded by the Brief, dropped under a command. */
    single(
        {
            id: BUILTIN_IDS.watchdogNudge,
            name: 'Director Watchdog',
            description: 'Deterministic stage note when NPC agency has been drifting.',
            details: {
                "trigger": "Automatic deterministic check on every turn while enabled; it makes no AI call.",
                "prompt": "[STAGE NOTE: Alden has not initiated toward the PC recently — give Alden a beat to reach out this scene.]",
                "tokenImpact": "No separate token cap. It emits only the highest-priority one-line correction from its signals.",
                "quietWhen": "No signal is found, or a Director Brief is present. It scans 3 recent assistant replies for silence, 5 assistant replies for initiation, and 5 recent messages for stalled goals."
            },
            explain: 'Watches across several turns for characters quietly turning into pushovers, and drops in a correction when it sees the drift. It stays silent the rest of the time, and stands down whenever the Director Brief is already speaking.',
            example: `Four turns in a row where everyone agreed with you.

**On** — *"The room has stopped resisting. Someone objects to this."*

**Off** — the drift continues until you notice it yourself.`,
        },
        (input) => ({
            id: BUILTIN_IDS.watchdogNudge,
            order: 500,
            text: input.watchdogNudge ?? '',
            trace: {
                source: 'Watchdog',
                classification: 'world_context',
                reason: 'Deterministic NPC-agency nudge (highest-priority signal from buildWatchdogDossier)',
            },
        }),
    ),

    /**
     * User-confirmed session-only guidance. Structural: the player explicitly asked for this,
     * so it is not something the extensions screen may quietly switch off.
     */
    single(
        {
            id: BUILTIN_IDS.askGmBrief,
            name: 'Ask-GM Handoff',
            description: 'Session-only guidance the player confirmed out of character.',
            toggleable: false,
        },
        (input) => ({
            id: BUILTIN_IDS.askGmBrief,
            order: 600,
            text: formatAskGmBrief(input.nextTurnOocBrief),
        }),
    ),

    /** The player's message. Never optional. */
    single(
        {
            id: BUILTIN_IDS.userMessage,
            name: 'Player Message',
            description: "The player's input for this turn.",
            toggleable: false,
        },
        (input) => ({ id: BUILTIN_IDS.userMessage, order: 700, text: input.userMessage }),
    ),

    /**
     * Binding out-of-character override, placed LAST — after the player's message — for maximum
     * recency. Outranks the GM reminder and the watchdog nudge. Structural: it only ever renders
     * when the player armed it this turn, so there is nothing for a settings toggle to mean.
     */
    single(
        {
            id: BUILTIN_IDS.absoluteCommand,
            name: 'Absolute Command',
            description: 'A binding out-of-character instruction for a single turn.',
            toggleable: false,
        },
        (input) => ({
            id: BUILTIN_IDS.absoluteCommand,
            order: 800,
            text: buildAbsoluteCommandBlock(input.absoluteCommand),
            suppresses: [BUILTIN_IDS.gmReminder, BUILTIN_IDS.watchdogNudge],
            trace: {
                source: 'Absolute Command',
                classification: 'world_context',
                reason: 'Binding out-of-character player instruction for this turn (supersedes GM_REMINDER, watchdog nudge, and Director Brief)',
            },
        }),
    ),
];

export function getBuiltinTokenCap(blockId: string): ModuleTokenCap | undefined {
    return BUILTIN_FINAL_USER_MODULES.find((module) => module.id === blockId)?.tokenCap;
}

/**
 * Phase 5.3 — the suppressible built-in ids, derived from the module list rather
 * than hand-kept. A built-in is suppressible iff it is NOT structural
 * (`toggleable !== false`), which is the same marker the contribution registry
 * uses to keep structural modules out of the extensions screen.
 *
 * This is the authoritative published list. `modContext.ts` exposes it on
 * `ctx.api.suppressibleIds`, the loader's `PROTECTED_SUPPRESSION_IDS` is its
 * complement, and `phase53Subtraction.test.ts` pins both sides together so a
 * new built-in that forgets to set `toggleable: false` is caught at test time
 * rather than at "a mod just deleted the player's message" time.
 *
 * Derived, not declared: the moment a second list is hand-kept it drifts from
 * the module array, and the drift is silent. The filter runs once at module
 * load and the result is frozen.
 */
export const SUPPRESSIBLE_BUILTIN_IDS: readonly string[] = Object.freeze(
    BUILTIN_FINAL_USER_MODULES
        .filter((m) => m.toggleable !== false)
        .map((m) => m.id),
);

/**
 * Build a registry pre-populated with the built-ins.
 *
 * A factory rather than a module-level singleton: a shared mutable registry across tests (and
 * across campaign switches once mods can be loaded and unloaded) is exactly the kind of hidden
 * global the Project 1 refactor spent its effort removing.
 */
export function createFinalUserRegistry(): ContributionRegistry<FinalUserModuleInput> {
    const registry = createContributionRegistry<FinalUserModuleInput>();
    for (const module of BUILTIN_FINAL_USER_MODULES) registry.register(module);
    return registry;
}
