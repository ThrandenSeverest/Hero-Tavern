# Hero Tavern

A Windows launcher that installs **SillyTavern + KoboldCpp** together and provides one-button GGUF model downloads. The default is **Qwen3 8B Abliterated Q4_K_M**.

This is the first development version: the setup executable is built by GitHub Actions. Full installation and generation on a Windows PC still need a smoke test before a stable release.

## Install

1. Download this repository with **Code → Download ZIP**, then extract it.
2. Double-click **Install.cmd**. It installs portable Node.js, SillyTavern and KoboldCpp without administrator rights, Git or Python.
3. Setup opens **Hero Tavern / SillyTavern immediately**, even with no model installed.
4. Click **Hero Tavern · Models** in the bottom-right corner. In the embedded panel, click **Download Qwen default** once.
5. The approximately **5.03 GB** file downloads with progress, resume and SHA-256 verification. The first selected model starts in the background after verification. Once the panel says AI ready, click **Connect** in SillyTavern's API Connections if requested.

On subsequent runs, use the **Hero Tavern** desktop shortcut. The chat UI opens first; a previously selected model loads in the background.

Alternatively, open [Actions](https://github.com/ThrandenSeverest/Hero-Tavern/actions/workflows/build-windows.yml), select a successful run and download `Hero-Tavern-Setup-Windows-x64`. Extract and run `Hero-Tavern-Setup.exe`. Artifact downloads require a GitHub login.

The launcher starts SillyTavern and the local model service, then opens your browser without waiting for a model. Keep its window open; press Enter there to stop the servers. The Models panel provides downloads, installed-model selection, progress and Start AI / Stop AI controls. An Advanced manager button opens the Windows manager for custom links and deletion.

## Included behavior

- Shared installation folder: `%LOCALAPPDATA%\Hero-Tavern`.
- Built-in Models panel in SillyTavern with one-button default Qwen downloads, additional Qwen quantizations and installed-model selection.
- Advanced Windows manager for custom public Hugging Face GGUF links and deletion.
- Download progress, cancellation, resume, free-space checks and automatic model selection.
- GGUF header and version checks, exact size checks when metadata exists, SHA-256 verification. The default model has a fixed published checksum.
- Fresh Qwen ChatML profile with non-thinking assistant prefix and local KoboldCpp endpoint.
- Repeat setup preserves chats, characters, settings and downloaded models. It repairs dependencies and launchers; it does not upgrade an existing SillyTavern or KoboldCpp installation.
- All services bind locally (SillyTavern 8000, model library 8001, KoboldCpp 5001). The launcher rejects busy ports and duplicate launches rather than terminating unrelated processes.
- Startup logs in `Logs`; installation log in `install.log`.

## Hardware

Windows 10/11 **x64**, built-in Windows PowerShell 5.1 and `curl.exe` are required. Allow roughly **10 GB of free disk space** for software, dependencies, model and temporary archives. For the 8B model, **16 GB system RAM** is a practical starting point; memory use also depends on context and GPU offload. CPU mode is compatible but can be slow. Older CPUs without the instructions required by the normal KoboldCpp build may need its upstream `oldpc` variant, which this first installer does not select automatically.

Edit `%LOCALAPPDATA%\Hero-Tavern\backend.json` while the app is stopped:

```json
{"mode":"cpu","gpuLayers":0,"contextSize":4096}
```

For NVIDIA acceleration use `"mode":"cuda"`; for a supported Vulkan GPU use `"mode":"vulkan"`. Set `"gpuLayers":-1` for KoboldCpp autofit. Lower context or switch back to CPU if GPU memory is insufficient. The first version exposes this through the configuration file; a hardware-settings UI is planned.

If you increase backend context, adjust SillyTavern's context setting too. When switching to a non-Qwen model, choose that model's appropriate instruction template in SillyTavern.

## Model source

Default: [richardyoung/Qwen3-8B-Abliterated-GGUF](https://huggingface.co/richardyoung/Qwen3-8B-Abliterated-GGUF), file `qwen3-8b-abliterated-Q4_K_M.gguf`, model-card license Apache-2.0.

Published file SHA-256:

```text
8625e48da4c4be9bcba2414fd8cad4095ff3a538d5b0111c2b26b5f6209538b9
```

Models live on your computer and are not committed to GitHub. Custom downloads check their available upstream metadata; when no hash is published, only GGUF/header and available size checks apply. Split multi-file GGUFs and gated/private repositories are not supported in this first version.

## Development

Our launcher and integration code are MIT licensed. Upstream components retain their licenses; see [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

`Install.cmd` and the compiled bootstrap package the same published scripts. CI parses every PowerShell script with Windows PowerShell, tests PowerShell 5.1 catalog/dropdown behavior, model verification/path restrictions, UI startup without a model and profile preservation and compiles the executable from embedded source resources.

Local profile test:

```sh
node --test tests/*.test.cjs
```

Windows model validation test:

```powershell
./tests/ModelTools.Tests.ps1
```

See [ROADMAP.md](ROADMAP.md) for the next development steps.
