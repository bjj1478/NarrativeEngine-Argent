import { describe, it, expect } from 'vitest';
import { migratePCIntoContext, foldPcRecord, stripLegacyPcFields } from '../migratePC';
import type { NPCEntry, GameContext } from '../../types';

function makeNpc(name: string, extra: Partial<NPCEntry> = {}): NPCEntry {
    return {
        id: name.toLowerCase(),
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
        ...extra,
    };
}

function makePc(name: string, extra: Partial<NPCEntry> = {}): NPCEntry {
    return makeNpc(name, { isPC: true, ...extra });
}

function baseCtx(): GameContext {
    return {
        loreRaw: '',
        rulesRaw: '',
        canonState: '',
        headerIndex: '',
        starter: '',
        continuePrompt: '',
        inventory: '',
        inventoryLastScene: 'Never',
        characterProfile: { identity: {}, activeTraits: [] },
        characterProfileLastScene: 'Never',
        inventoryItems: [],
        characterProfileData: { name: '', race: '', class: '', level: 1, hp: { current: 20, max: 20 }, stats: {}, skills: [], abilities: [], traits: [], notes: '' },
        smartBookkeepingActive: true,
        surpriseEngineActive: false,
        encounterEngineActive: true,
        worldEngineActive: true,
        diceFairnessActive: true,
        canonStateActive: false,
        headerIndexActive: false,
        starterActive: false,
        continuePromptActive: false,
        inventoryActive: false,
        characterProfileActive: false,
        sceneNote: '',
        sceneNoteActive: false,
        sceneNoteDepth: 3,
        notebook: [],
        notebookActive: true,
        worldVibe: '',
        playerCharacter: null,
    } as unknown as GameContext;
}

