# Ilreon Adventure mode

Open **Adventure** in Hero Tavern. It runs the supplied Ilreon 1.5.4 simulator in its own workspace; ordinary character chats remain separate.

Load a text model in **Models** first. For large game prompts, choose 8192 or 16384 context in **Hardware** if your machine has enough memory. Context is finite: when a character/world prompt is too large, Hero Tavern reports the overflow rather than silently cutting its rules. Reply tokens also occupy this context.

Create a hero manually or import existing Ilreon / HeroList / Long Story Short saves using the original controls. Quests, NPC initiative, inventory, spell slots, combat, undo/redo and eight manual slots remain Ilreon systems. The pinned catalogue includes all 514 spells and works offline.

For portraits, download and load an image checkpoint in **Images**. The same model is used by the portrait controls in NPC profiles. Image files persist under `Images`; image models can be selected independently of text models.

Game saves persist under `AdventureSaves`, with the original browser save fallback. Export saves regularly using Ilreon's export control, especially before moving to another computer. Reinstalling Hero Tavern preserves models, images, chat memory and game saves.

Ilreon automatically summarizes older established story events after long sessions and keeps recent events plus structured game state in its prompts. Undo and edited history invalidate affected summaries. Game mechanics remain authoritative over outdated numbers in summaries.

The included code is the supplied version, adapted only at its local generation, storage and offline catalogue boundaries. A smaller local model may produce invalid game JSON or imperfect narration; this integration cannot guarantee rules correctness or model quality. CI uses a synthetic engine to check the real UI, game startup, structured generation, local portraits and save/load. Real Qwen and diffusion quality/hardware speed need testing on your computer.
