// Client-side image shrinking so phone photos (3-5 MB) upload quickly over ngrok.

// File from <input type="file"> -> JPEG data URL, longest edge <= maxEdge, EXIF orientation applied.
export async function fileToDataUrl(file: File, maxEdge = 1600, quality = 0.82): Promise<string> {
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    source = await loadImage(URL.createObjectURL(file)); // older Safari
  }
  return drawToJpeg(source, maxEdge, quality);
}

// Current frame of a playing <video> -> JPEG data URL.
export function videoFrame(video: HTMLVideoElement, maxEdge = 720, quality = 0.72): string | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  return drawToJpeg(video, maxEdge, quality);
}

function drawToJpeg(src: CanvasImageSource & { width?: number; height?: number }, maxEdge: number, quality: number): string {
  const w0 = (src as HTMLVideoElement).videoWidth || (src as ImageBitmap).width || (src as HTMLImageElement).naturalWidth;
  const h0 = (src as HTMLVideoElement).videoHeight || (src as ImageBitmap).height || (src as HTMLImageElement).naturalHeight;
  const scale = Math.min(1, maxEdge / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.drawImage(src, 0, 0, w, h);
  if ('close' in src && typeof (src as ImageBitmap).close === 'function') (src as ImageBitmap).close();
  return canvas.toDataURL('image/jpeg', quality);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read that image"));
    };
    img.src = url;
  });
}

// Evenly picks up to n entries, keeping the first and last.
export function sampleEvenly<T>(list: T[], n: number): T[] {
  if (list.length <= n) return list.slice();
  return Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))]);
}
