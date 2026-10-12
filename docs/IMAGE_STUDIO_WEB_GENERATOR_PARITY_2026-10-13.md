# HERO TAVERN — Image Studio / ComfyUI: web-generator parity phase

**Date:** 2026-10-13  
**Branch:** `main`  
**Environment:** Windows 10/11, RTX 5070 12 GB VRAM, 32 GB system RAM  
**Status:** Source implementation + unit tests; real ComfyUI / Windows installer smoke tests not yet verified.

## Product goal

Allow a user to generate, refine, compare, batch, save and reuse results **without switching to a commercial web UI** for normal creation work. Avoid per-image cloud costs, extra model copies, opaque storage and uncontrolled process restarts. It is not technically possible to guarantee output quality matches every commercial generator solely by implementing UI: that depends on actual installed weights, prompt conditioning, workflow, sampling and hardware.

## Features landed in source

| User workflow | Hero Tavern implementation |
|---|---|
| Prompt + style + negative prompt + formats | Existing Image Studio presets, editable sampling, optional text-model prompt refiner |
| Local engine preference | Auto, ComfyUI, KoboldCpp; explicit KoboldCpp choice respected |
| High-quality model families | Standard SD 1.5 / SDXL checkpoint graphs; reviewed API JSON workflow library for multipiece model stacks |
| LoRA | ComfyUI discovery and two selectable LoRAs in UI, up to three in API; strength controls |
| Precise scene composition | 2–6 character independent area conditionings via ComfyUI core nodes |
| Reference / img2img | Import PNG/JPEG/WebP into local PNG gallery; select it as a reference; denoise slider |
| Inpainting | Draw mask with brush, undo, eraser; exact source compositing outside edited regions; save separately |
| Batch variations | 1, 2, 4 images; each is saved with provenance; thumbnails and full gallery |
| Upscale | Built-in Lanczos resizer or installed ComfyUI AI upscaler model |
| Saved output | Images as PNG, sidecar metadata including seed/engine/source/LoRA; favorites, search, reuse, compare before/after |
| Live feedback | WebSocket sampling steps, percentage and approximate remaining time; no invented numeric progress if missing |
| Source retention | No source overwritten; gallery provides edit/compare/upscale/reuse shortcuts |
| Plugin workflows | Local import, list, select, delete API workflow. Guarded: size/node limits, no URL/absolute-path fields, dangerous command nodes rejected; nonstandard nodes require explicit permission |
| Storage safety | Low free-disk warning/block, no automatic deletion of ComfyUI inputs/outputs or pretrained weights, auditable file paths, isolated KoboldCpp runtime temp, optional confirmed cache cleanup |

## How to use latest models

**Ordinary SDXL:** select a compatible `.safetensors` checkpoint in Image Studio, optionally attach compatible LoRAs. Does not need a custom graph.

**FLUX.2 Klein 4B** and **Z-Image Turbo:** these are *not* standalone SDXL checkpoints. Install the required diffusion model, text encoder and VAE in ComfyUI according to the verified, published model workflow. Use the ComfyUI workflow editor to export the **API-format** JSON, then import into Hero Tavern under **Modern ComfyUI workflows**. Replacing graph input values with exact placeholders `{{prompt}}`, `{{negative}}`, `{{seed}}`, `{{steps}}`, `{{width}}`, `{{height}}`, `{{guidance}}`, `{{source}}`, `{{mask}}` lets Hero Tavern dynamically fill them. Without placeholders, stored workflow values run as originally configured. Custom-node workflows need explicit review/permission.

- Official FLUX.2 Klein 4B guide: https://docs.comfy.org/tutorials/flux/flux-2-klein
- Official ComfyUI Z-Image Turbo files and layout: https://huggingface.co/Comfy-Org/z_image_turbo
- ComfyUI Z-Image examples: https://comfyanonymous.github.io/ComfyUI_examples/z_image/

**12 GB VRAM strategy:** use 1024-ish px, batch 1 for heavyweight SDXL/FLUX; generate variants serially or use lower resolution and upscale if the model causes OOM. Keep sequential text→image loading enabled where appropriate. Qwen Image 2.1 and full-model stacks can have larger CPU/RAM and disk requirements. Do not silently download 15–30 GB of model packages or duplicate them: show sizes first and let the user decide.

## Files and cache

