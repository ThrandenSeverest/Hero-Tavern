# Hero Tavern — ComfyUI & storage safety (2026-10-13)

## Scope and rollout status

Implemented in `main` as an **optional external local ComfyUI integration**, not an automatic ComfyUI installer. Hero Tavern does not install PyTorch, download ComfyUI dependencies, or ship a new image checkpoint with the EXE. A running ComfyUI server must be available at `http://127.0.0.1:8188`. Verify and select its installed checkpoint inside **Image Studio → Image engine**.

The adapter uses ComfyUI core nodes and REST API endpoints: `/system_stats`, `/models/checkpoints`, `/prompt`, `/history/{id}`, `/view`, `/upload/image`, `/queue`, `/interrupt`, `/free`. Hero Tavern deliberately does not terminate an independently started ComfyUI process. The generated image and metadata are copied into the existing `Images/` gallery. Native ComfyUI output remains in ComfyUI's own output directory; source and mask uploads remain in ComfyUI's input directory (no unverified external deletions). `Logs/image-files.jsonl` reports transfer paths and local output sizes.

## Use ComfyUI

1. Install/run ComfyUI separately on localhost, port 8188, using a CUDA-supported environment compatible with your GPU; refer to upstream release notes for hardware-dependent details.
2. Make at least one compatible SD 1.5 or SDXL **complete checkpoint** available to ComfyUI. You can configure ComfyUI extra model paths to reference Hero Tavern's existing `ImageModels/` instead of copying multi-gigabyte checkpoints. Check the ComfyUI configuration format in your installed version. Existing GGUF text models are **not** interchangeable with diffusion checkpoints.
3. Go to **Image Studio** → **Check ComfyUI connection**. Choose `Auto` (ComfyUI first, fallback to KoboldCpp when ComfyUI is unreachable) or `ComfyUI only`. Pick an installed checkpoint and press **Save engine selection**.
4. Generate normally. Select **Edit an existing image**, choose a gallery PNG, click **Load image**, paint the red mask region, and describe only what should change. The workflow encodes and regenerates the masked area, composites that region over the original image, and saves a **new** PNG. Unpainted original pixels are retained exactly; soft feathering is not currently provided.
5. **Unload ComfyUI models from RAM/VRAM** calls ComfyUI's `/free` endpoint after user confirmation. It does not delete model files. Release GPU text models is a separate setting. It may temporarily affect other users of the same ComfyUI process.

**Auto-selection behavior:** ComfyUI is chosen if the local service is reachable and a checkpoint has been selected; otherwise the existing KoboldCpp engine is used. A masked editing request must use ComfyUI and will error rather than silently regenerate the whole picture. No fallback from a failed **in-progress** ComfyUI job is attempted: this avoids an unintended duplicate job or overwriting source art.

## Disk-leak mitigation

Old behavior used `taskkill /F` for managed text/image/planning KoboldCpp processes on Windows. This can leave repeated multi-gigabyte PyInstaller `%TEMP%\_MEI...` extractions. The new code:

- Starts all three KoboldCpp roles with `--singleinstance`, requests supported local `POST /api/extra/shutdown` first, and uses a bounded emergency fallback only after a failed graceful shutdown. This must be validated against the actual bundled binary, including SD mode.
- Uses scoped child-process `TEMP`/`TMP` under `Cache/KoboldCpp/{text,image,thinking}` to separate its extraction directories from other apps.
- On launcher shutdown, requests the bridge's authenticated loopback `/launcher/shutdown` and allows a grace period for all three workers to exit.
- In **Storage**, lists own expired, verified `_MEI\d+` extraction directories only. Cleanup is explicit and refused if a managed engine is running or Windows still has any `koboldcpp.exe` process. Folders must be at least 15 minutes old, live in one of the app's three scoped runtime directories, contain specific KoboldCpp DLLs, and contain no symlink/junction.
- Provides read-only reports of global `%TEMP%\_MEI...` candidate sizes and NVIDIA `DXCache`; those **are not automatically deleted**. The existing separate confirmed npm-clean button remains. `Models`, `ImageModels`, `Images`, `SillyTavern/data`, `Story`, memories, saves, and `.part` downloads are protected.

**Do not equate a successful cleanup click with a repaired disk leak.** Compare free space before/after, verify process exits, and perform the stress cycles listed below. Existing global `_MEI` folders cannot reliably be assigned to Hero Tavern solely by filename/DLL signatures, so the UI does not offer reckless bulk deletion.

## Where things go

| Content | Location | Delete automatically? |
|---|---|---|
| Generated and edited PNG + JSON | `%LOCALAPPDATA%\Hero-Tavern\Images` | No |
| Downloaded diffusion checkpoints | `%LOCALAPPDATA%\Hero-Tavern\ImageModels` | No |
| Text models (GGUF) | `%LOCALAPPDATA%\Hero-Tavern\Models` | No |
| ComfyUI source + mask upload copies | ComfyUI's own `input` directory | No |
| ComfyUI's native rendered outputs | ComfyUI's own `output` directory | No |
| Scoped KoboldCpp temporary extraction | `%LOCALAPPDATA%\Hero-Tavern\Cache\KoboldCpp\{text,image,thinking}` | Only confirmed aged leftovers, on request |
| Legacy PyInstaller leftovers | `%TEMP%\_MEI...` | Inventory only |
| Comfy file transfer audit | `%LOCALAPPDATA%\Hero-Tavern\Logs\image-files.jsonl` | Rotated when it exceeds 4 MiB |
| Diagnostics and engine logs | `%LOCALAPPDATA%\Hero-Tavern\Diagnostics`, `Logs` | Managed according to their existing policies |

## Windows acceptance checklist (still required for release verification)

- Run `node --test tests/comfy.test.cjs tests/studio.test.cjs tests/images.test.cjs tests/storage-gallery.test.cjs` on the CI runner.
- Test ComfyUI auto mode with service on/off, installed/missing checkpoint, txt2img, mask edits, cancellation while queued/running, and GPU unload.
- Test output not overwriting source and unmasked pixels being identical in the saved PNG. Confirm two-generation gallery provenance and correct image file paths.
- Perform at least ten text engine restarts and ten text→ComfyUI/KoboldCpp→text transitions with free-space checkpoints; check processes and `Cache/KoboldCpp` after each cycle and after closing the launcher.
- Verify emergency fallback logs distinguish forced termination from graceful exit, and validate the selected KoboldCpp build supports `--singleinstance` plus shutdown for all roles.
- Check the packaged EXE contains `ComfyAdapter.cjs`, `EngineShutdown.cjs`, and `EngineRuntime.cjs`. Validate preservation of all user data on upgrade.
- Only mark complete when Windows end-to-end checks and a fresh GitHub Actions installer artifact succeed. Code commit alone does **not** prove an installable executable.

## Known limitations / follow-up

1. ComfyUI must be installed/running separately; no auto-install or downloadable model catalog for this engine yet.
2. The editor currently supports hand-painted raster PNG masks; selection tools, undo brush strokes, feathering and image-to-image reference workflows are later refinements.
3. ComfyUI owns its input/output files; they are listed in audit metadata, not silently erased by Hero Tavern.
4. Live GPU/VRAM utilization is not a guarantee of coexisting model availability. Use sequential GPU release for a 12 GB VRAM card.
5. The global NVIDIA DXCache remains protected pending a separate explicit action and safe per-driver procedure.
