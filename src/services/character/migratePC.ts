import type { NPCEntry, GameContext, PlayerCharacter, CharacterTrait } from '../../types';
import { DEFAULT_VISUAL_PROFILE } from '../../types';
import { sanitizeSignatureKit } from '../npc/signatureKit';
import { uid } from '../../utils/uid';
import { parsePlainInventory } from '../../types/gamecontext';

/**
 * WO-A rewrite 2 §2 — one-time, idempotent migration of a legacy `isPC: true`
 * row from `npcLedger` to `context.playerCharacter`.
 *
 * Old saves (pre-rewrite-2) stored the PC as a row inside `npcLedger` flagged
 * with `isPC: true`. The rewrite moves the PC out of the ledger entirely so
 * the NPC ledger, agency engine, updater, detector, review, and post-turn
 * pipeline never see it. This function folds any legacy `isPC` row into
 * `context.playerCharacter` and strips it from the ledger.
 *
 * Contract:
 *  - Idempotent: a second call on already-migrated state is a no-op.
 *  - First-write-wins on `playerCharacter`: if a PC already exists at
 *    `context.playerCharacter`, any stray `isPC` row in the ledger is just
 *    dropped (it's a duplicate from a buggy save path). The existing PC record
 *    is preserved untouched.
 *  - Pure: returns a new `{ context, npcLedger }` object; does not mutate input.
 *  - The migrated record keeps its `id`, `name`, `signatureKit`, `personalityHex`,
 *    `wants`, `voice`, `personality`, `visualProfile`, `portrait`, `pcMeta`,
 *    `traits`, and every other NPCEntry field. `isPC: true` is left in place on
 *    the migrated record — it is vestigial but harmless, and removing it would
 *    change the byte shape of the record mid-migration (and risk confusing any
 *    code that still defensively checks `isPC`).
 */