| Purpose | Default path |
|---|---|
| Image models downloaded by Hero Tavern | `%LOCALAPPDATA%\Hero-Tavern\ImageModels` |
| Generated, imported and edited PNG + JSON | `%LOCALAPPDATA%\Hero-Tavern\Images` |
| Imported API graphs (never autodeleted) | `%LOCALAPPDATA%\Hero-Tavern\ImageWorkflows` |
| File audit log, bounded size | `%LOCALAPPDATA%\Hero-Tavern\Logs\image-files.jsonl` |
| Managed KoboldCpp unpacking temp | `%LOCALAPPDATA%\Hero-Tavern\Cache\KoboldCpp\{text,image,thinking}` |
| External ComfyUI uploads and outputs | ComfyUI's own `input` / `output` trees, configurable separately; Hero Tavern never deletes them |
| NVIDIA DXCache, legacy shared Windows TEMP | Read-only inventory; explicit intervention only |

**Important:** each generated image is persisted in Hero Tavern *and* ComfyUI output. Uploaded image/mask copies also remain in ComfyUI input. This is deliberate ownership protection, but it can increase disk usage. Future work: opt-in deletion of precisely identified owned ComfyUI staging assets, never a blanket purge.

## Compatibility matrix and unimplemented work

| Target | Current | Required next |
|---|---|---|
| Text and single-shot generation | Implemented in source | Windows end-to-end inference |
| Better model quality | External FLUX/Z-Image API workflows supported as imported graphs | Tested install/runtime recipes, curated models with license + checksum, no duplicate downloads |
| Multi-character accuracy | Core-region conditioning | Reference-based character locking and fine-grained region masks |
| Pro canvas | Inpaint mask, erase, undo, before/after | Canvas expansion (outpaint), rectangle/lasso, layer transforms, soft feather radius, live previews |
| Local workflow library | Guarded import and parameter substitution | Guided model-specific one-click templates after verified testing |
| GPU/RAM budgets | Sequential model release, explicit unload, runtime storage monitoring | Measured memory predictor and automatic batch-size adjustment on RTX 5070 |
| Inference throughput | WebSocket progress / ETA | Queue pause/resume and genuine thumbnail previews, per-model benchmarks |
| Reliability | CI unit tests and syntax check | Real ComfyUI integration tests, 10+ model switches and disk before/after measurements, Windows EXE artifact |

## Verification required before claiming release

1. On Windows, start installed ComfyUI at `127.0.0.1:8188`, test `GET /system_stats`, `GET /models/checkpoints`, `GET /models/loras` and `GET /models/upscale_models`.
2. Test plain SDXL, with LoRA and without; TXT/IMG2IMG/inpaint; 1/2/4 variants; upscale model (if installed); an imported FLUX Klein and Z-Image API graph.
3. Verify unpainted source areas are unchanged in pixel comparisons, that img2img changes the full canvas only when selected, and that cancel stops only the Hero Tavern prompt without interrupting unrelated ComfyUI jobs.
4. Run interrupted/failed ComfyUI tasks to verify exact errors, no false completion and no duplicate outputs. Test when ComfyUI disconnects and when the chosen model is unavailable.
5. Compare disk free space, `Images`, `ImageWorkflows`, `Logs`, KoboldCpp `_MEI`, and ComfyUI external input/output before/after 10 consecutive jobs and close cycles.
6. Run `node --test tests/comfy.test.cjs tests/comfy-advanced.test.cjs tests/comfy-workflow-library.test.cjs tests/studio.test.cjs tests/storage-gallery.test.cjs tests/engine-runtime.test.cjs`.
7. Confirm installer contains `ComfyAdapter.cjs`, `ComfyWorkflows.cjs`, `ComfyWorkflowLibrary.cjs`, `EngineRuntime.cjs`, `EngineShutdown.cjs` and the updated HTML. Verify EXE from successful GitHub Actions Windows build, not only commits.
8. Never erase `Models`, `ImageModels`, `Images`, `ImageWorkflows`, characters, chats, saves, `.env`, or partial downloads for storage cleanup.

Research:
- ComfyUI server routes: https://github.com/Comfy-Org/ComfyUI/blob/master/server.py
- ComfyUI official FLUX 2 Klein guide: https://docs.comfy.org/tutorials/flux/flux-2-klein
- ComfyUI official Z-Image Turbo model tree: https://huggingface.co/Comfy-Org/z_image_turbo
- Leonardo AI canvas and editor: https://intercom.help/leonardo-ai/en/articles/8093145-how-to-use-canvas-editor-tool
