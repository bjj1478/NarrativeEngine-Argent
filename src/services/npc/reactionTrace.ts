import type { ReactionDiagnostics } from './reactionMenu';
import type { PersonalityHex, SceneStakes } from '../../types';

/**
 * Console trace for engine-built reaction menus, behind `settings.debugMode`.
 *
 * The payload trace already shows the REACTIONS line that reached the model, but not WHY that
 * line says what it says — which stakes were detected, which half of the table was in play,
 * what each entry scored, or which entries a trait gate refused and on what grounds. That is
 * the part you need when an NPC reacts in a way that looks wrong.
 *
 * Console-only on purpose: no ring buffer, no persistence, no UI surface to keep in sync. The
 * diagnostics come from `selectReactions` itself rather than being re-derived here, so what is
 * printed is what actually happened.
 */

const AXIS_ABBR: Array<[keyof PersonalityHex, string]> = [
    ['drive', 'dr'], ['diligence', 'di'], ['boldness', 'bo'],
    ['warmth', 'wa'], ['empathy', 'em'], ['composure', 'co'],
];

function fmtHex(hex: PersonalityHex | undefined): string {
    if (!hex) return 'no hex';
    return AXIS_ABBR.map(([axis, abbr]) => `${abbr}${hex[axis] >= 0 ? '+' : ''}${hex[axis]}`).join(' ');
}

/**
 * One collapsed group per NPC per turn. Grouped rather than flat because an active scene builds
 * a menu for every on-stage NPC and a flat dump buries the one you care about.
 */
export function logReactionSelection(
    diag: ReactionDiagnostics,
    stakes: SceneStakes | undefined,
    finalMenu: string[],
    traceLabel?: string,
): void {
    try {
        const label = [
            '[Reactions]',
            traceLabel ? `${traceLabel} ·` : '',
            diag.npcName,
            `· stakes=${stakes ?? 'calm(default)'} -> [${diag.contexts.join(', ')}]`,
            `· ${finalMenu.length} surfaced of ${diag.scored.length} eligible`,
            diag.matureMode ? '· mature ON' : '',
        ].filter(Boolean).join(' ');

        console.groupCollapsed(label);
        console.debug('hex     ', fmtHex(diag.hex));
        console.debug('traits  ', diag.traits.length > 0 ? diag.traits.join(', ') : '(none)');
        console.debug('pcRel   ', diag.pcRel);

        // The menu the model was actually handed. Repression can rewrite an entry after
        // scoring, so this is `finalMenu`, not the pre-repression pick.
        console.debug('MENU    ', finalMenu.length > 0 ? finalMenu.join('  |  ') : '(empty — line omitted)');

        if (diag.scored.length > 0) {
            console.debug('scored (highest first, ✓ = surfaced):');
            for (const s of diag.scored) {
                console.debug(
                    `   ${s.surfaced ? '✓' : ' '} ${String(s.score).padStart(4)}  ${s.text}` +
                    `   [${s.context}${s.tier === 'mature' ? '/mature' : ''}]`,
                );
            }
        }

        // The load-bearing half of the trace: an NPC reacting wrongly is usually an NPC whose
        // right reaction was refused by a gate, and the reason names which rule did it.
        if (diag.excluded.length > 0) {
            console.debug(`gated out (${diag.excluded.length}):`);
            for (const e of diag.excluded) console.debug(`     ${e.text}  <-  ${e.reason}`);
        }
        console.groupEnd();
    } catch {
        // Never let a diagnostic break a turn.
    }
}
