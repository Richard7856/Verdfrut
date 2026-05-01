// Compresión de imágenes en cliente antes de subir a Supabase Storage.
// Reduce drasticamente el tiempo de upload en redes celulares lentas.

interface CompressOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  mimeType?: string;
  maxSizeBytes?: number;
}

const DEFAULTS: Required<CompressOptions> = {
  maxWidth: 1920,
  maxHeight: 1920,
  quality: 0.85,
  mimeType: 'image/jpeg',
  maxSizeBytes: 2 * 1024 * 1024,
};

/**
 * Comprime una imagen usando Canvas. Solo browser (require window.Image).
 * Si el archivo ya pesa menos que maxSizeBytes, lo retorna sin tocar.
 */
export async function compressImage(
  file: File,
  options: CompressOptions = {},
): Promise<File> {
  const opts = { ...DEFAULTS, ...options };

  if (file.size <= opts.maxSizeBytes) return file;

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
