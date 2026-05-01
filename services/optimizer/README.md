# Optimizer Service

FastAPI wrapper sobre VROOM para optimización de rutas.

## Local development

```bash
cd services/optimizer
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export OPTIMIZER_API_KEY=dev-secret
export VROOM_BIN_PATH=/path/to/vroom  # opcional para dev sin VROOM
uvicorn main:app --reload --port 8000
```

Sin VROOM instalado localmente, los endpoints aceptan requests pero `/optimize` devuelve 503. Para dev real, levanta el container Docker:

```bash
docker build -t verdfrut-optimizer .
docker run -p 8000:8000 -e OPTIMIZER_API_KEY=dev-secret verdfrut-optimizer
```

## Test rápido

```bash
curl -X POST http://localhost:8000/optimize \
  -H "Authorization: Bearer dev-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "vehicles": [{
      "id": 1, "capacity": [4],
      "start": [-99.1332, 19.4326], "end": [-99.1332, 19.4326],
      "time_window": [1714464000, 1714492800]
    }],
    "jobs": [
      {"id": 1, "location": [-99.13, 19.43], "service": 600, "amount": [1]},
      {"id": 2, "location": [-99.14, 19.44], "service": 600, "amount": [1]}
    ]
  }'
```