describe('migratePCIntoContext', () => {
    it('moves an isPC row from npcLedger into context.playerCharacter', () => {
        const pc = makePc('Hero', { signatureKit: { equipment: ['Excalibur'], abilities: [] } });
        const npcA = makeNpc('Aria');
        const npcB = makeNpc('Bram');
        const ctx = baseCtx();
        const ledger = [npcA, pc, npcB];

        const { context, npcLedger, migrated } = migratePCIntoContext(ctx, ledger);

        expect(migrated).toBe(true);
        expect(npcLedger.map(n => n.name)).toEqual(['Aria', 'Bram']);
        expect(context.playerCharacter).toBeDefined();
        expect(context.playerCharacter!.name).toBe('Hero');
        expect(context.playerCharacter!.signatureKit?.equipment).toEqual(['Excalibur']);
    });

    it('is idempotent: a second call on already-migrated state is a no-op', () => {
        const pc = makePc('Hero');
        const npcA = makeNpc('Aria');
        const ctx = baseCtx();
        const ledger = [npcA, pc];

        const first = migratePCIntoContext(ctx, ledger);
        expect(first.migrated).toBe(true);

        const second = migratePCIntoContext(first.context, first.npcLedger);
        expect(second.migrated).toBe(false);
        expect(second.npcLedger.map(n => n.name)).toEqual(['Aria']);
        expect(second.context.playerCharacter!.name).toBe('Hero');
    });

    it('drops a stray isPC row when playerCharacter already exists (defensive — keeps existing PC)', () => {
        const existingPc = makePc('Original', { id: 'pc-original' });
        const strayPc = makePc('Stray', { id: 'pc-stray' });
        const npcA = makeNpc('Aria');
        const ctx = { ...baseCtx(), playerCharacter: existingPc };
        const ledger = [npcA, strayPc];

        const { context, npcLedger, migrated } = migratePCIntoContext(ctx, ledger);

        expect(migrated).toBe(false);
        expect(npcLedger.map(n => n.name)).toEqual(['Aria']);
        expect(context.playerCharacter!.name).toBe('Original');
        expect(context.playerCharacter!.id).toBe('pc-original');
    });

    it('returns unchanged state when there is no isPC row', () => {
        const npcA = makeNpc('Aria');
        const npcB = makeNpc('Bram');
        const ctx = baseCtx();
        const ledger = [npcA, npcB];

        const { context, npcLedger, migrated } = migratePCIntoContext(ctx, ledger);

        expect(migrated).toBe(false);
        expect(npcLedger.map(n => n.name)).toEqual(['Aria', 'Bram']);
        expect(context.playerCharacter).toBeNull();
    });

    it('strips multiple isPC rows (buggy state) and keeps the first as the PC', () => {
        const pcA = makePc('HeroA', { id: 'pc-a' });
        const pcB = makePc('HeroB', { id: 'pc-b' });
        const npcA = makeNpc('Aria');
        const ctx = baseCtx();
        const ledger = [pcA, npcA, pcB];

        const { context, npcLedger, migrated } = migratePCIntoContext(ctx, ledger);

        expect(migrated).toBe(true);
        expect(npcLedger.map(n => n.name)).toEqual(['Aria']);
        expect(context.playerCharacter!.name).toBe('HeroA');
    });

    it('does not mutate the input arrays', () => {
        const pc = makePc('Hero');
        const npcA = makeNpc('Aria');
        const ctx = baseCtx();
        const ledgerSnapshot = [npcA, pc];
        const ledger = [...ledgerSnapshot];

        migratePCIntoContext(ctx, ledger);

        expect(ledger.map(n => n.name)).toEqual(['Aria', 'Hero']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// foldPcRecord — the four-records-into-one consolidation.
//
// These run against the shapes that actually exist on disk, not the shapes the
// types claim. `data/campaigns/*.state.json` contains PC records missing more than
// half of NPCEntry's required fields, and pre-WO-G saves store `characterProfile`
// as a bare string. Both are covered below.
// ─────────────────────────────────────────────────────────────────────────────

/** Build a context carrying the retired fields, whatever the current type says. */
function legacyCtx(patch: Record<string, unknown>): GameContext {
    return { ...baseCtx(), ...patch } as unknown as GameContext;
}

const sheetOf = (patch: Record<string, unknown> = {}) => ({
    name: '', race: '', class: '', level: 1,
    hp: { current: 20, max: 20 },
    stats: {}, skills: [], abilities: [], traits: [], notes: '',
    ...patch,
});

function trait(id: string, text: string) {
    return {
        id, subject: 'Sabrita', category: 'party_facts', text,
        importance: 7, eventTags: [], sceneEstablished: '004',
        superseded: false, source: 'llm' as const,
    };
}

describe('foldPcRecord', () => {
    it('folds the real Sabrita save shape and drops the fake numbers', () => {
        // Verbatim from data/campaigns/mtup8f7049pih.state.json. Note the PC record
        // omits aliases/appearance/faction/goals/voice/affinity — all of which NPCEntry
        // declares required. This is what "PlayerCharacter = NPCEntry" looks like in
        // practice, and it must not throw.
        const ctx = legacyCtx({
            characterProfile: { identity: { name: 'Sabrita' }, activeTraits: [] },
            characterProfileData: sheetOf({ name: 'Sabrita' }),
            playerCharacter: {
                isPC: true, name: 'Sabrita', status: 'Alive', tier: 'recurring',
                visualProfile: { race: '', artStyle: 'Stylized Game Realism' },
                id: 'mtuqjcp30mwml', populated: true,
            },
        });

        const { context, folded } = foldPcRecord(ctx);
        const pc = context.playerCharacter!;

        expect(folded).toBe(true);
        expect(pc.name).toBe('Sabrita');
        // The Lv1 / HP 20-20 that reached the model were creation defaults, not state.
        expect(JSON.stringify(pc)).not.toMatch(/\blevel\b|\bhp\b|\bmp\b/i);
        // Empty race/class rendered as "? ?" in the old payload. They stay absent.
        expect(pc.visualProfile?.race ?? '').toBe('');
        expect(pc.pcMeta?.archetype).toBeUndefined();
    });

    it('moves narrative traits onto the PC record', () => {
        const ctx = legacyCtx({
            characterProfile: {
                identity: { name: 'Sabrita' },
                activeTraits: [trait('t1', 'Fled the coven at seventeen.')],
            },
            characterProfileData: sheetOf({ name: 'Sabrita' }),
            playerCharacter: null,
        });

        const pc = foldPcRecord(ctx).context.playerCharacter!;
        expect(pc.activeTraits?.map(t => t.text)).toEqual(['Fled the coven at seventeen.']);
    });

    it('synthesizes a PC when the sheet has a name but playerCharacter is null', () => {
        const ctx = legacyCtx({
            characterProfile: { identity: {}, activeTraits: [] },
            characterProfileData: sheetOf({ name: 'Kael' }),
            playerCharacter: null,
        });

        const { context, folded } = foldPcRecord(ctx);
        expect(folded).toBe(true);
        expect(context.playerCharacter?.name).toBe('Kael');
        expect(context.playerCharacter?.isPC).toBe(true);
        expect(context.playerCharacter?.id).toBeTruthy();
    });

    it('reads a pre-WO-G flat-string characterProfile into legacyNotes', () => {
        const ctx = legacyCtx({
            characterProfile: 'Name: Kael\nRace: Human\nA quiet ranger.',
            characterProfileData: sheetOf({ name: 'Kael' }),
            playerCharacter: null,
        });

        const pc = foldPcRecord(ctx).context.playerCharacter!;
        expect(pc.name).toBe('Kael');
        expect(pc.legacyNotes).toContain('A quiet ranger.');
    });

    it('lets the PC record outrank both mirrors on a name conflict', () => {
        // characterProfileData and characterProfile.identity were written FROM the PC
        // record by mirrorName / commitCharacterDraft. A mirror never wins.
        const ctx = legacyCtx({
            characterProfile: { identity: { name: 'Stale Identity' }, activeTraits: [] },
            characterProfileData: sheetOf({ name: 'Stale Sheet' }),
            playerCharacter: { ...makePc('Authored'), id: 'pc1' },
        });

        expect(foldPcRecord(ctx).context.playerCharacter?.name).toBe('Authored');
    });

    it('folds sheet.traits into pc.traits, never into activeTraits', () => {
        // A CharacterTrait needs a category, eventTags, importance and an establishing
        // scene, and queryTraits scores on exactly those. Inventing them for a bare
        // string would poison retrieval permanently, so these stay descriptors.
        const ctx = legacyCtx({
            characterProfile: { identity: {}, activeTraits: [] },
            characterProfileData: sheetOf({ name: 'Kael', traits: ['stoic', 'wary'] }),
            playerCharacter: null,
        });

        const pc = foldPcRecord(ctx).context.playerCharacter!;
        expect(pc.traits).toEqual(['stoic', 'wary']);
        expect(pc.activeTraits ?? []).toEqual([]);
    });

    it('preserves skills and notes as text, not as a stat line', () => {
        const ctx = legacyCtx({
            characterProfile: { identity: {}, activeTraits: [] },
            characterProfileData: sheetOf({ name: 'Kael', skills: ['Stealth', 'Arcana'], notes: 'Old profile blob.' }),
            playerCharacter: null,
        });

        const pc = foldPcRecord(ctx).context.playerCharacter!;
        expect(pc.legacyNotes).toContain('Old profile blob.');
        expect(pc.legacyNotes).toContain('Skills: Stealth, Arcana');
    });

    it('unions abilities into the signature kit without dropping existing ones', () => {
        const ctx = legacyCtx({
            characterProfile: { identity: {}, activeTraits: [] },
            characterProfileData: sheetOf({ name: 'Kael', abilities: ['herbcraft', 'fire magic'] }),
            playerCharacter: { ...makePc('Kael'), signatureKit: { equipment: ['Belt Knife'], abilities: ['fire magic'] } },
        });

        const kit = foldPcRecord(ctx).context.playerCharacter!.signatureKit!;
        expect(kit.equipment).toEqual(['Belt Knife']);
        expect(kit.abilities).toEqual(['fire magic', 'herbcraft']);
    });

    it('is idempotent — folding twice equals folding once', () => {
        const ctx = legacyCtx({
            characterProfile: {
                identity: { name: 'Sabrita', race: 'human' },
                activeTraits: [trait('t1', 'Owes the ferryman a debt.')],
            },
            characterProfileData: sheetOf({ name: 'Sabrita', traits: ['wary'], abilities: ['herbcraft'] }),
            playerCharacter: null,
        });

        const once = foldPcRecord(ctx).context;
        const twice = foldPcRecord(once).context;

        // The synthesized id is random, so compare everything else.
        expect({ ...twice.playerCharacter, id: 'x' }).toEqual({ ...once.playerCharacter, id: 'x' });
    });

    it('is a no-op once the legacy fields are gone', () => {
        const ctx = stripLegacyPcFields(legacyCtx({
            characterProfileData: sheetOf({ name: 'Kael' }),
            playerCharacter: makePc('Kael'),
        }));

        const result = foldPcRecord(ctx);
        expect(result.folded).toBe(false);
        expect(result.context).toBe(ctx);
    });

    it('leaves the context untouched when there is no PC and nothing to build one from', () => {
        const ctx = legacyCtx({
            characterProfile: { identity: {}, activeTraits: [] },
            characterProfileData: sheetOf(),
            playerCharacter: null,
        });

        const result = foldPcRecord(ctx);
        expect(result.folded).toBe(false);
        expect(result.context.playerCharacter ?? null).toBeNull();
    });
});

describe('stripLegacyPcFields', () => {
    const RETIRED = [
        'characterProfileData', 'characterProfile', 'characterProfileActive',
        'characterProfileLastScene', 'smartBookkeepingActive', 'inventoryActive',
        'inventory', 'inventoryLastScene',
    ];

    it('removes every retired field and keeps the rest', () => {
        const ctx = legacyCtx({ playerCharacter: makePc('Kael') });
        const stripped = stripLegacyPcFields(ctx) as unknown as Record<string, unknown>;

        for (const key of RETIRED) expect(stripped).not.toHaveProperty(key);
        expect(stripped.playerCharacter).toBeTruthy();
        expect(stripped.inventoryItems).toBeDefined();
    });

    it('is idempotent and does not mutate its input', () => {
        const ctx = legacyCtx({ playerCharacter: makePc('Kael') });
        const once = stripLegacyPcFields(ctx);
        const twice = stripLegacyPcFields(once);

        expect(twice).toEqual(once);
        expect(ctx as unknown as Record<string, unknown>).toHaveProperty('characterProfileData');
    });
});