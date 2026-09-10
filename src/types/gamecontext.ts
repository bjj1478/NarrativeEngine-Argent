// ─── Game Context / Pipeline / Session Types ─────────────────────────────

import type { InventoryItem, InventoryItemCategory, SceneStakes, NPCEntry, NPCVisualProfile } from './character';
export type { SceneStakes };
import type { LoreChunk, RuleChunkMeta } from './lore';
import type { ArcRecord } from './arc';
export type { ArcRecord };
import type { LootTree } from './loot';
import type { TravelMode } from '../services/location/travelModes';

// WO-A rewrite 2 §2: PlayerCharacter is an NPCEntry-shaped record stored at
// `context.playerCharacter`. It is NOT a row in `npcLedger`. `isPC` is vestigial
// for this record (its location *is* its PC-ness). Reusing the NPCEntry shape
// keeps the prompt pipeline, sanitization helpers, and hex/traits/wants/kit
// fields identical between PC and NPC without inventing a parallel schema.
export type PlayerCharacter = NPCEntry;

export type PipelinePhase =
    | 'idle'
    | 'rolling-dice'
    | 'gathering-context'
    | 'building-prompt'
    | 'generating'
    | 'checking-notes'
    | 'awaiting-player'
    | 'post-processing';

export type StreamingStats = {
    tokens: number;
    elapsed: number;
    speed: number;
};

export type LoreCheckCategory = 'wrong-fact' | 'contradicts-lore' | 'wrong-entity' | 'tone-voice' | 'out-of-character';
export type LoreCheckVerdict = 'consistent' | 'unsupported' | 'contradicts' | 'corrected';
export type LoreCheckCitation = { ref: string; label: string };
export type LoreCheckResult = {
    verdict: LoreCheckVerdict;
    issues: string[];
    citations: LoreCheckCitation[];
    suggestedRewrite: string | null;
    originalText: string;
    rawResponse?: string;
};
export type LoreCheckSelection = {
    messageId: string;
    selectedText: string;
    start: number;
    end: number;
    surroundingContext: string;
};

export type CondenserState = {
    condensedUpToIndex: number;
};

/** @deprecated — superseded by DiceSystemConfig. Kept for migration detection only. */
export type DiceConfig = {
    catastrophe: number;
    failure: number;
    success: number;
    triumph: number;
    crit: number;
};

// ─── Generalized dice engine types ──────────────────────────────────────

export type OutcomeBand = {
    id: string;
    label: string;   // "Catastrophe", "Mixed", "Success with boon", etc.
    min: number;      // inclusive
    max: number;      // inclusive
};

export type DieType = {
    id: string;
    name: string;     // "d6", "d20", "d100", "Custom ..."
    faces: number;    // 6, 20, 100, ...
    bands: OutcomeBand[]; // must tile 1..faces with no gaps/overlaps
};

export type RollAggregation = 'pick_one' | 'total_all';
export type RollModifier = 'none' | 'adv' | 'disadv';

export type RollDefinition = {
    modifier: RollModifier;      // Gate 1: None / Advantage / Disadvantage
    count: number;               // Gate 2: number of dice (e.g. 3 for 3d6)
    aggregation: RollAggregation; // Gate 3: Pick one / Total all
};

export type DiceCategory = {
    id: string;
    name: string;         // "Combat", "Stealth", custom — up to 10
    dieTypeId: string;    // references DieType.id
};

export type DiceSystemConfig = {
    dieTypes: DieType[];          // registry of available die types
    categories: DiceCategory[];   // up to 10
    // Note: no global rollDef — pool mode always does a singular roll per category.
    // The 3-gate RollDefinition is per-roll (dice me modal / roll_dice tool args), not global.
};

