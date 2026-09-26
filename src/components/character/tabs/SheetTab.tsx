import { forwardRef, useCallback, useImperativeHandle, useState } from 'react';
import { Sparkles, ClipboardPaste } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import type { PlayerCharacter, CharacterProfileState, NPCEntry } from '../../../types';
import { DEFAULT_VISUAL_PROFILE } from '../../../types';
import { toast } from '../../Toast';
import { PCEditForm } from '../PCEditForm';
import { useNpcPortraits } from '../../hooks/useNpcPortraits';
import { uid } from '../../../utils/uid';
import { NPCFromTextDialog } from '../../npc-ledger/NPCFromTextDialog';
import { extractPCFromText } from '../../../services/character/pcFromText';

/**
 * Imperative handle exposed to the Character Ledger host so it can guard the
 * modal's close paths (backdrop click, Escape, X button) against un-saved
 * Sheet-tab edits. The Sheet tab still owns the form state; the host just
 * asks "is it dirty?" and "please save / discard" before closing.
 */
export interface SheetTabHandle {
    isDirty: () => boolean;
    save: () => boolean;
    discard: () => void;
}

/**
 * Character Ledger — Sheet tab.
 *
 * Owner: user authors. Hosts `PCEditForm` (the "D&D character paper": identity,
 * kit, hex, wants, boundaries, portrait) in two modes:
 *  - No PC → create mode (empty draft) → `setPlayerCharacter` on save.
 *  - PC exists → view mode with an Edit toggle → `updatePlayerCharacter` on save.
 *
 * The read-only Bonds section + established-events list live in the Record tab;
 * the inventory grid lives in the Inventory tab; the stat block lives in the
 * Stats tab. This is the user-authored mechanical sheet only.
 *
 * On save the PC's name is mirrored into `context.characterProfile.identity.name`
 * + `characterProfileData.name` so the prompt pipeline picks up the canonical
 * identity (the persona block sources from `characterProfile`; the kit line
 * sources from `playerCharacter.signatureKit`).
 */
// Local copy of the ledger's tab union -- deliberately not imported from
// CharacterLedgerModal, which imports this file.
type LedgerTab = 'sheet' | 'record' | 'inventory' | 'stats';

/** The empty draft a brand-new PC starts from (also the create-mode dirty baseline). */
function blankPcForm(): Partial<PlayerCharacter> {
    return {
        isPC: true,
        name: '',
        status: 'Alive',
        tier: 'recurring',
        visualProfile: { ...DEFAULT_VISUAL_PROFILE },
    };
}

