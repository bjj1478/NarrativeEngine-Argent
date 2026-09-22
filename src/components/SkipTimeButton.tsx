import { useEffect, useRef, useState } from 'react';
import { Hourglass, X } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { tierAllows } from '../services/turn/aiTier';
import {
    TIMESKIP_UNITS,
    timeskipDuration,
    timeskipPhrase,
    type TimeskipUnit,
} from '../services/turn/timeskipDuration';

/**
 * Skip Time — an explicit, picked time skip.
 *
 * Skips used to be triggered only by phrasing: a regex table over the player's typed
 * message. A near-miss ("I rest for a week", "tomorrow") matched nothing and was
 * indistinguishable from an ordinary turn, and "a season later" was detected, flagged
 * ambiguous, and dropped without ever telling the user why. This button makes the
 * trigger and the duration explicit; the typed phrases still work, unchanged.
 *
 * Confirm advances the calendar, arms the skip for the turn, and sends — one press,
 * one result. The guiding text becomes the visible player message.
 */
export function SkipTimeButton({ onConfirm }: { onConfirm: (text: string) => void }) {
    const pipelinePhase = useAppStore(s => s.pipelinePhase);
    const aiTier = useAppStore(s => s.settings.aiTier);
    const [modalOpen, setModalOpen] = useState(false);

    const isStreaming = pipelinePhase !== 'idle';
    // The simulation is gated on both blocks; without them a skip would advance the
    // calendar and silently simulate nothing. Say so on the button rather than
    // letting the press look like it worked.
    const simulationEnabled = tierAllows(aiTier, 'timeskipRun') && tierAllows(aiTier, 'heartbeatTick');

    const title = simulationEnabled
        ? 'Skip ahead in time — advances the calendar and lets the world move on'
        : 'Time skips are off: enable NPC Agency Heartbeat and Timeskip Narration, or raise the AI tier';

    return (
        <>
            <button
                onClick={() => setModalOpen(true)}
                disabled={isStreaming || !simulationEnabled}
                title={title}
                className="shrink-0 flex items-center gap-1.5 bg-void border border-terminal/30 hover:border-terminal text-terminal text-[10px] sm:text-[11px] uppercase tracking-wider px-3 h-[32px] rounded-sm transition-all hover:bg-terminal/5 disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
            >
                <Hourglass size={13} />
                <span className="hidden xs:inline">Skip Time</span>
                <span className="inline xs:hidden">Skip</span>
            </button>
            {modalOpen && !isStreaming && (
                <SkipTimeModal onClose={() => setModalOpen(false)} onConfirm={onConfirm} />
            )}
        </>
    );
}

function SkipTimeModal({
    onClose,
    onConfirm,
}: {
    onClose: () => void;
    onConfirm: (text: string) => void;
}) {
    const [amount, setAmount] = useState(1);
    const [unit, setUnit] = useState<TimeskipUnit>('weeks');
    const [guidance, setGuidance] = useState('');

    const openedAtRef = useRef(0);
    useEffect(() => {
        openedAtRef.current = Date.now();
    }, []);

    const handleBackdropClick = () => {
        if (Date.now() - openedAtRef.current < 350) return;
        onClose();
    };

    const duration = timeskipDuration(amount, unit);
    const worldDay = useAppStore(s => s.context.worldDay);
    const valid = duration.days > 0;

    const handleConfirm = () => {
        if (!valid) return;
        const state = useAppStore.getState();

        // Advance the calendar first so this turn's payload already shows the new date
        // and the GM narrates having arrived there. `worldDay` is optional — undefined
        // means "this campaign does not track time" — so an explicit skip starts it.
        state.updateContext({ worldDay: (state.context.worldDay ?? 1) + duration.days });
        state.setArmedTimeskip({ days: duration.days, weeks: duration.weeks, ticks: duration.ticks });

        const phrase = timeskipPhrase(amount, unit);
        const trimmed = guidance.trim();
        onConfirm(trimmed ? `${phrase} ${trimmed}` : phrase);
        onClose();
    };

    const nextDay = worldDay === undefined ? duration.days + 1 : worldDay + duration.days;

    return (
        <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60"
            onClick={handleBackdropClick}
        >
            <div
                className="bg-surface border border-border rounded-lg w-full max-w-md mx-4 flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-4 border-b border-border">
                    <h2 className="text-terminal text-sm font-bold tracking-[0.2em] uppercase flex items-center gap-2">
                        <Hourglass size={14} /> Skip Time
                    </h2>
                    <button onClick={onClose} className="text-text-dim hover:text-text-primary">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-4 space-y-4">
                    <div>
                        <label className="block text-[10px] text-text-dim uppercase tracking-wider mb-1">
                            How long?
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="number"
                                min={1}
                                value={amount}
                                onChange={e => setAmount(Math.max(1, Number(e.target.value) || 1))}
                                className="w-24 bg-void border border-border px-3 py-2 text-sm text-text-primary focus:border-terminal focus:outline-none"
                            />
                            <select
                                value={unit}
                                onChange={e => setUnit(e.target.value as TimeskipUnit)}
                                className="flex-1 bg-void border border-border px-3 py-2 text-sm text-text-primary focus:border-terminal focus:outline-none appearance-none"
                            >
                                {TIMESKIP_UNITS.map(u => (
                                    <option key={u} value={u}>{u}</option>
                                ))}
                            </select>
                        </div>
                        <p className="mt-1 text-[10px] text-text-dim">
                            {duration.days} day{duration.days === 1 ? '' : 's'} pass — Day {nextDay}.
                            {duration.ticks === 0
                                ? ' Too short for anything to happen off-screen.'
                                : ` The world moves on (${duration.ticks} tick${duration.ticks === 1 ? '' : 's'}).`}
                        </p>
                    </div>

                    <div>
                        <label className="block text-[10px] text-text-dim uppercase tracking-wider mb-1">
                            What do you do? <span className="normal-case tracking-normal">(optional)</span>
                        </label>
                        <textarea
                            value={guidance}
                            onChange={e => setGuidance(e.target.value)}
                            rows={3}
                            placeholder="I spend the winter rebuilding the forge."
                            className="w-full bg-void border border-border px-3 py-2 text-sm text-text-primary focus:border-terminal focus:outline-none resize-none"
                        />
                        <p className="mt-1 text-[10px] text-text-dim">
                            Sent as your message for this turn, so it steers what you return to.
                        </p>
                    </div>
                </div>

                <div className="flex justify-end gap-2 p-4 border-t border-border">
                    <button
                        onClick={onClose}
                        className="px-3 h-[32px] text-[11px] uppercase tracking-wider text-text-dim hover:text-text-primary"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!valid}
                        className="flex items-center gap-1.5 bg-void border border-terminal/50 text-terminal text-[11px] uppercase tracking-wider px-4 h-[32px] rounded-sm transition-all hover:bg-terminal/5 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        Skip
                    </button>
                </div>
            </div>
        </div>
    );
}
