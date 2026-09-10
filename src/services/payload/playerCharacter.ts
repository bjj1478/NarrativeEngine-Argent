import type { PlayerCharacter, InventoryItem, ChatMessage, NPCEntry, SceneEventType } from '../../types';
import { CORE_FLOOR_TRAITS } from '../../types';
import { queryTraits } from '../retrieval/semanticMemory';

/**
 * playerCharacter.ts — the single [PLAYER CHARACTER] block.
 *
 * Replaces three overlapping blocks that between them described the PC three times:
 *
 *   [CHARACTER]  CHAR:Sabrita|? ?|Lv1 | HP:20/20 | EQP:Belt Knife
 *   [INVENTORY]  [EQP] Belt Knife
 *   [PROFILE]    Sabrita | HP:20/20
 *
 * Name twice, HP twice, the knife twice, and `? ?` was empty race/class rendered as
 * placeholders. Worse, the two profile branches in the old `buildVolatile` were mutually
 * exclusive, and the one that always won could not see `activeTraits` or `signatureKit` —
 * so the persona material was maintained every turn and never sent.
 *
 * WHAT IS DELIBERATELY ABSENT, and why:
 *
 * - **Numbers.** No level, HP, MP or stat block. Those were hardcoded creation defaults
 *   (`commitCharacterDraft`'s `DEFAULT_HP`), never decremented by anything, and the
 *   design goals are explicit: "a number in the prompt is a number the writer can read
 *   back out." Injury reaches the model as words, through `status` / `condition`.
 * - **Trait metadata.** No `[category]` prefix, no `[imp:7 tags:combat]` suffix. That is
 *   selection bookkeeping for `queryTraits`; the writer has no use for it and `imp:7` is
 *   just another number to read back out.
 * - **Personality.** Stable prose belongs in the world and starter docs, above the
 *   prompt-cache boundary. This block sits below it and is re-billed every turn.
 *   `appearance` is the exception: the drift updater writes narrated changes into it
 *   (a scar, a burn), so it has to come back or those changes are write-only.
 */

/** Cap on the `Carrying:` line. Overflow collapses into a `+N more` tail. */
const CARRY_LINE_CHAR_CAP = 300;

/** Cap on the `Looks:` line. Appearance is user-authored and can run to a paragraph. */
const LOOKS_LINE_CHAR_CAP = 200;

/** Token budget handed to `queryTraits` for the scene-relevant tier. */
const TRAIT_TOKEN_BUDGET = 400;

export type PlayerCharacterBlockOptions = {
    userMessage?: string;
    history?: ChatMessage[];
    npcLedger?: NPCEntry[];
    plannerEventTypes?: SceneEventType[];
};

/**
 * The PC's signature loadout, as one bounded line.
 *
 * `element` used to ride along here as a third segment. It was a single affinity tag
 * ("fire") that said nothing a descriptive ability ("fire magic") in `abilities` did not
 * already say, so it is gone from the type entirely.
 *
 * Returns '' when there is no kit, so the caller can skip the line.
 */
export function buildPcKitLine(pc: PlayerCharacter | null | undefined): string {
    const kit = pc?.signatureKit;
    if (!kit) return '';
    const segments: string[] = [];
    if (kit.equipment.length > 0) segments.push(`Kit: ${kit.equipment.join(', ')}`);
    if (kit.abilities.length > 0) segments.push(`Powers: ${kit.abilities.join(', ')}`);
    return segments.join(' | ');
}

/**
 * `Sabrita — human, hedge-witch — gash across the left forearm; favours the right hand`
 *
 * Every part is optional and an absent part is simply omitted; nothing is ever rendered
 * as `?`, which is what produced the old stub's `? ?`. A whole, living PC costs one word:
 * their name.
 *
 * `condition` and `status` are separate axes and both can show: how hurt they are, and
 * whether they are alive, dead, missing or held. Each is skipped at its default — an
 * empty condition (healed) and an `Alive` status say nothing worth spending tokens on.
 * `'healthy'` is skipped too: the field was an enum before it carried prose, and old
 * records may still hold that literal.
 */
function buildIdentityLine(pc: PlayerCharacter): string {
    const descriptors = [pc.visualProfile?.race, pc.pcMeta?.archetype]
        .map(s => (s ?? '').trim())
        .filter(Boolean);

    const condition = (pc.condition ?? '').trim();
    const showCondition = condition && condition.toLowerCase() !== 'healthy' ? condition : '';

    const status = (pc.status ?? '').trim();
    const showStatus = status && status !== 'Alive' ? status : '';

    let line = pc.name?.trim() || 'The player character';
    if (descriptors.length > 0) line += ` — ${descriptors.join(', ')}`;
    if (showCondition) line += ` — ${showCondition}`;
    if (showStatus) line += ` — ${showStatus}`;
    return line;
}

