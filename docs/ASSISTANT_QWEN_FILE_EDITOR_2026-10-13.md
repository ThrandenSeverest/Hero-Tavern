# Assistant mode — ordinary GPT-style Qwen helper

**Hero Tavern, 2026-10-13 · new source feature in branch main**

## User workflow

Open the new **Ассистент** mode from the left navigation, independently from Tavern chat and Ilreon Adventure. Choose **Загрузить Qwen3 8B Abliterated**. The installed Q4_K_M GGUF is reused; if it is not present, download it from the existing Model library (no automatic duplicate download). Switching unloads the currently active RP model before loading Qwen in the shared local KoboldCpp, so two 12 GB GPU-consuming text workers are not started simultaneously. Existing character chats remain intact; switch the RP model back from Model library when needed.

### Conversation options

- **Fast**: ordinary local Qwen conversational answer, no roleplay system text.
- **Think**: Qwen3 /think prompt switch with up to 3000 output tokens; hidden reasoning is removed from displayed answer. The model may still exhaust its budget on reasoning, so there is a non-thinking recovery retry.
- **Deep Think**: an additional separate short planning/verification pass before the final answer. It is a local two-pass workflow, not a cloud research service, and does not expose internal reasoning.
- **Web search**: optional Brave Search API over HTTPS. Disabled until user checks the toggle and provides a personal key in this browser tab. The key is not stored in config, exported files, chat messages or sidecars. Queries are sent to Brave only when explicitly requested. Five HTTPS results with snippets and URLs can be used as cited sources, with clickable source links retained in the chat. The assistant does not browse full pages or use open internet when disabled.

Brave web search docs: https://api-dashboard.search.brave.com/app/documentation/web-search

### Text file workflow

1. Select an existing .txt, .md, .json, .js, .ts, .yaml, .csv, .html, .py and similar plain text file in the browser's file chooser (max 300 KiB). **A new local copy** is imported into `AssistantWorkspace/Files`, with no permission to read arbitrary filesystem paths.
2. Optionally attach the selected workspace document as local context in a normal chat question, or use the dedicated **Предложить исправления** button with a detailed instruction. File context is not included in the outbound Brave query.
3. For edits, Qwen must supply a complete delimited revised file; a partial, empty or malformed output is rejected. JSON proposals are parsed for syntax before a draft can be applied. Current full-file rewrite limit is 12,500 characters (longer imports may be read/managed but cannot be automatically rewritten in one generation).
4. Compare original/proposed text in side-by-side fields and a changed-region preview. **Apply** requires explicit user confirmation and saves the previous revision under `AssistantWorkspace/Backups/`. Revision restore is separately confirmed.
5. Use **Скачать рабочий файл** to save the updated copy via the browser, with the original filename. The external source file on disk is never overwritten by Hero Tavern.

## Privacy and resource control

- Standalone assistant history saved only in `AssistantWorkspace/chats.json`; neither RP chat data nor Adventure state are modified.
- No command/shell execution or arbitrary file read/write tool is granted to the model. Imported file content and search snippets are treated as untrusted input, not commands.
- No web requests unless web toggle and an API key are supplied; file text itself is never sent to Brave.
- Deep Think uses sequential local calls to the existing Qwen model, without spawning a second KoboldCpp worker.
- The disk monitor includes assistant chat and workspace files. Generated drafts are not written to the final document until the user approves them.
- The app's normal `/generation/abort` and Assistant Cancel are separate. The Assistant interface calls its own cancellation endpoint.

## Verification / limitations

Code and installer resource lists have been updated. Regression tests are in `tests/assistant.test.cjs` and registered in the Windows workflow.

- Verify compiled EXE resource extraction of `AssistantWorkspace.cjs` and `AssistantPanel.js` and the visible left-navigation tab in real SillyTavern UI.
- Test Qwen installed/not installed, RP model unload and Qwen reload, cancellations while generating, RP inference blocked during assistant work, saved session retrieval.
- Test import + draft + confirmation + version restoration, browser download and preserved original file, including Markdown, JSON and HTML with special tags.
- Test Brave key absent, invalid, normal, and rate-limited; confirm returned citations and no key/file contents in saved history or logs.
- Run `node --test tests/assistant.test.cjs` plus the existing CI suite on Windows. This write-up does **not** claim the new EXE or real GPU inference is verified until Actions passes.
- Deep Think is two local passes, not web-scale reasoning, full-page retrieval, a coding agent or automated access to files throughout the disk.

Official Qwen3 thinking switch documentation: https://qwen.readthedocs.io/en/latest/getting_started/quickstart.html