export const SheetTab = forwardRef<SheetTabHandle, { onStartGuidedCreation?: () => void; onNavigateTab?: (tab: LedgerTab) => void }>(function SheetTab({ onStartGuidedCreation, onNavigateTab }, ref) {
    const {
        playerCharacter,
        setPlayerCharacter,
        updatePlayerCharacter,
        context,
        updateContext,
        characterProfileData,
        setCharacterProfileData,
    } = useAppStore(useShallow((s) => ({
        playerCharacter: s.playerCharacter,
        setPlayerCharacter: s.setPlayerCharacter,
        updatePlayerCharacter: s.updatePlayerCharacter,
        context: s.context,
        updateContext: s.updateContext,
        characterProfileData: s.characterProfileData,
        setCharacterProfileData: s.setCharacterProfileData,
    })));

    const portraits = useNpcPortraits();

    const [isEditing, setIsEditing] = useState(false);
    const [form, setForm] = useState<Partial<PlayerCharacter>>({});
    const [fromTextMode, setFromTextMode] = useState<'create' | 'update' | null>(null);
    const [isFromTextRunning, setIsFromTextRunning] = useState(false);

    // Sync form when the PC id changes. Render-phase setForm pattern (same as
    // the prior PCPanelModal) avoids a stale-closure effect when the PC is
    // mutated outside this component (e.g. by the hydrator migration).
    const [prevPcId, setPrevPcId] = useState<string | undefined>('__INITIAL_UNSET__');
    if (playerCharacter?.id !== prevPcId) {
        setPrevPcId(playerCharacter?.id);
        if (playerCharacter) {
            setForm({ ...playerCharacter });
            setIsEditing(false);
        } else {
            setForm(blankPcForm());
            // WO-A2 §2.1: with no PC we must land on the Manual / AI-Guided
            // chooser (NoPCState), NOT straight into the manual form — otherwise
            // AI-Guided Creation is unreachable. `Manual Creation` sets isEditing.
            setIsEditing(false);
        }
    }

    const mirrorName = useCallback((name: string) => {
        const profile: CharacterProfileState = context.characterProfile ?? { identity: {}, activeTraits: [] };
        updateContext({
            characterProfileActive: true,
            characterProfile: {
                ...profile,
                identity: { ...profile.identity, name },
            },
        });
        if (characterProfileData) {
            setCharacterProfileData({ ...characterProfileData, name });
        }
    }, [context, characterProfileData, updateContext, setCharacterProfileData]);

    const handleSave = useCallback((): boolean => {
        if (!form.name?.trim()) {
            toast.error('Your character needs a name.');
            return false;
        }
        if (playerCharacter) {
            updatePlayerCharacter(form as PlayerCharacter);
        } else {
            const newPc: PlayerCharacter = {
                ...(form as NPCEntry),
                id: uid(),
                isPC: true,
                populated: true,
            };
            setPlayerCharacter(newPc);
        }
        mirrorName(form.name.trim());
        setIsEditing(false);
        toast.success(playerCharacter ? 'Character updated.' : `Character "${form.name.trim()}" created!`);
        return true;
    }, [form, playerCharacter, mirrorName, updatePlayerCharacter, setPlayerCharacter]);

    const handleDiscard = useCallback(() => {
        if (playerCharacter) {
            setForm({ ...playerCharacter });
            setIsEditing(false);
        } else {
            setForm(blankPcForm());
            setIsEditing(false);
        }
    }, [playerCharacter]);

    // isDirty: the Sheet tab is in edit mode AND the form diverges from the
    // last-saved PC (edit mode) or from the empty new-character draft (create
    // mode). Comparing the JSON snapshot catches every field the form owns
    // (identity, kit, hex, wants, boundaries, triggers, portrait, relations).
    const isDirty = useCallback((): boolean => {
        if (!isEditing) return false;
        const baseline = playerCharacter
            ? { ...playerCharacter }
            : blankPcForm();
        return JSON.stringify(form) !== JSON.stringify(baseline);
    }, [isEditing, form, playerCharacter]);

    useImperativeHandle(ref, () => ({
        isDirty,
        save: handleSave,
        discard: handleDiscard,
    }), [isDirty, handleSave, handleDiscard]);

    /**
     * Paste-anything → PC sheet. The result lands in edit mode and is NOT saved:
     * Save Character persists it through handleSave and Discard reverts.
     */
    const handleFromText = async (text: string) => {
        if (!fromTextMode) return;
        const state = useAppStore.getState();
        const provider = state.getActiveStoryEndpoint();
        if (!provider) { toast.error('Story AI endpoint is not configured.'); return; }
        const existing = fromTextMode === 'update' ? playerCharacter ?? undefined : undefined;
        if (fromTextMode === 'update' && !existing) return;
        setIsFromTextRunning(true);
        try {
            const patch = await extractPCFromText(provider, text, {
                existing,
                matureMode: state.settings.matureMode ?? false,
            });
            setForm(existing
                ? { ...existing, visualProfile: existing.visualProfile || { ...DEFAULT_VISUAL_PROFILE }, ...patch }
                : { ...blankPcForm(), ...patch });
            setIsEditing(true);
            setFromTextMode(null);
            toast.success('Sheet filled from text. Review it, then Save Character.');
        } catch (err: unknown) {
            console.error('[PC From Text] Error:', err);
            toast.error(`Could not build a character from that text${err instanceof Error ? `: ${err.message}` : ''}`);
        } finally {
            setIsFromTextRunning(false);
        }
    };

    const handleUploadPortrait = (file: File) => {
        const targetId = playerCharacter?.id || 'new-pc';
        portraits.uploadForForm(file, form.name || 'Unknown', targetId, true, (patch) => {
            setForm(prev => ({ ...prev, ...patch }));
            if (playerCharacter) updatePlayerCharacter(patch);
        });
    };

    const handleGeneratePortrait = () => {
        const targetId = playerCharacter?.id || 'new-pc';
        portraits.generateForForm(
            { ...form, id: targetId, isPC: true } as NPCEntry,
            targetId,
            true,
            (patch) => {
                setForm(prev => ({ ...prev, ...patch }));
                if (playerCharacter) updatePlayerCharacter(patch);
            },
        );
    };

    const handleRemovePortrait = () => {
        const patch = { portrait: '' };
        setForm(prev => ({ ...prev, ...patch }));
        if (playerCharacter) updatePlayerCharacter(patch);
    };

    const fromTextDialog = fromTextMode && (
        <NPCFromTextDialog
            mode={fromTextMode}
            title={fromTextMode === 'create' ? 'Create Character from Text' : `Update ${form.name || 'Character'} from Text`}
            description={fromTextMode === 'create'
                ? 'Paste any description of your character (a wiki page, a bio, a story excerpt, notes). The AI will fill in the character sheet for you to review before saving.'
                : 'Paste extra material about your character. The AI will add or correct only what the text supports, then open the sheet for review before saving.'}
            running={isFromTextRunning}
            onSubmit={(text) => { void handleFromText(text); }}
            onCancel={() => setFromTextMode(null)}
        />
    );

    let body: React.ReactNode;
    if (playerCharacter || isEditing) {
        body = (
            <PCEditForm
                form={form}
                setForm={setForm}
                selectedId={playerCharacter?.id ?? null}
                isEditing={playerCharacter ? isEditing : true}
                isGeneratingImage={portraits.isGeneratingImage}
                isFromTextRunning={isFromTextRunning}
                onEdit={() => setIsEditing(true)}
                onSave={handleSave}
                onCancel={handleDiscard}
                onGeneratePortrait={handleGeneratePortrait}
                onUploadPortrait={handleUploadPortrait}
                onRemovePortrait={handleRemovePortrait}
                onFromText={playerCharacter ? () => setFromTextMode('update') : undefined}
                onNavigateTab={onNavigateTab}
            />
        );
    } else {
        body = (
            <NoPCState
                onStartManual={() => setIsEditing(true)}
                onStartGuidedCreation={onStartGuidedCreation}
                onStartFromText={() => setFromTextMode('create')}
            />
        );
    }

    return (
        <div className="relative flex-1 flex flex-col min-h-0">
            {fromTextDialog}
            {body}
        </div>
    );
});

