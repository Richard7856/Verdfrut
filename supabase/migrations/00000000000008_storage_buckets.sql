-- Storage buckets para evidencia y tickets.
-- Los buckets se crean vía API de Supabase, no SQL — este archivo documenta los nombres
-- y políticas de acceso para que el script de provisioning los configure.

-- ============================================================================
-- BUCKET: evidence (público)
-- Estructura:
--   {report_id}/{evidence_key}_{timestamp}.{ext}    ← evidencia del flujo
--   chat-images/{report_id}/{timestamp}-{rand}.{ext} ← imágenes del chat
-- Tipos permitidos: image/jpeg, image/png, image/webp
-- Límite: 10MB (pre-compresión cliente: máx 2MB)
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'evidence',
  'evidence',
  TRUE,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies para evidence: cualquier usuario autenticado puede leer/escribir.
-- (RLS más estricta vive en delivery_reports — la URL pública no expone reportes ajenos
-- porque los nombres de archivo incluyen UUID.)

DROP POLICY IF EXISTS "evidence read public" ON storage.objects;
CREATE POLICY "evidence read public" ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'evidence');

DROP POLICY IF EXISTS "evidence write authenticated" ON storage.objects;
CREATE POLICY "evidence write authenticated" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'evidence');

DROP POLICY IF EXISTS "evidence update own authenticated" ON storage.objects;
CREATE POLICY "evidence update own authenticated" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'evidence' AND owner = auth.uid());

-- ============================================================================
-- BUCKET: ticket-images (privado)
-- Acceso solo para el dueño y zone_manager/admin de la zona.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ticket-images',
  'ticket-images',
  FALSE,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "tickets read own" ON storage.objects;
CREATE POLICY "tickets read own" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'ticket-images'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

DROP POLICY IF EXISTS "tickets write own" ON storage.objects;
CREATE POLICY "tickets write own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ticket-images'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );
