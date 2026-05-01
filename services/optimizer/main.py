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
from typing import Any

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
    matrix: Matrix | None = None


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
    """Convierte el request a formato VROOM JSON."""
    payload: dict[str, Any] = {
        "vehicles": [
            {
                "id": v.id,
                "start": list(v.start),
                "end": list(v.end),
                "capacity": v.capacity,
                "time_window": list(v.time_window),
            }
            for v in req.vehicles
        ],
        "jobs": [
            {
                "id": j.id,
                "location": list(j.location),
                "service": j.service,
                "time_windows": [list(w) for w in j.time_windows] if j.time_windows else None,
                "amount": j.amount or None,
            }
            for j in req.jobs
        ],
    }
    # Limpiar None de jobs.
    for job in payload["jobs"]:
        for k in list(job.keys()):
            if job[k] is None:
                del job[k]

    if req.matrix:
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
