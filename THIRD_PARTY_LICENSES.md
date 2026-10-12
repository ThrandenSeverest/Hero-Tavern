# Third-party components

Hero Tavern contains our MIT-licensed bootstrap, installer and integration scripts. It downloads upstream software and model weights at installation/use time; those components keep their original licenses.

| Component | Source | License reported by upstream |
|---|---|---|
| SillyTavern | https://github.com/SillyTavern/SillyTavern | AGPL-3.0 |
| KoboldCpp | https://github.com/LostRuins/koboldcpp | AGPL-3.0, with component-specific notices |
| Node.js | https://github.com/nodejs/node | MIT and dependency notices |
| Qwen3 8B Abliterated GGUF | https://huggingface.co/richardyoung/Qwen3-8B-Abliterated-GGUF | Apache-2.0 on model card |
| Qwen3 4B GGUF | https://huggingface.co/Qwen/Qwen3-4B-GGUF | Apache-2.0 on model card |

Upstream license files and notices remain inside downloaded distributions. Hero Tavern's MIT license does not relicense those materials. Any future redistribution of bundled upstream binaries or weights must retain applicable licenses/notices and satisfy corresponding-source obligations where required.

Original installer prototype: SillyTavern Ready contributors, 2026 (MIT notice retained in LICENSE).

## Image checkpoints and Adventure assets

Image checkpoints are downloaded separately, never bundled. DreamShaper 8 and DreamShaper XL Turbo are distributed by Lykon; consult https://huggingface.co/Lykon/DreamShaper and the linked original model terms. The application does not relabel those terms as unrestricted.

Adventure mode adapts user-supplied Ilreon 1.5.4 HTML/JavaScript. Its pinned HeroList catalogue comes from ThrandenSeverest/list-geroya-5e commit f115e08a38c04a1a8f7f4f6c2c4f3d3856aad196. See adventure/NOTICE.md for provenance.
