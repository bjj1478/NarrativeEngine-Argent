import type { SceneStakes } from '../../types';

/** Bubble-header readout of the scene stakes; see stakesForMessage for where the value comes from. */
const STAKES_VIEW: Record<SceneStakes, { label: string; level: number; ink: string; next: string }> = {
    calm: { label: 'Calm', level: 1, ink: 'text-text-dim', next: 'has room to breathe' },
    tense: { label: 'Tense', level: 2, ink: 'text-ice', next: 'stays short and hands the moment back' },
    dangerous: { label: 'Dangerous', level: 3, ink: 'text-danger', next: 'stays short, close and physical' },
};

export function SceneStakesChip({ stakes }: { stakes: SceneStakes }) {
    // `?? calm`: a value outside the union (old save, hand-edited file) must not crash the bubble.
    const view = STAKES_VIEW[stakes] ?? STAKES_VIEW.calm;
    return (
        <span
            data-ui="msg-stakes"
            data-stakes={stakes}
            className={`inline-flex items-center gap-1 text-[9px] uppercase tracking-wider ${view.ink}`}
            title={`Scene read as ${view.label.toLowerCase()}. With Flexible length, the next reply ${view.next}.`}
        >
            <span aria-hidden="true" className="inline-flex items-end gap-[2px]">
                {[1, 2, 3].map(i => (
                    <span
                        key={i}
                        className={`w-[3px] rounded-[1px] bg-current ${i <= view.level ? '' : 'opacity-25'}`}
                        style={{ height: `${3 + i * 2}px` }}
                    />
                ))}
            </span>
            {view.label}
        </span>
    );
}