// How readily the GM asks the player for a roll. A THRESHOLD for what deserves dice,
// not a target count. Consumed only by getToolDefinitions (it selects request_roll's
// "when to call me" paragraph). Optional + read-site default (`?? 'contested'`) so no
// campaign migration is needed — migrateLegacyContext is deliberately untouched.
export type RollFrequency =
    | 'contested'       // any action meeting real resistance (default)
    | 'consequential'   // only when failure imposes a real, lasting cost
    | 'critical';       // only decisive conflicts and near-impossible attempts

/**
 * A pending player-rolled resolution, as shown in the roll modal. `successOn` and
 * `failureMeans` are the bar the GM committed to BEFORE it could see the number — they are
 * displayed so the player can see the terms are fixed in advance, not chosen afterwards.
 */
export type PlayerRollRequest = {
    dice: string;
    reason: string;
    successOn: string;
    failureMeans: string;
};

// Player-called "dice me" arm request (WO-H). Resolved at send time so the result is
// hidden until the player commits; asserted as fact into the turn.
//
// Declared here rather than imported from @narrative/engine on purpose: the engine's copy is
// shared with the mobile app, and `reason` is a desktop-only addition. Structural typing keeps
// this assignable to `resolveManualRoll`'s parameter, so nothing shared has to change.
export type ManualRollRequest = {
    dieTypeId: string;       // which DieType to roll
    rollDef: RollDefinition;  // per-roll 3-gate config (local to this roll)
    /** The player's own words for what the roll is attempting. Travels into the turn in place
     *  of the outcome tier the engine used to assert. Optional — legacy armed rolls have none. */
    reason?: string;
};

/** @deprecated — kept for migration. Old shape was '1d20' | 'adv' | 'disadv'. */
export type ManualRollMode = '1d20' | 'adv' | 'disadv';

export type SurpriseConfig = {
    initialDC: number;
    dcReduction: number;
    types: string[];
    tones: string[];
};

export type EncounterConfig = {
    initialDC: number;
    dcReduction: number;
    types: string[];
    tones: string[];
};

export type CharacterIntroEntry = {
    name: string;
    type: 'wandering' | 'location';
    location?: string;          // only for type === 'location'
    boostKeywords?: string[];   // if present in last 3 assistant msgs → 3x weight
    weight?: number;            // base draw weight (default 1)
};

export type NpcIntroConfig = {
    characters: CharacterIntroEntry[];
    initialDC: number;
    dcReduction: number;
};

export type WorldEventConfig = {
    initialDC: number; // Starting DC (default: 498)
    dcReduction: number; // Amount DC drops per turn (default: 2)
    who?: string[]; // The custom 'who' table
    where?: string[]; // The custom 'where' table
    why?: string[]; // The custom 'why' table
    what?: string[]; // The custom 'what' table
};

export type NotebookNote = {
    id: string;
    text: string;
    timestamp: number;
};

/** Active journey. Optional — a campaign that never travels is byte-identical
 *  to one that does. Set by `depart`, advanced each committed turn, cleared on
 *  `arrive` or when the fiction names an unrelated place (safety valve).
 *
 *  WO 6.1 §2 — multi-hop: a journey may route A→B→C through intermediate places
 *  when no direct A→C connection exists. `hops` carries the per-hop legs; the
 *  overall `fromId`/`toId` stay the journey's endpoints so the `[TRAVEL]` block
 *  names only the destination (WO 6.1 §2: "do not enumerate every intermediate
 *  place in the prose"). `hopIndex` is the 0-based current hop. Single-hop
 *  journeys (the original WO 3 case) leave `hops`/`hopIndex` undefined — they
 *  are byte-identical to pre-6.1 state. */
export type TravelHop = {
    fromId: string;
    toId: string;
    transitId: string;
    /** Legs (≡ days) for this hop, terrain-real when the route came from the
     *  pathfinder (WO 6.1 §2). */
    legs: number;
};

export type TravelState = {
    fromId: string;
    toId: string;
    transitId: string;
    mode: TravelMode;
    /** 1-based: the leg being played this turn. Counts across the whole journey;
     *  for a multi-hop journey this is the cumulative leg, not the per-hop leg. */
    leg: number;
    totalLegs: number;
    /** 'constrained' = bound, escorted, carried. A forced journey is a normal
     *  journey with constrained agency — legs still apply. */
    agency: 'free' | 'constrained';
    /** WO 6.1 §2 — the per-hop breakdown for a multi-hop journey. Absent for a
     *  single-hop journey (the WO 3 case). When present, `hopIndex` is the
     *  0-based index of the hop currently being traversed, `transitId` is that
     *  hop's transit node, and `totalLegs` is the sum of all hops' legs. */
    hops?: TravelHop[];
    hopIndex?: number;
};

export type GameContext = {
    loreRaw: string;
    rulesRaw: string;
    canonState: string;
    headerIndex: string;
    starter: string;
    continuePrompt: string;
    // The player character lives at `playerCharacter` (below) and nowhere else. Seven
    // fields used to sit here describing the same person a second and third time —
    // `characterProfile` (identity + traits), `characterProfileData` (a numeric sheet),
    // their staleness stamps, a `smartBookkeepingActive` switch choosing between the two,
    // and the pre-structured `inventory` string. `foldPcRecord` migrates all of them.
    inventoryItems: InventoryItem[];
    surpriseDC?: number;
    encounterDC?: number;
    worldEventDC?: number;
    diceConfig?: DiceConfig;        // @deprecated — migrated to diceSystem on load
    diceSystem?: DiceSystemConfig;   // generalized dice engine config
    worldEventConfig?: WorldEventConfig;
    /**
     * World-specific costs of a miss, seeded from the lore file and editable in Engine
     * Tuning. Whole phrases, not tags — they carry their own commas, so they are stored
     * one per entry and edited newline-separated.
     *
     * Nothing draws from this yet. It is campaign data waiting for the roll path to
     * consume it, and is deliberately NOT injected into the prompt in the meantime —
     * an unused list in every payload is context spent for nothing.
     */
    consequences?: string[];
    // Toggles: whether each field is appended to context
    canonStateActive: boolean;
    headerIndexActive: boolean;
    starterActive: boolean;
    continuePromptActive: boolean;
    surpriseEngineActive: boolean;
    encounterEngineActive: boolean;
    worldEngineActive: boolean;
    /**
     * "Ask To Roll" — the one dice mode. ON (the default) offers the `request_roll` tool: the
     * GM states the die and the bar, generation suspends, and the player types the total their
     * physical dice showed. OFF means no dice at all — no tool, and therefore no instruction to
     * ask for one, since every "ask for a roll" imperative lives in that tool's description.
     *
     * The name is historical. It used to mean the opposite thing (an engine-pre-rolled
     * `[DICE OUTCOMES]` pool); it is kept as the key so no save needs rewriting, and the UI
     * reads "Ask To Roll". The one-time value flip lives in migrateLegacyContext.
     */
    diceFairnessActive: boolean;
    /** Threshold for what deserves dice. Absent reads as 'contested' at the use site. */
    rollFrequency?: RollFrequency;
    sceneNote: string;
    sceneNoteActive: boolean;
    sceneNoteDepth: number;
    surpriseConfig?: SurpriseConfig;
    encounterConfig?: EncounterConfig;
    worldVibe: string;
    notebook: NotebookNote[];
    notebookActive: boolean;
    // NPC Intro Engine
    npcIntroEngineActive?: boolean;         // master toggle
    npcIntroDC?: number;                    // current DC (decays on failed rolls)
    npcIntroConfig?: NpcIntroConfig;        // config block
    rulesChunkMeta?: Record<string, RuleChunkMeta>;
    rulesChunks?: LoreChunk[];
    // ---- NPC Agency & Combat / Tier contexts ----
    agencyTick?: number;          // monotonic tick counter (heartbeat/timeskip advance it)
    agencyHeartbeatDC?: number;   // escalating-DC pity timer (mirrors surpriseDC)
    lastSceneStakes?: SceneStakes;     // last parsed/fallback scene stakes
    agencyDigest?: string;             // player-visible tick digest, folded into next GM call
    arcDigest?: string;                // Arc Engine: current-rung surface line, folded into next GM call
    arcs?: ArcRecord[];                // Arc Engine (System 2): active + retired arcs for this campaign
    combatModeActive?: boolean;        // combat master switch (Phase 7 wiring; type-only now)
    combatConfig?: {                   // combat tuning knobs (Phase 7 wiring; type-only now)
        mookJitterRange?: number;
        defaultWeaponDie?: number;
        recoveryBands?: Record<'healthy' | 'wounded' | 'critical', number>;
        combatAutoDetect?: boolean;
        autoEnterThreshold?: number;
        askThreshold?: number;
        confirmOnBorderline?: boolean;
        combatKeywords?: string[];
    };
    statLabelMap?: Record<string, string>;
    lootTree?: LootTree;
    activeLootProfileId?: string;
    // ── Location Ledger (v1) — current-place pointer (engine-owned writer;
    //    LLM only proposes, player can always override). Lazy migration:
    //    absent on existing campaigns → undefined → "no current place".
    currentPlaceId?: string | null;
    currentFeature?: string | null;   // free-string feature within the current place
    /** In-game day counter, 1-based. Optional: campaigns that never engage with
     * travel or deadlines simply never set it, and every consumer treats
     * `undefined` as "this campaign does not track time". */
    worldDay?: number;
    /** Remembers the player's last travel-mode choice. Defaults to `'foot'`. */
    travelMode?: TravelMode;
    /** Active journey, or null/undefined when settled. */
    travel?: TravelState | null;
    // ── Player Character (WO-A rewrite 2 §2 — D1: PC leaves npcLedger) ──
    // The PC is an NPCEntry-shaped record. `null` = no PC created yet. Persisted
    // as part of the campaign state JSON. Migration (services/character/migratePC.ts)
    // moves any legacy `isPC: true` row from npcLedger into this field on hydrate.
    playerCharacter?: PlayerCharacter | null;
    relationshipMemory?: boolean;
    // ── WO-A2 §2.1 — first-send intercept flag. Once the user picks
    // "Proceed anyway" on the no-PC warning modal, this is set true and the
    // intercept never fires again for the rest of this campaign.
    pcPromptDismissed?: boolean;
    // ── WO-A2 §2.5 — AI-Guided creation draft. The wizard persists every
    // step into this field so a dropped-out creation resumes where it left
    // off. Text-only; storage cost is nil. Cleared on commit (§2.8) or
    // explicit discard.
    creationDraft?: CharacterCreationDraft | null;
};

