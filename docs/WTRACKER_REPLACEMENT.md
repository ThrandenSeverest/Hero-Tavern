# Tracker replacement

Source: https://github.com/bmen25124/SillyTavern-WTracker
Pinned revision: `8a5e42e6cbea0b63ca0fb92b5ce52ec4a399012c` (MIT).

This is a Hero Tavern adaptation, not the unmodified browser extension. The upstream JSON parser and schema-example generator are reused, and its complete-schema / previous-snapshot / recent-dialogue generation lifecycle is adapted to the existing local KoboldCpp pipeline. Original upstream source is retained in `docs/upstream/wtracker/`; the MIT notice ships inside the Windows installer.

Removed: `TrackerDelta.cjs`, UPDATE-line and changes/operations protocols, copied UUID/quote requirements, numeric-delta approval gates, pending-change UI, old live tracker controls and old tracker-only protocol tests. StoryState now contains only shared conversation/lore helpers and exports the new adapter. Chat IDs, story routes and native JSONL storage remain the integration boundary; they are not the retired extractor.

The new engine requests complete typed JSON snapshots in batches of four fields, with native `json_schema` and KoboldCpp's JSON-schema-as-grammar payload. Missing/malformed fields fail the job without committing any batch. Chat/schema edits invalidate in-flight results. Manual corrections on the current turn win. Saved results follow swipes, edits, branches, recovery and restart, and feed subsequent reply context. Fields are visible in the chat strip and editable in the new Trackers panel. The AI designer and character templates use the new definitions.

Existing installations reset old tracker fields and state once when loading a session. Native chat text, lore, memories and saved stories are preserved. New presets can be added to rebuild desired fields. The installer removes the retired application module; it does not delete user model or chat files.

## Validation

- 247 Node tests passed in a serial run (parallel execution exposed one unrelated transient image-test port collision; it passed when rerun).
- 16 replacement-specific tests cover schema transport through the actual Mistral ReplyPipeline, complete snapshots, malformed output, all-or-nothing batches, manual edits, reload persistence, retry, changed chats/schemas and unanswered turns.
- DOM integration with the actual StoryAPI and StoryStore passed for update, render, manual correction, safe text rendering, presets, custom fields, AI designer and deletion.
- Updated full SillyTavern/Chromium smoke test and Windows packaging manifests. Local Chromium execution was blocked by a truncated browser-download response; no successful Chromium run is claimed.
- No live GPU/Rocinante inference was available here. Schema constraints enforce structure, not factual model accuracy. This requires validation on the user's installed model.

The new D&D Adventure combat engine and Writer manuscript engine are separate from the removed character-chat tracker extractor and were not replaced by this change.
