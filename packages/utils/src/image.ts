// Compresión de imágenes en cliente antes de subir a Supabase Storage.
// Reduce drasticamente el tiempo de upload en redes celulares lentas.
//
// ADR-054 / H4.6 / issue #20: iOS Low Power Mode reduce throttling agresivo
// del JS — `canvas.toBlob` puede tardar 10+ segundos o quedar pendiente
// indefinidamente. Para no bloquear al chofer agregamos un timeout y un
// fallback de "subir original sin comprimir" — el upload será más lento
// pero la app sigue funcionando.

interface CompressOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  mimeType?: string;
  maxSizeBytes?: number;
  /**
   * Timeout total de compresión en ms. Si se excede, devolvemos el file
   * original. Default 5s — iOS LP a veces tarda 3-4s en un canvas grande,
   * 5s es el límite donde el chofer empieza a frustrarse.
   */
  timeoutMs?: number;
}

const DEFAULTS: Required<CompressOptions> = {
  maxWidth: 1920,
  maxHeight: 1920,
  quality: 0.85,
  mimeType: 'image/jpeg',
  maxSizeBytes: 2 * 1024 * 1024,
  timeoutMs: 5000,
};

/**
 * Comprime una imagen usando Canvas. Solo browser (require window.Image).
 * Si el archivo ya pesa menos que maxSizeBytes, lo retorna sin tocar.
 *
 * Defensa iOS Low Power (issue #20): si la compresión tarda más que
 * `timeoutMs`, devolvemos el archivo original sin comprimir. El upload
 * será más lento (red celular pelada) pero el chofer NO ve la app colgada.
 */
export async function compressImage(
  file: File,
  options: CompressOptions = {},
): Promise<File> {
  const opts = { ...DEFAULTS, ...options };

  if (file.size <= opts.maxSizeBytes) return file;

  const compression = (async (): Promise<File> => {
    const img = await loadImage(file);
    const { width, height } = scaleToFit(img.width, img.height, opts.maxWidth, opts.maxHeight);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('[image] No se pudo obtener contexto 2D del canvas');
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, opts.mimeType, opts.quality);
    const newName = file.name.replace(/\.[^.]+$/, '.jpg');
    return new File([blob], newName, { type: opts.mimeType });
  })();

  // Race contra timeout. Si vence, fallback al original — el upload tomará
  // más tiempo pero la promesa nunca se queda colgada.
  //
  // Issue #144: marcamos el resultado para que el caller pueda detectar timeout
  // vs éxito. Usamos un Symbol único en window para no contaminar el File API.
  const TIMEOUT_MARKER = Symbol.for('tripdrive.compressImage.timeout');
  const timeout = new Promise<File>((resolve) => {
    setTimeout(() => {
      const original = file;
      (original as unknown as Record<symbol, true>)[TIMEOUT_MARKER] = true;
      resolve(original);
    }, opts.timeoutMs);
  });

  try {
    const result = await Promise.race([compression, timeout]);
    // Hint observable: si el caller revisa este flag puede mandar telemetría.
    // No lo hacemos acá porque el package es client-side y no depende de
    // @verdfrut/observability. El call site del driver registra la métrica.
    return result;
  } catch (err) {
    // Cualquier error de canvas / decode → fallback al original con flag.
    const original = file;
    (original as unknown as Record<symbol, true>)[TIMEOUT_MARKER] = true;
    // Re-throw mantenido como log silencioso — el caller decide qué hacer.
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn('[compressImage] error → usando archivo original', err);
    }
    return original;
  }
}

/**
 * Detector del flag de timeout/error. Útil para que el caller mande métricas
 * sin enredarse con el Symbol manualmente.
 */
export function compressImageFellBack(file: File): boolean {
  const TIMEOUT_MARKER = Symbol.for('tripdrive.compressImage.timeout');
  return (file as unknown as Record<symbol, true>)[TIMEOUT_MARKER] === true;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

function scaleToFit(
  w: number,
  h: number,
  maxW: number,
  maxH: number,
): { width: number; height: number } {
  const ratio = Math.min(maxW / w, maxH / h, 1);
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('[image] canvas.toBlob retornó null'));
      },
      mimeType,
      quality,
    );
  });
}