function NoPCState({ onStartManual, onStartGuidedCreation, onStartFromText }: { onStartManual: () => void; onStartGuidedCreation?: () => void; onStartFromText: () => void }) {
    return (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-full bg-terminal/10 border border-terminal/30 flex items-center justify-center mb-4">
                <Sparkles size={28} className="text-terminal/70" />
            </div>
            <p className="text-text-dim uppercase tracking-widest text-sm font-bold">No Character Yet</p>
            <p className="text-text-dim/60 text-xs mt-2 max-w-sm">
                Build your player character to give the world a protagonist.
            </p>
            <div className="mt-4 flex flex-col gap-2 w-full max-w-xs">
                <button
                    onClick={onStartManual}
                    className="px-5 py-2 bg-terminal/20 text-terminal border border-terminal/30 rounded hover:bg-terminal/30 transition-colors text-[11px] uppercase tracking-widest"
                >
                    Manual Creation
                </button>
                {onStartGuidedCreation && (
                    <button
                        onClick={onStartGuidedCreation}
                        className="px-5 py-2 bg-void text-text-dim border border-border rounded hover:border-terminal hover:text-terminal transition-colors text-[11px] uppercase tracking-widest"
                    >
                        AI-Guided Creation
                    </button>
                )}
                <button
                    onClick={onStartFromText}
                    className="flex items-center justify-center gap-1.5 px-5 py-2 bg-void text-text-dim border border-border rounded hover:border-terminal hover:text-terminal transition-colors text-[11px] uppercase tracking-widest"
                >
                    <ClipboardPaste size={12} /> Create from Text
                </button>
            </div>
        </div>
    );
}