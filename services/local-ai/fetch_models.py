"""Download the sidecar's weights into MODELS_DIR once (at image build time).

Only models whose licences allow commercial use (LICENSES.md). Files already
present are kept, so running it again only fills gaps.
"""

from __future__ import annotations

import os
import urllib.request

MODELS_DIR = os.environ.get("MODELS_DIR", "/opt/models")
os.environ.setdefault("U2NET_HOME", os.path.join(MODELS_DIR, "rembg"))
os.environ.setdefault("HF_HOME", os.path.join(MODELS_DIR, "hf"))

FILES = {
    "kokoro/kokoro-v1.0.onnx": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
    "kokoro/voices-v1.0.bin": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
    "aesthetic/sac+logos+ava1-l14-linearMSE.pth": "https://github.com/christophschuhmann/improved-aesthetic-predictor/raw/main/sac%2Blogos%2Bava1-l14-linearMSE.pth",
}


def fetch(rel: str, url: str) -> None:
    dest = os.path.join(MODELS_DIR, rel)
    if os.path.exists(dest):
        return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    print("fetching", rel, flush=True)
    urllib.request.urlretrieve(url, dest + ".part")
    os.replace(dest + ".part", dest)


def main() -> None:
    for rel, url in FILES.items():
        fetch(rel, url)
    # rembg stores BiRefNet-lite in U2NET_HOME on the first session.
    from rembg import new_session

    new_session("birefnet-general-lite")
    from rapidocr_onnxruntime import RapidOCR

    RapidOCR()
    from transformers import CLIPModel, CLIPProcessor, pipeline

    pipeline("image-classification", model="Falconsai/nsfw_image_detection")
    CLIPModel.from_pretrained("openai/clip-vit-large-patch14")
    CLIPProcessor.from_pretrained("openai/clip-vit-large-patch14")


if __name__ == "__main__":
    main()
