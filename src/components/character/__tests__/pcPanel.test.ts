import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../../store/useAppStore';
import { filterNPCs, filterPCOut } from '../../../utils/ledgerFilters';
import { buildPcKitLine } from '../../../services/payload/playerCharacter';
import { buildPayload } from '../../../services/payload/payloadBuilder';
import type { NPCEntry, GameContext, AppSettings, CharacterTrait } from '../../../types';

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

// ── Test 1: pcMeta typed write survives addNPC (regression for cast-after-add bug) ──
describe('WO-A §6.1: pcMeta typed write', () => {
    beforeEach(() => {
        useAppStore.setState({ npcLedger: [], activeCampaignId: 'test-campaign' } as Partial<ReturnType<typeof useAppStore.getState>>);
    });

    it('addNPC preserves pcMeta on the store copy when the entry has pcMeta set before addNPC', () => {
        const pcEntry = makePc('Hero', {
            pcMeta: { archetype: 'skirmisher', combatTier: 'Grunt', stats: { str: 14, dex: 12 } },
        });
        useAppStore.getState().addNPC(pcEntry);
        const stored = useAppStore.getState().npcLedger.find(n => n.isPC);
        expect(stored).toBeDefined();
        expect(stored!.pcMeta).toBeDefined();
        expect(stored!.pcMeta!.archetype).toBe('skirmisher');
        expect(stored!.pcMeta!.combatTier).toBe('Grunt');
        expect(stored!.pcMeta!.stats).toEqual({ str: 14, dex: 12 });
    });

    it('a PC entry without pcMeta does not synthesise one', () => {
        const pcEntry = makePc('Bare');
        useAppStore.getState().addNPC(pcEntry);
        const stored = useAppStore.getState().npcLedger.find(n => n.isPC);
        expect(stored).toBeDefined();
        expect(stored!.pcMeta).toBeUndefined();
    });
});

// ── Test 2: PC excluded from the NPC ledger ──
describe('WO-A §6.2: PC filtered out of the NPC ledger', () => {
    const npcA = makeNpc('Aria');
    const pc = makePc('PC');
    const npcB = makeNpc('Bram');

    it('filterPCOut drops the PC and keeps every other entry', () => {
        expect(filterPCOut([npcA, pc, npcB]).map(n => n.name)).toEqual(['Aria', 'Bram']);
        expect(filterPCOut([pc, npcA, npcB]).map(n => n.name)).toEqual(['Aria', 'Bram']);
        expect(filterPCOut([npcA, npcB, pc]).map(n => n.name)).toEqual(['Aria', 'Bram']);
    });

    it('does not mutate the input array', () => {
        const input = [npcA, pc, npcB];
        const snapshot = input.map(n => n.name);
        filterPCOut(input);
        expect(input.map(n => n.name)).toEqual(snapshot);
    });

    it('filterNPCs excludes the PC under all sort orders', () => {
        expect(filterNPCs([npcA, pc, npcB], '', 'none').map(n => n.name)).toEqual(['Aria', 'Bram']);
        expect(filterNPCs([npcB, pc, npcA], '', 'az').map(n => n.name)).toEqual(['Aria', 'Bram']);
        expect(filterNPCs([npcA, pc, npcB], '', 'za').map(n => n.name)).toEqual(['Bram', 'Aria']);
    });

    it('no PC in the list leaves order unchanged', () => {
        expect(filterPCOut([npcA, npcB]).map(n => n.name)).toEqual(['Aria', 'Bram']);
    });
});

// ── Test 3: bonds selector — non-archived, non-zero pcRelation, |value| desc ──

