# Performance, diagnostics and chat image studio (0.8)

Target machine: NVIDIA RTX 5070 12 GB and 32 GB RAM. This release changes actual engine launch arguments and measures local performance; it does not merely rename UI preferences.

## Text failures and diagnostics

The earlier five-minute `fetch failed` is consistent with a response-header timeout in Node's fetch transport, but the old report did not preserve the cause and cannot prove that was the only fault. Local engine HTTP now has explicit deadlines (20 minutes for inference by default), short connection/probe deadlines, cancellation and underlying error codes. Configure the inference deadline in Hardware.

Reports include failing stage, endpoint and cause chain, model, loaded/configured hardware, process ID, exact launch arguments, pipeline timeline, HTTP request events, token budget, NVIDIA driver/VRAM/load/temperature, available system RAM, engine performance counters and recent stdout/stderr. Diagnostics also gives a readable failure summary. Successful replies survive a failure to collect optional final token metrics.

## Use the machine's capacity

Hardware exposes CUDA/Vulkan/CPU, autofit or manual GPU layers, context, Flash Attention, F16/Q8/Q4 KV cache, CPU threads, batching threads, prompt batch size and deadline. Context is a numeric input up to the engine's supported 524,288-token allocation, not an 8K-only selector. Allocation is distinct from the model's supported/trained context: Qwen3's native supported context is 32K; extended contexts need appropriate scaling/model support and additional memory.

- Fast: CUDA autofit, 8K, Q8 KV cache.
- Balanced: CUDA autofit, 16K, Q8 KV cache.
- Capacity: CUDA autofit, 32K, Q4 KV cache.

Presets apply/reload actual hardware settings and set sampling/reply/memory defaults. The local tuner tests the chosen context ceiling, smaller contexts and Q8/Q4 KV; it requires successful inference and at least 768 MiB free GPU memory. It then compares 256/512/1024 prompt batches and keeps the fastest measured one at the largest working context. Failed/cancelled tuning restores prior files and reloads the original model. Reports persist under Diagnostics. These short measurements identify working configurations, not an absolute universal speed/quality maximum.

On the first 0.8 launch, a detected non-Ti RTX 5070 with at least 24 GiB RAM and an already selected model starts a one-time 32K-ceiling calibration unless a performance preset/previous calibration is recorded. The UI remains accessible; Hardware shows progress and cancellation. Other machines use the explicit tuning button. Real calibration runs on the user's PC; CI has no RTX 5070 and does not claim a hardware score.

## Image generation in chat

The native SillyTavern image provider is configured to Hero Tavern's local Automatic1111-compatible adapter at `http://127.0.0.1:8001`. It supports the native model/sampler/settings/image endpoints. The chat toolbar also offers **Generate image**, with prompt, style preset, optional refiner preview, generation and direct insertion into the selected chat. Images are uploaded to SillyTavern's native image library, so external-media blocking does not hide them. Changing chats during a job prevents insertion into the wrong chat; the generated file remains saved.

All UI, native chat, diagnostics and Adventure image requests use the same managed studio flow. The refiner runs on the selected local text model before image generation and preserves requested identity, pose, clothing, markings, placement and scene. Original/refined prompts, preset and model are saved with the image; the planning text is never a chat message.

Built-in styles: Natural digital art, painted fantasy, cinematic portrait and XL Turbo. Save/delete custom styles with positive/negative instructions, resolution, steps, guidance and sampler. Refinement is optional. SDXL Base 1.0 is now a verified one-click model download; existing DreamShaper models remain available. Use an appropriate preset/checkpoint pairing. A local SDXL model can target polished natural illustrations but does not reproduce ChatGPT's proprietary image model or guarantee identical composition/detail fidelity.

GPU memory saving is on by default: the studio unloads managed text/planning workers, loads the image worker, generates, unloads it and restores the text/planning workers. Refinement happens before that swap. This avoids forcing two large model processes into 12 GB VRAM. Disable it only when your chosen models fit together. Chat data, characters, lore, trackers and Ilreon saves remain untouched.

## Research sources

- KoboldCpp launch flags, Flash Attention, quantized KV cache and image offload: https://github.com/LostRuins/koboldcpp/wiki
- Current argument definitions: https://github.com/LostRuins/koboldcpp/blob/concedo/koboldcpp.py
- Qwen3 context and sampling recommendations: https://huggingface.co/Qwen/Qwen3-14B
- Node fetch timeout behavior: https://github.com/nodejs/undici/issues/1864
- SDXL Base checkpoint: https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0
- DreamShaper XL Turbo: https://huggingface.co/Lykon/dreamshaper-xl-turbo
- Native SillyTavern image integration: tested against upstream commit 06bde939fb1e9c4c8d8641d810f0a916b5bce127.

## Validation

Tests cover explicit HTTP timeout/cancellation errors, larger-context launch flags, optional refiner ordering, preset persistence, tuning selection/rollback and the native image API with worker swaps and text restoration. Windows browser tests verify the chat image button, native provider configuration, direct chat image uploads and the existing Adventure workflow. Model/API fixtures establish integration, not visual quality or real GPU throughput.