export function migratePCIntoContext(
    context: GameContext,
    npcLedger: NPCEntry[],
): { context: GameContext; npcLedger: NPCEntry[]; migrated: boolean } {
    const existingPc = context.playerCharacter ?? null;

    const pcRow = npcLedger.find(n => n.isPC);
    if (!pcRow) {
        return { context, npcLedger, migrated: false };
    }

    // Strip the PC row from the ledger. If multiple `isPC` rows exist (buggy
    // state), strip them all — only one PC is valid.
    const strippedLedger = npcLedger.filter(n => !n.isPC);

    if (existingPc) {
        // Already migrated. Drop the stray duplicate row but keep the existing
        // playerCharacter record untouched.
        return { context, npcLedger: strippedLedger, migrated: false };
    }

    const newContext: GameContext = { ...context, playerCharacter: pcRow as PlayerCharacter };
    return { context: newContext, npcLedger: strippedLedger, migrated: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// PC record consolidation — fold the retired sheet + trait-state into the PC.
//
// The engine used to keep the player character in three places at once:
//   context.characterProfileData  — a stat sheet (name/race/class/level/hp/stats/…)
//   context.characterProfile      — identity + narrative traits + a frozen legacy blob
//   context.playerCharacter       — the NPCEntry-shaped record (kit, hex, wants, visuals)
// `commitCharacterDraft` wrote the name into all three and seeded a hardcoded Lv1 and
// HP 20/20 that nothing ever decremented, so the prompt carried the PC three times over
// and two of those copies were fiction. This folds the first two into the third, which
// is the only one with a real owner.
//
// WHY THIS IS NOT IN `migrateLegacyContext`: that function runs on every single
// `updateContext` call, and `updateContext` returns only `{ context }` — it does not
// republish the top-level `playerCharacter` store mirror. A fold that mutated
// `context.playerCharacter` there would leave the mirror stale, and the next
// `updatePlayerCharacter(patch)` — which merges onto the mirror — would write the stale
// copy back and silently erase everything folded. This runs at hydrate only, where the
// store sets context and mirror together in one `setState`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The retired `CharacterProfile` sheet, declared structurally and locally. The exported
 * type is gone; the migration is the one place that must still recognise the old shape
 * on disk, so it keeps its own description of it.
 */
type LegacySheet = {
    name?: string;
    race?: string;
    class?: string;
    skills?: string[];
    abilities?: string[];
    traits?: string[];
    notes?: string;
    // level / hp / mp / stats are deliberately absent: nothing reads them.
};

/** The retired `CharacterProfileState`, likewise structural and local. */
type LegacyProfileState = {
    identity?: { name?: string; race?: string; class?: string; archetype?: string };
    activeTraits?: CharacterTrait[];
    legacyNotes?: string;
};

function firstNonEmpty(...values: (string | undefined | null)[]): string {
    for (const v of values) {
        const s = (v ?? '').trim();
        if (s) return s;
    }
    return '';
}

function dedupeStrings(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of values) {
        const v = (raw ?? '').trim();
        if (!v) continue;
        const key = v.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(v);
    }
    return out;
}

/**
 * Build the minimum viable PC record when the sheet holds a name but
 * `context.playerCharacter` is null. Never drop the data on the floor.
 */
function blankPc(name: string): PlayerCharacter {
    return {
        id: uid(),
        name,
        aliases: '',
        appearance: '',
        faction: '',
        storyRelevance: '',
        disposition: '',
        status: 'Alive',
        goals: '',
        voice: '',
        personality: '',
        exampleOutput: '',
        affinity: 50,
        isPC: true,
        populated: true,
    };
}

/**
 * Fold `characterProfileData` + `characterProfile` into `context.playerCharacter`.
 *
 * Conflict rule: PC wins, then identity, then sheet — first non-empty. The PC record is
 * what the user typed into the Sheet tab; the other two were mirrors written *from* it
 * (`SheetTab.mirrorName`, `commitCharacterDraft`). A mirror never outranks its source.
 *
 * Deliberately dropped: level, hp, mp, stats. They were hardcoded creation defaults,
 * never tracked, and the design goals keep numbers out of the prompt. `skills` folds into
 * `legacyNotes` instead of any field that reaches the model, so the text survives without
 * becoming a stat line again.
 *
 * `sheet.traits` becomes `pc.traits` (short personality descriptors), NOT `activeTraits`
 * — a `CharacterTrait` needs a category, eventTags, importance and an establishing scene,
 * and `queryTraits` scores on exactly those. Inventing them would poison retrieval.
 *
 * Idempotent: the guard is the data itself. Once `stripLegacyPcFields` has removed the
 * two keys this returns on the first two property reads. Re-running *before* the strip is
 * also safe — every scalar merge is first-non-empty and every array merge dedupes by
 * identity, so fold(fold(x)) === fold(x).
 *
 * Pure: returns a new context; does not mutate the input.
 */
export function foldPcRecord(
    context: GameContext,
): { context: GameContext; folded: boolean } {
    const raw = context as unknown as Record<string, unknown>;
    const sheetRaw = raw.characterProfileData;
    const stateRaw = raw.characterProfile;
    const legacyInventory = typeof raw.inventory === 'string' ? raw.inventory : '';

    // Cheap exit — the steady state once the strip has run.
    if (!sheetRaw && !stateRaw && !legacyInventory) return { context, folded: false };

    // Pre-structured saves kept the inventory as free text. Convert it before the strip
    // removes the field; this used to live in `migrateLegacyContext`, which no longer sees
    // it. Structured items always win — the string is a stale mirror of them.
    let inventoryItems = context.inventoryItems;
    let inventoryConverted = false;
    if ((!inventoryItems || inventoryItems.length === 0) && legacyInventory.trim()) {
        inventoryItems = parsePlainInventory(legacyInventory);
        inventoryConverted = inventoryItems.length > 0;
    }

    const sheet: LegacySheet = (sheetRaw && typeof sheetRaw === 'object') ? sheetRaw as LegacySheet : {};

    // Pre-WO-G saves stored `characterProfile` as a raw string. Normalize first — reading
    // `.identity` off a string yields undefined and silently loses the blob.
    const isLegacyString = typeof stateRaw === 'string';
    const state: LegacyProfileState = (!isLegacyString && stateRaw && typeof stateRaw === 'object')
        ? stateRaw as LegacyProfileState
        : {};
    const identity = state.identity ?? {};
    const stateTraits = Array.isArray(state.activeTraits) ? state.activeTraits : [];
    const legacyNotes = isLegacyString ? (stateRaw as string) : state.legacyNotes;

    const existing = context.playerCharacter ?? null;
    const name = firstNonEmpty(existing?.name, identity.name, sheet.name);

    if (!existing && !name) {
        if (inventoryConverted) {
            return { context: { ...context, inventoryItems }, folded: true };
        }
        // No PC, and nothing to build one from. If narrative data is present it has no
        // owner to attach to — say so rather than dropping it silently.
        if (stateTraits.length > 0 || legacyNotes) {
            console.warn('[foldPcRecord] Retired profile data found, but there is no player character and no name to build one from. It will be dropped.');
        }
        return { context, folded: false };
    }

    // The on-disk record is frequently NOT a complete NPCEntry — real saves omit
    // aliases/appearance/faction/goals/voice/affinity despite the type declaring them
    // required. Every read below is optional-chained for that reason.
    const pc: PlayerCharacter = existing ? { ...existing } : blankPc(name);
    pc.name = name;

    const race = firstNonEmpty(existing?.visualProfile?.race, identity.race, sheet.race);
    if (race) {
        pc.visualProfile = { ...DEFAULT_VISUAL_PROFILE, ...(pc.visualProfile ?? {}), race };
    }

    const archetype = firstNonEmpty(existing?.pcMeta?.archetype, identity.archetype, identity.class, sheet.class);
    if (archetype) {
        pc.pcMeta = { ...(pc.pcMeta ?? {}), archetype };
    }

    // Abilities are set-valued, so this is a union rather than first-non-empty. Routed
    // through the shared sanitizer to inherit the 8-entry / 48-char bounds.
    const abilities = dedupeStrings([
        ...(existing?.signatureKit?.abilities ?? []),
        ...(Array.isArray(sheet.abilities) ? sheet.abilities : []),
    ]);
    if (abilities.length > 0) {
        pc.signatureKit = sanitizeSignatureKit({ abilities }, pc.signatureKit)
            ?? { equipment: [], abilities };
    }

    // Dedupe by id so a re-run before the strip is a no-op; the PC side wins.
    const seenTraitIds = new Set((pc.activeTraits ?? []).map(t => t.id));
    const mergedTraits = [...(pc.activeTraits ?? [])];
    for (const t of stateTraits) {
        if (!t || seenTraitIds.has(t.id)) continue;
        seenTraitIds.add(t.id);
        mergedTraits.push(t);
    }
    if (mergedTraits.length > 0) pc.activeTraits = mergedTraits;

    const personality = dedupeStrings([
        ...(existing?.traits ?? []),
        ...(Array.isArray(sheet.traits) ? sheet.traits : []),
    ]).slice(0, 5);
    if (personality.length > 0) pc.traits = personality;

    // `notes` is not a small field: on any save that came through the flat-string
    // migration it holds the ENTIRE old profile blob. Preserve it, never inject it.
    // Skills join it here — text worth keeping, but not as a stat line.
    const skills = Array.isArray(sheet.skills) ? sheet.skills.filter(Boolean) : [];
    const notesParts = [
        existing?.legacyNotes,
        legacyNotes,
        sheet.notes,
        skills.length > 0 ? `Skills: ${skills.join(', ')}` : undefined,
    ].filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
    const notes = dedupeStrings(notesParts).join('\n\n');
    if (notes) pc.legacyNotes = notes;

    return { context: { ...context, playerCharacter: pc, inventoryItems }, folded: true };
}

/**
 * Remove the retired PC fields from a context. Split from {@link foldPcRecord} so the
 * fold always runs first and this can never delete data that has not been folded yet.
 * Unconditional deletes on a fresh object — no branching, idempotent by construction.
 */
export function stripLegacyPcFields(context: GameContext): GameContext {
    const next = { ...context } as unknown as Record<string, unknown>;
    for (const key of [
        'characterProfileData',
        'characterProfile',
        'characterProfileActive',
        'characterProfileLastScene',
        'smartBookkeepingActive',
        'inventoryActive',
        'inventory',
        'inventoryLastScene',
    ]) {
        delete next[key];
    }
    return next as unknown as GameContext;
}