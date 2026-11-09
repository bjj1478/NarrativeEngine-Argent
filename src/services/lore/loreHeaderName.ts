/**
 * One place to turn a lore chunk header into the entity's display name.
 *
 * `loreChunker` emits headers in every dialect the lore format has ever used, because the
 * header is just the Markdown heading the author wrote:
 *
 *   `FACTION -- The Aes Sedai of the White Tower`   <- current `lore_template.md` format
 *   `LOCATION — Baerlon`                            <- same, with an em dash
 *   `[CHUNK: FACTION] The Crimson Hand — A Syndicate`  <- the old bracketed marker
 *   `Harbor District`                               <- a bare name, no type at all
 *
 * All four must yield the name alone. `loreNPCParser` and `loreLocationParser` each grew
 * their own correct copy of this; `loreEngineSeeder` grew an incorrect one that only ever
 * handled the bracketed dialect, so every `TYPE -- Name` header seeded the literal type
 * token ("FACTION", "LOCATION") into the World Event pools. This is the shared version.
 *
 * Known limitation, inherited deliberately so all call sites agree: an ALL-CAPS *name*
 * followed by a dash is indistinguishable from a type prefix, so
 * `THE RED HAND — Western Cell` resolves to `Western Cell`. Mixed-case names are unaffected.
 */

/** The old `[CHUNK: TYPE]` marker, with or without trailing dashes inside the bracket. */
const CHUNK_MARKER = /\[CHUNK:\s*[A-Z_]+[—\-\s]*\]/i;

/** A leading `TYPE -- ` marker. Checked first: `--` is the template's canonical separator. */
const TYPE_PREFIX_DOUBLE_DASH = /^[A-Z][A-Z_\s]*--\s*(.+)/;

/** A leading `TYPE — ` / `TYPE – ` marker (em / en dash). */
const TYPE_PREFIX_DASH = /^[A-Z][A-Z_\s]*[—–]\s*(.+)/;

/**
 * The entity name a lore chunk header refers to, with any `[CHUNK: TYPE]` marker and any
 * `TYPE -- ` / `TYPE — ` prefix removed. Headers with no type marker are returned as-is,
 * except that a trailing `— epithet` is dropped (`Cao Cao — The Tyrant` -> `Cao Cao`).
 *
 * The fallback splits on em / en dash ONLY, never the plain hyphen, so hyphenated names
 * such as `Jean-Luc Picard` survive.
 */
export function chunkHeaderName(header: string): string {
    const stripped = (header || '').replace(CHUNK_MARKER, '').trim();

    const doubleDash = stripped.match(TYPE_PREFIX_DOUBLE_DASH);
    if (doubleDash) return doubleDash[1].trim();

    const dash = stripped.match(TYPE_PREFIX_DASH);
    if (dash) return dash[1].trim();

    return stripped.split(/[—–]/)[0].trim();
}
