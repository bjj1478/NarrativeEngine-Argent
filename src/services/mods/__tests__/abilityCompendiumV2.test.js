import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadMods } from '../../../../server/lib/modLoader.js';
import runAbilityCompendium from '../../../../mods/ability-compendium/compute.js';
import { buildMatchedAbilityPrompt, matchPromptRows } from '../../../../mods/ability-compendium/index.js';

/**
 * Creates a compute ModContext whose table writes remain observable by tests.
 * It mirrors the v2 public data/write names, so these tests fail if the module
 * accidentally regresses to the removed core-bound context adapter.
 */
function createComputeHarness(overrides = {}) {
    const rows = new Map([
        ['abilities', []], ['assignments', []], ['runtime', []],
        ['proposals', []], ['config', null], ['prompt-index', []],
        ...Object.entries(overrides.tables || {}),
    ]);
    const updatePlayerCharacter = vi.fn();
    const ctx = {
        data: { messages: [], npcLedger: [], playerCharacter: null, inventory: [], ...(overrides.data || {}) },
        table: {
            read: vi.fn(async (name) => structuredClone(rows.get(name))),
            write: vi.fn(async (name, value) => rows.set(name, structuredClone(value))),
        },
        write: { updatePlayerCharacter },
        model: { available: vi.fn(() => false), callJson: vi.fn() },
    };
    return { ctx, rows, updatePlayerCharacter };
}

describe('Ability & Power Compendium v2 module', () => {
    it('loads from its folder manifest with native, compute, tables, and no core patch', () => {
        const { mods, faults } = loadMods(path.resolve('mods'), '2.0.0');
        const mod = mods.find((entry) => entry.id === 'ability-compendium');
        expect(faults.filter((fault) => fault.file?.includes('ability-compendium'))).toEqual([]);
        expect(mod).toBeTruthy();
        expect(mod.native?.js).toBe('index.js');
        expect(mod.compute?.file).toBe('compute.js');
        expect(mod.tables).toHaveLength(6);
        expect(mod.contributions?.[0]?.text).toBe('{{matchedAbilities}}');
    });

    it('injects only whole-name or alias matches and respects the prompt budget', () => {
        const rows = [
            { terms: ['Fireball', 'Orb of Flame'], text: 'FIREBALL DETAILS' },
            { terms: ['Fly'], text: 'FLY DETAILS' },
        ];
        expect(matchPromptRows(rows, 'I cast Orb of Flame.')).toEqual([rows[0]]);
        expect(matchPromptRows(rows, 'The butterfly passes.')).toEqual([]);
        expect(buildMatchedAbilityPrompt(rows, 'Fireball then Fly', { count: (value) => value.length }, 20)).toBe('FIREBALL DETAILS');
    });

    it('queues sheet abilities for approval and removes only approved source lines', async () => {
        const first = createComputeHarness({
            data: { playerCharacter: { id: 'pc1', name: 'Mira', signatureKit: { equipment: [], abilities: ['Cantrip: Mage Hand'] } } },
        });
        await runAbilityCompendium(first.ctx);
        expect(first.rows.get('proposals')).toEqual([
            expect.objectContaining({ kind: 'new', abilityName: 'Mage Hand', ownerId: 'pc1' }),
        ]);

        const second = createComputeHarness({
            tables: { config: { consumedProfileAbilities: ['Cantrip: Mage Hand'] } },
            data: { playerCharacter: { id: 'pc1', name: 'Mira', signatureKit: { equipment: [], abilities: ['Cantrip: Mage Hand', 'Darkvision'] } } },
        });
        await runAbilityCompendium(second.ctx);
        // The PC's abilities now live on the signature kit, so the consume path patches
        // that channel instead of replacing a whole character sheet.
        expect(second.updatePlayerCharacter).toHaveBeenCalledWith({
            signatureKit: { equipment: [], abilities: ['Darkvision'] },
        });
        expect(second.rows.get('config').consumedProfileAbilities).toEqual([]);
    });
});
