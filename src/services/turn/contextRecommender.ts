/**
 * contextRecommender.ts
 * ---------------------
 * LLM-powered context selection — replaces substring matching when a utilityAI endpoint is configured.
 * Sends the NPC ledger headers + lore chunk headers + recent history excerpt to a cheap/local model,
 * which returns JSON arrays of relevant NPC names and lore IDs.
 *
 * Falls back silently on any error (caller handles fallback to substring scan).
 */

import type { EndpointConfig, NPCEntry, LoreChunk, ChatMessage, ArchiveChapter } from '../../types';
import { llmCall } from '../../utils/llmCall';
import { AI_CALL_TIMEOUT_MS } from '../llm/timeouts';
import { extractJsonRobust } from '../infrastructure/jsonExtract';
import type { ModelRequest, ModelResponse } from './hostFacade';

// The recommender used to also pick which inventory categories and character-sheet
// fields to inject. Both are gone: the sheet no longer exists, and the PC block now
// renders the whole (bounded) inventory rather than paying a blocking utility round
// trip each turn to choose between categories. NPCs and lore are what it is for.
export type RecommenderResult = {
    relevantNPCNames: string[];   // NPC names the model considers relevant
    relevantLoreIds: string[];    // Lore chunk IDs the model considers relevant
};

/**
 * Build a compact roster string from the NPC ledger.
 * Only sends name + faction + status — enough for the model to judge relevance
 * without blowing up the prompt.
 */
function buildNPCRoster(ledger: NPCEntry[]): string {
    if (ledger.length === 0) return 'No NPCs in ledger.';
    return ledger.map(npc => {
        const parts = [npc.name];
        if (npc.aliases) parts.push(`(aka ${npc.aliases})`);
        if (npc.faction) parts.push(`[${npc.faction}]`);
        if (npc.status) parts.push(`— ${npc.status}`);
        return parts.join(' ');
    }).join('\n');
}

/**
 * Build a compact lore index from chunks.
 * Sends id + category + header + summary for relevance judgment.
 */
function buildLoreIndex(chunks: LoreChunk[]): string {
    if (chunks.length === 0) return 'No lore chunks available.';
    return chunks
        .filter(c => !c.alwaysInclude) // alwaysInclude chunks don't need recommendation
        .map(c => {
            const sum = c.summary ? ` — ${c.summary}` : '';
            return `- ID:${c.id} | ${c.category} | ${c.header}${sum}`;
        }).join('\n');
}

/**
 * Extract a concise conversation excerpt from recent messages.
 * Takes the last N messages and truncates long ones.
 */
function buildConversationExcerpt(messages: ChatMessage[], userMessage: string, depth: number = 6): string {
    const recent = messages.slice(-depth);
    const lines = recent.map(m => {
        const role = m.role === 'user' ? 'PLAYER' : m.role === 'assistant' ? 'GM' : m.role.toUpperCase();
        const text = (m.content || '').slice(0, 300);
        return `[${role}]: ${text}`;
    });
    lines.push(`[PLAYER]: ${userMessage.slice(0, 300)}`);
    return lines.join('\n\n');
}

function buildPinnedChapterContext(chapters: ArchiveChapter[]): string {
    return chapters.map(ch => {
        const parts = [`[${ch.chapterId}] ${ch.title} (Scenes ${ch.sceneRange[0]}–${ch.sceneRange[1]})`];
        if (ch.summary) parts.push(`  Summary: ${ch.summary.slice(0, 200)}`);
        if (ch.npcs.length > 0) parts.push(`  NPCs: ${ch.npcs.join(', ')}`);
        if (ch.keywords.length > 0) parts.push(`  Keywords: ${ch.keywords.slice(0, 10).join(', ')}`);
        if (ch.majorEvents.length > 0) parts.push(`  Events: ${ch.majorEvents.slice(0, 3).join('; ')}`);
        return parts.join('\n');
    }).join('\n\n');
}

