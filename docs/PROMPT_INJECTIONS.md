# Prompt injections

Open **Injection Modifier** in the chat sidebar, beside Gallery. Toggle cards directly in the sidebar, or choose **Edit injections** to open the side editor while keeping chat visible. Changes save automatically for the current campaign.

- **Message at depth:** choose System, User or Assistant. Depth 0 follows the latest conversational message; depth 1 precedes it. Deeper positions count back through retained player/narrator messages. Leading context and tool exchanges are excluded from the count.
- **Order:** use the up/down buttons. Card order breaks ties at one depth.
- **Triggers:** replies/retries, swipes and scene continues can be selected independently. Empty, disabled and unselected cards are not sent.
- **Assistant prefill:** places text at the end as an assistant prefix.
- **Reasoning prefill:** places an unfinished `<think>` prefix followed by your text. This is prompt text, not access to private model reasoning. Prefill behavior depends on the chosen model/backend.
- **Preview:** an illustrative conversation using the same placement logic as the outgoing request, before provider conversion. Actual history is context-fitted.
- **Claude/Gemini:** native APIs move system messages into a separate system field. In-chat System injections are therefore sent as labeled User messages to preserve their position.

Cards are stored in campaign context and travel with campaign saves/backups/exports. Switching AI presets does not change them; switching campaigns loads a separate list. Deleting a card can be undone within the editor; undo is cleared when switching campaigns. Legacy preset injections are never applied automatically. If any exist, **Copy from old preset injections** can copy them into the current campaign without changing the original.

Injections are applied at the streaming request boundary for story generation only, never written into chat history or cached swipe payloads. Context assembly reserves space for enabled cards. If a changed injection overflows an older cached request, shorten the injection or start a new turn to refit history. Tool call/result pairs remain intact; background utility calls are unaffected.
