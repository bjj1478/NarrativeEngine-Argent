import { useEffect, useRef, useState } from 'react';
import { Dices, RefreshCw } from 'lucide-react';
import { PLAYER_OUTCOMES } from '../../types';
import type { OutcomeDifficulty, PlayerOutcome, PlayerOutcomeRequest } from '../../types';
import { pickWeightedOutcome } from '../../services/engine/outcomeWeights';
import { pickRandomConsequence } from '../../services/engine/consequencePicker';

/**
 * Player-resolved action modal. The GM called `request_outcome` and generation is SUSPENDED
 * behind this; the turn resumes the moment `onSubmit` or `onDecline` fires.
 *
 * Two things make it different from DiceRollModal (which arms a roll BEFORE a send):
 *
 *  1. It is driven by props + a resolver, not a store boolean, because it must hand a value
 *     back to a promise the orchestrator is awaiting. Same shape as PcPromptModal.
 *  2. It has NO cancel-by-backdrop and no X. A stray click here would dismiss a request the
 *     player probably meant to answer, so dismissing is a deliberate, labelled button.
 *
 * The difficulty and the cost of failure are shown because the GM committed to them before it
 * could see the answer. Displaying them is the point: the player can see the terms were fixed
 * in advance rather than chosen to suit the result.
 *
 * There is no number input and no die. The player resolves the attempt by whatever means their
 * table uses and reports which of four outcomes came up; the engine never learns how.
 *
 * The Consequence field is drawn from the campaign's authored list on open, rerollable, and
 * freely editable — the engine draws, the player approves or overrides, the model renders. It
 * only matters on a `_with_consequence` pick; `formatPlayerOutcomeResult` alone decides that,
 * so this component reports the field's text either way rather than second-guessing it.
 */

const DIFFICULTY_STYLES: Record<OutcomeDifficulty, string> = {
    trivial:    'text-terminal border-terminal/40 bg-terminal/10',
    easy:       'text-terminal/80 border-terminal/30 bg-terminal/5',
    average:    'text-text-primary border-border bg-void',
    hard:       'text-amber-400 border-amber-500/40 bg-amber-500/10',
    impossible: 'text-red-400 border-red-500/40 bg-red-500/10',
};

const OUTCOME_LABELS: Record<PlayerOutcome, string> = {
    fail: 'Fail',
    fail_with_consequence: 'Fail with consequence',
    success_with_consequence: 'Success with consequence',
    success: 'Success',
};

// Fails read amber, successes read terminal. The rider does not change the colour, because it
// does not change the thing that matters: whether the action happened.
const OUTCOME_STYLES: Record<PlayerOutcome, string> = {
    fail: 'border-amber-500/40 text-amber-400 hover:bg-amber-500/10',
    fail_with_consequence: 'border-amber-500/40 text-amber-400 hover:bg-amber-500/10',
    success_with_consequence: 'border-terminal/40 text-terminal hover:bg-terminal/10',
    success: 'border-terminal/40 text-terminal hover:bg-terminal/10',
};

