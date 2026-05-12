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

from google_routes import (
    GoogleRoutesError,
    LatLng,
    compute_route_matrix,
)


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
    response = parse_vroom_output(vroom_output)

    # FIX-distance0 (ADR-034): si VROOM devolvió distance=0 a pesar de tener matrix,
    # calcular manualmente sumando la matriz para los pares (location_idx[i], location_idx[i+1])
    # según la secuencia de steps. Esto es defensivo: si VROOM se queda sin profile,
    # o si una versión futura cambia el output, siempre tendremos distance correcta.
    if req.matrix is not None:
        response = _backfill_distances_from_matrix(response, req, vroom_output)
    return response


# ----------------------------------------------------------------------------
# Re-optimización en vivo con Google Routes (Stream C / Fase O1 — ADR-074)
# ----------------------------------------------------------------------------


class StopInput(BaseModel):
    """Una parada pendiente del chofer con coords + restricciones."""
    stop_id: str  # UUID en BD del platform; opaco para el optimizer
    location: tuple[float, float]
    service_seconds: int = 1800  # default 30 min


class ReoptimizeLiveRequest(BaseModel):
    """
    Re-optimización en vivo: chofer está en `current_position`, le quedan
    `pending_stops` paradas que NO han sido completadas. Necesitamos la
    secuencia óptima considerando tráfico ACTUAL.

    Convención: NO incluimos las stops ya completadas (su sequence es
    histórico y no se toca). NO incluimos el depot — el chofer no regresa
    durante la ruta, solo al final (eso ya está modelado en el optimizer
    nocturno).
    """
    current_position: tuple[float, float]
    pending_stops: list[StopInput]
    shift_end_unix: int  # límite del turno; las stops fuera salen como unassigned


class ReoptimizeLiveStop(BaseModel):
    """Una parada en la nueva secuencia, con ETA recalculada."""
    stop_id: str
    sequence: int  # 1-indexed
    arrival_unix: int
    departure_unix: int


class ReoptimizeLiveResponse(BaseModel):
    stops: list[ReoptimizeLiveStop]
    unassigned_stop_ids: list[str]  # paradas que no caben en el shift restante
    total_duration_seconds: int  # tiempo total de la ruta restante
    total_distance_meters: int
    google_routes_calls: int  # para tracking de costo


@app.post("/reoptimize-live", response_model=ReoptimizeLiveResponse)
async def reoptimize_live(
    req: ReoptimizeLiveRequest,
    _: None = Depends(verify_token),
) -> ReoptimizeLiveResponse:
    """
    Re-optimiza las paradas pendientes de un chofer con tráfico real-time.

    Flujo:
      1. Construye matrix N×N con Google Routes API (N = current + stops).
      2. Pasa a VROOM con start=current_position, jobs=pending_stops.
      3. Devuelve secuencia óptima + ETAs proyectadas.

    Costo: 1 call por cada par (origin, dest) con i!=j → ~N×(N-1) calls.
    Para 10 stops + posición = 11 puntos = 110 calls = ~$0.55 USD por re-opt.
    """
    n_pending = len(req.pending_stops)
    if n_pending == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No hay paradas pendientes para re-optimizar",
        )

    # 1. Build matrix con Google Routes — current_position primero (índice 0)
    #    y luego cada pending stop.
    points = [LatLng(lat=req.current_position[0], lng=req.current_position[1])]
    for s in req.pending_stops:
        points.append(LatLng(lat=s.location[0], lng=s.location[1]))

    try:
        durations, distances = await compute_route_matrix(points)
    except GoogleRoutesError as e:
        # No hacemos fallback a haversine acá: el llamador pidió Google
        # explícito para tener precisión. Mejor falla fast con mensaje claro.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Google Routes API error: {e}",
        )

    n = len(points)
    google_calls = n * (n - 1)

    # 2. Pasar a VROOM. Convención de IDs:
    #    - vehicle.id = 1 (un solo chofer)
    #    - vehicle.start = índice 0 (current_position)
    #    - vehicle.end = índice 0 (no regreso a depot durante la ruta;
    #      el shift_end es la única restricción de cierre)
    #    - jobs.id = 1..N (índices 1..N en la matrix corresponden a pending_stops)
    #
    # Importante: la matrix usa los índices de `points`. Los jobs deben
    # apuntar a sus posiciones en esa matrix.

    # Construir input VROOM directamente (sin pasar por OptimizeRequest porque
    # el formato es más simple para 1 vehículo + N jobs).
    vroom_input = {
        "vehicles": [
            {
                "id": 1,
                "start_index": 0,
                "end_index": 0,
                "time_window": [0, req.shift_end_unix - 0],  # offset desde "ahora"
                "profile": "car",
            }
        ],
        "jobs": [
            {
                "id": i + 1,
                "location_index": i + 1,
                "service": s.service_seconds,
            }
            for i, s in enumerate(req.pending_stops)
        ],
        "matrices": {
            "car": {
                "durations": durations,
                "distances": distances,
            }
        },
    }

    vroom_output = run_vroom(vroom_input)

    # 3. Parsear output VROOM y mapear IDs internos → stop_id externo.
    if not vroom_output.get("routes"):
        # VROOM no pudo asignar nada — todas las stops out of window
        return ReoptimizeLiveResponse(
            stops=[],
            unassigned_stop_ids=[s.stop_id for s in req.pending_stops],
            total_duration_seconds=0,
            total_distance_meters=0,
            google_routes_calls=google_calls,
        )

    route = vroom_output["routes"][0]
    response_stops: list[ReoptimizeLiveStop] = []
    seq = 1

    # `arrival` y `departure` que VROOM devuelve son segundos desde "ahora"
    # (el shift relativo). Convertimos a unix sumando timestamp actual.
    import time
    now_unix = int(time.time())

    for step in route["steps"]:
        if step["type"] != "job":
            continue  # skip start/end del depot virtual
        job_id = step["job"]
        stop_index = job_id - 1
        stop_input = req.pending_stops[stop_index]
        response_stops.append(
            ReoptimizeLiveStop(
                stop_id=stop_input.stop_id,
                sequence=seq,
                arrival_unix=now_unix + step["arrival"],
                departure_unix=now_unix + step["arrival"] + step.get("service", 0),
            )
        )
        seq += 1

    # Paradas que VROOM no asignó (no caben en el turno restante).
    assigned_ids = {s.stop_id for s in response_stops}
    unassigned_ids = [
        s.stop_id for s in req.pending_stops if s.stop_id not in assigned_ids
    ]

    return ReoptimizeLiveResponse(
        stops=response_stops,
        unassigned_stop_ids=unassigned_ids,
        total_duration_seconds=route.get("duration", 0),
        total_distance_meters=route.get("distance", 0),
        google_routes_calls=google_calls,
    )


