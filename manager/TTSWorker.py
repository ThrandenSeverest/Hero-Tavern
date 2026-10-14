"""Isolated Hero Tavern TTS inference worker (one JSON object per stdin line).
Only stdout JSON records are protocol; package logs go to stderr.
"""
import sys, json, base64, io, gc, traceback, os
from contextlib import redirect_stdout

model = None
model_key = None
clone_prompts = {}

def unload():
    global model, model_key
    model = None
    model_key = None
    clone_prompts.clear()
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass

def load(engine, variant, device, model_path):
    global model, model_key
    key = (engine, variant, device, model_path)
    if key == model_key and model is not None:
        return model
    unload()
    if not model_path or not os.path.isfile(os.path.join(model_path, ".hero-downloaded")):
        raise FileNotFoundError("Download the selected TTS model weights from Voice Models first.")
    with redirect_stdout(sys.stderr):
        if engine == "flash":
            from chatterbox_flash import ChatterboxFlashTTS
            model = ChatterboxFlashTTS.from_local(model_path, device=device)
        elif engine == "qwen":
            import torch
            from qwen_tts import Qwen3TTSModel
            allowed = {
                "custom-0.6": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
                "custom-1.7": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
                "clone-0.6": "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
                "clone-1.7": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
                "design-1.7": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
            }
            if variant not in allowed:
                raise ValueError("Unsupported Qwen3-TTS variant")
            model = Qwen3TTSModel.from_pretrained(
                model_path,
                device_map="cuda:0" if device == "cuda" else "cpu",
                dtype=torch.bfloat16 if device == "cuda" else torch.float32,
                attn_implementation="sdpa",
            )
        else:
            raise ValueError("Unsupported TTS engine")
    model_key = key
    return model

def generate(data):
    engine = data["engine"]
    variant = data.get("variant", "custom-0.6")
    device = data.get("device", "cpu")
    text = str(data["text"])
    if not text.strip() or len(text) > 600:
        raise ValueError("Speech segment must contain 1–600 characters.")
    with redirect_stdout(sys.stderr):
        m = load(engine, variant, device, data.get("modelPath"))
        if engine == "flash":
            voice_file = data.get("reference", "")
            if not voice_file:
                raise ValueError("Chatterbox Flash requires an imported reference voice (WAV).")
            # Flash does not implement Qwen's natural-language 'instruct' control.
            wav = m.generate(text, audio_prompt_path=voice_file, backend="torch")
            sample_rate = m.sr
            import torchaudio
            out = io.BytesIO()
            torchaudio.save(out, wav.unsqueeze(0).cpu() if wav.ndim == 1 else wav.cpu(), sample_rate, format="wav")
            encoded = out.getvalue()
        else:
            import soundfile as sf
            language = data.get("language", "Auto")
            if hasattr(m, "get_supported_languages"):
                supported = m.get_supported_languages()
                if supported and language.lower() not in [x.lower() for x in supported]:
                    raise ValueError("TTS_LANGUAGE_UNSUPPORTED: Choose one of " + ", ".join(supported))
            style = data.get("style", "")
            if variant.startswith("custom"):
                speaker = data.get("speaker", "Ryan")
                if hasattr(m, "get_supported_speakers"):
                    supported = m.get_supported_speakers()
                    if supported and speaker.lower() not in [x.lower() for x in supported]:
                        raise ValueError("TTS_SPEAKER_UNSUPPORTED: Choose one of " + ", ".join(supported))
                kwargs = dict(text=text, language=language, speaker=speaker)
                # Only the 1.7B custom voice variant supports style instructions.
                if variant == "custom-1.7" and style:
                    kwargs["instruct"] = style
                wavs, sample_rate = m.generate_custom_voice(**kwargs)
            elif variant.startswith("clone"):
                ref = data.get("reference", "")
                if not ref:
                    raise ValueError("Qwen3-TTS Base cloning needs a reference WAV.")
                ref_text = data.get("referenceText", "")
                if not ref_text:
                    raise ValueError("Qwen3-TTS cloning needs the exact reference transcript.")
                cache_key = (ref, ref_text)
                if cache_key not in clone_prompts:
                    clone_prompts[cache_key] = m.create_voice_clone_prompt(
                        ref_audio=ref, ref_text=ref_text
                    )
                wavs, sample_rate = m.generate_voice_clone(
                    text=text, language=language, voice_clone_prompt=clone_prompts[cache_key]
                )
            elif variant == "design-1.7":
                if not style:
                    raise ValueError("Qwen3-TTS VoiceDesign requires a voice description.")
                wavs, sample_rate = m.generate_voice_design(
                    text=text, language=language, instruct=style
                )
            else:
                raise ValueError("Unknown Qwen voice mode")
            out = io.BytesIO()
            sf.write(out, wavs[0], sample_rate, format="WAV")
            encoded = out.getvalue()
    # One playback format across models, including mixed narrator/character jobs.
    import soundfile as sf
    import numpy as np
    samples, rate = sf.read(io.BytesIO(encoded), dtype="float32", always_2d=True)
    samples = samples.mean(axis=1)
    if not len(samples) or not np.isfinite(samples).all():
        raise ValueError("TTS_EMPTY_OR_INVALID_WAV: Model returned empty or non-finite audio")
    if rate != 24000:
        count = max(1, round(len(samples) * 24000 / rate))
        samples = np.interp(np.arange(count) * rate / 24000, np.arange(len(samples)), samples)
    out = io.BytesIO()
    sf.write(out, samples, 24000, format="WAV", subtype="PCM_16")
    encoded = out.getvalue()
    sample_rate = 24000
    return {"audio": base64.b64encode(encoded).decode("ascii"), "sampleRate": int(sample_rate)}

for line in sys.stdin:
    try:
        task = json.loads(line)
        task_id = task.get("id")
        if task.get("type") == "unload":
            unload()
            reply = {"id": task_id, "ok": True}
        else:
            reply = {"id": task_id, "ok": True, **generate(task)}
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        reply = {"id": task.get("id") if "task" in locals() else None,
                 "ok": False, "error": str(error)}
    print(json.dumps(reply, ensure_ascii=False), flush=True)
