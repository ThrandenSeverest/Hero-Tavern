# Hero Tavern

A unified local AI application built on **SillyTavern**, with a Hero Tavern navigation shell, embedded model/hardware controls and a managed **KoboldCpp** engine. The default is **Qwen3 8B Abliterated Q4_K_M**.

This is the first development version: the setup executable is built by GitHub Actions. Full installation and generation on a Windows PC still need a smoke test before a stable release.

## Install

1. Download this repository with **Code → Download ZIP**, then extract it.
2. Double-click **Install.cmd**. It installs portable Node.js, SillyTavern and KoboldCpp without administrator rights, Git or Python.
3. Setup opens **Hero Tavern / SillyTavern immediately**, even with no model installed.
4. Click **Hero Tavern · Models** in the bottom-right corner. In the embedded panel, click **Download Qwen default** once.
5. The approximately **5.03 GB** file downloads with progress, resume and SHA-256 verification. The first selected model starts in the background after verification. Hero Tavern automatically switches the chat to Text Completion / KoboldCpp at port 5001 and connects it through Hero Tavern’s local reply pipeline, including for existing profiles that previously used KoboldAI Classic.

On subsequent runs, use the **Hero Tavern** desktop shortcut. The chat UI opens first; a previously selected model loads in the background.

Alternatively, open [Actions](https://github.com/ThrandenSeverest/Hero-Tavern/actions/workflows/build-windows.yml), select a successful run and download `Hero-Tavern-Setup-Windows-x64`. Extract and run `Hero-Tavern-Setup.exe`. Artifact downloads require a GitHub login.

The launcher starts SillyTavern and the local model service, then opens your browser without waiting for a model. Keep its window open; press Enter there to stop the servers. The Models panel provides downloads, installed-model selection, progress and Start AI / Stop AI controls. Custom Hugging Face links, model deletion, CPU/CUDA/Vulkan settings and engine diagnostics are handled in this same UI.

## Included behavior

- Shared installation folder: `%LOCALAPPDATA%\Hero-Tavern`.
- Built-in Models panel in SillyTavern with one-button default Qwen downloads, additional Qwen quantizations and installed-model selection.
- Hero Tavern navigation, welcome dashboard and automatic local API connection for both fresh and existing profiles.
- Embedded hardware settings and engine logs; the Windows manager remains only as a standalone fallback.
- Download progress, cancellation, resume, free-space checks and automatic model selection.
- GGUF header and version checks, exact size checks when metadata exists, SHA-256 verification. The default model has a fixed published checksum.
- Fresh Qwen ChatML profile with non-thinking assistant prefix and local KoboldCpp endpoint.
- Repeat setup preserves chats, characters, settings and downloaded models. It repairs dependencies and launchers; it does not upgrade an existing SillyTavern or KoboldCpp installation.
- All services bind locally (SillyTavern 8000, model library 8001, KoboldCpp 5001). The launcher rejects busy ports and duplicate launches rather than terminating unrelated processes.
- Startup logs in `Logs`; installation log in `install.log`.

## Generation and reply filters

Open **Generation** in the left navigation. Presets and editable controls cover creativity/temperature, Top P, Min P, repetition penalty, reply length, planning budget, writing instructions and dialogue-only versus narration style.

- **Thinking disabled** is the default and requests a non-thinking Qwen reply.
- **Separate private planning** runs a planning pass, then generates the displayed reply from its private continuity outline. Choose **Use reply model** for sequential passes, or **Use separate loaded model** for an independently selected GGUF on port 5003. Save and load that planning model in Generation; CPU is its default to preserve GPU memory. Both models must fit available RAM / VRAM. Private planning is never stored as dialogue.
- Recognized thinking/analysis blocks are always stripped. Streaming engine output is buffered and cleaned before any text is sent to the chat, preventing partial thinking tags from flashing on screen.
- Optional filters remove model control tokens, stop accidental user/system turns, remove exact duplicated paragraphs and apply user-defined literal stop markers.
- Out-of-character writer announcements can trigger one corrective retry. This can be disabled; ordinary narration and character refusals are not treated as writer announcements.
- A preview lets you test cleanup on sample text without generating a reply. Existing recognized reasoning blocks are hidden in the display without deleting stored conversations.

The managed endpoint is `http://127.0.0.1:8001/inference`; Hero Tavern configures it automatically. KoboldCpp itself remains at port 5001. Direct connections to 5001 bypass this reply pipeline. Generation settings are saved in `generation.json` and apply to subsequent turns.

The filters recognize structural reasoning markers and common writer announcements; they cannot reliably identify every untagged sentence as model reasoning versus fictional narration. Reply-style instructions and the one-time repair pass address those cases without blindly deleting story actions.

## Hardware

Windows 10/11 **x64**, built-in Windows PowerShell 5.1 and `curl.exe` are required. Allow roughly **10 GB of free disk space** for software, dependencies, model and temporary archives. For the 8B model, **16 GB system RAM** is a practical starting point; memory use also depends on context and GPU offload. CPU mode is compatible but can be slow. Older CPUs without the instructions required by the normal KoboldCpp build may need its upstream `oldpc` variant, which this first installer does not select automatically.

Edit `%LOCALAPPDATA%\Hero-Tavern\backend.json` while the app is stopped:

```json
{"mode":"cpu","gpuLayers":0,"contextSize":4096}
```

For NVIDIA acceleration use `"mode":"cuda"`; for a supported Vulkan GPU use `"mode":"vulkan"`. Set `"gpuLayers":-1` for KoboldCpp autofit. Lower context or switch back to CPU if GPU memory is insufficient. You can also change these settings in **Hardware** inside Hero Tavern.

If you increase backend context, adjust SillyTavern's context setting too. When switching to a non-Qwen model, choose that model's appropriate instruction template in SillyTavern.

## Model source

Default: [richardyoung/Qwen3-8B-Abliterated-GGUF](https://huggingface.co/richardyoung/Qwen3-8B-Abliterated-GGUF), file `qwen3-8b-abliterated-Q4_K_M.gguf`, model-card license Apache-2.0.

Published file SHA-256:

```text
8625e48da4c4be9bcba2414fd8cad4095ff3a538d5b0111c2b26b5f6209538b9
```

Models live on your computer and are not committed to GitHub. Custom downloads check their available upstream metadata; when no hash is published, only GGUF/header and available size checks apply. Split multi-file GGUFs and gated/private repositories are not supported in this first version.

## Chat continuity and repeated replies

Hero Tavern sends the actual chronological chat to the local reply pipeline, including older turns that SillyTavern's own prompt builder may have omitted. It retains the system/character/world instructions and recent messages. When the loaded context fills, older turns become per-chat continuity notes under `Memories`, with token space reserved for instructions, planning and the reply. Editing, swiping or rolling back messages invalidates affected automatic summaries. No chat messages are deleted.

**Chat memory** shows automatic notes and the last request's context budget. Add editable pinned facts or rebuild the summary. **Generation** controls automatic memory, summary size, preferred recent-turn count and reply length. The recent-turn preference is best effort within the real context limit. If even the card plus newest turns cannot fit, an explicit error asks you to increase Hardware context or shorten the card. Tokenizer failures use conservative UTF-8 byte counting rather than an optimistic character estimate.

Repetition detection works with **thinking disabled**: a draft that closely copies a recent assistant reply or echoes the user gets one corrective retry. It also catches long repeated sentences within a draft. A repeated retry is hidden with an actionable error. Tune the threshold or disable this heuristic in Generation; short natural phrases are allowed. Sampling penalties remain configurable and the repetition range covers 1024 tokens. This is a text-similarity heuristic, not a guarantee against semantic repetition.

## Adventure, images and character studio

**Adventure** embeds the supplied Ilreon 1.5.4 simulator, using the same local text model and local image library. It retains game mechanics, character/save imports, quests, NPCs, combat and slots, with all 514 pinned spells bundled for offline use. Saves persist under `AdventureSaves`. See [Adventure instructions](adventure/README.md) and [source provenance](adventure/NOTICE.md).

**Images** downloads, verifies, selects and runs complete SD 1.5 / SDXL `.safetensors` checkpoints. A separate background KoboldCpp worker on loopback port 5002 lets image and text models change independently. Images and generation metadata persist under `Images`; checkpoints under `ImageModels`. Stop the image worker to free memory. CPU, CUDA or Vulkan follow Hardware settings when the image worker starts. Two simultaneously loaded models consume additional RAM / VRAM.

The practical general-purpose recommendation is [DreamShaper 8](https://huggingface.co/Lykon/DreamShaper/blob/main/DreamShaper_8_pruned.safetensors), a 2.13 GB checkpoint. [DreamShaper XL Turbo](https://huggingface.co/Lykon/DreamShaper/blob/main/DreamShaperXL_Turbo_dpmppSdeKarras_half_pruned_6.safetensors) is an optional 6.94 GB alternative with higher default resolution. The image pipeline adds no content classifier; these models still have their own model-card licence terms. “Unrestricted” is not a licence promise or a claim of universal model capability. Recommended checkpoint hashes are pinned; custom downloads verify available metadata and safetensors structure. Multi-file Flux / Qwen Image packages are not supported by this simple checkpoint importer.

Generate portraits or scenes, adjust prompt, negative prompt, dimensions, steps, guidance, sampler and seed, then download the image or add it to the selected chat. Ilreon NPC portraits use the same selected image model.

**Character studio** offers simple character fields and advanced JSON, AI drafts, isolated test replies and reviewed episode openings with starting state and persona constraints. Save edits to a selected native card, or export/import compatible V2 JSON. Portrait editing remains in native Characters.

## Qwen Assistant — ordinary GPT-style helper (October 2026)

Hero Tavern now has a separate **Ассистент** screen alongside Tavern and Adventure, using the existing local Qwen3 8B Abliterated GGUF. It has Fast, Think and two-pass Deep Think modes; editable conversations; and **opt-in Brave Search API** with user-supplied per-tab key and linked source snippets.

The assistant can import user-selected plain text files into an isolated workspace, propose an updated file with a side-by-side review and changed region, apply only after confirmation, save prior revisions, restore them and download the updated copy. It has **no unrestricted access** to local files or command execution. More details: [Assistant user guide](docs/ASSISTANT_QWEN_FILE_EDITOR_2026-10-13.md).

## Managed ComfyUI and simple model switching (October 2026)

**Image Studio → ComfyUI · model hub** now offers named local image models: SDXL / Stable Diffusion, FLUX.2 Klein 4B (including reference editing), and Z-Image Turbo (text-to-image). The app builds the corresponding ComfyUI core-node workflow internally; no node graph or API JSON import is needed for those built-in choices. Chat image generation also has the model picker.

Already-running ComfyUI on `127.0.0.1:8188` can be reused. Otherwise the UI can install official Windows NVIDIA ComfyUI Portable with explicit user confirmation, disk preflight, and 7-Zip or compatible Windows archive extraction; it can manage the process lifecycle afterward. On-demand startup occurs after the GPU text engine unloads to preserve 12 GB VRAM. A separate managed model hub checks installed components, downloads missing weights from official Hugging Face packages with size/SHA-256 verification and resume, and keeps all downloaded user assets.

See [managed ComfyUI guide](docs/MANAGED_COMFYUI_ONE_CLICK_2026-10-13.md). **Actual Windows inference, downloadable installer build, and long-cycle VRAM/disk acceptance testing remain unverified** until CI and on-device smoke tests pass. New source commits alone are not a validated EXE.

## Development

Our launcher and integration code are MIT licensed. Upstream components retain their licenses; see [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

`Install.cmd` and the compiled bootstrap package the same published scripts. CI parses every PowerShell script with Windows PowerShell, tests PowerShell 5.1 catalog/dropdown behavior, model verification/path restrictions, UI startup without a model and profile preservation and tests a real child-process engine fixture, then runs a Chromium integration test against upstream SillyTavern. The browser test reproduces a stale Classic/5000 profile, verifies automatic connection to the filtered proxy at 8001/inference and routes a generation request through SillyTavern. The fixture test validates integration, not model quality or real GGUF inference. CI then compiles the executable from embedded source resources.

Local profile test:

```sh
node --test tests/configure.test.cjs tests/bridge.test.cjs tests/reply.test.cjs tests/context.test.cjs tests/images.test.cjs tests/adventure.test.cjs tests/story.test.cjs tests/thinking.test.cjs
```

Windows model validation test:

```powershell
./tests/ModelTools.Tests.ps1
```

See [ROADMAP.md](ROADMAP.md) for the next development steps.

## Sessions, trackers and lore (P0 / P1)

**Save & New Chat** preserves the original and offers Fresh Start, Continue in New Session with reviewed tracker/memory carryover, Duplicate and bookmarked branch starts. **History** searches native messages, opens, renames, archives and exports Markdown or portable family archives. Stable session/message IDs link branches. Message **Story actions** add bookmarks, branch, show state at that point or preview rollback. Restoring a session creates a recovery copy; Undo opens that preserved future. Archive import remaps IDs and copies available character cards/chat images without replacing originals.

**Trackers** has optional preset switches for injuries, appearance, relationships, inventory, secrets, time and quests. Add custom number, boolean, enum, text, list, relationship, timer or quest trackers using forms. Edit live values or review proposed changes; the AI helper drafts definitions for review. Automatic updates require source evidence and correct types/owners; major or ambiguous changes require approval. Invalid model JSON leaves dialogue and confirmed state untouched. Edits, deletion and swipes invalidate downstream changes; branches replay only their own evidence. Story-time timers change only from established/approved narrative time, not browser elapsed time. Time skip asks for an amount and unit, confirms matching timer reductions and preserves injuries. Edit behavior changes labels, instructions and update modes with a saved definition version; Creator view exposes hidden trackers for editing. Confirmed relevant state is inserted after memory; prompt inspection shows token budgets and activation reasons with private planning/hidden content masked.

**Lorebooks** supports entry text, keyword triggers, state comparisons (including relationship/quest fields), activation preview and an AI draft helper. Save/load reusable native World Info books. Hero-managed entries are disabled for native injection and activated through the story pipeline, so conditional secrets cannot also be injected unconditionally. Editing story lore changes that session; save the character template to reuse it in future openings. Ilreon continues to use its independent mechanics and saves.

Native JSONL and existing settings remain in SillyTavern. Versioned derived story data and recovery journals live under `Story`; generation filters, private model selection and memory have separate settings. New installations pin the tested SillyTavern commit; setup preserves existing installations. This version supports the local default-user profile. Multi-user server profiles and P2 multiplayer/immersion/branch merging are outside this scope.

## Prioritized model catalog and diagnostics

Rocinante-X 12B Q5/Q4 and Qwen3 14B Q4 now have verified one-click downloads. Cydonia/Magidonia 24B are optional RAM-offload experiments. Qwen 8B remains the baseline. Prompt formats are selected per model; custom files have an editable format. New installations use 8K context; existing installs can apply 8K and reload in Hardware.

**Diagnostics** tests isolated text generation, long-history compaction and image generation, checks engine connections, and exports reports. Welcome/settings panels can be closed with their buttons or Escape. Cancel reply also stops memory work. See [implementation and remaining work](docs/LOCAL_AI_IMPLEMENTATION.md) and [full supplied model specification](docs/LOCAL_AI_MODELS_SPEC.md).

## Hardware calibration and chat image studio (0.8)

Detailed diagnostics now retain failure causes, stages, launch arguments, VRAM/RAM, driver and logs. Local inference uses explicit timeouts instead of the hidden five-minute fetch header limit. Hardware offers actual KV-cache/Flash Attention/thread/batch controls and a local tuner with rollback. A detected RTX 5070 / 32 GB profile receives a first-run calibration; Hardware also provides manual tuning and cancellation.

Chat now has Generate image, and native SillyTavern image actions use the managed local provider. Images supports optional AI prompt refinement, natural-art/fantasy/photo/turbo presets and custom preset saving. The default sequential GPU workflow unloads text/planning models for the image job and restores them afterwards. SDXL Base is available as a verified download. See [performance and image studio guide](docs/PERFORMANCE_AND_IMAGE_STUDIO.md).
