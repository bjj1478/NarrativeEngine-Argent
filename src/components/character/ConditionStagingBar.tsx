import { HeartPulse, Check, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { toast } from '../Toast';
import { applyConditionProposal } from '../../services/character/applyConditionProposal';
import type { ConditionProposal } from '../../types';

/**
 * GM-proposed change to the player character's body state, awaiting confirmation.
 * Sibling of `InventoryStagingBar` — same amber banner above the composer, same
 * Apply / Dismiss shape.
 *
 * Dismiss means "do not record this", not "that did not happen": the GM already narrated
 * the moment in prose. The engine only ever learns what you confirm, and the character
 * block sent next turn is what tells the GM which way you went.
 */
export function ConditionStagingBar({
    proposal,
    onDone,
}: {
    proposal: ConditionProposal;
    onDone: () => void;
}) {
    const updatePlayerCharacter = useAppStore(s => s.updatePlayerCharacter);

    const apply = () => {
        const summary = applyConditionProposal(proposal, updatePlayerCharacter);
        if (summary) toast.success(summary);
        else toast.warning('That proposal named no change.');
        onDone();
    };

    // What the banner leads with, in the order that matters: death and capture first,
    // because they are not a curation call the way a scrape is.
    const headline = proposal.status
        ? proposal.status
        : proposal.condition
            ? proposal.condition
            : 'no change';
    const isClearing = proposal.condition === '' && !proposal.status;

    return (
        <div className="bg-amber-500/10 border-b border-amber-500/40 px-4 py-2 flex items-center justify-between gap-3">
            <span className="text-amber-400 text-[11px] font-mono flex items-center gap-2 min-w-0">
                <HeartPulse size={13} className="shrink-0" />
                <span className="truncate">
                    GM proposes:{' '}
                    <span className="font-bold uppercase">{isClearing ? 'recovered' : 'condition'}</span>{' '}
                    <span className="text-text-primary">{isClearing ? 'wound cleared' : headline}</span>
                    {proposal.status && proposal.condition ? (
                        <span className="text-text-dim"> ({proposal.condition || 'condition cleared'})</span>
                    ) : null}
                    {proposal.reason ? <span className="text-text-dim"> — {proposal.reason}</span> : null}
                </span>
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
                <button
                    onClick={apply}
                    className="flex items-center gap-1 bg-green-900/30 border border-green-600 text-green-400 hover:bg-green-900/50 text-[10px] uppercase tracking-wider px-2 py-1 rounded-sm transition-colors"
                >
                    <Check size={12} /> Apply
                </button>
                <button
                    onClick={onDone}
                    className="flex items-center gap-1 text-text-dim hover:text-text-primary border border-border hover:border-text-dim text-[10px] uppercase tracking-wider px-2 py-1 rounded-sm transition-colors"
                >
                    <X size={12} /> Dismiss
                </button>
            </div>
        </div>
    );
}
