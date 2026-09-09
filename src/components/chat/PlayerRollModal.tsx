import { useEffect, useMemo, useRef, useState } from 'react';
import { Dices } from 'lucide-react';
// From the pure engine package, NOT services/engine/engineRolls — that desktop wrapper
// pulls in useAppStore for its default tag lists, which drags the whole store into any
// test that renders this component.
import { parseDiceExpr } from '@narrative/engine';
import type { PlayerRollRequest } from '../../types';

/**
 * Player-rolled resolution modal. The GM called `request_roll` and generation is SUSPENDED
 * behind this; the turn resumes the moment `onSubmit` or `onDecline` fires.
 *
 * Two things make it different from DiceRollModal (which arms a roll BEFORE a send):
 *
 *  1. It is driven by props + a resolver, not a store boolean, because it must hand a value
 *     back to a promise the orchestrator is awaiting. Same shape as PcPromptModal.
 *  2. It has NO cancel-by-backdrop and no X. A stray click here would decline a roll the
 *     player probably meant to make, so dismissing is a deliberate, labelled button.
 *
 * The success / failure lines are shown because the GM committed to them before it could see
 * the number. Displaying them is the point: the player can see the terms were fixed in
 * advance rather than chosen to suit the result.
 */
export function PlayerRollModal({ request, onSubmit, onDecline }: {
    request: PlayerRollRequest;
    onSubmit: (total: number) => void;
    onDecline: () => void;
}) {
    const [value, setValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    // Focus only. The input needs no reset: ChatArea renders this as
    // `{pendingRollRequest && <PlayerRollModal …>}`, so resolving a request unmounts the
    // component and the next one mounts fresh with useState's initial ''.
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const parsed = useMemo(() => parseDiceExpr(request.dice), [request.dice]);
    const parsedTotal = value.trim() === '' ? null : Number(value);
    const isValid = parsedTotal !== null && Number.isFinite(parsedTotal);

    const submit = () => {
        if (!isValid) return;
        onSubmit(Math.trunc(parsedTotal));
    };

    // Fallback for when the player has no dice to hand. Rolls the stated expression locally
    // and submits it, so the flow is identical from the model's point of view.
    const rollForMe = () => {
        if (!parsed) return;
        let total = parsed.modifier;
        for (let i = 0; i < parsed.count; i++) {
            total += Math.floor(Math.random() * parsed.faces) + 1;
        }
        onSubmit(total);
    };

    return (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70">
            <div className="bg-surface border border-terminal/40 rounded-lg w-full max-w-sm mx-4 flex flex-col">
                <div className="flex items-center gap-2 p-4 border-b border-border">
                    <Dices size={14} className="text-terminal" />
                    <h2 className="text-terminal text-sm font-bold tracking-[0.2em] uppercase">
                        Roll {request.dice}
                    </h2>
                </div>

                <div className="p-4 space-y-3">
                    <p className="text-[13px] text-text-primary leading-relaxed">{request.reason}</p>

                    <div className="space-y-1 text-[11px] font-mono">
                        {request.successOn && (
                            <div className="flex gap-2">
                                <span className="text-terminal shrink-0">{request.successOn}</span>
                                <span className="text-text-dim">success</span>
                            </div>
                        )}
                        {request.failureMeans && (
                            <div className="flex gap-2">
                                <span className="text-amber-400/80 shrink-0">miss</span>
                                <span className="text-text-dim">{request.failureMeans}</span>
                            </div>
                        )}
                    </div>

                    <div>
                        <div className="text-[9px] text-text-dim uppercase tracking-wider mb-1">
                            Your total — include any bonus you judge applies
                        </div>
                        <input
                            ref={inputRef}
                            type="number"
                            value={value}
                            onChange={e => setValue(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') { e.preventDefault(); submit(); }
                            }}
                            placeholder={parsed ? `${parsed.count}–${parsed.count * parsed.faces}` : ''}
                            className="w-full bg-void border border-border focus:border-terminal text-[15px] text-text-primary rounded px-2 py-2 outline-none font-mono text-center"
                        />
                    </div>

                    <p className="text-[10px] text-text-dim/70 leading-relaxed">
                        The GM stated the bar before you rolled and is bound to it. Nothing is tracked —
                        the maths is yours.
                    </p>
                </div>

                <div className="px-4 py-3 border-t border-border flex items-center justify-between gap-2">
                    <button
                        onClick={onDecline}
                        className="px-2 py-1.5 text-[11px] text-text-dim hover:text-text-primary rounded"
                        title="Continue without resolving this — the GM will leave the outcome open"
                    >
                        No roll
                    </button>
                    <div className="flex gap-2">
                        {parsed && (
                            <button
                                onClick={rollForMe}
                                className="px-3 py-1.5 text-xs text-text-dim hover:text-text-primary rounded border border-border"
                                title="No dice to hand? Roll it here instead"
                            >
                                Roll for me
                            </button>
                        )}
                        <button
                            onClick={submit}
                            disabled={!isValid}
                            className="px-3 py-1.5 text-xs font-semibold bg-terminal/20 text-terminal rounded hover:bg-terminal/30 disabled:opacity-30"
                        >
                            Submit
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
