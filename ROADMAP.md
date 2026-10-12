# Hero Tavern development plan

## First development build

- [x] Combined Windows setup for portable Node, SillyTavern and KoboldCpp.
- [x] Default Qwen3 8B Abliterated Q4_K_M with a dedicated download button and published SHA-256.
- [x] Model selection, cancellation/resume and custom public GGUF downloads.
- [x] Fresh local API profile and Qwen instruction format.
- [x] UI-first launcher: SillyTavern opens without requiring a model; selected AI loads in the background.
- [x] Embedded Models panel with browser downloads, progress and AI start/stop controls.
- [x] PowerShell 5.1 JSON catalog/dropdown regression test.
- [x] Shared launcher with startup checks, logs, loopback bindings and owned-process cleanup.
- [x] Windows compilation workflow and regression tests.
- [ ] Real Windows install → default download → character import → first generated reply smoke test.

## Reply and layout improvements

- [x] Dock character panels below the toolbar and reserve chat width when they open.
- [x] Buffered reasoning cleanup before replies reach the chat.
- [x] Optional separate private planning call using the same loaded model.
- [x] Generation presets, editable sampling controls, reply styles and filter preview.
- [x] Corrective retry for writer/meta announcements.

## Next: make first-run entirely graphical

- [x] CPU/CUDA/Vulkan selector, GPU layers and context controls.
- RAM/VRAM estimates and automatic hardware recommendations.
- [x] Unified SillyTavern-based navigation with models, hardware, start/stop and logs.
- [x] SillyTavern extension exposing the model library inside its UI.
- [x] Managed direct engine process with readiness, visible failures and automatic chat connection.
- [x] Browser regression test with upstream SillyTavern and a real engine process fixture.
- Graceful shutdown when closing the launcher, including console-window close events.

## Reliable releases

- Lock tested SillyTavern, Node and KoboldCpp versions per release.
- Transactional updates with rollback and backup/restore controls.
- Installer cancellation and resumable component downloads, not only models.
- Prevent simultaneous setup/model-manager instances from competing for files.
- Build and sign release executables; publish downloadable release assets and SHA-256 manifests.
- Automated fresh-install/repair tests using small fixture servers, plus a hardware smoke-test matrix.

## Broader platform and model support

- Linux/macOS installers and launchers.
- Older-CPU and AMD-specific backend build selection.
- More verified model presets, model-specific instruction templates and split GGUF support.
- Optional offline bundle with upstream license notices and corresponding source supplied as required.

The initial repository combines installation and operation. Upstream SillyTavern and KoboldCpp are downloaded unchanged. A source-level fork or deeply integrated UI is a later decision, not a requirement for the first launcher.
