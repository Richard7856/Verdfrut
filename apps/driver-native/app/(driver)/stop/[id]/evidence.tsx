// Pantalla "Reportar entrega" — Fase N4.
//
// Single-screen flow para `type='entrega'` (el web tiene un wizard de 10
// pasos; replicarlo en native sería deuda significativa sin ROI claro).
// Lo que se simplificó vs el web está documentado en ADR-080.
//
// Estructura visual (un solo ScrollView):
//   1. Foto del exhibidor (required).
//   2. Foto del ticket + OCR opcional.
//   3. Toggle merma → foto + descripción.
//   4. Toggle otro incidente → descripción.
//   5. Botón "Enviar entrega" — encola al outbox y vuelve a /route.
//
// Decisiones clave:
//   - El submit siempre encola, nunca llama Supabase directo. Si hay red, el
//     worker procesa inmediato (tickNow). Si no, espera reconexión. La UX es
//     idéntica online/offline desde el punto de vista del chofer.
//   - OCR es opcional: si falla o se salta, los campos quedan editables.

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { TicketData } from '@tripdrive/types';
import { colors } from '@/theme/colors';
import { captureAndCompress } from '@/lib/photo';
import { getStopContext, type StopContext } from '@/lib/queries/stop';
import { uploadEvidence } from '@/lib/storage';
import { extractTicket } from '@/lib/ocr';
import { enqueueSubmitDelivery, tickNow } from '@/lib/outbox';
import { supabase } from '@/lib/supabase';

