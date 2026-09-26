import { useState } from 'react';
import { ClipboardPaste, Loader2 } from 'lucide-react';

interface NPCFromTextDialogProps {
    /** `create` builds a new record; `update` refines the selected NPC. */
    mode: 'create' | 'update';
    /** Name of the NPC being refined (update mode only). */
    npcName?: string;
    /** Overrides for the NPC-specific copy (the Character Ledger reuses this dialog). */
    title?: string;
    description?: string;
    running: boolean;
    onSubmit: (text: string) => void;
    onCancel: () => void;
}

/**
 * Paste-anything dialog for the NPC Ledger. The text is handed to the AI, which fills the
 * sheet; the result opens in edit mode so nothing is saved until the user commits it.
 */
export function NPCFromTextDialog({ mode, npcName, title, description, running, onSubmit, onCancel }: NPCFromTextDialogProps) {
    const [text, setText] = useState('');
    const canSubmit = text.trim().length > 0 && !running;

    return (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-void/80 backdrop-blur-sm p-4" onClick={running ? undefined : onCancel}>
            <div className="w-full max-w-2xl max-h-full flex flex-col bg-surface border border-border rounded-lg shadow-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2 text-terminal font-bold uppercase tracking-widest text-sm">
                    <ClipboardPaste size={16} /> {title ?? (mode === 'create' ? 'Create NPC from Text' : `Update ${npcName || 'NPC'} from Text`)}
                </div>
                <p className="text-xs text-text-dim leading-relaxed">
                    {description ?? (mode === 'create'
                        ? 'Paste any description of a character (a wiki page, a bio, a story excerpt, notes). The AI will fill in a new NPC sheet for you to review before committing.'
                        : 'Paste extra material about this character. The AI will add or correct only what the text supports, then open the sheet for review before committing.')}
                </p>
                <textarea
                    value={text}
                    onChange={e => setText(e.target.value)}
                    disabled={running}
                    autoFocus
                    rows={14}
                    placeholder="Paste character text here..."
                    className="w-full flex-1 min-h-[200px] bg-void border border-border rounded px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/50 disabled:opacity-60 resize-y focus:outline-none focus:border-terminal"
                />
                <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] text-text-dim/60 uppercase tracking-wider">{text.length.toLocaleString()} chars</span>
                    <div className="flex gap-3">
                        <button
                            onClick={onCancel}
                            disabled={running}
                            className="px-4 py-2 text-xs uppercase tracking-widest text-text-dim hover:text-text-primary border border-border bg-void transition-colors disabled:opacity-40"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => onSubmit(text)}
                            disabled={!canSubmit}
                            className="flex items-center gap-2 px-6 py-2 text-xs uppercase tracking-widest text-void bg-terminal font-bold hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                        >
                            {running ? <Loader2 size={14} className="animate-spin" /> : <ClipboardPaste size={14} />}
                            {running ? 'Processing…' : 'Process'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