# ----------------------------------------------------------------------------
# VROOM I/O
# ----------------------------------------------------------------------------


def build_vroom_input(req: OptimizeRequest) -> dict[str, Any]:
    """Convierte el request a formato VROOM JSON.

    Cuando viene `matrix`, VROOM espera índices (start_index/end_index/location_index)
    que apuntan a posiciones de la matriz. Convención: indexamos en orden:
      - vehicle[0].start, vehicle[0].end, vehicle[1].start, ..., job[0], job[1], ...
    Sin matrix, VROOM consulta OSRM en localhost:5000 (que NO tenemos en el setup).

    Profile: cuando hay `matrices` con varios profiles, cada vehicle DEBE indicar
    qué profile usar. Sin `profile` declarado, VROOM cae a un profile por default
    pero PUEDE ignorar la sub-matriz de `distances` y sólo usar `durations` —
    eso resulta en `route.distance=0` en el output. Por eso forzamos `profile=car`
    cuando hay matrix (FIX-distance0, ADR-034).
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
            item["profile"] = "car"  # Match con matrices.car (línea 204) — sin esto VROOM ignora distances.
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


def _backfill_distances_from_matrix(
    resp: OptimizeResponse,
    req: OptimizeRequest,
    raw_vroom: dict[str, Any],
) -> OptimizeResponse:
    """Calcula distancias a partir de la matriz si VROOM no las llenó.

    Cómo: para cada `route` del raw_vroom, recorre ALL los steps (start/job/end) y
    suma `req.matrix.distances[from_idx][to_idx]` consecutivamente. Necesitamos el
    raw para acceder a `location_index`/`start_index`/`end_index` que VROOM devuelve
    en cada step (no los exponemos en OptimizeStep porque la app cliente no los usa).

    Si la suma resulta > 0 y el response ya tenía distance=0, la sobreescribe.
    Si VROOM ya devolvió distance>0 confiable, NO la toca (asume que es correcta).

    Trade-off: este método NO repara duración (asumimos que VROOM siempre llena
    duration porque es la dimensión de optimización por default). Si en el futuro
    también queda en 0, replicar esta lógica con `durations`.
    """
    if not raw_vroom.get("routes"):
        return resp

    matrix_dist = req.matrix.distances if req.matrix else None
    if not matrix_dist:
        return resp

    fixed_routes: list[OptimizeRoute] = []
    grand_total = 0
    for i, route in enumerate(raw_vroom.get("routes", [])):
        original = resp.routes[i] if i < len(resp.routes) else None
        if original is None:
            continue

        if original.distance > 0:
            # VROOM llenó bien — no tocar.
            fixed_routes.append(original)
            grand_total += original.distance
            continue

        # Sumar steps consecutivos usando location_index (VROOM lo expone para start/end/job).
        total_dist = 0
        prev_idx: Optional[int] = None
        for step in route.get("steps", []):
            # VROOM nombra el índice según el tipo de step.
            idx = step.get("location_index")
            if idx is None:
                # start/end usan start_index/end_index; tratamos cada uno.
                idx = step.get("start_index") or step.get("end_index")
            if idx is None:
                continue
            if prev_idx is not None:
                try:
                    total_dist += matrix_dist[prev_idx][idx]
                except (IndexError, TypeError):
                    pass
            prev_idx = idx

        rebuilt = OptimizeRoute(
            vehicle_id=original.vehicle_id,
            steps=original.steps,
            distance=int(total_dist),
            duration=original.duration,
            cost=original.cost,
        )
        fixed_routes.append(rebuilt)
        grand_total += rebuilt.distance

    new_summary = (
        OptimizeSummary(
            total_distance=int(grand_total) if resp.summary.total_distance == 0 else resp.summary.total_distance,
            total_duration=resp.summary.total_duration,
            total_cost=resp.summary.total_cost,
        )
        if resp.summary.total_distance == 0
        else resp.summary
    )

    return OptimizeResponse(routes=fixed_routes, unassigned=resp.unassigned, summary=new_summary)


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
