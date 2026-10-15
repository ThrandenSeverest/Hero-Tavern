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
        if engine == "kokoro":
            from kokoro import KModel, KPipeline
            import torch
            model_file = os.path.join(model_path, "kokoro-v1_0.pth")
            config_file = os.path.join(model_path, "config.json")
            if not os.path.isfile(model_file) or not os.path.isfile(config_file):
                raise FileNotFoundError("Kokoro weights/config missing; repair the model download.")
            kmodel = KModel(repo_id="hexgrad/Kokoro-82M", config=config_file, model=model_file).to(device).eval()
            model = {"model": kmodel, "pipelines": {"a": KPipeline(lang_code="a", model=kmodel), "b": KPipeline(lang_code="b", model=kmodel)}, "folder": model_path}
        elif engine == "flash":
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
        if engine == "kokoro":
            import numpy as np
            import soundfile as sf
            voice = str(data.get("speaker") or "af_heart")
            if voice not in ("af_heart", "af_bella", "af_nicole", "af_sarah", "am_adam", "am_michael", "am_echo", "bf_emma", "bf_isabella", "bm_george", "bm_lewis"):
                raise ValueError("TTS_SPEAKER_UNSUPPORTED: Choose a built-in Kokoro voice.")
            voice_file = os.path.join(m["folder"], "voices", voice + ".pt")
            if not os.path.isfile(voice_file):
                raise FileNotFoundError("Kokoro voice missing from the downloaded model: " + voice)
            pipeline = m["pipelines"][voice[0]]
            clips = []
            for result in pipeline(text, voice=voice_file):
                if result.audio is not None:
                    clips.append(result.audio.detach().cpu().numpy())
            if not clips:
                raise ValueError("TTS_EMPTY_OR_INVALID_WAV: Kokoro generated no speech")
            out = io.BytesIO()
            sf.write(out, np.concatenate(clips), 24000, format="WAV")
            encoded = out.getvalue()
        elif engine == "flash":
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
                # Both CustomVoice sizes accept an optional style instruction.
                if style:
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

def check_dependencies(engine):
    if engine != "kokoro":
        raise ValueError("Unsupported dependency self-check engine")
    import importlib.metadata
    import torch
    import torchvision
    import transformers
    from transformers import AlbertModel, AlbertConfig
    from kokoro import KModel, KPipeline
    from misaki import en
    version = importlib.metadata.version("transformers")
    if version != "4.49.0":
        raise RuntimeError(f"Kokoro needs transformers==4.49.0; installed {version}")
    if not hasattr(AlbertModel, "__init__") or not hasattr(en, "G2P"):
        raise RuntimeError("Kokoro dependencies did not import correctly")
    print(json.dumps({"ok": True, "engine": "kokoro", "transformers": version, "torch": torch.__version__, "torchvision": torchvision.__version__}), flush=True)

if len(sys.argv) >= 3 and sys.argv[1] == "--check-dependencies":
    try:
        check_dependencies(sys.argv[2])
    except Exception:
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
    sys.exit(0)

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
                 "ok": False, "error": f"{type(error).__name__}: {error}", "traceback": traceback.format_exc()[-9000:]}
    print(json.dumps(reply, ensure_ascii=False), flush=True)
