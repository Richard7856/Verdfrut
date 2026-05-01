# Multi-stage build: VROOM compilado en primera etapa, Python runtime en segunda.
# Usar la imagen oficial vroomvrp/vroom-docker como base evita compilar VROOM nosotros.

FROM vroomvrp/vroom-docker:v1.14.0 AS vroom

FROM python:3.12-slim AS runtime

# Copiamos el binario VROOM de la imagen oficial.
COPY --from=vroom /usr/local/bin/vroom /usr/local/bin/vroom

# Dependencias runtime mínimas para que VROOM corra.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl3 \
    libcurl4 \
    libasio-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

ENV VROOM_BIN_PATH=/usr/local/bin/vroom
ENV PORT=8000

EXPOSE 8000

# Healthcheck — Traefik usa esto para saber si el container está listo.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health').read()" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