/**
 * AI-Guided creation draft (WO-A2 §2.5). The wizard writes user answers +
 * AI-generated question wording into this record on every step so the flow is
 * resumable. Only prose fields + the slot-9 visual profile are stored here —
 * `personalityHex` and `traits` are NEVER inferred from prose (§0) and are
 * written only by the quiz or the user's own hand on the Sheet tab.
 */
export type CharacterCreationDraft = {
    /** Slot 1 — engine-owned, free text. */
    name?: string;
    /** Slots 2–8 — AI-reskinned question wording (one per slot). */
    questions?: Partial<Record<CreationSlot, string>>;
    /** Slots 1–8 — user answers (free text for 2–8; name for 1). */
    answers?: Partial<Record<CreationSlot, string>>;
    /** Slot 9 — visual profile (hand-filled form, NOT prose). */
    visualProfile?: NPCVisualProfile;
    /** Slot 9 — appearance prose. */
    appearance?: string;
    /** §2.6 — 'manual' | 'questionnaire' | 'skip'. Set during the hex step. */
    hexMode?: 'manual' | 'questionnaire' | 'skip';
    /** §2.6 — quiz answers (scenario index → option index), for deriveHexFromAnswers. */
    quizAnswers?: Record<number, number>;
    /** §2.7 — at most 3 clarifying questions from the converter, skippable. */
    clarifyingQuestions?: string[];
    /** §2.7 — user answers to the clarifying questions. */
    clarifyingAnswers?: string[];
    /** Wizard step index for resume. */
    step?: number;
};

