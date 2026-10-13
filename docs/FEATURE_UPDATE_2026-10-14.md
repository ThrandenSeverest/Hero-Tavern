# Hero Tavern: integrated workflow and story update

## ComfyUI
- Dedicated Workflows tab with the full local node editor; native graph JSON can be opened there without dropping custom nodes or connections.
- API workflow runner exposes literal inputs for all nodes and preserves graph connections. Outputs from either runner can be retained in the Hero Tavern gallery.
- Generation and refinement have independent sampler/scheduler controls. Refinement can use a different SDXL checkpoint; generation, refinement and upscaling remain sequential.
- LoRA model and CLIP strengths are independent. The existing activation/trigger-word integration remains in place.
- AI upscalers honor the selected factor. Qwen selection no longer routes Studio requests to SDXL.

## Writer
- Say/Do intents, Lore and User Persona tabs. Persona placeholders resolve before generation and in generated candidates.
- Optional missing fields are normalized on plain-text/JSON import. Memory accepts longer source text; ordinary edits, new stories, export and revision history preserve drafts.
- Oversized fixed context is compressed in measured chunks, audited into one continuity brief, then narrated. Original saved source is preserved.

## Trackers and lore
- Structured record trackers combine levels, summaries, times and recent events. Hunger preset retains recent actual meals and leaves unknown facts unknown.
- AI drafts can be edited as JSON before loading them into the editor. The helper can create 1–24 relevant trackers rather than forcing generic meters.
- JSON extraction tolerates surrounding prose; malformed shapes get one repair attempt. Evidence/ownership/conflict checks still apply before changes are committed.
- Lore helper accepts long source text, shows its limit/count/progress and summarizes oversized sources before drafting entries.

## Chat image input and output
- Show Image attaches a user image and reviewed visual description, which the ordinary character model can use in its next response.
- Local Qwen2.5 Omni 3B vision analyzer with matching MMProj can be downloaded/configured separately. CPU is the default; the analyzer unloads after use, preserving the ordinary chat model selection.
- Chat image prompting includes the current scene and appearance. Empty reasoning-only prompt generations fall back to the provided visual scene rather than blocking image generation.

## Adventure
- Custom starting premise, existing/custom location, companions, leader and starting inventory.
- Tavern cards can be adapted into NPCs from their description. Character images are copied into Hero Tavern so the Adventure portrait has its own retained copy.
- Current NPC clothing persists. Portrait updates retain earlier iterations, and earlier images can be selected again.
- Failed actions do not advance initiative or trigger enemy attacks. Missing/blank starting HP defaults to maximum; real zero HP is preserved in saves.
- Damaging saving-throw spells use target saves against caster DC, with half/no damage according to the spell. Thunderwave regression is covered.
- Savos retains portrait/group actions while hidden identity, HP and AC stay private.

## Validation
Automated tests cover memory/import roundtrips, intent anchors, long context, record evidence/history, JSON repair, graph inputs, failed-turn rollback, target saves, image-prompt fallback and portrait history. Windows CI additionally runs browser integration, installer compilation and embedded dependency checks.

Physical GPU inference and model quality depend on the installed local engines and compatible weights; automated fixtures do not certify those.
