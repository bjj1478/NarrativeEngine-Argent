import { describe, expect, it, vi, afterEach } from 'vitest';
import type { ArcRecord } from '../../types/arc';
// The mod file is the source of truth for the tick; the oracle test imports it the
// same way. `arcCompute` is the default export (the postTurn hook).
import arcCompute, { ARC_TIMESKIP_TICK_RATIO } from '../../../mods/arc/compute.js';

function mockArc(overrides: Partial<ArcRecord> = {}): ArcRecord {
    return {
        id: 'arc-123',
        type: 'economic',
        title: 'Grain Crisis',
        seed: 'Seed text',
        ladder: [
            { label: 'Rung 0', surface: 'ambient' },
            { label: 'Rung 1', surface: 'ambient' },
            { label: 'Rung 2', surface: 'rumor' },
            { label: 'Rung 3', surface: 'rumor' },
            { label: 'Rung 4', surface: 'direct' },
        ],
        currentRung: 0,
        tickDC: 35,
        stance: 'unaware',
        status: 'active',
        bornScene: 'scene-1',
        lastTickScene: 'scene-1',
        ...overrides,
    } as ArcRecord;
}

/** A compute ctx with one arc and a controllable `elapsedTicks`. */
function makeCtx(elapsedTicks: number | undefined, arcs: ArcRecord[]) {
    const written: ArcRecord[][] = [];
    return {
        written,
        ctx: {
            table: {
                read: async () => arcs,
                write: async (_name: string, rows: ArcRecord[]) => { written.push(rows); },
            },
            data: {
                archiveIndex: [{ sceneId: '007' }],
                playerInput: 'I wait.',
                messages: [{ role: 'assistant', content: 'The market is quiet.' }],
                location: elapsedTicks === undefined ? {} : { elapsedTicks },
            },
            config: { aiTier: 'pro' },
            write: { updateContext: () => undefined, addMessage: () => undefined },
        },
    };
}

describe('arc tick — elapsed time', () => {
    afterEach(() => vi.restoreAllMocks());

    it('ships at a 1:1 ratio with the agency tick budget', () => {
        // The shared currency. If this changes, the numbers in the plan's tuning
        // table no longer describe what the engine does.
        expect(ARC_TIMESKIP_TICK_RATIO).toBe(1);
    });

    // 0.0 → a nat 1 tempo roll, which always misses: one roll per run and no outcome
    // roll, so the call count is exactly the number of runs. Counting with an
    // always-firing roll instead would conflate runs with the arc resolving early.
    const ALWAYS_MISS = 0.0;

    it('rolls exactly once on an ordinary turn', async () => {
        const rollSpy = vi.spyOn(Math, 'random').mockReturnValue(ALWAYS_MISS);
        const { ctx } = makeCtx(0, [mockArc()]);
        await arcCompute(ctx);
        expect(rollSpy).toHaveBeenCalledTimes(1);
    });

    it('treats a missing elapsedTicks exactly like zero', async () => {
        // An older host, or any non-skip path, must not change arc behaviour.
        const rollSpy = vi.spyOn(Math, 'random').mockReturnValue(ALWAYS_MISS);
        const { ctx } = makeCtx(undefined, [mockArc()]);
        await arcCompute(ctx);
        expect(rollSpy).toHaveBeenCalledTimes(1);
    });

    it('runs one extra tick per elapsed tick', async () => {
        const rollSpy = vi.spyOn(Math, 'random').mockReturnValue(ALWAYS_MISS);
        const { ctx } = makeCtx(6, [mockArc()]);
        await arcCompute(ctx);
        expect(rollSpy).toHaveBeenCalledTimes(1 + 6);
    });

    it('stops spending the budget once every arc has resolved', async () => {
        // 0.999 fires every roll, so a 5-rung ladder boils over after two runs and
        // the remaining runs find nothing active. A long skip must not keep rolling
        // against resolved arcs.
        const rollSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
        const { ctx } = makeCtx(10, [mockArc({ currentRung: 0 })]);
        await arcCompute(ctx);
        expect(rollSpy.mock.calls.length).toBeLessThan((1 + 10) * 2);
    });

    it('carries the arc forward across the extra ticks rather than re-rolling the same state', async () => {
        // The point of the loop: a long skip should move an arc up its ladder, not
        // advance it once and discard the rest.
        vi.spyOn(Math, 'random').mockReturnValue(0.999);
        const { ctx, written } = makeCtx(4, [mockArc({ currentRung: 0 })]);
        await arcCompute(ctx);
        const finalArcs = written[written.length - 1];
        expect(finalArcs[0].currentRung).toBeGreaterThan(0);
    });

    it('ignores a negative or fractional elapsedTicks', async () => {
        const rollSpy = vi.spyOn(Math, 'random').mockReturnValue(ALWAYS_MISS);
        const { ctx } = makeCtx(-5, [mockArc()]);
        await arcCompute(ctx);
        expect(rollSpy).toHaveBeenCalledTimes(1);
    });

    it('does nothing when there are no arcs, however long the skip', async () => {
        const rollSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
        const { ctx, written } = makeCtx(10, []);
        await arcCompute(ctx);
        expect(rollSpy).not.toHaveBeenCalled();
        expect(written).toHaveLength(0);
    });
});
