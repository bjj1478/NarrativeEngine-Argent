import { forwardRef, useCallback, useImperativeHandle, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import type { PlayerCharacter, NPCEntry } from '../../../types';
import { DEFAULT_VISUAL_PROFILE } from '../../../types';
import { toast } from '../../Toast';
import { PCEditForm } from '../PCEditForm';
import { useNpcPortraits } from '../../hooks/useNpcPortraits';
import { uid } from '../../../utils/uid';
import { pickSheetFields } from '../../../services/character/sheetFields';

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
 * The narrative record (traits, established events) lives in the Record tab and the
 * inventory grid in the Inventory tab. Relationships live HERE and only here — Record
 * used to render a second, read-only copy of the same bonds.
 *
 * Nothing is mirrored on save any more. The name used to be copied into
 * `characterProfile.identity.name` and `characterProfileData.name` as well, because the
 * prompt sourced the persona block from one of those and the kit line from this record.
 * There is one record and one block now: services/payload/playerCharacter.ts.
 */
export const SheetTab = forwardRef<SheetTabHandle, { onStartGuidedCreation?: () => void }>(function SheetTab({ onStartGuidedCreation }, ref) {
    const {
        playerCharacter,
        setPlayerCharacter,
        updatePlayerCharacter,
    } = useAppStore(useShallow((s) => ({
        playerCharacter: s.playerCharacter,
        setPlayerCharacter: s.setPlayerCharacter,
        updatePlayerCharacter: s.updatePlayerCharacter,
    })));

    const portraits = useNpcPortraits();

    const [isEditing, setIsEditing] = useState(false);
    const [form, setForm] = useState<Partial<PlayerCharacter>>({});

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
            setForm({
                isPC: true,
                name: '',
                status: 'Alive',
                tier: 'recurring',
                visualProfile: { ...DEFAULT_VISUAL_PROFILE },
            });
            // WO-A2 §2.1: with no PC we must land on the Manual / AI-Guided
            // chooser (NoPCState), NOT straight into the manual form — otherwise
            // AI-Guided Creation is unreachable. `Manual Creation` sets isEditing.
            setIsEditing(false);
        }
    }

    const handleSave = useCallback((): boolean => {
        if (!form.name?.trim()) {
            toast.error('Your character needs a name.');
            return false;
        }
        if (playerCharacter) {
            // Patch only what this form owns. `form` is seeded from the whole PC record, so
            // a `updatePlayerCharacter(form)` whole-record write sends fields the form never
            // shows — `activeTraits` above all — straight back from a snapshot taken when the
            // panel opened. The trait scan and the PC-drift check run in the background
            // against this same record, and an applied condition proposal writes it too; any
            // of those landing while the panel is open would be silently undone on save.
            updatePlayerCharacter(pickSheetFields(form));
        } else {
            const newPc: PlayerCharacter = {
                ...(form as NPCEntry),
                id: uid(),
                isPC: true,
                populated: true,
            };
            setPlayerCharacter(newPc);
        }
        // `mirrorName` used to run here, copying the name into `characterProfile.identity`
        // and `characterProfileData` as well. Both records are gone — the PC record written
        // just above is the only place the name lives now.
        setIsEditing(false);
        toast.success(playerCharacter ? 'Character updated.' : `Character "${form.name.trim()}" created!`);
        return true;
    }, [form, playerCharacter, updatePlayerCharacter, setPlayerCharacter]);

    const handleDiscard = useCallback(() => {
        if (playerCharacter) {
            setForm({ ...playerCharacter });
            setIsEditing(false);
        } else {
            setForm({
                isPC: true,
                name: '',
                status: 'Alive',
                tier: 'recurring',
                visualProfile: { ...DEFAULT_VISUAL_PROFILE },
            });
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
            : { isPC: true, name: '', status: 'Alive', tier: 'recurring', visualProfile: { ...DEFAULT_VISUAL_PROFILE } };
        return JSON.stringify(form) !== JSON.stringify(baseline);
    }, [isEditing, form, playerCharacter]);

    useImperativeHandle(ref, () => ({
        isDirty,
        save: handleSave,
        discard: handleDiscard,
    }), [isDirty, handleSave, handleDiscard]);

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

    if (playerCharacter) {
        return (
            <PCEditForm
                form={form}
                setForm={setForm}
                selectedId={playerCharacter.id}
                isEditing={isEditing}
                isGeneratingImage={portraits.isGeneratingImage}
                onEdit={() => setIsEditing(true)}
                onSave={handleSave}
                onCancel={handleDiscard}
                onGeneratePortrait={handleGeneratePortrait}
                onUploadPortrait={handleUploadPortrait}
                onRemovePortrait={handleRemovePortrait}
            />
        );
    }

    if (isEditing) {
        return (
            <PCEditForm
                form={form}
                setForm={setForm}
                selectedId={null}
                isEditing={true}
                isGeneratingImage={portraits.isGeneratingImage}
                onEdit={() => setIsEditing(true)}
                onSave={handleSave}
                onCancel={handleDiscard}
                onGeneratePortrait={handleGeneratePortrait}
                onUploadPortrait={handleUploadPortrait}
                onRemovePortrait={handleRemovePortrait}
            />
        );
    }

    return <NoPCState onStartManual={() => setIsEditing(true)} onStartGuidedCreation={onStartGuidedCreation} />;
});

function NoPCState({ onStartManual, onStartGuidedCreation }: { onStartManual: () => void; onStartGuidedCreation?: () => void }) {
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
            </div>
        </div>
    );
}