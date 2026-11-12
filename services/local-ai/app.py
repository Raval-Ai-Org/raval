"""Mellox local AI sidecar (docs/local-ai.md).

Open-source models on CPU, on a private network only. Every endpoint takes
JSON with a base64 `image` (or `text` for /tts) and either answers or returns
an error status. The app's client (src/server/local-ai/client.server.ts)
treats any error as "use the paid path", so nothing here is load-bearing.

Models load on first use and stay in memory. Weights live under MODELS_DIR
(default /opt/models; H:/mellox-models during development).
"""

from __future__ import annotations

import base64
import io
import os
import threading
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import Response
from PIL import Image
from pydantic import BaseModel, Field

MODELS_DIR = os.environ.get("MODELS_DIR", "/opt/models")
os.environ.setdefault("U2NET_HOME", os.path.join(MODELS_DIR, "rembg"))
os.environ.setdefault("HF_HOME", os.path.join(MODELS_DIR, "hf"))
TOKEN = os.environ.get("LOCAL_AI_TOKEN", "").strip()
MAX_IMAGE_BYTES = 25 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 40_000_000

app = FastAPI(title="mellox-local-ai", docs_url=None, redoc_url=None, openapi_url=None)
_lock = threading.Lock()
_models: dict[str, Any] = {}


def auth(authorization: str | None = Header(default=None)) -> None:
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="unauthorized")


class ImageIn(BaseModel):
    image: str = Field(..., description="base64 image bytes")


class SpeechIn(BaseModel):
    text: str = Field(..., max_length=5000)
    language: str = "en"
    voice: str | None = None


def _image(payload: ImageIn) -> Image.Image:
    try:
        raw = base64.b64decode(payload.image, validate=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="bad base64") from exc
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="image too large")
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="not an image") from exc
    return img


def _model(name: str, load):
    with _lock:
        if name not in _models:
            _models[name] = load()
        return _models[name]


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "loaded": sorted(_models)}


@app.post("/cutout", dependencies=[Depends(auth)])
def cutout(payload: ImageIn) -> Response:
    """The product alone on transparency, as PNG (BiRefNet-lite, MIT)."""
    from rembg import new_session, remove

    session = _model("cutout", lambda: new_session("birefnet-general-lite"))
    out = remove(_image(payload).convert("RGB"), session=session)
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


@app.post("/ocr", dependencies=[Depends(auth)])
def ocr(payload: ImageIn) -> dict[str, Any]:
    """Text on the picture, line by line (RapidOCR, Apache-2.0)."""
    import numpy as np
    from rapidocr_onnxruntime import RapidOCR

    engine = _model("ocr", RapidOCR)
    result, _ = engine(np.array(_image(payload).convert("RGB")))
    lines = [{"text": str(text), "confidence": float(score)} for _box, text, score in (result or [])]
    return {"lines": lines}


@app.post("/safety", dependencies=[Depends(auth)])
def safety(payload: ImageIn) -> dict[str, Any]:
    """Probability the picture is unsafe (Falconsai/nsfw_image_detection, Apache-2.0)."""
    from transformers import pipeline

    clf = _model(
        "safety",
        lambda: pipeline("image-classification", model="Falconsai/nsfw_image_detection"),
    )
    scores = {r["label"].lower(): float(r["score"]) for r in clf(_image(payload).convert("RGB"))}
    return {"unsafe": scores.get("nsfw", 0.0)}


def _load_aesthetic():
    import torch
    from transformers import CLIPModel, CLIPProcessor

    name = "openai/clip-vit-large-patch14"
    clip = CLIPModel.from_pretrained(name).eval()
    proc = CLIPProcessor.from_pretrained(name)
    # improved-aesthetic-predictor (Apache-2.0): a small MLP on CLIP ViT-L/14
    # image embeddings.
    head = torch.nn.Sequential(
        torch.nn.Linear(768, 1024),
        torch.nn.Dropout(0.2),
        torch.nn.Linear(1024, 128),
        torch.nn.Dropout(0.2),
        torch.nn.Linear(128, 64),
        torch.nn.Dropout(0.1),
        torch.nn.Linear(64, 16),
        torch.nn.Linear(16, 1),
    )
    state = torch.load(
        os.path.join(MODELS_DIR, "aesthetic", "sac+logos+ava1-l14-linearMSE.pth"),
        map_location="cpu",
    )
    head.load_state_dict({k.replace("layers.", ""): v for k, v in state.items()})
    head.eval()
    return clip, proc, head


@app.post("/aesthetic", dependencies=[Depends(auth)])
def aesthetic(payload: ImageIn) -> dict[str, Any]:
    """Aesthetic score, about 1 to 10 (LAION improved-aesthetic-predictor)."""
    import torch

    clip, proc, head = _model("aesthetic", _load_aesthetic)
    with torch.no_grad():
        inputs = proc(images=_image(payload).convert("RGB"), return_tensors="pt")
        emb = clip.get_image_features(**inputs)
        emb = emb / emb.norm(dim=-1, keepdim=True)
        score = float(head(emb).item())
    return {"score": score}


KOKORO_LANG = {
    "en": "en-us",
    "es": "es",
    "fr": "fr-fr",
    "it": "it",
    "pt": "pt-br",
    "hi": "hi",
    "ja": "ja",
    "zh": "cmn",
}
KOKORO_VOICE = {
    "en": "af_heart",
    "es": "ef_dora",
    "fr": "ff_siwis",
    "it": "if_sara",
    "pt": "pf_dora",
    "hi": "hf_alpha",
    "ja": "jf_alpha",
    "zh": "zf_xiaobei",
}


@app.post("/tts", dependencies=[Depends(auth)])
def tts(payload: SpeechIn) -> Response:
    """A WAV voiceover of exactly these words (Kokoro-82M, Apache-2.0)."""
    import soundfile as sf
    from kokoro_onnx import Kokoro

    lang = payload.language.lower()[:2]
    if lang not in KOKORO_LANG or not payload.text.strip():
        raise HTTPException(status_code=422, detail="unsupported language")
    kokoro = _model(
        "tts",
        lambda: Kokoro(
            os.path.join(MODELS_DIR, "kokoro", "kokoro-v1.0.onnx"),
            os.path.join(MODELS_DIR, "kokoro", "voices-v1.0.bin"),
        ),
    )
    samples, rate = kokoro.create(
        payload.text,
        voice=payload.voice or KOKORO_VOICE[lang],
        speed=1.0,
        lang=KOKORO_LANG[lang],
    )
    buf = io.BytesIO()
    sf.write(buf, samples, rate, format="WAV")
    return Response(content=buf.getvalue(), media_type="audio/wav")
