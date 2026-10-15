"""Explicit Hero Tavern voice-weight downloader; progress is stderr/stdout only, never speech."""
import os, sys, json, traceback
from pathlib import Path

MODELS = {
    "flash": "ResembleAI/chatterbox-flash",
    "kokoro": "hexgrad/Kokoro-82M",
    "custom-0.6": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
    "custom-1.7": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    "clone-0.6": "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
    "clone-1.7": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
    "design-1.7": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
}
def main():
    kind, folder = sys.argv[1:3]
    if kind not in MODELS:
        raise ValueError("Unrecognized voice model")
    dst = Path(folder).resolve()
    dst.mkdir(parents=True, exist_ok=True)
    from huggingface_hub import snapshot_download
    print("Downloading " + MODELS[kind] + " from Hugging Face into " + str(dst), flush=True)
    snapshot_download(repo_id=MODELS[kind], local_dir=str(dst), max_workers=2)
    weights=list(dst.rglob("*.safetensors"))
    if kind == "kokoro":
        required = [dst / "kokoro-v1_0.pth", dst / "config.json", dst / "voices" / "af_heart.pt"]
        if not all(p.is_file() for p in required):
            raise RuntimeError("Kokoro model, configuration, or built-in voice is missing")
        weights = [required[0]]
    elif not weights:
        raise RuntimeError("Model download contains no .safetensors weights; not marked installed")
    (dst / ".hero-downloaded").write_text(json.dumps({"model": MODELS[kind], "files": [p.name for p in weights]}),encoding="utf-8")
    print("Ready: " + str(dst), flush=True)
if __name__=="__main__":
    try: main()
    except Exception as e:
        print("Download failed: "+str(e), file=sys.stderr, flush=True)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
