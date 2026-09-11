import { useState } from 'react';
import { Loader2, Sparkles, Plus } from 'lucide-react';
import { useAppStore, DEFAULT_SURPRISE_TYPES, DEFAULT_SURPRISE_TONES, DEFAULT_ENCOUNTER_TYPES, DEFAULT_ENCOUNTER_TONES, DEFAULT_WORLD_WHO, DEFAULT_WORLD_WHERE, DEFAULT_WORLD_WHY, DEFAULT_WORLD_WHAT } from '../../store/useAppStore';
import { populateEngineTags } from '../../services/chatEngine';
import { Toggle } from './Toggle';
import { NPCPressureInspector } from '../NPCPressureInspector';
import type { RollFrequency, ResponseLength, LoreCategory } from '../../types';

type PopulateField =
    | 'surpriseTypes' | 'surpriseTones' | 'encounterTypes' | 'encounterTones'
    | 'worldWho' | 'worldWhere' | 'worldWhy' | 'worldWhat'
    | 'consequences';

/** Which lore categories carry the answer for each populated field. */
const POPULATE_CATEGORIES: Record<PopulateField, LoreCategory[]> = {
    surpriseTypes: ['world_overview', 'culture', 'location', 'economy'],
    surpriseTones: ['world_overview', 'culture'],
    encounterTypes: ['world_overview', 'location', 'faction', 'power_system'],
    encounterTones: ['world_overview', 'faction'],
    worldWho: ['faction', 'character'],
    worldWhere: ['location', 'world_overview'],
    worldWhy: ['faction', 'event', 'world_overview'],
    worldWhat: ['event', 'faction'],
    // A consequence has to be world-shaped, so give the model the mechanical tables
    // and the world's own tone rather than its cast list.
    consequences: ['rules', 'world_overview', 'power_system', 'culture'],
};

/**
 * The ask-frequency dial. Each option is described by its THRESHOLD — what deserves asking —
 * and deliberately not by an expected count. Printing "~1-2 per scene" here would invite
 * the model to treat the setting as a quota to fill, which is the failure mode the whole
 * stakes-aware pacing change is fighting. The cadence is a consequence, not a target.
 */
const ROLL_FREQUENCY_OPTIONS: { value: RollFrequency; label: string; detail: string }[] = [
    {
        value: 'contested',
        label: 'Any contested action',
        detail: 'Anything meeting real resistance — a lock, a fight, a risky climb, persuasion against a genuine want.',
    },
    {
        value: 'consequential',
        label: 'Only when it costs something',
        detail: 'Only when failure leaves a mark: a wound, a burnt relationship, a door closed for good. Mere inconvenience resolves in the fiction.',
    },
    {
        value: 'critical',
        label: 'Only decisive moments',
        detail: 'Only a conflict that could genuinely go either way, or an attempt that by rights should not be possible.',
    },
];

/**
 * The reply-length dial. Described by what the player gets, not by the word counts the
 * prompt actually carries: a number here reads as a promise the model cannot keep exactly,
 * and the same "don't state a quota" caution as ROLL_FREQUENCY_OPTIONS applies.
 */
const RESPONSE_LENGTH_OPTIONS: { value: ResponseLength; label: string; detail: string }[] = [
    {
        value: 'flexible',
        label: 'Follow the scene',
        detail: 'Quiet scenes get room to breathe; pressured ones stay tight and hand back fast. Only a time skip runs long.',
    },
    {
        value: 'short',
        label: 'Short',
        detail: 'One development, then the turn is yours again. Best for fast back-and-forth.',
    },
    {
        value: 'medium',
        label: 'Medium',
        detail: 'A couple of beats — an exchange and its consequence — before it hands back.',
    },
    {
        value: 'long',
        label: 'Long',
        detail: 'Room to cover real ground: elapsed time, travel, errands, several people acting.',
    },
];

