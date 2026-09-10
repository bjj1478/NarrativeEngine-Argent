import { useState, useMemo } from 'react';
import { Trash2, Plus, AlertCircle, ScrollText } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { uid } from '../../../utils/uid';
import type { CharacterTrait, DivergenceCategory } from '../../../types';
import { TraitRow } from '../profileFields';
import { getEntriesForNpc, CATEGORY_LABELS, EMPTY_REGISTER } from '../../../services/campaign-state/divergenceRegister';

const CATEGORY_COLORS: Record<DivergenceCategory, string> = {
    locations: 'text-blue-400',
    npc_events: 'text-terminal',
    promises_debts: 'text-amber-400',
    world_state: 'text-cyan-400',
    party_facts: 'text-emerald-400',
    rules_lore: 'text-purple-400',
    misc: 'text-text-muted',
};

/**
 * Character Ledger — Record tab.
 *
 * Owner: engine writes, user curates. The PC narrative record — active traits, superseded
 * history, the frozen legacy blob, and the established-events list for this PC.
 *
 * Three things used to live here and no longer do:
 *  - Identity fields, which edited a parallel `characterProfile.identity` holding the same
 *    name/race/class the Sheet tab edits. One record now, and Sheet owns it.
 *  - An injection ON/OFF toggle for a profile block that no longer exists.
 *  - A read-only Bonds grid and a second `RelationshipMemoryEditor` — both duplicated the
 *    editable versions on the Sheet tab, over the very same store data.
 */
export function RecordTab() {
    const playerCharacter = useAppStore(s => s.playerCharacter);
    const updatePlayerCharacter = useAppStore(s => s.updatePlayerCharacter);
    const divergenceRegister = useAppStore(s => s.divergenceRegister);
    const chapters = useAppStore(s => s.chapters);

    const traits = useMemo(() => playerCharacter?.activeTraits ?? [], [playerCharacter]);
    const activeTraits = traits.filter(t => !t.superseded);
    const supersededTraits = traits.filter(t => t.superseded);
    const [showSuperseded, setShowSuperseded] = useState(false);

    // Single-key patch, matching the rule the background trait scan follows: never write the
    // whole PC record from a component holding a stale copy of it.
    const writeTraits = (next: CharacterTrait[]) => updatePlayerCharacter({ activeTraits: next });

    const updateTrait = (id: string, patch: Partial<CharacterTrait>) => {
        writeTraits(traits.map(t => t.id === id ? { ...t, ...patch } : t));
    };

    const addTrait = () => {
        const newTrait: CharacterTrait = {
            id: uid(),
            subject: playerCharacter?.name || 'PC',
            category: 'party_facts',
            text: '',
            importance: 5,
            eventTags: [],
            sceneEstablished: 'manual',
            superseded: false,
            source: 'manual',
        };
        writeTraits([...traits, newTrait]);
    };

    const removeTrait = (id: string) => {
        writeTraits(traits.filter(t => t.id !== id));
    };

    const supersedeTrait = (id: string) => {
        updateTrait(id, { superseded: true });
    };

    const pcEntries = useMemo(() => {
        if (!playerCharacter?.id) return [];
        const reg = divergenceRegister ?? EMPTY_REGISTER;
        return getEntriesForNpc(reg, playerCharacter.id);
    }, [divergenceRegister, playerCharacter]);

    const chapterTitleMap = useMemo(() => new Map((chapters ?? []).map(c => [c.chapterId, c.title])), [chapters]);

    return (
        <div className="px-4 py-4 space-y-3">
            <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-ember">
                    <span>Narrative Record</span>
                </label>
            </div>

            <div className="space-y-3 border border-border px-3 py-3 bg-void min-h-[100px]">
                {/* Active traits */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <p className="text-[9px] uppercase tracking-widest text-text-dim/70">
                            Active Traits ({activeTraits.length}/10)
                        </p>
                        <button
                            onClick={addTrait}
                            disabled={!playerCharacter || activeTraits.length >= 10}
                            className="flex items-center gap-1 text-[10px] text-terminal/70 hover:text-terminal disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <Plus size={12} /> Add
                        </button>
                    </div>

                    {!playerCharacter && (
                        <p className="text-[10px] text-text-dim/40 italic px-1">
                            No player character yet. Create one on the Sheet tab.
                        </p>
                    )}

                    {playerCharacter && activeTraits.length === 0 && (
                        <p className="text-[10px] text-text-dim/40 italic px-1">
                            No active traits. The trait scan will add them as the story progresses, or add one manually.
                        </p>
                    )}

                    {activeTraits.map(trait => (
                        <TraitRow
                            key={trait.id}
                            trait={trait}
                            onChange={(patch) => updateTrait(trait.id, patch)}
                            onSupersede={() => supersedeTrait(trait.id)}
                            onRemove={() => removeTrait(trait.id)}
                        />
                    ))}
                </div>

                {/* Superseded traits (collapsed) */}
                {supersededTraits.length > 0 && (
                    <div>
                        <button
                            onClick={() => setShowSuperseded(!showSuperseded)}
                            className="text-[9px] text-text-dim/50 hover:text-text-dim"
                        >
                            {showSuperseded ? '▾' : '▸'} {supersededTraits.length} superseded (historical)
                        </button>
                        {showSuperseded && (
                            <div className="space-y-1 mt-1">
                                {supersededTraits.map(trait => (
                                    <div key={trait.id} className="flex items-center gap-2 px-2 py-1 opacity-40">
                                        <AlertCircle size={10} className="text-text-dim shrink-0" />
                                        <span className="text-[10px] text-text-dim line-through flex-1 truncate">{trait.text}</span>
                                        <button
                                            onClick={() => removeTrait(trait.id)}
                                            className="text-text-dim/40 hover:text-red-400"
                                        >
                                            <Trash2 size={10} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Legacy notes (frozen, read-only — never injected into the prompt) */}
                {playerCharacter?.legacyNotes && (
                    <div>
                        <p className="text-[9px] text-text-dim/50">
                            Legacy profile preserved from upgrade (not injected): {playerCharacter.legacyNotes.length.toLocaleString()} chars
                        </p>
                    </div>
                )}
            </div>

             {playerCharacter?.id && pcEntries.length > 0 && (
                <div className="border-t border-border/30 pt-3">
                    <div className="flex items-center gap-2 text-text-primary font-bold uppercase tracking-widest text-xs mb-2">
                        <ScrollText size={14} /> Events ({pcEntries.length})
                    </div>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                        {pcEntries.map(e => (
                            <div key={e.id} className="flex items-start gap-1.5 text-[11px]">
                                <span className={`shrink-0 mt-0.5 text-[9px] uppercase font-bold ${CATEGORY_COLORS[e.category] ?? 'text-text-dim'}`}>
                                    {CATEGORY_LABELS[e.category] ?? e.category}
                                </span>
                                <span className="text-text-secondary min-w-0 flex-1">{e.text}</span>
                                <span className="text-text-dim/40 text-[9px] shrink-0">[#{e.sceneRef}]{e.source === 'manual' ? ' ⚡' : ''}</span>
                                <span className="text-text-dim/30 text-[9px] shrink-0">{chapterTitleMap.get(e.chapterId) ?? e.chapterId}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
