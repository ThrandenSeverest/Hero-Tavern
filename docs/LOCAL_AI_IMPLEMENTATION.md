# Hero Tavern: local models, UI recovery and diagnostic tests

Updated 12 October 2026. Target: personal local use on RTX 5070 12 GB / 32 GB RAM.

## Implemented now

- Welcome has an explicit Close button, stays dismissed, and disappears when opening character/model/world controls. Escape closes Hero panels and story dialogs. Embedded settings have Back to chat.
- Independent private planning and final response models remain supported. Only final cleaned text is displayed.
- Model catalog includes Rocinante-X 12B v1b Q5_K_M (8,727,634,208 bytes), its Q4_K_M variant (7,477,207,328 bytes), Qwen3 14B Q4_K_M (9,001,752,960 bytes), and experimental Cydonia/Magidonia 24B Q4_K_M (about 14.3 GB each). Existing Qwen 8B baseline and small Qwen alternatives remain available.
- New entries pin author-repository revisions, exact filenames, sizes and SHA-256 in `manager/models.json`. The Magidonia repository actually names its file `Cydonia-24B-v4zk-Q4_K_M.gguf`; the UI explains this instead of inventing a download filename.
- Models exposes size, source/licence link, prompt format, revision, checksum, target context, offload note and a sampling preset. Download is an explicit user action. Weights are not bundled in setup.
- Canonical messages stay in ChatML inside the memory/state pipeline. Before token counting and inference, the selected model's serializer converts them: Qwen ChatML, Rocinante Mistral v3 without SYSTEM_PROMPT, or Mistral v7 for Cydonia/Magidonia. Stop tokens change with the format. Custom GGUFs have a manual format selector. Planning and reply models use their own profiles.
- Fresh installations start with an 8,192-token context. Existing hardware choices are preserved. Hardware provides **Apply 8K context and reload AI**, retaining compute mode/offload. Context and reply/planning reserves are visible. Do not confuse the model's advertised maximum with the context actually loaded by the engine.
- Older history is compacted within the loaded context; the newest turns stay verbatim. A summary pass can now process all older turns that fit instead of always stopping at eight. The summary input reserves framing and output space. Cancellation works during memory updates and final inference.
- **Diagnostics** checks text/image connections, runs an isolated text test, adds 0–100 synthetic history turns to test context compaction, runs a seeded image test and shows the image. It reports success/error, model/template, token counts, context, elapsed time and end-to-end throughput. Export a JSON report; latest reports persist under `Diagnostics`. Text tests do not append messages to any character chat. Synthetic memory is separate from real chat memory.

## Using the new models

1. Models → Download Rocinante Q5. Use Rocinante Q4 when more memory headroom is needed. Qwen3 14B is the Russian/instruction comparison candidate.
2. Hardware → choose CPU/CUDA/Vulkan and GPU layers appropriate for the machine; start with 8K. CUDA compatibility depends on the installed KoboldCpp/driver build. No automatic hardware recommendation is claimed.
3. Select the downloaded model and Load model. Its catalog prompt format is automatic; use the manual selector for custom files. Sampling presets apply only when you click their button.
4. Diagnostics → Run text test with zero history, then 20–40 turns. Inspect prompt budget and retained/summarized turns. Use Cancel current reply if inference or summarization takes too long.
5. Test the same Russian dialogue with Qwen 8B, Rocinante Q5/Q4 and Qwen3 14B. A model card's reputation is not our own quality result.

Cydonia/Magidonia weights exceed 12 GB VRAM before KV cache; use partial GPU/RAM offload. They are optional experiments, not guaranteed comfortable full-GPU choices. Two text models plus an image worker compete for memory; stop unused workers.

## Diagnosing the reported ~3,000-token boundary

The previous default was 4,096 tokens. Response, planning, tracker/lore instructions and framing reduce the history allowance, so memory compaction can begin around 3,000. That is an application budget boundary, not Qwen's model maximum. Previously the visible status could sit at Updating memory while several CPU summary calls ran. This update increases fresh-install context, exposes loaded reserves, processes larger summary batches and adds explicit cancellation and repeatable diagnostic tests. A card/notes plus the newest turns that genuinely exceed the loaded context still produce an error; they are not silently deleted.

The tests cover large histories at 4K and 8K, distinct model formatting, preserved newest user messages and existing state/branch behavior. Browser tests use child-process API fixtures. They do not establish real-model quality or RTX 5070 throughput.

## Specification status and remaining work

| Requested scope | Status |
|---|---|
| UI close/navigation recovery | Implemented; browser regression |
| New prioritized text catalog / pinned downloads | Implemented |
| Correct per-model formats / sampling controls | Implemented; real weights still need local quality testing |
| Chronological history / memory / private two-pass replies | Implemented |
| Tracker/lore helpers, branches and rollback | Existing implemented systems preserved |
| Text/image diagnostic test menu | Implemented |
| Russian A/B quality evaluation on user's RTX 5070 | Requires actual local model runs; not claimed completed |
| SDXL through a managed ComfyUI install | Remaining image-backend stage; current image worker supports complete SD 1.5 / SDXL checkpoints |
| SD3.5 / FLUX multi-component workflows | Remaining; not advertised as supported single-checkpoint imports |
| Automatic hardware detection/recommendations | Deferred as requested |
| Qwen 30B MoE | Deferred large-model experiment |

The supplied design specification is preserved at [LOCAL_AI_MODELS_SPEC.md](LOCAL_AI_MODELS_SPEC.md). This document records what is shipped and what still needs hardware/image-backend work.

## Verified primary sources

- https://huggingface.co/TheDrummer/Rocinante-X-12B-v1-GGUF
- https://huggingface.co/Qwen/Qwen3-14B-GGUF
- https://huggingface.co/TheDrummer/Cydonia-24B-v4.3-GGUF
- https://huggingface.co/TheDrummer/Magidonia-24B-v4.3-GGUF
- https://huggingface.co/mistralai/Mistral-Nemo-Instruct-2407/blob/main/tokenizer_config.json

Author fine-tune repositories do not consistently declare a standalone licence. The catalog distinguishes the base-model Apache-2.0 licence from the fine-tune card that must be reviewed before redistribution.