export type CreationSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type OpenAITool = {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties: Record<string, unknown>;
            required?: string[];
        };
    };
};

export type ContextSourceClassification = 'stable_truth' | 'summary' | 'world_context' | 'volatile_state' | 'scene_local';

export type DebugSection = {
    label: string;
    role: string;
    tokens?: number;
    content: string;
    classification?: ContextSourceClassification;
};

export type PayloadTrace = {
    source: string;
    classification: ContextSourceClassification;
    tokens: number;
    reason: string;
    preview?: string;
    included: boolean;
    position?: string;
};

// ─── Bookkeeping Defaults & Migration ──────────────────────────────────

export const DEFAULT_INVENTORY: InventoryItem[] = [];

// ─── Dice System Defaults & Migration ──────────────────────────────────

function bandId() { return `b_${Math.random().toString(36).slice(2, 9)}`; }

/** Standard 8 polyhedral/percentile die types with sensible default outcome bands. */
export function buildDefaultDieTypes(): DieType[] {
    return [
        {
            id: 'dt_d2', name: 'd2', faces: 2, bands: [
                { id: bandId(), label: 'Failure', min: 1, max: 1 },
                { id: bandId(), label: 'Success', min: 2, max: 2 },
            ],
        },
        {
            id: 'dt_d4', name: 'd4', faces: 4, bands: [
                { id: bandId(), label: 'Failure', min: 1, max: 2 },
                { id: bandId(), label: 'Success', min: 3, max: 4 },
            ],
        },
        {
            id: 'dt_d6', name: 'd6', faces: 6, bands: [
                { id: bandId(), label: 'Catastrophe', min: 1, max: 1 },
                { id: bandId(), label: 'Failure', min: 2, max: 3 },
                { id: bandId(), label: 'Mixed', min: 4, max: 4 },
                { id: bandId(), label: 'Success', min: 5, max: 6 },
            ],
        },
        {
            id: 'dt_d8', name: 'd8', faces: 8, bands: [
                { id: bandId(), label: 'Catastrophe', min: 1, max: 1 },
                { id: bandId(), label: 'Failure', min: 2, max: 4 },
                { id: bandId(), label: 'Success', min: 5, max: 7 },
                { id: bandId(), label: 'Triumph', min: 8, max: 8 },
            ],
        },
        {
            id: 'dt_d10', name: 'd10', faces: 10, bands: [
                { id: bandId(), label: 'Catastrophe', min: 1, max: 1 },
                { id: bandId(), label: 'Failure', min: 2, max: 5 },
                { id: bandId(), label: 'Success', min: 6, max: 9 },
                { id: bandId(), label: 'Triumph', min: 10, max: 10 },
            ],
        },
        {
            id: 'dt_d12', name: 'd12', faces: 12, bands: [
                { id: bandId(), label: 'Catastrophe', min: 1, max: 2 },
                { id: bandId(), label: 'Failure', min: 3, max: 6 },
                { id: bandId(), label: 'Success', min: 7, max: 10 },
                { id: bandId(), label: 'Triumph', min: 11, max: 12 },
            ],
        },
        {
            id: 'dt_d20', name: 'd20', faces: 20, bands: [
                { id: bandId(), label: 'Catastrophe', min: 1, max: 2 },
                { id: bandId(), label: 'Failure', min: 3, max: 6 },
                { id: bandId(), label: 'Success', min: 7, max: 15 },
                { id: bandId(), label: 'Triumph', min: 16, max: 19 },
                { id: bandId(), label: 'Narrative Boon', min: 20, max: 20 },
            ],
        },
        {
            id: 'dt_d100', name: 'd100', faces: 100, bands: [
                { id: bandId(), label: 'Fumble', min: 1, max: 5 },
                { id: bandId(), label: 'Failure', min: 6, max: 50 },
                { id: bandId(), label: 'Success', min: 51, max: 95 },
                { id: bandId(), label: 'Critical', min: 96, max: 100 },
            ],
        },
    ];
}

