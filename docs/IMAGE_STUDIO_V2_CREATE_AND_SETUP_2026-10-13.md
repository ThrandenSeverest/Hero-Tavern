# Image Studio v2 — Create vs. Models & Setup

## Fixed user failure

Previously the Generate button was disabled whenever the **legacy KoboldCpp ImageModels checkpoint** was not selected, even if FLUX.2 Klein or Z-Image Turbo was installed in ComfyUI. The same screen mixed a multi-file ComfyUI model hub with a separate single-file checkpoint browser, making the selected engine unclear.

## New navigation

**Image Studio · Create** is the image-making screen:
- First, choose the actual model from one selector: FLUX.2 Klein 4B, Z-Image Turbo, ComfyUI SDXL, classic KoboldCpp, or an imported custom workflow.
- The selected model has an availability indicator showing ready, downloaded but not seen by ComfyUI, missing components, or the needed SDXL checkpoint.
- The image prompt, canvas format, Generate, live progress, result previews and gallery are immediately visible, with no install/download cards interfering.
- Reference editing, inpainting, LoRAs, outpainting, upscale, scene composition and preset editing remain accessible under a collapsed **Editing tools, scene composer and advanced options** section.
- Generate is not disabled by missing legacy checkpoints when FLUX, Z-Image or SDXL through ComfyUI is selected; clicking it either generates or gives an actionable error near the button.

**Models & Setup** contains:
- ComfyUI Portable install/start/stop and connection health.
- FLUX/Z-Image pack downloads, required model components, installed model directories and disk download progress.
- ComfyUI SDXL checkpoint selection, GPU model unloading, custom workflow import.
- Legacy KoboldCpp-only checkpoints and their separate download/load/delete actions (explicitly marked legacy).

## Model routing contract

| Create choice | Engine | Needs legacy ImageModels selection? | Needs ComfyUI `checkpoints` file? |
|---|---|---|---|
| FLUX.2 Klein 4B | ComfyUI | No | No; needs diffusion_models + text_encoders + vae |
| Z-Image Turbo | ComfyUI | No | No; needs diffusion_models + text_encoders + vae |
| SDXL | ComfyUI | No | Yes |
| KoboldCpp classic | KoboldCpp | Yes | No |
| Custom API workflow | ComfyUI | No | Only if the custom graph itself uses checkpoints |

Both creation controls and model downloads share the `modelPack` identifier and explicitly route to the chosen engine. For modern ComfyUI models, backend selection overrides stale KoboldCpp preferences saved before downloading FLUX. The imported API workflow no longer silently overrides a named model unless **Custom workflow** is selected.

Downloaded vs. ready states are separate: locally downloaded components may be invisible to a different running ComfyUI installation. In that case the UI instructs the user to check the active folder or restart ComfyUI, rather than trying to download the same large weights twice.

FLUX also accepts existing `flux-2-klein-4b-fp8.safetensors` names and nested folders. The workflow passes ComfyUI's **actual visible filename**, avoiding unnecessary rename or repeat downloads. The official Comfy-Org source was corrected to its canonical split-model tree:
https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-4b

## QA

- Added a Studio regression proving FLUX/Z-Image ignore an old KoboldCpp engine preference.
- Extended the ComfyUI mock to submit a real FLUX workflow with an empty checkpoint argument and assert `UNETLoader` and `Flux2Scheduler` are used instead of `CheckpointLoaderSimple`.
- Added FP8/nested-model-file recognition test.
- Updated the browser smoke flow to verify distinct tabs, model choices, and an enabled Generate button with a loaded classic image checkpoint.
- Existing source images, saved generations, LoRAs, ComfyUI model weights, text models, user data and settings are retained. No cleanup or automatic redownload.

**Verification limit:** Successful CI checks test source logic, mocked ComfyUI and browser layout; they do not prove that every downloaded large model or graphics driver combination will generate successfully until tested on the target RTX 5070. When ComfyUI itself fails, the error should appear beside Generate and in its normal engine log.
