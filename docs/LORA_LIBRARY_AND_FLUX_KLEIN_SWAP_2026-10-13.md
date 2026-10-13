# Image Studio: LoRA Library + FLUX.2 Klein Swap Lab (2026-10-13)

## Included implementation
- One LoRA library under Image Studio's editing tools, scoped to the active ComfyUI `models/loras` path.
- Import local `.safetensors` using bounded 1 MiB browser chunks, 2 GiB maximum and safetensors header validation.
- Detect architecture via training metadata where available. Unknown models remain unavailable until the user assigns a family.
- Support SDXL / SD1.5, FLUX.1, FLUX.2 Klein **4B** versus **9B** (not interchangeable), Qwen Image / Qwen Image 2.1, Z-Image.
- Check compatibility before passing selected LoRAs to ComfyUI, not just visually hiding list entries.
- SDXL and FLUX.2 Klein 4B workflows can use matching LoRAs; other families are inventoried but require tested family-specific loader graphs before enabling generation.
- Civitai browsing supports keywords, sorting, base-model filters, SFW search, model-page links, one-click confirmed download and optional API key.
- Downloads use version metadata, the selected safetensors file, a local file-size limit and upstream SHA-256 when provided. Password/API key is not persisted.
- Current Civitai API family names may change. No inference is made from a filename when version metadata explicitly conflicts with the selected model.
- Editing: FLUX Swap Lab supplies a target gallery image and painted region, a donor gallery reference, and face/outfit/object/material prompts. Original target is preserved.

## Uploaded upstream ZIP inspection
User attachment `flux2KleinSwapAnytingFace_v10.zip` includes a 42-node **ComfyUI UI-format** JSON called `Flux2 Klein SwapAnything CIVIT V1.2  Sam3.json`. This is not a LoRA checkpoint, and is not directly executable as an API prompt. It contains custom nodes including SAM3, rgthree and other helper nodes; it references a 9B FP8 UNet and non-standard input loaders. The built-in **4B Swap Lab is a compatible adapted workflow**, not a claim of exact parity with the original 9B/SAM3 JSON. The 9B ZIP remains a separate advanced workflow requiring porting of all custom nodes and new model dependency checks.

## Safety and deployment
- No automatic internet downloads except after explicit Install confirmation.
- Unknown/incompatible LoRAs fail closed. Filenames may be detected incorrectly; users can explicitly override family and should double-check architecture.
- LoRA and source images are never deleted when generating edited copies.
- Existing images from the original 9B workflow can still be used as references.
- Run Windows CI and actual NVIDIA 12GB ComfyUI inference before considering this production-validated.
