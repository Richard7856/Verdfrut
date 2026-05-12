"""
Cliente Google Routes API v2 — para re-optimización en vivo con tráfico real.

Diferencia clave vs Mapbox Matrix (que usamos en planning nocturno):
- Google Routes considera TRÁFICO ACTUAL al momento del request.
- En MX tiene mejor data (Waze + Android GPS) que Mapbox.
- Costo: $0.005 USD por route individual (NO hay endpoint "matrix" en v2;
  se llama `computeRoutes` por par origen→destino).

Stream C / Fase O1 — ADR-074.

Auth: API Key en env var GOOGLE_ROUTES_API_KEY (compartida con Geocoding).
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Optional

import httpx


GOOGLE_ROUTES_API_KEY = os.environ.get("GOOGLE_ROUTES_API_KEY", "")
GOOGLE_ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes"

# Field mask: pedimos solo lo que necesitamos para ahorrar bandwidth y costo.
# Google cobra por feature requested — duration + distanceMeters son los mínimos
# para nuestro caso de uso (re-optimización).
GOOGLE_ROUTES_FIELDS = "routes.duration,routes.distanceMeters"

# Timeout generoso pero acotado — un re-opt de 20 stops hace ~20 calls en paralelo.
# Si Google está lento, queremos saberlo en <10s en lugar de colgar el optimizer.
HTTP_TIMEOUT_SECONDS = 8.0


@dataclass
class LatLng:
    lat: float
    lng: float


@dataclass
class RouteSegment:
    """Resultado de un par origen→destino con tráfico actual."""
    duration_seconds: int
    distance_meters: int


class GoogleRoutesError(Exception):
    """Wrapper de errores del API. Mensaje incluye contexto para debugging."""


async def compute_route_segment(
    origin: LatLng,
    destination: LatLng,
    *,
    departure_time: Optional[str] = None,
    client: Optional[httpx.AsyncClient] = None,
) -> RouteSegment:
    """
    Calcula duración + distancia de UN par origen→destino con tráfico considerado.

    Args:
        origin, destination: coords lat/lng.
        departure_time: ISO 8601 UTC. None = "ahora" (tráfico actual).
                        Para predicción de shifts (Fase O3), se pasaría
                        futuro tipo "2026-05-13T11:00:00Z".
        client: httpx.AsyncClient compartido para reutilizar conexiones
                cuando se hacen N calls en paralelo (caso re-opt).

    Returns:
        RouteSegment con duración (segundos) y distancia (metros).

    Raises:
        GoogleRoutesError: si la API responde error o no hay routes.
    """
    if not GOOGLE_ROUTES_API_KEY:
        raise GoogleRoutesError("GOOGLE_ROUTES_API_KEY no está definida en env")

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_ROUTES_API_KEY,
        "X-Goog-FieldMask": GOOGLE_ROUTES_FIELDS,
    }

    body: dict = {
        "origin": {
            "location": {"latLng": {"latitude": origin.lat, "longitude": origin.lng}},
        },
        "destination": {
            "location": {"latLng": {"latitude": destination.lat, "longitude": destination.lng}},
        },
        "travelMode": "DRIVE",
        # TRAFFIC_AWARE_OPTIMAL = considera tráfico actual + reroute si hay
        # incidente reciente. Es el más preciso, también el más caro (igual costo
        # base — diferencia es solo en compute time de Google, no en facturación).
        "routingPreference": "TRAFFIC_AWARE_OPTIMAL",
        "computeAlternativeRoutes": False,
        "languageCode": "es-MX",
        "units": "METRIC",
    }

    if departure_time is not None:
        # Para predicción a futuro (Fase O3). En O1 no se usa.
        body["departureTime"] = departure_time

    owns_client = client is None
    if owns_client:
        client = httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS)

    try:
        response = await client.post(
            GOOGLE_ROUTES_ENDPOINT,
            headers=headers,
            json=body,
        )
        if response.status_code != 200:
            # Google devuelve detalle en el body, útil para debugging.
            raise GoogleRoutesError(
                f"Routes API HTTP {response.status_code}: {response.text[:200]}"
            )
        data = response.json()
        routes = data.get("routes", [])
        if not routes:
            raise GoogleRoutesError(
                f"Routes API devolvió 0 routes. "
                f"origin={origin.lat},{origin.lng} dest={destination.lat},{destination.lng}"
            )
        route = routes[0]
        # `duration` viene como "1234s" string. Parsear los digits antes de "s".
        duration_raw = route.get("duration", "0s")
        duration_seconds = int(duration_raw.rstrip("s"))
        distance_meters = int(route.get("distanceMeters", 0))
        return RouteSegment(
            duration_seconds=duration_seconds,
            distance_meters=distance_meters,
        )
    finally:
        if owns_client:
            await client.aclose()


async def compute_route_matrix(
    points: list[LatLng],
) -> tuple[list[list[int]], list[list[int]]]:
    """
    Construye matrix N×N de duraciones (con tráfico) y distancias entre todos
    los puntos. Hace N×(N-1) calls a Google Routes en paralelo.

    Para una ruta de 20 stops + posición actual = 21 puntos = 420 calls.
    A $0.005/call = $2.10 por re-opt. Caro si se abusa — el cap mensual
    de $300 lo controla.

    Returns:
        (durations[i][j], distances[i][j]) — diagonal es 0.

    Raises:
        GoogleRoutesError: si CUALQUIER segmento falla. All-or-nothing —
        no devolvemos matrix parcial porque VROOM se confundiría.
    """
    n = len(points)
    if n < 2:
        raise GoogleRoutesError(f"Necesito al menos 2 puntos, recibí {n}")

    durations = [[0] * n for _ in range(n)]
    distances = [[0] * n for _ in range(n)]

    # Compartimos client para reusar TCP connections (httpx pool).
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
        # Lista de tareas: cada (i,j) con i != j.
        tasks = []
        for i in range(n):
            for j in range(n):
                if i == j:
                    continue
                tasks.append(_fetch_segment(i, j, points[i], points[j], client))

        results = await asyncio.gather(*tasks, return_exceptions=False)

        for i, j, segment in results:
            durations[i][j] = segment.duration_seconds
            distances[i][j] = segment.distance_meters

    return durations, distances


async def _fetch_segment(
    i: int,
    j: int,
    origin: LatLng,
    destination: LatLng,
    client: httpx.AsyncClient,
) -> tuple[int, int, RouteSegment]:
    """Helper interno para preservar i,j del segmento al hacer asyncio.gather."""
    segment = await compute_route_segment(origin, destination, client=client)
    return (i, j, segment)
