# Writer, managed image engines, and live injuries

Implemented 2026-10-13. Install this build over the existing Hero Tavern installation, then restart the application; an older running bridge cannot serve new modules.

## Models

Image models now appear in the main Models library alongside the text model library. The image setup page reuses that same controller. **Install engine + model** performs runtime setup, model and dependency downloads, engine startup and workflow readiness checks as one background job. Progress, cancellation and errors remain visible. FLUX, Z-Image and SDXL share global, Tavern and Adventure choices. An already installed managed engine starts automatically when generation needs it.

The official Windows ComfyUI Portable installation still requires substantial disk space and downloads. No installation begins until the user invokes the install action. The managed installer retrieves a pinned, SHA-256 checked 7zr executable if a system 7-Zip installation is absent; installing a separate system archive utility is no longer required. 7-Zip is copyright Igor Pavlov, licensed under GNU LGPL (with applicable upstream restrictions); source and license are available at https://www.7-zip.org/ and https://github.com/ip7z/7zip.

The automated checks establish files and workflow-node visibility, not that GPU inference works on every CUDA driver. Use image diagnostics to validate generation on the actual PC. This change has unit coverage for engine/model setup orchestration; downloading all CUDA packages and models and running them on an RTX 5070 is outside the Linux test environment.

## Health and injury records

The Health & Injuries preset now consists of an overall condition tracker plus a separate structured injury ledger. It tracks any number of explicit injuries rather than assuming a shoulder wound. Each injury has a stable ID, location, origin, severity, pain (0–10), symptoms, functional limitations, treatment, status, and scar details. Confirmed events update it automatically after finalized messages. Healed and scarred wounds stay in history; bandaging is not healing. The ledger is injected into subsequent replies, displayed in chat and editable through form fields in the tracker panel. The AI designer understands the new injuries type.

Existing legacy definitions and their event histories remain intact. A missing ledger is added when an enabled legacy Health & Injuries preset is analyzed. It starts empty at that point; legacy information is still injected through the original trackers. State proposals require message evidence, and deleted/edited/swiped messages invalidate downstream effects as before. Complex medical progression still depends on the local model interpreting events correctly; unsupported or malformed updates preserve previous state and report errors.

## Writer v1

Open **Writer** in the left navigation. It is a separate continuous manuscript editor using the selected local text model, not a character-chat view.

Available: Continue, caret insertion, selection rewrite, candidate preview, Retry from the unchanged anchor, alternative candidates, explicit Accept/Reject, native text Undo/Redo, autosave and crash recovery, conflict detection, revision restore, independent story branches, Memory, Author’s Note, keyword or always-active lore, Writer-only sampling presets, measured token-budget context inspection, story/text export and import, adjustable font size, focus view and page theme.

Writer saves are isolated under the application’s `Writer/stories` directory. Manuscripts never replace SillyTavern chats or Adventure saves. Restores preserve the later draft as a revision. The most recent 100 save revisions are retained. The editor keeps an unsaved local recovery checkpoint until a successful save. Reloading an older conflicting checkpoint offers an export rather than overwriting a newer story. Generation uses per-story settings and does not overwrite global chat sampling.

This is the implemented first version of the attached NovelAI-style specification, not complete NovelAI feature or model-quality parity. Chapter outlines, paragraph provenance, scene summaries, advanced phrase biases, global lore linking, illustrations, and token-by-token streaming remain future work. Generation currently displays a truthful busy state and buffered candidate output. Retry is available while reviewing unaccepted candidates; accepted generations can be revisited through revision history.

Regression coverage includes manuscript persistence/branching/conflicts/import history, lore and context budgeting, isolated inference settings, injury progression/rollback/evidence, setup orchestration, and installer resource manifests. Windows CI additionally tests Writer through the real SillyTavern browser shell before compiling the EXE.
