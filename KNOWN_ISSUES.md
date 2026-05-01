# Known Issues — VerdFrut

Documento vivo. **Cuando se resuelve un issue, se quita de aquí** (no se marca, se elimina). El resumen al pie cuenta los abiertos por categoría.

Formato:
```
### #N — Título
**Severidad:** crítico | importante | cosmético
**Fase afectada:** N
**Síntoma:** descripción del bug
**Solución propuesta:** cómo arreglar
**Estado:** abierto | en progreso
```

---

## Críticos (bloquean Fase 2 o causan corrupción de datos)

> Sección vacía. Todos resueltos antes de Fase 2.

---

## Importantes (no bloquean, mejoran calidad / UX)

> Sección vacía. Todos resueltos antes de Fase 2.

---

## Cosméticos (futuro, no urgente)

### #9 — Distancias sin separador de miles
**Severidad:** cosmético
**Síntoma:** `1234.5 km` se ve raro. Mejor `1,234.5 km`.
**Solución propuesta:** `Intl.NumberFormat('es-MX').format(km)`.
**Estado:** abierto

### #10 — Rate limiting del optimizer
**Severidad:** cosmético (hasta que llegue carga real)
**Fase afectada:** 5+ (cuando haya múltiples tenants concurrentes)
**Síntoma:** Sin protección contra abuse — un atacante puede mandar 10K stops y bloquear el container.
**Solución propuesta:** Middleware en FastAPI con `slowapi`. Cap input size en el wrapper TS.
**Estado:** abierto

---

## Resumen

| Categoría | Abiertos |
|---|---|
| Críticos | 0 |
| Importantes | 0 |
| Cosméticos | 2 |

**Última actualización:** post-cierre de todos los importantes pre-Fase 2.
**Resueltos en este ciclo:** I#3 (re-optimize), I#4 (cancel UI), I#5 (paginación), I#6 (warning unassigned), I#7 (stubs de páginas).
**Total acumulado resuelto:** 6 críticos + 8 importantes = 14 issues cerrados.
