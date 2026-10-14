# ComfyUI integration audit (2026-10-14)

Hero Tavern runs against a local ComfyUI server. The **ComfyUI Workflows** tab has two distinct surfaces: the native ComfyUI node editor (the source of truth for graph editing and custom nodes) and Hero Tavern's saved API graph runner. The native editor can be opened in a separate window if the embedded frame is blocked. Completed SaveImage jobs can be imported into the Hero Tavern gallery.

| Capability | Current route | Remaining gap |
| --- | --- | --- |
| One-click LoRA in Image Studio | Visible compatible SDXL and FLUX.2 Klein shelf; three slots; per-slot model/CLIP strength; recorded trigger words applied after optional prompt refinement | LoRAs for Qwen and Z-Image require family-specific workflow validation. Native editor supports arbitrary compatible loaders. |
| Install local/Civitai LoRA | LoRA Library in Models & Setup; safetensors inspection, model-family assignment and editable trigger words | External ComfyUI installations must point Hero Tavern at their actual models folder; manually copied LoRAs with unknown metadata need family assignment. |
| Graph editing and native workflow JSON | Full native ComfyUI editor in Workflows tab/window | Hero Tavern does not serialize the canvas or expose custom node controls independently of the native editor. |
| Custom nodes | Native editor and its Manager on the connected ComfyUI runtime; optional reviewed custom nodes in API runner | Hero Tavern does not install arbitrary Python custom-node code or dependencies itself. Missing nodes must be installed in the same ComfyUI runtime and restarted. |
| API workflow import | Separate saved graph runner accepts API JSON, editable literal inputs and placeholders | Native JSON is loaded in the full editor; API runner has a 180-node / 220 KB limit and requires SaveImage. It does not preserve UI canvas layout. |
| Images and progress | Local gallery, native completed output import, job progress and cancellation | Arbitrary custom node output types beyond SaveImage are not gallery media. |
| Models, refiner, upscaler, inpainting | Built-in recipe paths for supported packs; gallery references | Arbitrary mixed-model pipelines and custom node parameters are composed in the native editor. |

These are not claims of universal ComfyUI feature parity. A custom node may execute Python code in ComfyUI, so the API runner requires explicit acknowledgement for unlisted classes; the full editor follows ComfyUI's own node management.
