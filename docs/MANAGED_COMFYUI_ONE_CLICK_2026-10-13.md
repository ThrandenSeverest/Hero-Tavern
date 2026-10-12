# Managed ComfyUI: one-click FLUX, Z-Image and SDXL

**Hero Tavern, 2026-10-13 · main source integration**

## User workflow

1. Open Image Studio → ComfyUI model hub. Existing ComfyUI running at 127.0.0.1:8188 is detected and reused. Alternatively approve installing official ComfyUI Portable, or point the app to an existing Portable folder. Managed Portable starts on demand for an advanced image generation.
2. Select SDXL / Stable Diffusion, FLUX.2 Klein 4B or Z-Image Turbo by name. Hero Tavern scans every required ComfyUI model group and shows missing weights. No manual workflow is necessary for these presets.
3. If missing, click Download missing model files and confirm the approximately 16.3 GiB FLUX or 10.6 GiB Z-Image pack. Files stream from official Hugging Face repositories to their correct ComfyUI subfolders; size and LFS SHA-256 are verified before atomic promotion. Partial files are retained for resume.
4. Click Use selected image model, then Generate image. Chat generation also offers this model selector. For existing images, FLUX supports reference editing and painted masks; SDXL supports img2img, inpainting and outpainting. Z-Image Turbo's built-in recipe currently supports text-to-image only.

## Model presets and workflows

| Model | Automatic ComfyUI workflow | Components | Notes |
| --- | --- | --- | --- |
| SDXL | Existing checkpoint graph, LoRA, masking, regional conditioning | Selected SDXL checkpoint | Reuses Hero Tavern's ImageModels directory when using its owned Portable runtime |
| FLUX.2 Klein 4B | UNETLoader, CLIPLoader(type=flux2), VAELoader, Flux2Scheduler, EmptyFlux2LatentImage; ReferenceLatent for edits | flux-2-klein-4b.safetensors + qwen_3_4b.safetensors + flux2-vae.safetensors | About 16.3 GiB; runtime VRAM varies |
| Z-Image Turbo | UNETLoader, CLIPLoader(type=lumina2), ModelSamplingAuraFlow, KSampler | z_image_turbo_nvfp4.safetensors + qwen_3_4b_fp8_mixed.safetensors + ae.safetensors | About 10.6 GiB; modern ComfyUI/CUDA and Nvidia model support needed |
| Custom API workflow | Existing guarded API JSON import / parameter placeholders | User-selected compatible multi-component models | Advanced mode only |

Official documentation:
- https://docs.comfy.org/tutorials/flux/flux-2-klein
- https://docs.comfy.org/tutorials/image/z-image/z-image-turbo
- https://huggingface.co/Comfy-Org/z_image_turbo
- https://github.com/Comfy-Org/ComfyUI
- https://github.com/Comfy-Org/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia.7z

## Runtime, data and disk

- Portable installation requires explicit confirmation and enough disk space. Extraction uses installed 7-Zip or Windows tar when that version can validate the 7z archive. Existing installations are preserved. Managed stop affects only the app-owned ComfyUI process, never an externally running service.
- A managed Portable runtime is located under the installed Hero Tavern root in ComfyUI-Portable. Its own temporary files are located under Cache/ComfyUI. Image models are stored in ComfyUI/models; the app also registers its ImageModels library as shared checkpoints in extra_model_paths.yaml only if no existing config is present.
- Original and edited images plus sidecars live under Images. Saved API graphs live under ImageWorkflows. A bounded audit of transferred and saved files lives in Logs/image-files.jsonl.
- ComfyUI can keep duplicate input uploads and raw outputs under its own input/output trees. Storage displays these managed folders. There is no automatic deletion of external ComfyUI user data, checkpoints, LoRAs or history.
- A completed official ComfyUI .7z installer is eligible for the existing confirmed safe cleanup. Partial installer/model downloads remain protected.
- Model downloads require explicit consent, a disk-space preflight with free-space reserve, metadata-based verification, and resume support.

## Remaining acceptance checks (not yet verified)

1. Run tests/comfy.test.cjs, tests/comfy-advanced.test.cjs, tests/comfy-model-hub.test.cjs, tests/comfy-workflow-library.test.cjs and Windows packaging tests in GitHub Actions.
2. Test install, resume, cancel and unmanaged external ComfyUI preservation on actual Windows.
3. Generate through all three model families on a real RTX 5070 12 GB system. Verify ComfyUI core-node support (Flux2Scheduler, ModelSamplingAuraFlow, ReferenceLatent), model file paths, and reproducible seed.
4. Verify editing respects painted mask in final output, and unsupported Z-Image Turbo edit actions give an actionable error.
5. Measure ten repeated model switches, close/reopen cycles, peak GPU/RAM use, download cache, ComfyUI input/output and Hero Tavern Images folder growth.
6. Confirm a successful Windows installer artifact includes all new .cjs modules. A pushed code commit is not proof of a successful binary or inference.
