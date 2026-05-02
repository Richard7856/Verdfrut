"""
Optimizador de rutas — wrapper FastAPI sobre VROOM.

Recibe vehículos y jobs (paradas), llama al binario VROOM, devuelve rutas optimizadas.
La matriz de distancias es OPCIONAL: si no viene, VROOM la calcula con OSRM público
(no recomendado en producción — el cliente debe enviar matriz precomputada con Mapbox).

Auth: bearer token en header Authorization. Token compartido con las apps via env.
"""

from __future__ import annotations

import json
import os
import subprocess
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field


VROOM_BIN = os.environ.get("VROOM_BIN_PATH", "/usr/local/bin/vroom")
API_KEY = os.environ.get("OPTIMIZER_API_KEY", "")
LOG_LEVEL = os.environ.get("LOG_LEVEL", "info").lower()


# ----------------------------------------------------------------------------
# Schemas — coinciden con packages/types/src/api/optimizer.ts
# ----------------------------------------------------------------------------


class Vehicle(BaseModel):
    id: int
    capacity: list[int]
    start: tuple[float, float]
    end: tuple[float, float]
    time_window: tuple[int, int]


class Job(BaseModel):
    id: int
    location: tuple[float, float]
    service: int = 0
    time_windows: list[tuple[int, int]] = Field(default_factory=list)
    amount: list[int] = Field(default_factory=list)


class Matrix(BaseModel):
    durations: list[list[int]]
    distances: list[list[int]]


class OptimizeRequest(BaseModel):
    vehicles: list[Vehicle]
    jobs: list[Job]
    # Python 3.9-compatible: usamos Optional en lugar de `Matrix | None` (PEP 604,
    # que requiere 3.10+). La imagen base es Bullseye con Python 3.9.
    matrix: Optional[Matrix] = None


class OptimizeStep(BaseModel):
    job_id: int
    arrival: int
    departure: int
    load: list[int] = Field(default_factory=list)


class OptimizeRoute(BaseModel):
    vehicle_id: int
    steps: list[OptimizeStep]
    distance: int
    duration: int
    cost: int


class OptimizeUnassigned(BaseModel):
    job_id: int
    reason: str


class OptimizeSummary(BaseModel):
    total_distance: int
    total_duration: int
    total_cost: int


class OptimizeResponse(BaseModel):
    routes: list[OptimizeRoute]
    unassigned: list[OptimizeUnassigned]
    summary: OptimizeSummary


# ----------------------------------------------------------------------------
# App
# ----------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not API_KEY:
        # Failing loud at startup — mejor que dejar la API sin auth.
        raise RuntimeError("OPTIMIZER_API_KEY no está definida")
    if not os.path.exists(VROOM_BIN):
        # Solo warning — útil para local dev sin VROOM. En producción debe existir.
        print(f"[startup] WARNING: VROOM binary no encontrado en {VROOM_BIN}")
    yield


app = FastAPI(title="VerdFrut Optimizer", version="0.1.0", lifespan=lifespan)
auth_scheme = HTTPBearer()


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(auth_scheme)) -> None:
    """Valida el bearer token contra OPTIMIZER_API_KEY."""
    if credentials.credentials != API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )


@app.get("/health")
def health() -> dict[str, Any]:
    """Health check para Traefik / monitoring."""
    return {
        "status": "ok",
        "vroom_available": os.path.exists(VROOM_BIN),
    }


@app.post("/optimize", response_model=OptimizeResponse)
def optimize(
    req: OptimizeRequest,
    _: None = Depends(verify_token),
) -> OptimizeResponse:
    """Ejecuta VROOM sobre la entrada y devuelve rutas optimizadas."""
    vroom_input = build_vroom_input(req)
    vroom_output = run_vroom(vroom_input)
    return parse_vroom_output(vroom_output)


# ----------------------------------------------------------------------------
# VROOM I/O
# ----------------------------------------------------------------------------


