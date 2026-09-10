import type { EndpointConfig, ProviderConfig } from '../../types';
import type { OpenAIMessage } from '../llm/llmService';
import { sendMessage } from '../llm/llmService';
import { extractJson } from '../infrastructure/jsonExtract';

/**
 * AI-powered tag population for Surprise & World engines.
 * Sends current tags + world lore to the AI, returns 3-12 contextually relevant tags.
 */
export async function populateEngineTags(
    provider: EndpointConfig | ProviderConfig,
    worldLore: string,
    currentTags: string[],
    field: 'surpriseTypes' | 'surpriseTones' | 'encounterTypes' | 'encounterTones' | 'worldWho' | 'worldWhere' | 'worldWhy' | 'worldWhat'
): Promise<string[]> {
    const fieldDescriptions: Record<typeof field, string> = {
        surpriseTypes: 'surprise event TYPES (e.g. WEATHER_SHIFT, ODD_SOUND, NPC_QUIRK). These are categories of unexpected ambient flavor events.',
        surpriseTones: 'surprise event TONES (e.g. CURIOUS, EERIE, AMUSING). These describe the emotional flavor of the surprise.',
        encounterTypes: 'encounter event TYPES (e.g. AMBUSH, RIVAL_APPEARANCE, RESOURCE_CRISIS). These are mid-stakes challenges or hooks requiring immediate player response.',
        encounterTones: 'encounter event TONES (e.g. TENSE, DESPERATE, MYSTERIOUS). These describe the emotional flavor of the encounter.',
        worldWho: '"Who" elements for world events — the actors/instigators, as bare NOUN PHRASES (e.g. "a rogue splinter group", "a powerful leader").',
        worldWhere: '"Where" elements for world events — the locations, as PREPOSITIONAL PHRASES starting with in/at/across/along/beneath (e.g. "in a neighboring city", "deep underground").',
        worldWhy: '"Why" elements for world events — the motivations, as a "to …" or "because …" CLAUSE (e.g. "to seize power", "for brutal vengeance").',
        worldWhat: '"What" elements for world events — the actions taken, as PAST-TENSE VERB PHRASES (e.g. "declared open hostilities", "formed an unexpected alliance").',
    };

    // The four world fields are concatenated verbatim into one sentence, so a tag that
    // dangles a preposition ("leaked a memo about") or repeats one ("…agreed to" + "to
    // seize power") breaks the emitted line. Spell the shape out for the model.
    const WORLD_FIELDS = ['worldWho', 'worldWhere', 'worldWhy', 'worldWhat'];
    const grammarRule = WORLD_FIELDS.includes(field)
        ? `\n- These tags are joined verbatim into one sentence: "[WORLD_EVENT: {who} {what} {why} {where}]" — e.g. "a major faction declared open hostilities to seize power in a neighboring city". Each tag must slot into that sentence and read as grammatical English. Never end a tag with a dangling preposition (to, of, about, on, for, near, at).`
        : '';

    const prompt = `You are a Campaign Tag Generator. Your job is to analyze the provided WORLD LORE and CURRENT TAGS, then generate contextually appropriate tags that fit this specific campaign's theme, factions, locations, and tone.

[FIELD TO GENERATE]
${fieldDescriptions[field]}

[CURRENT TAGS — Use as reference for format and style]
${currentTags.join(', ')}

[WORLD LORE — Use to make tags thematically relevant]
${worldLore.slice(0, 24000)}

RULES:
- Generate MINIMUM 3 and MAXIMUM 12 tags.
- Tags must be thematically appropriate for this specific campaign world.
- Keep the same format style as the current tags (uppercase for surprise types/tones, descriptive phrases for world engine).${grammarRule}
- Do NOT repeat any current tags verbatim — generate NEW ones inspired by the lore.
- RESPOND ONLY WITH A VALID JSON ARRAY OF STRINGS. No markdown, no explanation.

Example output: ["TAG_ONE", "TAG_TWO", "TAG_THREE"]`;

    const messages: OpenAIMessage[] = [
        { role: 'user', content: prompt }
    ];

    let fullJsonStr = '';

    await sendMessage(
        provider,
        messages,
        (chunk) => { fullJsonStr = chunk; },
        () => { },
        (err) => console.error('[Tag Populator] Error:', err)
    );

    if (fullJsonStr) {
        const cleanStr = extractJson(fullJsonStr);
        try {
            const parsed = JSON.parse(cleanStr);
            if (Array.isArray(parsed) && parsed.length >= 3 && parsed.every((t: unknown) => typeof t === 'string')) {
                console.log(`[Tag Populator] Generated ${parsed.length} tags for ${field}:`, parsed);
                return parsed.slice(0, 12);
            }
        } catch (e) {
            console.error('[Tag Populator] Failed to parse JSON:', e, '\nRaw:', cleanStr);
        }
    }

    return currentTags; // Fallback to current tags if generation fails
}
