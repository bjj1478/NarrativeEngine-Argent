import type { ConditionProposal, PlayerCharacter } from '../../types';

/**
 * Commit a staged {@link ConditionProposal} onto the player character.
 *
 * Deliberately a service, not a closure inside the banner component. Its inventory sibling
 * (`applyInventoryProposal` in InventoryStagingBar.tsx) is a component-local function that
 * nothing imports and no test covers; this one is separated so the four cases below can be
 * asserted directly.
 *
 * Writes through `updatePlayerCharacter` with ONLY the keys the proposal actually names —
 * the same single-key-patch rule the background tracks follow. The trait scan and the PC
 * drift check run concurrently in the background queue against this same record, and a
 * whole-record write from here would clobber whatever they had just written.
 *
 * Returns a short human summary for the toast, or null when the proposal named nothing.
 */
export function applyConditionProposal(
    proposal: ConditionProposal,
    updatePlayerCharacter: (patch: Partial<PlayerCharacter>) => void,
): string | null {
    const patch: Partial<PlayerCharacter> = {};
    const notes: string[] = [];

    // `undefined` means the proposal did not mention the injury; the empty string means it
    // explicitly cleared one. Only the former should be skipped, which is why this tests
    // for undefined rather than for truthiness.
    if (proposal.condition !== undefined) {
        patch.condition = proposal.condition;
        notes.push(proposal.condition ? `Condition: ${proposal.condition}` : 'Condition cleared');
    }

    if (proposal.status !== undefined) {
        patch.status = proposal.status;
        notes.push(`Status: ${proposal.status}`);
    }

    if (Object.keys(patch).length === 0) return null;

    updatePlayerCharacter(patch);
    return notes.join(' · ');
}
