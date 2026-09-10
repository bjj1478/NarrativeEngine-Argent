import { useEffect, useState } from 'react';
import { Check, ClipboardCopy, RotateCcw, ScanText, X } from 'lucide-react';
import { MAX_PORTRAIT_PROMPT_CHARS } from '../../services/npc/portraitPrompt';
import { toast } from '../Toast';

type Props = {
    /** The prompt exactly as `buildPortraitPrompt` produced it for this record. */
    prompt: string;
    /** Subject name, shown as a heading only — it is never part of the prompt itself. */
    name: string;
    onClose: () => void;
};

/** Copies via the async clipboard API, falling back to a hidden textarea for the
 *  insecure-origin case (the desktop shell serves the UI over plain http in some setups). */
async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        try {
            const scratch = document.createElement('textarea');
            scratch.value = text;
            scratch.setAttribute('readonly', '');
            scratch.style.position = 'fixed';
            scratch.style.opacity = '0';
            document.body.appendChild(scratch);
            scratch.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(scratch);
            return ok;
        } catch {
            return false;
        }
    }
}

/** Shows the image-generation prompt the engine would have sent, so it can be
 *  inspected, tweaked, and taken to an external image tool instead. Nothing here
 *  touches the image endpoint or the NPC/PC record. */
export function PortraitPromptModal({ prompt, name, onClose }: Props) {
    const [draft, setDraft] = useState(prompt);
    const [copied, setCopied] = useState(false);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- reseed the draft when a different record's prompt is shown
    useEffect(() => { setDraft(prompt); setCopied(false); }, [prompt]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    useEffect(() => {
        if (!copied) return;
        const t = window.setTimeout(() => setCopied(false), 1800);
        return () => window.clearTimeout(t);
    }, [copied]);

    const handleCopy = async () => {
        if (await copyText(draft)) setCopied(true);
        else toast.error('Could not access the clipboard — select the text and copy manually.');
    };

    const overLimit = draft.length > MAX_PORTRAIT_PROMPT_CHARS;

    return (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
            <div className="bg-surface border border-border rounded-lg w-full max-w-2xl flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b border-border">
                    <h2 className="text-terminal text-sm font-bold tracking-[0.2em] uppercase flex items-center gap-2">
                        <ScanText size={14} /> Image Prompt{name ? ` — ${name}` : ''}
                    </h2>
                    <button onClick={onClose} title="Close" className="text-text-dim hover:text-text-primary">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-4 space-y-2">
                    <p className="text-[10px] text-text-dim/80 leading-relaxed">
                        This is exactly what the engine would send to the configured image model, built from the
                        visual profile fields and art style. Edit it freely and copy it into any external image tool —
                        nothing is generated and the record is not changed.
                    </p>
                    <textarea
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        spellCheck={false}
                        rows={12}
                        className="w-full bg-void border border-border focus:border-terminal rounded px-3 py-2 text-[12px] leading-relaxed font-mono text-text-primary resize-y outline-none"
                    />
                    <div className="flex items-center justify-between text-[9px] uppercase tracking-wider">
                        <span className={overLimit ? 'text-amber-400' : 'text-text-dim'}>
                            {draft.length} / {MAX_PORTRAIT_PROMPT_CHARS} chars{overLimit ? ' — longer than the engine sends; some providers will truncate' : ''}
                        </span>
                        <button
                            type="button"
                            onClick={() => setDraft(prompt)}
                            disabled={draft === prompt}
                            className="flex items-center gap-1 text-text-dim hover:text-text-primary disabled:opacity-40 disabled:hover:text-text-dim"
                        >
                            <RotateCcw size={10} /> Reset
                        </button>
                    </div>
                </div>

                <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
                    <button onClick={onClose} className="px-3 py-1.5 text-xs text-text-dim hover:text-text-primary rounded">Close</button>
                    <button
                        onClick={handleCopy}
                        className="px-3 py-1.5 text-xs font-semibold bg-terminal/20 text-terminal rounded hover:bg-terminal/30 flex items-center gap-1.5"
                    >
                        {copied ? <Check size={12} /> : <ClipboardCopy size={12} />}
                        {copied ? 'Copied' : 'Copy Prompt'}
                    </button>
                </div>
            </div>
        </div>
    );
}