export default function EvidenceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [ctx, setCtx] = useState<StopContext | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [exhibitUri, setExhibitUri] = useState<string | null>(null);
  const [ticketUri, setTicketUri] = useState<string | null>(null);
  const [ticketData, setTicketData] = useState<TicketData | null>(null);
  const [ticketExtractionConfirmed, setTicketExtractionConfirmed] = useState(false);
  const [ocrInFlight, setOcrInFlight] = useState(false);
  const [ocrNotice, setOcrNotice] = useState<string | null>(null);

  const [hasMerma, setHasMerma] = useState(false);
  const [mermaPhotoUri, setMermaPhotoUri] = useState<string | null>(null);
  const [mermaDescription, setMermaDescription] = useState('');

  const [hasOtherIncident, setHasOtherIncident] = useState(false);
  const [otherIncidentDescription, setOtherIncidentDescription] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!id) return;
        const [stopCtx, userRes] = await Promise.all([
          getStopContext(id),
          supabase.auth.getUser(),
        ]);
        if (cancelled) return;
        setCtx(stopCtx);
        setUserId(userRes.data.user?.id ?? null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const captureExhibit = useCallback(async () => {
    const res = await captureAndCompress();
    if (res.ok) {
      setExhibitUri(res.uri);
    } else if (res.reason !== 'cancelled') {
      Alert.alert('No se pudo capturar la foto', res.message);
    }
  }, []);

  const captureTicket = useCallback(async () => {
    const res = await captureAndCompress();
    if (!res.ok) {
      if (res.reason !== 'cancelled') {
        Alert.alert('No se pudo capturar la foto', res.message);
      }
      return;
    }
    setTicketUri(res.uri);
    setTicketData(null);
    setTicketExtractionConfirmed(false);
    setOcrNotice(null);

    // Intentar OCR online — best-effort. Sube primero a Storage para
    // que el endpoint /api/ocr/ticket pueda fetchear la URL signed.
    if (!ctx || !userId) return;
    setOcrInFlight(true);
    try {
      const uploaded = await uploadEvidence({
        bucket: 'ticket-images',
        routeId: ctx.route.id,
        stopId: ctx.stop.id,
        slot: 'ticket-preview',
        localUri: res.uri,
        userId,
        // Timestamp ad-hoc para preview — el upload definitivo del outbox
        // usa el createdAt del item; ambos paths pueden coexistir (distinto ts).
        timestampMs: Date.now(),
      });
      const ocr = await extractTicket(uploaded.url);
      if (ocr.ok) {
        setTicketData(ocr.data);
        setTicketExtractionConfirmed(false);
        setOcrNotice(`OCR completo (confianza ${(ocr.data.confidence * 100).toFixed(0)}%). Revisa y confirma.`);
      } else {
        // No es un error fatal — el chofer puede entrar manual.
        setOcrNotice(
          ocr.reason === 'unavailable'
            ? 'OCR no disponible. Confirma los datos manualmente.'
            : `OCR no disponible (${ocr.reason}). Puedes seguir sin él.`,
        );
      }
    } catch (err) {
      setOcrNotice(
        `Foto guardada pero OCR falló: ${err instanceof Error ? err.message : 'error'}. Confirma manual.`,
      );
    } finally {
      setOcrInFlight(false);
    }
  }, [ctx, userId]);

  const captureMerma = useCallback(async () => {
    const res = await captureAndCompress();
    if (res.ok) {
      setMermaPhotoUri(res.uri);
    } else if (res.reason !== 'cancelled') {
      Alert.alert('No se pudo capturar la foto', res.message);
    }
  }, []);

  const canSubmit =
    Boolean(exhibitUri) &&
    Boolean(ticketUri) &&
    (!hasMerma || Boolean(mermaPhotoUri)) &&
    (!hasOtherIncident || otherIncidentDescription.trim().length > 0) &&
    !isSubmitting &&
    Boolean(ctx) &&
    Boolean(userId);

  const handleSubmit = useCallback(async () => {
    if (!ctx || !userId || !exhibitUri || !ticketUri) return;
    setIsSubmitting(true);
    try {
      await enqueueSubmitDelivery({
        stopId: ctx.stop.id,
        routeId: ctx.route.id,
        driverId: ctx.driverId ?? '',
        zoneId: ctx.route.zoneId,
        storeId: ctx.store.id,
        storeCode: ctx.store.code,
        storeName: ctx.store.name,
        userId,
        exhibitLocalUri: exhibitUri,
        ticketLocalUri: ticketUri,
        hasMerma,
        mermaPhotoLocalUri: hasMerma ? mermaPhotoUri : null,
        mermaDescription: hasMerma ? mermaDescription.trim() || null : null,
        otherIncidentDescription: hasOtherIncident
          ? otherIncidentDescription.trim() || null
          : null,
        ticketData,
        ticketExtractionConfirmed,
      });
      // Kick inmediato del worker — si hay red, se procesa antes de que
      // el chofer salga de la pantalla.
      void tickNow();
      router.replace('/(driver)/route' as never);
    } catch (err) {
      Alert.alert(
        'No se pudo encolar el envío',
        err instanceof Error ? err.message : 'Error desconocido',
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    ctx,
    userId,
    exhibitUri,
    ticketUri,
    hasMerma,
    mermaPhotoUri,
    mermaDescription,
    hasOtherIncident,
    otherIncidentDescription,
    ticketData,
    ticketExtractionConfirmed,
    router,
  ]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.brand} />
        </View>
      </SafeAreaView>
    );
  }
  if (!ctx) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>Parada no encontrada</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backArrow}>← Detalle</Text>
        </Pressable>
        <Text style={styles.title}>Reportar entrega</Text>
        <View style={{ width: 64 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.subtitle}>
          {ctx.store.code} · {ctx.store.name}
        </Text>

        <Section
          title="1. Foto del exhibidor"
          required
          hint="Foto del producto acomodado en la tienda."
        >
          <PhotoSlot uri={exhibitUri} onCapture={captureExhibit} onRetake={captureExhibit} />
        </Section>

        <Section
          title="2. Foto del ticket"
          required
          hint="Recibo del cliente. Si hay buena luz, OCR autocompleta los datos."
        >
          <PhotoSlot uri={ticketUri} onCapture={captureTicket} onRetake={captureTicket} />
          {ocrInFlight ? (
            <View style={styles.ocrInflight}>
              <ActivityIndicator color={colors.brand} size="small" />
              <Text style={styles.ocrInflightText}>Leyendo ticket…</Text>
            </View>
          ) : null}
          {ocrNotice ? <Text style={styles.ocrNotice}>{ocrNotice}</Text> : null}
          {ticketUri ? (
            <TicketEditor
              data={ticketData}
              onChange={setTicketData}
              confirmed={ticketExtractionConfirmed}
              onConfirm={setTicketExtractionConfirmed}
            />
          ) : null}
        </Section>

        <Section title="3. ¿Hubo merma?" hint="Producto dañado o devuelto.">
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Hubo merma</Text>
            <Switch
              value={hasMerma}
              onValueChange={setHasMerma}
              trackColor={{ false: colors.surface3, true: colors.brandDark }}
              thumbColor={hasMerma ? colors.brand : colors.textFaint}
            />
          </View>
          {hasMerma ? (
            <>
              <PhotoSlot
                uri={mermaPhotoUri}
                onCapture={captureMerma}
                onRetake={captureMerma}
                emptyText="Foto del ticket de merma"
              />
              <TextInput
                style={styles.textInput}
                placeholder="Descripción de la merma (opcional)"
                placeholderTextColor={colors.textFaint}
                value={mermaDescription}
                onChangeText={setMermaDescription}
                multiline
              />
            </>
          ) : null}
        </Section>

        <Section title="4. ¿Otro incidente?" hint="Rechazo, faltante, sobrante, etc.">
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Reportar otro incidente</Text>
            <Switch
              value={hasOtherIncident}
              onValueChange={setHasOtherIncident}
              trackColor={{ false: colors.surface3, true: colors.brandDark }}
              thumbColor={hasOtherIncident ? colors.brand : colors.textFaint}
            />
          </View>
          {hasOtherIncident ? (
            <TextInput
              style={styles.textInput}
              placeholder="Describe el incidente"
              placeholderTextColor={colors.textFaint}
              value={otherIncidentDescription}
              onChangeText={setOtherIncidentDescription}
              multiline
            />
          ) : null}
        </Section>

        <Pressable
          onPress={handleSubmit}
          disabled={!canSubmit}
          style={({ pressed }) => [
            styles.submitBtn,
            !canSubmit && styles.btnDisabled,
            pressed && canSubmit && styles.submitBtnPressed,
          ]}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#0c1410" />
          ) : (
            <Text style={styles.submitBtnText}>Enviar entrega</Text>
          )}
        </Pressable>

        <Text style={styles.disclaimer}>
          El envío se guarda en cola — si no hay red, se sube automáticamente cuando
          vuelvas a conectar. Puedes seguir trabajando con otras paradas.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  title,
  hint,
  required,
  children,
}: {
  title: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>
        {title} {required ? <Text style={styles.requiredStar}>*</Text> : null}
      </Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function PhotoSlot({
  uri,
  onCapture,
  onRetake,
  emptyText,
}: {
  uri: string | null;
  onCapture: () => void;
  onRetake: () => void;
  emptyText?: string;
}) {
  if (uri) {
    return (
      <View style={styles.photoFilled}>
        <Image source={{ uri }} style={styles.photoImg} />
        <Pressable
          onPress={onRetake}
          style={({ pressed }) => [styles.retakeBtn, pressed && styles.retakeBtnPressed]}
        >
          <Text style={styles.retakeBtnText}>Volver a tomar</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <Pressable
      onPress={onCapture}
      style={({ pressed }) => [styles.photoEmpty, pressed && styles.photoEmptyPressed]}
    >
      <Text style={styles.photoEmptyIcon}>📷</Text>
      <Text style={styles.photoEmptyText}>{emptyText ?? 'Tomar foto'}</Text>
    </Pressable>
  );
}

function TicketEditor({
  data,
  onChange,
  confirmed,
  onConfirm,
}: {
  data: TicketData | null;
  onChange: (data: TicketData | null) => void;
  confirmed: boolean;
  onConfirm: (value: boolean) => void;
}) {
  const numero = data?.numero ?? '';
  const fecha = data?.fecha ?? '';
  const total = data?.total != null ? String(data.total) : '';

  function patch(p: Partial<TicketData>) {
    const next: TicketData = {
      numero: data?.numero ?? null,
      fecha: data?.fecha ?? null,
      total: data?.total ?? null,
      items: data?.items ?? [],
      confidence: data?.confidence ?? 0,
      ...p,
    };
    onChange(next);
  }

  return (
    <View style={styles.ticketEditor}>
      <View style={styles.ticketRow}>
        <Text style={styles.ticketLabel}>Número</Text>
        <TextInput
          style={styles.ticketInput}
          value={numero}
          onChangeText={(t) => patch({ numero: t || null })}
          placeholder="Ej. F-1234"
          placeholderTextColor={colors.textFaint}
        />
      </View>
      <View style={styles.ticketRow}>
        <Text style={styles.ticketLabel}>Fecha</Text>
        <TextInput
          style={styles.ticketInput}
          value={fecha}
          onChangeText={(t) => patch({ fecha: t || null })}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.textFaint}
        />
      </View>
      <View style={styles.ticketRow}>
        <Text style={styles.ticketLabel}>Total</Text>
        <TextInput
          style={styles.ticketInput}
          value={total}
          onChangeText={(t) => {
            const n = Number(t.replace(/[^0-9.]/g, ''));
            patch({ total: Number.isFinite(n) && t.length > 0 ? n : null });
          }}
          placeholder="0.00"
          placeholderTextColor={colors.textFaint}
          keyboardType="decimal-pad"
        />
      </View>
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Datos verificados</Text>
        <Switch
          value={confirmed}
          onValueChange={onConfirm}
          trackColor={{ false: colors.surface3, true: colors.brandDark }}
          thumbColor={confirmed ? colors.brand : colors.textFaint}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.danger, fontSize: 14 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backArrow: { color: colors.brand, fontSize: 15, fontWeight: '600', width: 64 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },

  content: { padding: 16, gap: 16, paddingBottom: 32 },
  subtitle: { color: colors.textMuted, fontSize: 13, fontFamily: 'monospace' },

  section: {
    backgroundColor: colors.surface1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 6,
  },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  requiredStar: { color: colors.danger },
  sectionHint: { color: colors.textFaint, fontSize: 12, lineHeight: 16 },
  sectionBody: { gap: 12, marginTop: 8 },

  photoEmpty: {
    height: 140,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
    gap: 4,
  },
  photoEmptyPressed: { backgroundColor: colors.surface3 },
  photoEmptyIcon: { fontSize: 28 },
  photoEmptyText: { color: colors.textMuted, fontSize: 13, fontWeight: '500' },

  photoFilled: { gap: 8 },
  photoImg: {
    width: '100%',
    height: 200,
    borderRadius: 10,
    backgroundColor: colors.surface2,
  },
  retakeBtn: {
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  retakeBtnPressed: { backgroundColor: colors.surface2 },
  retakeBtnText: { color: colors.textMuted, fontSize: 12, fontWeight: '500' },

  ocrInflight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ocrInflightText: { color: colors.textMuted, fontSize: 12 },
  ocrNotice: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },

  ticketEditor: { gap: 8 },
  ticketRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ticketLabel: { color: colors.textMuted, fontSize: 12, width: 60 },
  ticketInput: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 13,
    borderWidth: 1,
    borderColor: colors.border,
  },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLabel: { color: colors.text, fontSize: 14 },

  textInput: {
    backgroundColor: colors.surface2,
    borderRadius: 8,
    padding: 10,
    minHeight: 72,
    color: colors.text,
    fontSize: 13,
    borderWidth: 1,
    borderColor: colors.border,
    textAlignVertical: 'top',
  },

  submitBtn: {
    backgroundColor: colors.brand,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  submitBtnPressed: { backgroundColor: colors.brandDark },
  btnDisabled: { opacity: 0.5 },
  submitBtnText: { color: '#0c1410', fontWeight: '700', fontSize: 16 },
  disclaimer: { color: colors.textFaint, fontSize: 12, lineHeight: 16, textAlign: 'center' },
});