const DEFAULT_CATEGORY_NAMES = ['Combat', 'Perception', 'Stealth', 'Social', 'Movement', 'Knowledge'];

export function buildDefaultDiceSystem(): DiceSystemConfig {
    const dieTypes = buildDefaultDieTypes();
    return {
        dieTypes,
        categories: DEFAULT_CATEGORY_NAMES.map((name, i) => ({
            id: `cat_default_${i}`,
            name,
            dieTypeId: 'dt_d20',
        })),
    };
}

/**
 * Migrate legacy `diceConfig` (d20-only threshold object) → `diceSystem`.
 * If `diceSystem` already exists, leave it. If only `diceConfig` exists, build
 * a d20 die type whose bands reflect the old thresholds.
 */
function migrateDiceConfig(ctx: Partial<GameContext>): DiceSystemConfig {
    if (ctx.diceSystem) return ctx.diceSystem;
    const sys = buildDefaultDiceSystem();
    const old = ctx.diceConfig;
    if (old) {
        const d20 = sys.dieTypes.find(d => d.id === 'dt_d20');
        if (d20) {
            d20.bands = [
                { id: bandId(), label: 'Catastrophe', min: 1, max: Math.max(1, old.catastrophe) },
                { id: bandId(), label: 'Failure', min: old.catastrophe + 1, max: Math.max(old.catastrophe + 1, old.failure) },
                { id: bandId(), label: 'Success', min: old.failure + 1, max: Math.max(old.failure + 1, old.success) },
                { id: bandId(), label: 'Triumph', min: old.success + 1, max: Math.max(old.success + 1, old.triumph) },
                { id: bandId(), label: 'Narrative Boon', min: old.triumph + 1, max: Math.max(old.triumph + 1, old.crit) },
            ];
        }
    }
    return sys;
}

export function normalizeLocationTag(raw?: unknown): string {
    if (typeof raw !== 'string') return 'inventory';
    const cleaned = raw.replace(/[\r\n\t]/g, ' ').replace(/\[/g, '').replace(/\]/g, '').trim();
    if (!cleaned) return 'inventory';
    return cleaned.slice(0, 60);
}

export function normalizeInventoryItem(item: InventoryItem): InventoryItem {
    const locationTag = normalizeLocationTag(item.locationTag);
    const equipped = locationTag === 'inventory' ? Boolean(item.equipped) : false;
    return {
        ...item,
        locationTag,
        equipped,
    };
}

export function parsePlainInventory(text: string): InventoryItem[] {
    const items: InventoryItem[] = [];
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
        const clean = line.replace(/^[-*•]\s*/, '').replace(/^\d+\.\s*/, '');
        if (!clean) continue;
        const nameMatch = clean.match(/^(.*?)(?:\s*\((\d+)\s*x\s*(.+)\))?\s*$/i);
        const name = nameMatch ? nameMatch[1].trim() : clean;
        const qtyMatch = clean.match(/(?:x\s*(\d+))|(\d+)x/i);
        const qty = qtyMatch ? parseInt(qtyMatch[1] || qtyMatch[2], 10) : 1;
        const lower = name.toLowerCase();
        let category: InventoryItemCategory = 'misc';
        if (lower.includes('gold') || lower.includes('coin') || lower.includes('silver') || lower.includes('copper')) category = 'currency';
        else if (lower.includes('potion') || lower.includes('elixir') || lower.includes('antidote')) category = 'consumable';
        else if (lower.includes('sword') || lower.includes('dagger') || lower.includes('bow') || lower.includes('axe') || lower.includes('mace') || lower.includes('staff') || lower.includes('blade')) category = 'weapon';
        else if (lower.includes('armor') || lower.includes('shield') || lower.includes('helm') || lower.includes('gauntlet') || lower.includes('boot') || lower.includes('plate')) category = 'armor';
        else if (lower.includes('key') || lower.includes('seal') || lower.includes('tome')) category = 'key';
        items.push(normalizeInventoryItem({
            id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            name,
            qty,
            category,
            keywords: name.toLowerCase().split(/\s+/).filter(w => w.length > 2),
            equipped: false,
            lastUsedScene: '000',
            importance: 5,
            notes: '',
            locationTag: 'inventory',
        }));
    }
    return items;
}