def build_vroom_input(req: OptimizeRequest) -> dict[str, Any]:
    """Convierte el request a formato VROOM JSON.

    Cuando viene `matrix`, VROOM espera índices (start_index/end_index/location_index)
    que apuntan a posiciones de la matriz. Convención: indexamos en orden:
      - vehicle[0].start, vehicle[0].end, vehicle[1].start, ..., job[0], job[1], ...
    Sin matrix, VROOM consulta OSRM en localhost:5000 (que NO tenemos en el setup).
    """
    has_matrix = req.matrix is not None

    # Construir mapeo de índices solo si vamos a pasar matrix.
    vehicles_payload = []
    next_idx = 0
    for v in req.vehicles:
        item: dict[str, Any] = {
            "id": v.id,
            "capacity": v.capacity,
            "time_window": list(v.time_window),
        }
        if has_matrix:
            item["start_index"] = next_idx
            next_idx += 1
            item["end_index"] = next_idx
            next_idx += 1
        else:
            item["start"] = list(v.start)
            item["end"] = list(v.end)
        vehicles_payload.append(item)

    jobs_payload = []
    for j in req.jobs:
        item = {
            "id": j.id,
            "service": j.service,
        }
        if j.time_windows:
            item["time_windows"] = [list(w) for w in j.time_windows]
        if j.amount:
            item["amount"] = j.amount
        if has_matrix:
            item["location_index"] = next_idx
            next_idx += 1
        else:
            item["location"] = list(j.location)
        jobs_payload.append(item)

    payload: dict[str, Any] = {
        "vehicles": vehicles_payload,
        "jobs": jobs_payload,
    }

    if req.matrix:
        # VROOM v1.13 acepta `matrices` (con profile name) o `matrix` legacy.
        # Usamos `matrices.car` con profile arbitrario — vehicles sin profile
        # explícito caen al primero disponible.
        payload["matrices"] = {
            "car": {
                "durations": req.matrix.durations,
                "distances": req.matrix.distances,
            }
        }
    return payload


def run_vroom(payload: dict[str, Any]) -> dict[str, Any]:
    """Invoca VROOM como subprocess. Espera JSON en stdin, devuelve JSON por stdout."""
    if not os.path.exists(VROOM_BIN):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"VROOM binary no encontrado en {VROOM_BIN}",
        )
    try:
        result = subprocess.run(
            [VROOM_BIN],
            input=json.dumps(payload).encode("utf-8"),
            capture_output=True,
            timeout=60,
            check=False,
        )
    except subprocess.TimeoutExpired as err:
        raise HTTPException(status_code=504, detail="VROOM timeout") from err

    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"VROOM falló (rc={result.returncode}): {result.stderr.decode('utf-8', 'ignore')[:500]}",
        )
    try:
        return json.loads(result.stdout.decode("utf-8"))
    except json.JSONDecodeError as err:
        raise HTTPException(status_code=500, detail=f"VROOM devolvió JSON inválido: {err}") from err


def parse_vroom_output(output: dict[str, Any]) -> OptimizeResponse:
    """Mapea la salida de VROOM al schema de respuesta."""
    routes_out: list[OptimizeRoute] = []
    for route in output.get("routes", []):
        steps = [
            OptimizeStep(
                job_id=int(s["job"]),
                arrival=int(s["arrival"]),
                departure=int(s["arrival"]) + int(s.get("service", 0)),
                load=s.get("load", []),
            )
            for s in route.get("steps", [])
            if s.get("type") == "job"
        ]
        routes_out.append(
            OptimizeRoute(
                vehicle_id=int(route["vehicle"]),
                steps=steps,
                distance=int(route.get("distance", 0)),
                duration=int(route.get("duration", 0)),
                cost=int(route.get("cost", 0)),
            )
        )

    unassigned = [
        OptimizeUnassigned(job_id=int(u["id"]), reason="unassigned")
        for u in output.get("unassigned", [])
    ]

    summary_in = output.get("summary", {})
    summary = OptimizeSummary(
        total_distance=int(summary_in.get("distance", 0)),
        total_duration=int(summary_in.get("duration", 0)),
        total_cost=int(summary_in.get("cost", 0)),
    )

    return OptimizeResponse(routes=routes_out, unassigned=unassigned, summary=summary)