const RECOMMENDER_PROMPT = `You are a context selector for a tabletop RPG game engine. Given a conversation excerpt, a roster of NPCs, and lore entries, determine which items are RELEVANT to the current scene.

RULES:
1. An NPC is relevant if they are: mentioned by name/alias, physically present in the scene, directly referenced, or their faction/goals are materially involved.
2. A lore entry is relevant if: its subject matter relates to the current location, active quest, mentioned organizations, or ongoing conflict.
3. DM-PINNED CHAPTERS are manually flagged as important by the DM. Strongly favor NPCs and lore entries mentioned in pinned chapters.
4. Be SELECTIVE — only include truly relevant entries.
5. Return ONLY valid JSON in exactly this format, no other text:

{"npcs": ["Name1"], "lore": ["id1"]}

If nothing is relevant, return: {"npcs": [], "lore": []}`;

/**
 * Calls the utility AI endpoint to determine which NPCs and lore chunks
 * are relevant to the current conversation context.
 *
 * @throws on network/API errors — caller MUST catch and fall back to substring scan.
 */
export async function recommendContext(
    utilityEndpoint: EndpointConfig | undefined,
    npcLedger: NPCEntry[],
    loreChunks: LoreChunk[],
    messages: ChatMessage[],
    userMessage: string,
    signal?: AbortSignal,
    pinnedChapters?: ArchiveChapter[],
    timeoutMs?: number,
    modelCall?: (request: ModelRequest) => Promise<ModelResponse>
): Promise<RecommenderResult> {
    const npcRoster = buildNPCRoster(npcLedger);
    const loreIndex = buildLoreIndex(loreChunks);
    const conversation = buildConversationExcerpt(messages, userMessage);

    const pinnedSection = (pinnedChapters && pinnedChapters.length > 0)
        ? `\n[DM-PINNED CHAPTERS — manually selected as relevant]\n${buildPinnedChapterContext(pinnedChapters)}\n`
        : '';

    const userContent = `${RECOMMENDER_PROMPT}\n\n[NPC ROSTER — ${npcLedger.length} characters]\n${npcRoster}\n\n[LORE INDEX — ${loreChunks.filter(c => !c.alwaysInclude).length} entries]\n${loreIndex}\n${pinnedSection}[RECENT CONVERSATION]\n${conversation}\n\nRespond with the JSON object now:`;

    console.log(`[ContextRecommender] Sending recommendation request...`);

    // High priority — story AI cannot start until this returns. Tracked so it shows in
    // the UtilityCallStrip (otherwise this is an invisible blocking call during gather).
    const rawContent = modelCall
        ? (await modelCall({ prompt: userContent, temperature: 0.1, signal, priority: 'high', trackingLabel: 'context-recommender', timeoutMs: timeoutMs ?? AI_CALL_TIMEOUT_MS })).content
        : utilityEndpoint
            ? await llmCall(utilityEndpoint, userContent, { temperature: 0.1, signal, priority: 'high', trackingLabel: 'context-recommender', timeoutMs: timeoutMs ?? AI_CALL_TIMEOUT_MS })
            : '';

    // Parse the JSON response — handle thinker blocks and markdown wrapping
    type RecommenderRaw = { npcs?: unknown; lore?: unknown };
    const { value: parsed, parseOk } = extractJsonRobust<RecommenderRaw>(rawContent, {});
    if (!parseOk) {
        console.warn('[ContextRecommender] Failed to find JSON in response:', rawContent.slice(0, 200));
        throw new Error('No valid JSON in recommender response');
    }

    const result: RecommenderResult = {
        relevantNPCNames: Array.isArray(parsed.npcs) ? parsed.npcs.filter((n: unknown) => typeof n === 'string') : [],
        relevantLoreIds: Array.isArray(parsed.lore) ? parsed.lore.filter((n: unknown) => typeof n === 'string') : [],
    };

    console.log(`[ContextRecommender] Recommended ${result.relevantNPCNames.length} NPCs, ${result.relevantLoreIds.length} lore entries.`);

    return result;
}
