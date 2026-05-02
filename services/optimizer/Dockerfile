# Single-stage build sobre vroomvrp/vroom-docker.
#
# Por qué single-stage en vez de multi-stage:
# VROOM v1.13 fue compilado contra libssl1.1, libglpk.40, libcolamd, libamd,
# libltdl, libgmp, libsuitesparseconfig — todas en versiones de Debian Bullseye.
# El runtime python:3.12-slim usa Bookworm que tiene versiones distintas o
# faltantes. Copiar libs una a una entre stages es frágil (paths cambian por
# arch — ARM vs x86_64) y rompe en cada lib nueva que VROOM agregue.
#
# Solución: usar la propia imagen oficial como base. Todas las libs de VROOM
# ya están correctamente vinculadas. Solo agregamos Python + nuestro wrapper.
#
# Pin: v1.13.0 es la última estable. v1.14 aún en RC.
# https://hub.docker.com/r/vroomvrp/vroom-docker/tags

FROM vroomvrp/vroom-docker:v1.13.0

# Bullseye trae Python 3.9 por default. Suficiente para FastAPI/Pydantic/uvicorn.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-venv \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Aislar deps de Python en venv. Evita conflictos con paquetes del sistema y
# es el patrón recomendado en Debian moderno (PEP 668).
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY main.py .

ENV VROOM_BIN_PATH=/usr/local/bin/vroom
ENV PORT=8000

EXPOSE 8000

# Healthcheck — Traefik usa esto para saber si el container está listo.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health').read()" || exit 1

# El ENTRYPOINT de la imagen base es /usr/local/bin/vroom — sobrescribimos.
ENTRYPOINT []
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