export function EnginesTab() {
    const context = useAppStore((s) => s.context);
    const updateContext = useAppStore((s) => s.updateContext);
    const openDivergenceEntry = useAppStore((s) => s.openDivergenceEntry);
    const [populatingField, setPopulatingField] = useState<string | null>(null);

    const renderPopulateButton = (fieldKey: string, onPopulate: () => Promise<void>) => (
        <button
            onClick={async () => {
                setPopulatingField(fieldKey);
                await onPopulate();
                setPopulatingField(null);
            }}
            disabled={populatingField !== null}
            className="flex items-center gap-1 text-[11px] text-terminal hover:text-text-primary transition-colors disabled:opacity-30"
            title="AI-populate tags based on campaign lore"
        >
            {populatingField === fieldKey ? <Loader2 size={9} className="animate-spin" /> : <Sparkles size={9} />}
            Populate
        </button>
    );

    /**
     * Source text for the AI tag populator.
     *
     * This used to read `context.loreRaw`, which is initialised to '' and never written by
     * any code path — the lore file is chunked on import, not stored raw — so every Populate
     * call silently fell through to `rulesRaw` and asked the model to invent world tags from
     * the GM ruleset. Build the text from the campaign's own lore chunks instead, narrowed to
     * the categories that actually carry the answer for the field being generated.
     */
    const loreTextFor = (field: PopulateField): string => {
        const chunks = useAppStore.getState().loreChunks;
        if (chunks.length === 0) return context.loreRaw || context.rulesRaw || '';
        const wanted = POPULATE_CATEGORIES[field];
        const relevant = chunks.filter((c) => wanted.includes(c.category));
        return (relevant.length > 0 ? relevant : chunks)
            .map((c) => `### ${c.header}\n${c.content}`)
            .join('\n\n');
    };

    const surpriseDefaults = { types: DEFAULT_SURPRISE_TYPES, tones: DEFAULT_SURPRISE_TONES, initialDC: 95, dcReduction: 3 };
    const encounterDefaults = { types: DEFAULT_ENCOUNTER_TYPES, tones: DEFAULT_ENCOUNTER_TONES, initialDC: 198, dcReduction: 2 };
    const worldDefaults = { initialDC: 498, dcReduction: 2, who: [] as string[], where: [] as string[], why: [] as string[], what: [] as string[] };

    return (
        <div className="px-4 py-4 space-y-4">
            <p className="text-[11px] text-text-dim/50">
                Configure thresholds and tags for the local narrative engines.
            </p>

            {/* WO-ui-polish §A2 — the four near-identical engine blocks tile well
                as a 2-column card grid at xl: and up, filling the wide lightbox
                honestly instead of stretching or wasting it. Below xl: the grid
                collapses to a stacked column. */}
            <div className="space-y-4 xl:grid xl:grid-cols-2 xl:gap-4 xl:space-y-0">
                {/* Surprise Engine */}
                <div className="space-y-2">
                    <div className="text-[12px] text-terminal uppercase tracking-wider font-bold border-b border-terminal/20 pb-1 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-terminal" />
                            Surprise Engine
                        </div>
                        <Toggle active={context.surpriseEngineActive ?? false} onChange={() => updateContext({ surpriseEngineActive: !(context.surpriseEngineActive ?? false) })} />
                    </div>
                    <div className="bg-void border border-border p-3 space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                            <div className="flex flex-col">
                                <label className="text-[12px] text-text-dim uppercase tracking-wider mb-1">Initial DC (Default 95)</label>
                                <input
                                    type="number"
                                    value={context.surpriseConfig?.initialDC ?? 95}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        updateContext({ surpriseConfig: { ...(context.surpriseConfig || surpriseDefaults), initialDC: isNaN(val) ? 95 : val } });
                                    }}
                                    className="w-full bg-surface border border-border px-3 py-2 text-[13px] font-mono text-text-primary focus:border-terminal outline-none transition-colors"
                                />
                            </div>
                            <div className="flex flex-col">
                                <label className="text-[12px] text-text-dim uppercase tracking-wider mb-1">DC Drop per turn (Def 3)</label>
                                <input
                                    type="number"
                                    value={context.surpriseConfig?.dcReduction ?? 3}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        updateContext({ surpriseConfig: { ...(context.surpriseConfig || surpriseDefaults), dcReduction: isNaN(val) ? 3 : val } });
                                    }}
                                    className="w-full bg-surface border border-border px-3 py-2 text-[13px] font-mono text-text-primary focus:border-terminal outline-none transition-colors"
                                />
                            </div>
                        </div>

                        <div className="flex flex-col">
                            <label className="text-[12px] text-text-dim uppercase tracking-wider mb-1 flex justify-between items-center">
                                <span>Event Types (Comma Separated)</span>
                                <span className="flex items-center gap-2">
                                    {renderPopulateButton('surpriseTypes', async () => {
                                        const provider = useAppStore.getState().getActiveStoryEndpoint();
                                        if (!provider) return;
                                        const lore = loreTextFor('surpriseTypes');
                                        const current = context.surpriseConfig?.types || DEFAULT_SURPRISE_TYPES;
                                        const result = await populateEngineTags(provider, lore, current, 'surpriseTypes');
                                        updateContext({ surpriseConfig: { ...(context.surpriseConfig || surpriseDefaults), types: result } });
                                    })}
                                    <span className={(context.surpriseConfig?.types?.length ?? 0) < 3 ? 'text-danger' : 'text-terminal'}>Min 3 tags</span>
                                </span>
                            </label>
                            <textarea
                                value={context.surpriseConfig?.types.join(', ') ?? DEFAULT_SURPRISE_TYPES.join(', ')}
                                onChange={(e) => {
                                    const tags = e.target.value.split(',').map(t => t.trim()).filter(Boolean);
                                    updateContext({ surpriseConfig: { ...(context.surpriseConfig || surpriseDefaults), types: tags } });
                                }}
                                placeholder="ENVIRONMENTAL_HAZARD, NPC_ACTION..."
                                rows={3}
                                className="w-full bg-surface border border-border px-3 py-2 text-[13px] font-mono text-text-primary focus:border-terminal outline-none transition-colors resize-y min-h-[4.5rem]"
                            />
                        </div>
                        <div className="flex flex-col">
                            <label className="text-[12px] text-text-dim uppercase tracking-wider mb-1 flex justify-between items-center">
                                <span>Event Tones (Comma Separated)</span>
                                <span className="flex items-center gap-2">
                                    {renderPopulateButton('surpriseTones', async () => {
                                        const provider = useAppStore.getState().getActiveStoryEndpoint();
                                        if (!provider) return;
                                        const lore = loreTextFor('surpriseTones');
                                        const current = context.surpriseConfig?.tones || DEFAULT_SURPRISE_TONES;
                                        const result = await populateEngineTags(provider, lore, current, 'surpriseTones');
                                        updateContext({ surpriseConfig: { ...(context.surpriseConfig || surpriseDefaults), tones: result } });
                                    })}
                                    <span className={(context.surpriseConfig?.tones?.length ?? 0) < 3 ? 'text-danger' : 'text-terminal'}>Min 3 tags</span>
                                </span>
                            </label>
                            <textarea
                                value={context.surpriseConfig?.tones.join(', ') ?? DEFAULT_SURPRISE_TONES.join(', ')}
                                onChange={(e) => {
                                    const tags = e.target.value.split(',').map(t => t.trim()).filter(Boolean);
                                    updateContext({ surpriseConfig: { ...(context.surpriseConfig || surpriseDefaults), tones: tags } });
                                }}
                                placeholder="GOOD, BAD, NEUTRAL..."
                                rows={2}
                                className="w-full bg-surface border border-border px-3 py-2 text-[13px] font-mono text-text-primary focus:border-terminal outline-none transition-colors resize-y min-h-[4.5rem]"
                            />
                        </div>
                    </div>
                </div>

                {/* Encounter Engine */}
                <div className="space-y-2">
                    <div className="text-[12px] text-ember uppercase tracking-wider font-bold border-b border-ember/20 pb-1 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-ember" />
                            Encounter Engine
                        </div>
                        <Toggle active={context.encounterEngineActive ?? true} onChange={() => updateContext({ encounterEngineActive: !(context.encounterEngineActive ?? true) })} />
                    </div>
                    <div className="bg-void border border-border p-3 space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                            <div className="flex flex-col">
                                <label className="text-[12px] text-text-dim uppercase tracking-wider mb-1">Initial DC (Default 198)</label>
                                <input
                                    type="number"
                                    value={context.encounterConfig?.initialDC ?? 198}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        updateContext({ encounterConfig: { ...(context.encounterConfig || encounterDefaults), initialDC: isNaN(val) ? 198 : val } });
                                    }}
                                    className="w-full bg-surface border border-border px-3 py-2 text-[13px] font-mono text-text-primary focus:border-terminal outline-none transition-colors"
                                />
                            </div>
                            <div className="flex flex-col">
                                <label className="text-[12px] text-text-dim uppercase tracking-wider mb-1">DC Drop per turn (Def 2)</label>
                                <input
                                    type="number"
                                    value={context.encounterConfig?.dcReduction ?? 2}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        updateContext({ encounterConfig: { ...(context.encounterConfig || encounterDefaults), dcReduction: isNaN(val) ? 2 : val } });
                                    }}
                                    className="w-full bg-surface border border-border px-3 py-2 text-[13px] font-mono text-text-primary focus:border-terminal outline-none transition-colors"
                                />
                            </div>
                        </div>

                        <div className="flex flex-col">
                            <label className="text-[12px] text-text-dim uppercase tracking-wider mb-1 flex justify-between items-center">
                                <span>Event Types (Comma Separated)</span>
                                <span className="flex items-center gap-2">
                                    {renderPopulateButton('encounterTypes', async () => {
                                        const provider = useAppStore.getState().getActiveStoryEndpoint();
                                        if (!provider) return;
                                        const lore = loreTextFor('encounterTypes');
                                        const current = context.encounterConfig?.types || DEFAULT_ENCOUNTER_TYPES;
                                        const result = await populateEngineTags(provider, lore, current, 'encounterTypes');
                                        updateContext({ encounterConfig: { ...(context.encounterConfig || encounterDefaults), types: result } });
                                    })}
                                    <span className={(context.encounterConfig?.types?.length ?? 0) < 3 ? 'text-danger' : 'text-terminal'}>Min 3 tags</span>
                                </span>
                            </label>
                            <textarea
                                value={context.encounterConfig?.types.join(', ') ?? DEFAULT_ENCOUNTER_TYPES.join(', ')}
                                onChange={(e) => {
                                    const tags = e.target.value.split(',').map(t => t.trim()).filter(Boolean);
                                    updateContext({ encounterConfig: { ...(context.encounterConfig || encounterDefaults), types: tags } });
                                }}
                                placeholder="AMBUSH, RIVAL_APPEARANCE..."
                                rows={3}
                                className="w-full bg-surface border border-border px-3 py-2 text-[13px] font-mono text-text-primary focus:border-terminal outline-none transition-colors resize-y min-h-[4.5rem]"
                            />
                        </div>
                        <div className="flex flex-col">
                            <label className="text-[12px] text-text-dim uppercase tracking-wider mb-1 flex justify-between items-center">
                                <span>Event Tones (Comma Separated)</span>
                                <span className="flex items-center gap-2">
                                    {renderPopulateButton('encounterTones', async () => {
                                        const provider = useAppStore.getState().getActiveStoryEndpoint();
                                        if (!provider) return;
                                        const lore = loreTextFor('encounterTones');
                                        const current = context.encounterConfig?.tones || DEFAULT_ENCOUNTER_TONES;
                                        const result = await populateEngineTags(provider, lore, current, 'encounterTones');
                                        updateContext({ encounterConfig: { ...(context.encounterConfig || encounterDefaults), tones: result } });
                                    })}
                                    <span className={(context.encounterConfig?.tones?.length ?? 0) < 3 ? 'text-danger' : 'text-terminal'}>Min 3 tags</span>
                                </span>
                            </label>
                            <textarea
                                value={context.encounterConfig?.tones.join(', ') ?? DEFAULT_ENCOUNTER_TONES.join(', ')}
                                onChange={(e) => {
                                    const tags = e.target.value.split(',').map(t => t.trim()).filter(Boolean);
                                    updateContext({ encounterConfig: { ...(context.encounterConfig || encounterDefaults), tones: tags } });
                                }}
                                placeholder="TENSE, DESPERATE, EPICK..."
                                rows={2}
                                className="w-full bg-surface border border-border px-3 py-2 text-[13px] font-mono text-text-primary focus:border-terminal outline-none transition-colors resize-y min-h-[4.5rem]"
                            />
                        </div>
                    </div>
                </div>

                {/* World Engine */}
                <div className="space-y-2">
                    <div className="text-[12px] text-terminal uppercase tracking-wider font-bold border-b border-terminal/20 pb-1 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-terminal" />
                            World Engine
                        </div>
                        <Toggle active={context.worldEngineActive ?? true} onChange={() => updateContext({ worldEngineActive: !(context.worldEngineActive ?? true) })} />
                    </div>
                    <div className="bg-void border border-border p-3 space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                            <div className="flex flex-col">
                                <label className="text-[12px] text-text-dim uppercase tracking-wider mb-1">Initial DC (Default 498)</label>
                                <input
                                    type="number"
                                    value={context.worldEventConfig?.initialDC ?? 498}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        updateContext({ worldEventConfig: { ...(context.worldEventConfig || worldDefaults), initialDC: isNaN(val) ? 498 : val } });
                                    }}
                                    className="w-full bg-surface border border-border px-3 py-2 text-[13px] font-mono text-text-primary focus:border-terminal outline-none transition-colors"
                                />
                            </div>
                            <div className="flex flex-col">
                                <label className="text-[12px] text-text-dim uppercase tracking-wider mb-1">DC Drop per turn (Def 2)</label>
                                <input
                                    type="number"
                                    value={context.worldEventConfig?.dcReduction ?? 2}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        updateContext({ worldEventConfig: { ...(context.worldEventConfig || worldDefaults), dcReduction: isNaN(val) ? 2 : val } });
                                    }}
                                    className="w-full bg-surface border border-border px-3 py-2 text-[13px] font-mono text-text-primary focus:border-terminal outline-none transition-colors"
                                />
                            </div>
                        </div>
                        {(['who', 'where', 'why', 'what'] as const).map((field) => {
                            const defaults: Record<string, string[]> = { who: DEFAULT_WORLD_WHO, where: DEFAULT_WORLD_WHERE, why: DEFAULT_WORLD_WHY, what: DEFAULT_WORLD_WHAT };
                            const labels: Record<string, string> = { who: '"Who" Elements', where: '"Where" Elements', why: '"Why" Elements', what: '"What" Elements' };
                            const placeholders: Record<string, string> = {
                                who: 'a rogue splinter group, a powerful leader...',
                                where: 'in a neighboring city, deep underground...',
                                why: 'to seize power, for brutal vengeance...',
                                what: 'declared hostilities, discovered a relic...',
                            };
                            return (
                                <div key={field} className="flex flex-col mt-2">
                                    <label className="text-[12px] text-text-dim uppercase tracking-wider mb-1 flex justify-between items-center">
                                        <span>{labels[field]} (Comma Separated)</span>
                                        <span className="flex items-center gap-2">
                                            {renderPopulateButton(`world${field.charAt(0).toUpperCase() + field.slice(1)}`, async () => {
                                                const provider = useAppStore.getState().getActiveStoryEndpoint();
                                                if (!provider) return;
                                                const populateField = `world${field.charAt(0).toUpperCase() + field.slice(1)}` as PopulateField;
                                                const lore = loreTextFor(populateField);
                                                const current = context.worldEventConfig?.[field] || defaults[field];
                                                const result = await populateEngineTags(provider, lore, current, populateField);
                                                updateContext({ worldEventConfig: { ...(context.worldEventConfig || worldDefaults), [field]: result } });
                                            })}
                                            <span className={(context.worldEventConfig?.[field]?.length ?? 0) < 3 ? 'text-danger' : 'text-terminal'}>Min 3 tags</span>
                                        </span>
                                    </label>
                                    <textarea
                                        value={context.worldEventConfig?.[field]?.join(', ') ?? defaults[field].join(', ')}
                                        onChange={(e) => {
                                            const tags = e.target.value.split(',').map(t => t.trim()).filter(Boolean);
                                            updateContext({ worldEventConfig: { ...(context.worldEventConfig || worldDefaults), [field]: tags } });
                                        }}
                                        placeholder={placeholders[field]}
                                        rows={2}
                                        className="w-full bg-surface border border-border px-3 py-2 text-[13px] font-mono text-text-primary focus:border-terminal outline-none transition-colors resize-y min-h-[4.5rem]"
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Ask To Resolve + Response Length are the two turn-shape dials — one decides
                    when the GM stops to ask you something, the other how long it writes before
                    handing back — so they read as a pair. Their own full-width row with a nested
                    2-column grid, because the three engine blocks above are an odd number: left
                    to the outer grid's auto-flow these two would land in different rows. Mirrors
                    the outer container's classes so it collapses to a stacked column below xl. */}
                <div className="space-y-4 xl:col-span-2 xl:grid xl:grid-cols-2 xl:gap-4 xl:space-y-0">
                    {/* Dice Fairness Engine (generalized) */}
                    <DiceFairnessSection context={context} updateContext={updateContext} />

                    {/* Response Length — caps the [BEAT BUDGET] line sent every turn. */}
                    <ResponseLengthSection context={context} updateContext={updateContext} />
                </div>

                {/* Consequences — seeded from lore, edited here, not yet drawn from. */}
                <div className="space-y-2 xl:col-span-2">
                    <div className="text-[12px] text-text-dim uppercase tracking-wider font-bold border-b border-border pb-1 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-text-dim" />
                        Consequences
                    </div>
                    <div className="bg-void border border-border p-3 space-y-3">
                        <p className="text-[11px] text-text-dim/60 leading-relaxed">
                            World-specific costs of a miss, seeded from your lore file's consequence
                            tables. One per line — these are whole phrases, not tags, so they are
                            never split on commas. Populate adds to the list rather than replacing it.
                            The resolve prompt draws one of these at random into its Consequence
                            field, where you can reroll it or type your own; it is used when you pick
                            an outcome <span className="text-text-dim">with consequence</span>.
                        </p>
                        <div className="flex flex-col">
                            <label className="text-[12px] text-text-dim uppercase tracking-wider mb-1 flex justify-between items-center">
                                <span>Costs of a Miss (One Per Line)</span>
                                <span className="flex items-center gap-2">
                                    {renderPopulateButton('consequences', async () => {
                                        const provider = useAppStore.getState().getActiveStoryEndpoint();
                                        if (!provider) return;
                                        const current = context.consequences ?? [];
                                        const result = await populateEngineTags(
                                            provider, loreTextFor('consequences'), current, 'consequences');
                                        // Append, unlike the tag fields, which replace. This list is
                                        // seeded from hand-written consequence tables, and the populator
                                        // is asked for entries it has not already got — so replacing
                                        // would throw away authored work to make room for a guess.
                                        updateContext({ consequences: [...new Set([...current, ...result])] });
                                    })}
                                    <span className="text-text-dim/60">
                                        {(context.consequences?.length ?? 0)} entries
                                    </span>
                                </span>
                            </label>
                            <textarea
                                value={(context.consequences ?? []).join('\n')}
                                onChange={(e) => {
                                    // Split on newlines only. A consequence is a sentence and
                                    // carries its own commas; comma-splitting would shred it.
                                    const phrases = e.target.value.split('\n').map(p => p.trim()).filter(Boolean);
                                    updateContext({ consequences: phrases });
                                }}
                                placeholder={'Noise — Not discovery, attention. A patrol changes its route.\nTrace — You are through, but you left something.'}
                                rows={8}
                                className="w-full bg-surface border border-border px-3 py-2 text-[13px] font-mono text-text-primary focus:border-terminal outline-none transition-colors resize-y min-h-[10rem]"
                            />
                        </div>
                    </div>
                </div>

            </div>

            <NPCPressureInspector />

            <BookkeepingBudgetSection />

            <button
                onClick={() => openDivergenceEntry()}
                className="w-full flex items-center justify-center gap-1.5 text-[12px] uppercase tracking-widest text-amber-400 border border-amber-500/30 rounded py-2 hover:bg-amber-500/10 transition-colors"
            >
                <Plus size={12} /> Add Campaign Fact
            </button>
        </div>
    );
}

// ─── Ask To Resolve Section ────────────────────────────────────────────
//
// The one resolution mode. ON: the GM states what is attempted and how hard it judges it,
// generation suspends, and the player picks one of four outcomes. OFF: nothing is ever asked
// — no tool is offered, and because every "ask the player" imperative lives in that tool's
// own description, withholding the tool is also what stops the model being told to ask.
//
// The stored field is still `diceFairnessActive`, which used to select the opposite thing (an
// engine-pre-rolled `[DICE OUTCOMES]` pool). The key is kept so no save needs rewriting; the
// one-time value flip lives in migrateLegacyContext.
//
// The die-type/outcome-band registry and the category→die map that used to live here are gone
// with pool mode: bands existed to turn a rolled number into a label like "Triumph", which is
// precisely the machinery this path refuses to compute. "Dice me" still needs a die to roll,
// so the built-in registry from buildDefaultDiceSystem() remains — it is just no longer
// editable, because nothing reads the parts you could edit.

type DiceFairnessSectionProps = {
    context: ReturnType<typeof useAppStore.getState>['context'];
    updateContext: ReturnType<typeof useAppStore.getState>['updateContext'];
};

/**
 * Response Length. Unlike its neighbours there is no on/off toggle: "no length guidance at
 * all" is not a useful state, and it is what every thinking-off campaign used to get by
 * accident. Switch the block off in the Block View if you really want it gone.
 */
function ResponseLengthSection({ context, updateContext }: DiceFairnessSectionProps) {
    const active = context.responseLength ?? 'flexible';

    return (
        <div className="border border-border bg-surface p-3 space-y-3">
            <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-terminal" />
                <span className="text-[13px] text-text-primary font-bold uppercase tracking-wider">
                    Response Length
                </span>
            </div>

            <div className="text-[11px] text-text-dim/70 leading-relaxed">
                How much the GM writes before handing the turn back. This is a cap, not a target —
                a scene that is genuinely finished ends early rather than padding to fill it.
            </div>

            <div className="space-y-1 pt-1">
                {RESPONSE_LENGTH_OPTIONS.map(opt => {
                    const selected = active === opt.value;
                    return (
                        <button
                            key={opt.value}
                            onClick={() => updateContext({ responseLength: opt.value })}
                            className={`w-full text-left px-2 py-1.5 rounded border transition-colors ${
                                selected
                                    ? 'border-terminal/50 bg-terminal/10'
                                    : 'border-border/50 hover:border-border'
                            }`}
                        >
                            <div className={`text-[11px] font-bold ${selected ? 'text-terminal' : 'text-text-primary'}`}>
                                {opt.label}
                            </div>
                            <div className="text-[10px] text-text-dim/70 leading-snug">
                                {opt.detail}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function DiceFairnessSection({ context, updateContext }: DiceFairnessSectionProps) {
    const askToRoll = context.diceFairnessActive !== false;

    return (
        <div className="border border-border bg-surface p-3 space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${askToRoll ? 'bg-terminal' : 'bg-border'}`} />
                    <span className="text-[13px] text-text-primary font-bold uppercase tracking-wider">
                        Ask To Resolve
                    </span>
                </div>
                <Toggle active={askToRoll} onChange={() => updateContext({ diceFairnessActive: !askToRoll })} />
            </div>

            <div className="text-[11px] text-text-dim/70 leading-relaxed">
                {askToRoll
                    ? 'The GM states what is attempted, how hard it judges it, and what a failure costs, then stops. You resolve it however you like — dice, cards, an oracle — and pick one of four outcomes. The difficulty is committed to before you answer, and nothing is tracked.'
                    : 'Nothing is ever asked. The GM narrates outcomes directly and is never told to stop for you.'}
            </div>

            {askToRoll && (
                <div className="space-y-1 pt-1">
                    <div className="text-[9px] text-text-dim uppercase tracking-wider">
                        When to ask
                    </div>
                    {ROLL_FREQUENCY_OPTIONS.map(opt => {
                        const active = (context.rollFrequency ?? 'contested') === opt.value;
                        return (
                            <button
                                key={opt.value}
                                onClick={() => updateContext({ rollFrequency: opt.value })}
                                className={`w-full text-left px-2 py-1.5 rounded border transition-colors ${
                                    active
                                        ? 'border-terminal/50 bg-terminal/10'
                                        : 'border-border/50 hover:border-border'
                                }`}
                            >
                                <div className={`text-[11px] font-bold ${active ? 'text-terminal' : 'text-text-primary'}`}>
                                    {opt.label}
                                </div>
                                <div className="text-[10px] text-text-dim/70 leading-snug">
                                    {opt.detail}
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ─── Bookkeeping Budget (prompt-budget controls moved out of the old Bookkeeping tab) ─────
//
// The Auto-Update interval (`autoBookkeepingInterval` — "scan every N turns") is a
// prompt-budget knob, not character data, so it lives in Engine Tuning.
//
// Two controls used to sit beside it and are gone. The Smart Injection ON/OFF toggle chose
// between two mutually exclusive character blocks; there is one block now, so the choice
// has no meaning. The stub-vs-full token readout compared those same two renderings of a
// character sheet that no longer exists.

function BookkeepingBudgetSection() {
    const autoBookkeepingInterval = useAppStore((s) => s.autoBookkeepingInterval);
    const setAutoBookkeepingInterval = useAppStore((s) => s.setAutoBookkeepingInterval);

    const [showSettings, setShowSettings] = useState(false);

    return (
        <div className="space-y-2">
            <div className="text-[12px] text-amber-400 uppercase tracking-wider font-bold border-b border-amber-500/20 pb-1 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    Bookkeeping Budget
                </div>
            </div>

            <div className="bg-void border border-border p-3 space-y-3">
                <div>
                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        className="flex items-center gap-1.5 text-text-dim/60 hover:text-text-primary text-[11px] uppercase tracking-wider transition-colors"
                    >
                        {showSettings ? 'Hide' : 'Auto-Update Settings'}
                    </button>
                    {showSettings && (
                        <div className="mt-2 space-y-2">
                            <div className="flex items-center gap-2">
                                <label className="text-[11px] text-text-dim/60 uppercase tracking-wider whitespace-nowrap">Scan every N turns:</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={50}
                                    value={autoBookkeepingInterval}
                                    onChange={(e) => setAutoBookkeepingInterval(Number(e.target.value))}
                                    className="w-16 px-2 py-1 bg-void border border-border rounded text-text-primary text-[13px] text-center focus:outline-none focus:border-terminal"
                                />
                            </div>
                            <p className="text-[11px] text-text-dim/40">
                                Auto-scanned every N turns via background queue.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
