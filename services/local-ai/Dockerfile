# Mellox local AI sidecar (docs/local-ai.md). CPU only and never exposed: the
# app reaches it on the compose network as http://local-ai:8090.
FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MODELS_DIR=/opt/models
# espeak-ng (GPL, run as a separate program by Kokoro's phonemizer; fine
# server-side) and libsndfile for WAV output.
RUN apt-get update \
  && apt-get install -y --no-install-recommends espeak-ng libsndfile1 curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py fetch_models.py ./
# Weights are baked in (about 1.2 GB), so a cold start never downloads.
RUN python fetch_models.py

RUN useradd --system --uid 1001 localai && chown -R localai /opt/models
USER localai
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8090/health || exit 1
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090", "--workers", "1"]