/**
 * `Looks: lean, dark-haired, now a scar across the left eye`
 *
 * The drift updater records narrated changes to appearance — its own worked example is a
 * scar — and until now nothing sent them back, so the GM could write a mark onto the
 * character and never see it again. Capped because this field is user-authored and the
 * block is re-billed every turn.
 */
function buildLooksLine(pc: PlayerCharacter): string {
    const appearance = (pc.appearance ?? '').replace(/\s+/g, ' ').trim();
    if (!appearance) return '';
    const trimmed = appearance.length > LOOKS_LINE_CHAR_CAP
        ? appearance.slice(0, LOOKS_LINE_CHAR_CAP).trimEnd() + '…'
        : appearance;
    return `Looks: ${trimmed}`;
}

/**
 * `Carrying: Belt Knife (worn), rope, torch x2, lockpicks [at: the inn]`
 *
 * Equipped items lead, because what is in the PC's hands is the fact most likely to
 * change a scene. The old block gated inventory by recommender-chosen categories, which
 * meant a blocking utility LLM call every turn to decide which of one item to show; a
 * character cap does the same job without the round trip.
 */
function buildCarryLine(items: InventoryItem[]): string {
    if (items.length === 0) return '';

    const render = (i: InventoryItem): string => {
        let s = i.name;
        if (i.qty > 1) s += ` x${i.qty}`;
        if (i.equipped) s += ' (worn)';
        const loc = (i.locationTag ?? 'inventory').trim();
        if (loc && loc !== 'inventory') s += ` [at: ${loc}]`;
        return s;
    };

    const ordered = [...items].sort((a, b) => Number(b.equipped) - Number(a.equipped));
    const rendered = ordered.map(render);

    // Admit entries until the cap, then say how many were left out rather than
    // truncating mid-item — a half-named object is worse than a known omission.
    const accepted: string[] = [];
    for (const entry of rendered) {
        const candidate = `Carrying: ${[...accepted, entry].join(', ')}`;
        if (accepted.length > 0 && candidate.length > CARRY_LINE_CHAR_CAP) break;
        accepted.push(entry);
    }

    const dropped = rendered.length - accepted.length;
    const tail = dropped > 0 ? `, +${dropped} more` : '';
    return `Carrying: ${accepted.join(', ')}${tail}`;
}

/**
 * Build the whole block.
 *
 * Returns '' only when there is neither a PC record nor anything in the inventory, so a
 * campaign that never created a character emits nothing rather than an empty header.
 *
 * A campaign CAN have inventory and no PC record — the player can dismiss the character
 * prompt and keep playing, and `migrateLegacyContext` converts the old free-text
 * inventory into `inventoryItems` regardless of whether a PC exists. In that case the
 * identity line is skipped and the block carries the possessions alone; dropping them
 * would lose the one thing the old legacy-inventory branch was there to send.
 */
export function buildPlayerCharacterBlock(
    pc: PlayerCharacter | null | undefined,
    inventoryItems: InventoryItem[] | undefined,
    opts: PlayerCharacterBlockOptions = {},
): string {
    const carry = buildCarryLine(inventoryItems ?? []);
    if (!pc && !carry) return '';

    const lines: string[] = [
        // Plain tag. It used to carry a gloss — "the human you are playing with" — inherited
        // from the old persona block, which was written when this material lived in a block
        // called [CHARACTER PROFILE] and needed to say whose profile it was. The tag names
        // itself now, and the closer below matches it.
        '[PLAYER CHARACTER]',
    ];

    if (pc) {
        lines.push(buildIdentityLine(pc));
        const looks = buildLooksLine(pc);
        if (looks) lines.push(looks);
    }
    if (carry) lines.push(carry);

    const kit = buildPcKitLine(pc);
    if (kit) lines.push(kit);

    // Core traits always inject; the extended tier is scored against this turn's message,
    // the recent history, the on-stage cast and the planner's event types.
    const selected = queryTraits(
        pc?.activeTraits ?? [],
        opts.userMessage ?? '',
        opts.history ?? [],
        opts.npcLedger ?? [],
        opts.plannerEventTypes,
        TRAIT_TOKEN_BUDGET,
        CORE_FLOOR_TRAITS,
    );
    if (selected.core.length > 0) {
        lines.push('Core:');
        for (const t of selected.core) lines.push(`▸ ${t.text}`);
    }
    if (selected.extended.length > 0) {
        lines.push('Scene-relevant:');
        for (const t of selected.extended) lines.push(`▸ ${t.text}`);
    }

    lines.push('[END PLAYER CHARACTER]');
    return lines.join('\n');
}
