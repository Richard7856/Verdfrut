'use client';

// Editor de una tienda. Form completo + mapa con pin draggable + botón
// "Re-geocodificar desde la dirección" que llama Google Geocoding y propone
// nuevas coords (el admin confirma con un click).
//
// Heurísticas:
//   - Si el admin mueve el pin (lat/lng cambian), `coord_verified` se sube
//     automáticamente al guardar (asumimos ground truth manual).
//   - Si solo edita texto sin tocar coords, respeta el toggle visible.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Input, toast } from '@tripdrive/ui';
import type { Store, Zone } from '@tripdrive/types';
import { LocationPicker } from './location-picker';
import {
  updateStoreAction,
  geocodeStoreAddressAction,
  type GeocodeProposal,
} from '../actions';

interface Props {
  store: Store;
  zone: Zone | null;
  mapboxToken: string | null;
}

export function StoreEditor({ store, zone, mapboxToken }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [geocoding, setGeocoding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<GeocodeProposal | null>(null);

  // Estado controlado para los campos que afectan al mapa.
  const [name, setName] = useState(store.name);
  const [address, setAddress] = useState(store.address);
  const [lat, setLat] = useState(store.lat);
  const [lng, setLng] = useState(store.lng);
  const [contactName, setContactName] = useState(store.contactName ?? '');
  const [contactPhone, setContactPhone] = useState(store.contactPhone ?? '');
  const [receivingStart, setReceivingStart] = useState(store.receivingWindowStart ?? '');
  const [receivingEnd, setReceivingEnd] = useState(store.receivingWindowEnd ?? '');
  const [serviceMinutes, setServiceMinutes] = useState(
    Math.round(store.serviceTimeSeconds / 60).toString(),
  );
  const [coordVerified, setCoordVerified] = useState(store.coordVerified);

  const coordsChanged =
    Math.abs(lat - store.lat) > 0.00001 || Math.abs(lng - store.lng) > 0.00001;

  function handleMapChange(newLat: number, newLng: number) {
    setLat(newLat);
    setLng(newLng);
    setProposal(null);
  }

  function handleGeocode() {
    setGeocoding(true);
    setError(null);
    setProposal(null);
    startTransition(async () => {
      const res = await geocodeStoreAddressAction(address);
      setGeocoding(false);
      if (!res.ok || !res.lat || !res.lng) {
        setError(res.error ?? 'Sin resultados');
        return;
      }
      setProposal(res);
    });
  }

  function applyProposal() {
    if (!proposal?.lat || !proposal?.lng) return;
    setLat(proposal.lat);
    setLng(proposal.lng);
    if (proposal.formattedAddress) setAddress(proposal.formattedAddress);
    setProposal(null);
    toast.success('Coords aplicadas — revisa el pin y guarda');
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    // Sobrescribir lat/lng con los del state (el pin del mapa es la verdad).
    formData.set('lat', String(lat));
    formData.set('lng', String(lng));

    startTransition(async () => {
      const res = await updateStoreAction(store.id, formData);
      if (res.ok) {
        toast.success('Tienda actualizada');
        router.refresh();
      } else {
        setError(res.error ?? 'Error al guardar');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-5 md:grid-cols-2">
      {/* Mapa ocupa toda la fila arriba */}
      <div className="md:col-span-2">
        <LocationPicker
          initialLat={lat}
          initialLng={lng}
          mapboxToken={mapboxToken}
          onChange={handleMapChange}
        />
      </div>

      {/* Identificación */}
      <Field label="Código" htmlFor="code">
        <Input
          id="code"
          name="code"
          defaultValue={store.code}
          disabled
          // El code es identidad histórica — no se edita aquí para evitar
          // huérfanos en histórico (routes/stops viejos referencian por id, pero
          // dashboards externos pueden referenciar por code).
        />
      </Field>
      <Field label="Zona">
        <Input value={zone ? `${zone.code} — ${zone.name}` : '—'} disabled />
      </Field>

      <Field label="Nombre" htmlFor="name" required className="md:col-span-2">
        <Input
          id="name"
          name="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
        />
      </Field>

      {/* Dirección + Re-geocodificar */}
      <Field
        label="Dirección"
        htmlFor="address"
        required
        className="md:col-span-2"
        hint="Editar y luego “Re-geocodificar” para proponer coords nuevas desde Google Maps."
      >
        <div className="flex gap-2">
          <Input
            id="address"
            name="address"
            required
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            maxLength={240}
            className="flex-1"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={handleGeocode}
            isLoading={geocoding}
            disabled={pending || geocoding || address.length < 5}
          >
            Re-geocodificar
          </Button>
        </div>
      </Field>

      {proposal && proposal.lat && proposal.lng && (
        <div
          className="md:col-span-2 rounded-[var(--radius-md)] border px-3 py-2 text-sm"
          style={{
            borderColor: 'var(--vf-info-border)',
            backgroundColor: 'var(--vf-info-bg)',
            color: 'var(--vf-text)',
          }}
        >
          <strong>Propuesta:</strong>{' '}
          <span className="font-mono">
            {proposal.lat.toFixed(6)}, {proposal.lng.toFixed(6)}
          </span>{' '}
          · {proposal.locationType ?? '—'}
          <br />
          <span style={{ color: 'var(--vf-text-mute)' }}>{proposal.formattedAddress}</span>
          <div className="mt-2 flex gap-2">
            <Button type="button" variant="primary" size="sm" onClick={applyProposal}>
              Aplicar al pin
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setProposal(null)}>
              Descartar
            </Button>
          </div>
        </div>
      )}

      {/* Coords manuales (para ajuste fino) */}
      <Field label="Latitud" htmlFor="lat-display">
        <Input
          id="lat-display"
          type="number"
          step="0.000001"
          value={lat.toFixed(6)}
          onChange={(e) => setLat(parseFloat(e.target.value) || 0)}
        />
      </Field>
      <Field label="Longitud" htmlFor="lng-display">
        <Input
          id="lng-display"
          type="number"
          step="0.000001"
          value={lng.toFixed(6)}
          onChange={(e) => setLng(parseFloat(e.target.value) || 0)}
        />
      </Field>

      {/* Contacto */}
      <Field label="Contacto (nombre)" htmlFor="contact_name">
        <Input
          id="contact_name"
          name="contact_name"
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
          maxLength={120}
        />
      </Field>
      <Field label="Teléfono" htmlFor="contact_phone">
        <Input
          id="contact_phone"
          name="contact_phone"
          value={contactPhone}
          onChange={(e) => setContactPhone(e.target.value)}
          maxLength={24}
        />
      </Field>

      {/* Ventana de recepción */}
      <Field label="Ventana inicio (HH:MM)" htmlFor="receiving_window_start">
        <Input
          id="receiving_window_start"
          name="receiving_window_start"
          type="time"
          value={receivingStart}
          onChange={(e) => setReceivingStart(e.target.value)}
        />
      </Field>
      <Field label="Ventana fin (HH:MM)" htmlFor="receiving_window_end">
        <Input
          id="receiving_window_end"
          name="receiving_window_end"
          type="time"
          value={receivingEnd}
          onChange={(e) => setReceivingEnd(e.target.value)}
        />
      </Field>

      <Field label="Tiempo de servicio (minutos)" htmlFor="service_minutes" className="md:col-span-2">
        <Input
          id="service_minutes"
          name="service_minutes"
          type="number"
          min={1}
          max={240}
          value={serviceMinutes}
          onChange={(e) => setServiceMinutes(e.target.value)}
        />
      </Field>

      {/* Flag coord_verified */}
      <div className="md:col-span-2 flex items-center gap-2">
        <input
          type="checkbox"
          id="coord_verified"
          name="coord_verified"
          checked={coordVerified}
          onChange={(e) => setCoordVerified(e.target.checked)}
          className="h-4 w-4"
        />
        <label htmlFor="coord_verified" className="text-sm" style={{ color: 'var(--vf-text)' }}>
          Coordenadas verificadas (ground truth)
        </label>
        {coordsChanged && (
          <span className="text-[11px]" style={{ color: 'var(--vf-warn-fg)' }}>
            ⚠️ El pin se movió — se marcará como verificada al guardar.
          </span>
        )}
      </div>

      {error && (
        <div
          className="md:col-span-2 rounded-[var(--radius-md)] border px-3 py-2 text-sm"
          style={{
            borderColor: 'var(--vf-crit-border)',
            backgroundColor: 'var(--vf-crit-bg)',
            color: 'var(--vf-crit-fg)',
          }}
        >
          {error}
        </div>
      )}

      <div className="md:col-span-2 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => router.push('/settings/stores')} disabled={pending}>
          Volver al listado
        </Button>
        <Button type="submit" variant="primary" isLoading={pending}>
          Guardar cambios
        </Button>
      </div>
    </form>
  );
}