export function migrateLegacyContext(ctx: Partial<GameContext>): GameContext {
    // Note: Agency fields (agencyTick, agencyHeartbeatDC, lastSceneStakes, agencyDigest, arcDigest, etc.)
    // are not initialized here; they are lazy-migrated in Phase 2.
    const base: GameContext = {
        loreRaw: '',
        rulesRaw: '',
        rulesChunkMeta: {},
        rulesChunks: [],
        canonState: '',
        headerIndex: '',
        starter: '',
        continuePrompt: '',
        inventoryItems: DEFAULT_INVENTORY,
        canonStateActive: false,
        headerIndexActive: false,
        starterActive: false,
        continuePromptActive: false,
        surpriseEngineActive: false,
        encounterEngineActive: true,
        worldEngineActive: true,
        diceFairnessActive: true,
        sceneNote: '',
        sceneNoteActive: false,
        sceneNoteDepth: 3,
        notebook: [],
        notebookActive: true,
        worldVibe: '',
        relationshipMemory: false,
        worldEventConfig: {
            initialDC: 498,
            dcReduction: 2,
            who: [],
            where: [],
            why: [],
            what: [],
        },
        consequences: [],
    };
    const merged: GameContext = { ...base, ...ctx };
    // Inventory normalization. The legacy free-text `inventory` string is read by
    // `foldPcRecord` at hydrate; here we only normalize what is already structured.
    merged.inventoryItems = (merged.inventoryItems ?? DEFAULT_INVENTORY).map(normalizeInventoryItem);

    // ── Dice system migration ──
    // Old saves have `diceConfig` (d20 thresholds) but no `diceSystem`. Build one.
    if (!merged.diceSystem) {
        merged.diceSystem = migrateDiceConfig(merged);
    }
    // ── Ask To Roll migration ──
    // Dice modes collapsed three into two, and `diceFairnessActive` changed meaning: it used to
    // select the engine-pre-rolled pool, it now selects player-rolled resolution. The field is
    // REQUIRED, so every save carries an explicit value that wins the spread above — a changed
    // default cannot reach them.
    //
    // The pairing that needs carrying is `diceFairnessActive: false` + `playerRollActive: true`,
    // which is how "player rolls, ON" was stored for the few days that flag existed. Under the
    // new reading that `false` means NO DICE, so those campaigns would silently lose dice.
    //
    // `false` + `playerRollActive: false` (the legacy engine-rolled mode) correctly lands on
    // no-dice: the engine no longer rolls on the model's behalf, so that is the honest outcome.
    // A pre-fork `true` (pool mode) needs nothing — it already reads as ON.
    //
    // Self-limiting, so no migration flag is needed: the condition reads `playerRollActive`, and
    // the delete below removes it, so a second pass cannot re-fire.
    const legacy = ctx as Partial<GameContext> & { playerRollActive?: boolean };
    if (legacy.playerRollActive === true && merged.diceFairnessActive === false) {
        merged.diceFairnessActive = true;
    }
    delete (merged as { playerRollActive?: boolean }).playerRollActive;
    return merged;
}
