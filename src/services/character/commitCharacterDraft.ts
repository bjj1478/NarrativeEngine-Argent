import type { PlayerCharacter, CharacterCreationDraft, NPCVisualProfile, InventoryItem } from '../../types';
import { DEFAULT_VISUAL_PROFILE } from '../../types';
import { uid } from '../../utils/uid';

/**
 * WO-A2 §2.8 — commit the assembled draft into the live store.
 *
 * Nothing exists until this runs. One function, one code path, used by the
 * wizard AND by WO-C's "play as one of my cards" import. The caller passes
 * the resolved store setters so this stays pure + testable.
 *
 * §0 invariant: `personalityHex` and `traits` are written ONLY by the quiz
 * or the user's own hand. The converter (§2.7) is forbidden from emitting
 * them; this function does NOT synthesize them either. If `draft.hex` /
 * `draft.traits` are present (set by the quiz step), they are honored. If
 * not, they stay unset — a PC without a hex is a valid state.
 */

export type CommitInputs = {
    draft: CharacterCreationDraft;
    /** Personality hex from the quiz step (§2.6). Optional — Skip leaves this undefined. */
    hex?: import('../../types').PersonalityHex;
    /** Traits from the quiz step (§2.6). Optional. */
    traits?: string[];
};

export type CommitDeps = {
    setPlayerCharacter: (pc: PlayerCharacter | null) => void;
    setInventoryItems: (items: InventoryItem[]) => void;
    updateContext: (patch: Record<string, unknown>) => void;
};

/**
 * Assemble a `PlayerCharacter` record from a committed draft, WITHOUT writing
 * it anywhere. Exposed for tests and WO-C's "play as one of my cards" import
 * (which has its own store wiring but wants the same assembly rules).
 */
export function assemblePlayerCharacter(inputs: CommitInputs): PlayerCharacter {
    const { draft, hex, traits } = inputs;
    const visualProfile: NPCVisualProfile = { ...DEFAULT_VISUAL_PROFILE, ...(draft.visualProfile || {}) };

    const pc: PlayerCharacter = {
        id: uid(),
        name: (draft.name || '').trim(),
        aliases: '',
        appearance: draft.appearance || '',
        visualProfile,
        faction: draft.answers?.[3] || '',
        storyRelevance: draft.answers?.[2] || '',
        disposition: draft.answers?.[5] || '',
        status: 'Alive',
        goals: '',
        voice: draft.answers?.[6] || '',
        personality: '',
        exampleOutput: '',
        affinity: 50,
        isPC: true,
        populated: true,
        wants: { short: [], medium: [], long: draft.answers?.[7] || '' },
    };

    // §2.3 slot 4 → signatureKit.abilities. Free-text answer, split on comma/pipe.
    // A trailing " (element: fire)" used to be scraped into its own field; the field is
    // gone, so the parenthetical is simply left in the ability text where it reads fine.
    const slot4 = draft.answers?.[4] || '';
    if (slot4) {
        const abilities = slot4.split(/[,|]/).map(s => s.trim()).filter(Boolean).slice(0, 8);
        if (abilities.length) {
            pc.signatureKit = { equipment: [], abilities };
        }
    }

    if (hex) pc.personalityHex = hex;
    if (traits && traits.length > 0) pc.traits = traits.slice(0, 5);

    return pc;
}

/**
 * Parse slot 8 (starting possessions, free text) into `InventoryItem[]`.
 * Comma/pipe/newline separated; each item becomes a `misc`-category row.
 */
export function parseStartingInventory(raw: string): InventoryItem[] {
    const names = (raw || '')
        .split(/[,|\n]/)
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 30);
    return names.map((name, i) => ({
        id: `pc_start_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        name,
        qty: 1,
        category: 'misc' as const,
        keywords: [],
        equipped: false,
        lastUsedScene: '000',
        importance: 5,
        notes: '',
        locationTag: 'inventory',
    }));
}

/**
 * Commit the draft. Writes `playerCharacter`, sets `inventoryItems` from slot 8, and
 * clears `creationDraft`. One record, written once.
 *
 * It used to also seed a `characterProfileData` sheet with `level: 1` and a hardcoded
 * `HP 20/20`, and mirror the name a third time into `characterProfile.identity.name`.
 * Nothing ever decremented that HP, and both mirrors reached the model every turn — so
 * every new character was born with two numbers that were never true and a name the
 * prompt then repeated three times over.
 */
export function commitCharacterDraft(inputs: CommitInputs, deps: CommitDeps): void {
    const pc = assemblePlayerCharacter(inputs);
    deps.setPlayerCharacter(pc);

    const startItems = parseStartingInventory(inputs.draft.answers?.[8] || '');
    if (startItems.length > 0) deps.setInventoryItems(startItems);

    // Clear the draft (§2.8 step 5).
    deps.updateContext({ creationDraft: null } as never);
}