export function PlayerOutcomeModal({ request, consequences, onSubmit, onDecline }: {
    request: PlayerOutcomeRequest;
    /** The campaign's authored consequence list (`context.consequences`). May be empty. */
    consequences: string[];
    onSubmit: (outcome: PlayerOutcome, consequence: string) => void;
    onDecline: () => void;
}) {
    const firstButtonRef = useRef<HTMLButtonElement>(null);

    // Lazy initializer: the draw happens once per MOUNT, not once per render. ChatArea renders
    // this as `{pendingOutcomeRequest && <PlayerOutcomeModal …>}`, so every request mounts a
    // fresh component and gets its own draw — and a re-render never overwrites an edit.
    const [consequence, setConsequence] = useState(() => pickRandomConsequence(consequences));

    // ChatArea passes `onSubmit` as an inline arrow, so it is a fresh function on every
    // render, and `consequence` changes as the player types. Holding both in refs is what lets
    // the effect below run ONCE on mount: depend on them directly and the effect re-fires on
    // every render, re-focusing the first option and yanking focus back out from under a
    // player who has tabbed to another one — or worse, mid-keystroke in the field.
    const submitRef = useRef(onSubmit);
    const consequenceRef = useRef(consequence);
    useEffect(() => {
        submitRef.current = onSubmit;
        consequenceRef.current = consequence;
    });

    const submit = (outcome: PlayerOutcome) => onSubmit(outcome, consequence);

    // Focus the first option so the modal is keyboard-reachable the moment it opens, and bind
    // 1-4 to the four outcomes in the order they are rendered.
    useEffect(() => {
        firstButtonRef.current?.focus();
        const onKeyDown = (e: KeyboardEvent) => {
            // The Consequence field is editable and lives on this same surface, so a bare
            // digit handler would submit `fail` the moment the player typed "1" into it and
            // end the turn. Anything originating in a text field is the field's to keep.
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            const index = Number(e.key) - 1;
            if (Number.isInteger(index) && index >= 0 && index < PLAYER_OUTCOMES.length) {
                e.preventDefault();
                submitRef.current(PLAYER_OUTCOMES[index], consequenceRef.current);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    const difficultyStyle = DIFFICULTY_STYLES[request.difficulty] ?? DIFFICULTY_STYLES.average;
    const canReroll = consequences.length > 0;

    return (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70">
            <div className="bg-surface border border-terminal/40 rounded-lg w-full max-w-sm mx-4 flex flex-col">
                <div className="flex items-center gap-2 p-4 border-b border-border">
                    <Dices size={14} className="text-terminal" />
                    <h2 className="text-terminal text-sm font-bold tracking-[0.2em] uppercase">
                        Resolve
                    </h2>
                    <span className={`ml-auto px-2 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wider ${difficultyStyle}`}>
                        {request.difficulty}
                    </span>
                </div>

                <div className="p-4 space-y-3">
                    <p className="text-[13px] text-text-primary leading-relaxed">{request.reason}</p>

                    {request.failureMeans && (
                        <div className="flex gap-2 text-[11px] font-mono">
                            <span className="text-amber-400/80 shrink-0">if it fails</span>
                            <span className="text-text-dim">{request.failureMeans}</span>
                        </div>
                    )}

                    <div>
                        <div className="text-[9px] text-text-dim uppercase tracking-wider mb-1">
                            What happened
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                            {PLAYER_OUTCOMES.map((outcome, i) => (
                                <button
                                    key={outcome}
                                    ref={i === 0 ? firstButtonRef : undefined}
                                    onClick={() => submit(outcome)}
                                    className={`px-2 py-2 rounded border text-[11px] font-semibold text-left leading-snug outline-none focus:ring-1 focus:ring-terminal/60 ${OUTCOME_STYLES[outcome]}`}
                                >
                                    <span className="text-text-dim/50 font-mono mr-1">{i + 1}</span>
                                    {OUTCOME_LABELS[outcome]}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <div className="text-[9px] text-text-dim uppercase tracking-wider mb-1 flex items-center justify-between">
                            <span>Consequence</span>
                            <button
                                onClick={() => setConsequence(pickRandomConsequence(consequences, Math.random, consequence))}
                                disabled={!canReroll}
                                className="flex items-center gap-1 text-[9px] text-text-dim hover:text-terminal disabled:opacity-30 disabled:hover:text-text-dim uppercase tracking-wider"
                                title={canReroll
                                    ? 'Draw another from this campaign'
                                    : 'No consequences authored for this campaign — add some under Engine Tuning, or type one here'}
                            >
                                <RefreshCw size={9} /> reroll
                            </button>
                        </div>
                        <textarea
                            value={consequence}
                            onChange={e => setConsequence(e.target.value)}
                            rows={2}
                            placeholder="Only used if you pick an outcome with consequence"
                            className="w-full bg-void border border-border focus:border-terminal text-[11px] text-text-primary rounded px-2 py-1.5 outline-none resize-y font-mono leading-snug"
                        />
                    </div>

                    <p className="text-[10px] text-text-dim/70 leading-relaxed">
                        The GM committed to the difficulty before you answered and is bound to it.
                        Resolve it however your table does — nothing is tracked, and the maths is yours.
                    </p>
                </div>

                <div className="px-4 py-3 border-t border-border flex items-center justify-between gap-2">
                    <button
                        onClick={onDecline}
                        className="px-2 py-1.5 text-[11px] text-text-dim hover:text-text-primary rounded"
                        title="Continue without resolving this — the GM will leave the outcome open"
                    >
                        Leave it open
                    </button>
                    <button
                        onClick={() => submit(pickWeightedOutcome(request.difficulty))}
                        className="px-3 py-1.5 text-xs text-text-dim hover:text-text-primary rounded border border-border"
                        title="Nothing to resolve with? Let the app pick, weighted by the stated difficulty"
                    >
                        Decide for me
                    </button>
                </div>
            </div>
        </div>
    );
}
