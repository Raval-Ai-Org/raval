# Local AI sidecar

Mellox Lean moves checks that don't need a frontier model onto open-source
models running on Mellox's own machine. They cost $0 per call. The sidecar
lives in `services/local-ai/` (Python, FastAPI, CPU). It runs as its own
compose service, `local-ai`, which is never published.

## Endpoints

| Endpoint                      | Model                                       | Replaces                            | Used by                              |
| ----------------------------- | ------------------------------------------- | ----------------------------------- | ------------------------------------ |
| `POST /cutout` → PNG          | BiRefNet-lite                               | the Sunburst "high" cut-out edit    | `ensureProductCutout` (product hero) |
| `POST /ocr` → `{lines}`       | RapidOCR                                    | part of `studio.image.review`       | `localOcr`                           |
| `POST /safety` → `{unsafe}`   | Falconsai ViT                               | Haiku vision moderation             | `localSafety`                        |
| `POST /aesthetic` → `{score}` | LAION aesthetic predictor on CLIP L/14      | the first pass of the vision review | `localAesthetic`                     |
| `POST /tts` → WAV             | Kokoro-82M (en, es, fr, it, pt, hi, ja, zh) | KIE voice                           | `localSpeech`                        |
| `GET /health`                 | —                                           | —                                   | compose health check                 |

Transcription is whisper.cpp inside the **main** image (`WHISPER_CPP_PATH`,
`WHISPER_MODEL_PATH`). It is already supported by
`src/server/studio/clip-edit/transcribe.server.ts`.

## Rules

- **One client:** `src/server/local-ai/client.server.ts` is the only code that
  calls the sidecar.
- **It never decides alone and never blocks.** Every call has a timeout and
  returns null on any failure, and the caller then uses the paid path it used
  before.
- **A cut-out still passes `judgeCutout`.** BiRefNet keeps the photo's own
  pixels (never redrawn, ADR-0040). Only when the sidecar is off or its matte
  fails the check does the image model cut the product out.
- **Every call is metered** as provider `local` at $0, under its route label
  (`studio.image.cutout`, `studio.image.ocr`, `studio.image.aesthetic`,
  `guardrails.local-safety`, `studio.video.voice`). This puts the savings in
  the admin usage view.
- **Licences:** see `services/local-ai/LICENSES.md`. rembg's default model
  (BRIA RMBG) is non-commercial; always name `birefnet-general-lite`.

## Configuration

| Variable                        | Meaning                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `LOCAL_AI_URL`                  | e.g. `http://local-ai:8090`. Unset means the sidecar is off.                          |
| `LOCAL_AI_TOKEN`                | Optional bearer token shared by the app and the sidecar.                              |
| `FEATURE_FLAG_LOCAL_AI_ENABLED` | On unless `false`; `_WS_<id>` overrides per workspace.                                |
| `MODELS_DIR` (sidecar)          | Where the weights live: `/opt/models` in the image (about 1.2 GB, baked in at build). |

## Running it in development

C: is full, so keep the weights on H::

```bash
cd services/local-ai
python -m venv H:/mellox-models/venv
H:/mellox-models/venv/Scripts/pip install -r requirements.txt
MODELS_DIR=H:/mellox-models H:/mellox-models/venv/Scripts/python fetch_models.py
MODELS_DIR=H:/mellox-models H:/mellox-models/venv/Scripts/uvicorn app:app --port 8090
```

Then set `LOCAL_AI_URL=http://127.0.0.1:8090` and run:

```bash
node scripts/local-ai-smoke.mjs
```

## Not wired yet

The cut-out is wired. These are the next calls to connect, each one in front
of the paid call it replaces, failing open:

- OCR spelling check before `studio.image.review`;
- the aesthetic pre-filter;
- safety on uploads (cached by hash);
- Kokoro in `soundtrack.server.ts`.
