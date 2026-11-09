import type { LoreChunk, CharacterIntroEntry } from '../../types';
import { chunkHeaderName } from './loreHeaderName';

/**
 * Character Intro Flags -> the NPC Appearance Engine's candidate pool.
 *
 * `lore_template.md` has documented three optional lines on a CHARACTER block since the
 * format was written, but nothing on desktop ever read them, so the pool could only be
 * filled by hand in Context Drawer -> Engines, one NPC at a time:
 *
 *   **Wandering: true**                    -> eligible anywhere in the world
 *   **Location: Baerlon**                  -> eligible only when the party is there
 *   **Intro Boost: holy, oath, undead**    -> 3x draw weight when one of these words
 *                                             appears in the last 3 GM replies
 *
 * A character with none of the three stays out of the pool: they appear only when the GM
 * introduces them. `Wandering` and `Location` are mutually exclusive because
 * `CharacterIntroEntry['type']` is a two-value union; `Location` wins if a file sets both,
 * being the more specific claim.
 *
 * Both bold dialects are accepted, since lore files in the wild use each:
 *   `**Wandering: true**`  (label and value inside the bold)
 *   `**Wandering:** true`  (value outside)
 */

/** [value-inside-the-bold, value-after-the-bold] for each flag. */
const WANDERING = [/\*\*Wandering:\s*([^*\n]+?)\s*\*\*/i, /\*\*Wandering:\*\*\s*(.+)/i] as const;
const LOCATION = [/\*\*Location:\s*([^*\n]+?)\s*\*\*/i, /\*\*Location:\*\*\s*(.+)/i] as const;
const INTRO_BOOST = [/\*\*Intro Boost:\s*([^*\n]+?)\s*\*\*/i, /\*\*Intro Boost:\*\*\s*(.+)/i] as const;

/** First pattern that matches wins; '' when the flag is absent. */
function field(body: string, patterns: readonly RegExp[]): string {
    for (const pattern of patterns) {
        const m = body.match(pattern);
        if (m) return m[1].trim();
    }
    return '';
}

/** `[a, b, c]` and `a, b, c` both become `['a','b','c']`. */
function list(raw: string): string[] {
    return unbracket(raw).split(',').map(v => v.trim()).filter(Boolean);
}

/** `[Place Name]` -> `Place Name`. The template's placeholders are bracketed. */
function unbracket(raw: string): string {
    return raw.replace(/^\[/, '').replace(/\]$/, '').trim();
}

const TRUTHY = new Set(['true', 'yes', 'y', '1']);

/**
 * Builds the intro pool from every `character` chunk carrying at least one intro flag.
 * Deduped by name, case-insensitively, first occurrence winning.
 */
export function parseIntroFlagsFromLore(chunks: LoreChunk[]): CharacterIntroEntry[] {
    const entries: CharacterIntroEntry[] = [];
    const seen = new Set<string>();

    for (const chunk of chunks) {
        if (chunk.category !== 'character') continue;

        const name = chunkHeaderName(chunk.header);
        if (!name || seen.has(name.toLowerCase())) continue;

        const body = chunk.content;
        const wandering = TRUTHY.has(field(body, WANDERING).toLowerCase());
        const location = unbracket(field(body, LOCATION));
        const boostKeywords = list(field(body, INTRO_BOOST));

        if (!wandering && !location) continue;

        const entry: CharacterIntroEntry = location
            ? { name, type: 'location', location }
            : { name, type: 'wandering' };
        if (boostKeywords.length > 0) entry.boostKeywords = boostKeywords;

        entries.push(entry);
        seen.add(name.toLowerCase());
    }

    return entries;
}