// ── Test 4: volatile.ts PC kit line — present with kit, byte-identical without ──
describe('WO-A §6.4: buildPcKitLine + volatile payload', () => {
    const baseCtx = (): GameContext => ({
        loreRaw: '',
        rulesRaw: '',
        canonState: '',
        headerIndex: '',
        starter: '',
        continuePrompt: '',
        inventory: '',
        inventoryLastScene: 'Never',
        characterProfile: '',
        characterProfileLastScene: 'Never',
        surpriseDC: 95,
        encounterDC: 198,
        worldEventDC: 498,
        canonStateActive: false,
        headerIndexActive: false,
        starterActive: false,
        continuePromptActive: false,
        inventoryActive: false,
        characterProfileActive: false,
        surpriseEngineActive: true,
        encounterEngineActive: true,
        worldEngineActive: true,
        diceFairnessActive: true,
        sceneNote: '',
        sceneNoteActive: false,
        sceneNoteDepth: 3,
        diceConfig: { catastrophe: 2, failure: 6, success: 15, triumph: 19, crit: 20 },
        surpriseConfig: { initialDC: 95, dcReduction: 3, types: [], tones: [] },
        encounterConfig: { initialDC: 198, dcReduction: 2, types: [], tones: [] },
        worldVibe: '',
        notebook: [],
        notebookActive: true,
        worldEventConfig: { initialDC: 498, dcReduction: 2, who: [], where: [], why: [], what: [] },
        playerCharacter: null,
    } as GameContext);

    const baseSettings = (): AppSettings => ({ debugMode: true, contextLimit: 8192 } as unknown as AppSettings);

    const profileTraits: CharacterTrait[] = [{
        id: 't1', subject: 'Hero', category: 'party_facts', text: 'A seasoned fighter',
        importance: 7, eventTags: ['other'], sceneEstablished: '', superseded: false, source: 'seed',
    }];

    it('buildPcKitLine emits "Kit:" line when PC has a kit with equipment', () => {
        const pc = makePc('Hero', { signatureKit: { equipment: ['Excalibur', 'shield'], abilities: ['fire magic'] } });
        const line = buildPcKitLine(pc);
        expect(line).toContain('Kit:');
        expect(line).toContain('Excalibur, shield');
        expect(line).toContain('Powers: fire magic');
    });

    it('buildPcKitLine omits empty segments', () => {
        const pc = makePc('Hero', { signatureKit: { equipment: ['sword'], abilities: [] } });
        const line = buildPcKitLine(pc);
        expect(line).toContain('Kit: sword');
        expect(line).not.toContain('Powers:');
    });

    it('buildPcKitLine returns empty string when PC has no kit', () => {
        expect(buildPcKitLine(makePc('Hero'))).toBe('');
    });

    it('buildPcKitLine returns empty string when there is no PC', () => {
        expect(buildPcKitLine(null)).toBe('');
        expect(buildPcKitLine(undefined)).toBe('');
    });

    it('the PC block carries the signature kit (integration via buildPayload)', () => {
        const ctx = {
            ...baseCtx(),
            playerCharacter: makePc('Hero', {
                signatureKit: { equipment: ['Excalibur'], abilities: ['fire magic'] },
                activeTraits: profileTraits,
            }),
        } as unknown as GameContext;
        const result = buildPayload({
            settings: baseSettings(),
            context: ctx,
            history: [],
            userMessage: 'What do I have?',
            npcLedger: [],
        });
        const allContent = result.messages.map(m => m.content as string).join('\n');
        expect(allContent).toContain('[PLAYER CHARACTER');
        expect(allContent).toContain('Kit: Excalibur');
        expect(allContent).toContain('Powers: fire magic');
        // `element` was a single affinity tag that said nothing the abilities did not.
        expect(allContent).not.toContain('element:');
    });

    it('omits the kit line entirely when the PC has none', () => {
        const ctx = {
            ...baseCtx(),
            playerCharacter: makePc('Hero', { activeTraits: profileTraits }),
        } as unknown as GameContext;
        const content = buildPayload({
            settings: baseSettings(),
            context: ctx,
            history: [],
            userMessage: 'What do I have?',
            npcLedger: [],
        }).messages.map(m => m.content as string).join('\n');

        expect(content).toContain('[PLAYER CHARACTER');
        expect(content).not.toContain('Kit:');
        expect(content).not.toContain('Powers:');
    });
});