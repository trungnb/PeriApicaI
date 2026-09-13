export interface CompressionResult {
  dataUrl: string;
  originalSizeKB: number;
  compressedSizeKB: number;
  width: number;
  height: number;
  compressionRatio: number; // For backward compatibility (percentage reduction, e.g., 85)
  
  // High-fidelity medical diagnostics coordinate mapping & performance metrics
  originalWidth: number;
  originalHeight: number;
  scaleX: number;
  scaleY: number;
  processingTimeMs: number;
  outputMime: string;
  qualityUsed: number;
  wasAccelerated: boolean;
}

export interface CompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number; // Starting quality (default 0.90)
  targetMaxSizeKB?: number; // Target size limit (default 1000 KB)
  outputFormat?: 'image/webp' | 'image/jpeg';
}

/**
 * Checks if the browser supports WebP canvas export.
 */
function checkWebPSupport(): boolean {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
  } catch {
    return false;
  }
}

/**
 * Converts a Blob to a base64 Data URL.
 */
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Lỗi chuyển đổi dữ liệu ảnh sang base64.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Main Thread Fallback for Multi-stage Step-down Resizing
 * Reduces scale by steps of 50% max to preserve high contrast dental radiographic details.
 */
function drawScaledCanvas(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number
): HTMLCanvasElement {
  let currentCanvas = document.createElement('canvas');
  let currentCtx = currentCanvas.getContext('2d', { alpha: false });
  
  if (!currentCtx) {
    throw new Error('Canvas 2D context is not supported in fallback mode.');
  }

  currentCanvas.width = srcWidth;
  currentCanvas.height = srcHeight;
  currentCtx.imageSmoothingEnabled = true;
  currentCtx.imageSmoothingQuality = 'high';
  currentCtx.drawImage(source, 0, 0, srcWidth, srcHeight);

  let curW = srcWidth;
  let curH = srcHeight;

  // Step down by half increments to avoid jagged downsampling artifacts
  while (curW / 2 >= targetWidth && curH / 2 >= targetHeight) {
    const nextW = Math.floor(curW / 2);
    const nextH = Math.floor(curH / 2);
    
    const nextCanvas = document.createElement('canvas');
    nextCanvas.width = nextW;
    nextCanvas.height = nextH;
    const nextCtx = nextCanvas.getContext('2d', { alpha: false });
    
    if (nextCtx) {
      nextCtx.imageSmoothingEnabled = true;
      nextCtx.imageSmoothingQuality = 'high';
      nextCtx.drawImage(currentCanvas, 0, 0, curW, curH, 0, 0, nextW, nextH);
      currentCanvas = nextCanvas;
      curW = nextW;
      curH = nextH;
    } else {
      break;
    }
  }

  // Final scaling to reach the exact requested dimensions
  if (curW !== targetWidth || curH !== targetHeight) {
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = targetWidth;
    finalCanvas.height = targetHeight;
    const finalCtx = finalCanvas.getContext('2d', { alpha: false });
    if (finalCtx) {
      finalCtx.imageSmoothingEnabled = true;
      finalCtx.imageSmoothingQuality = 'high';
      finalCtx.drawImage(currentCanvas, 0, 0, curW, curH, 0, 0, targetWidth, targetHeight);
      return finalCanvas;
    }
  }

  return currentCanvas;
}

/**
 * High-performance image compressor utilizing OffscreenCanvas in Web Workers.
 * Offloads decoding, multi-stage resizing, and image formatting to a background thread
 * to guarantee 60fps UI responsive interactions. Includes step-down scaling and adaptive
 * quality control loop specifically tuned for clinical diagnostics.
 */
export async function compressImage(
  source: File | Blob | string,
  options: CompressionOptions = {}
): Promise<CompressionResult> {
  const startTime = performance.now();
  const { 
    maxWidth = 1800, 
    maxHeight = 1800, 
    quality = 0.90,
    targetMaxSizeKB = 1000, // 1MB default optimized size for Gemini Vision API payloads
    outputFormat
  } = options;

  const useWebP = checkWebPSupport() && outputFormat !== 'image/jpeg';
  const targetFormat = useWebP ? 'image/webp' : 'image/jpeg';

  let originalSizeKB = 0;
  let sourceBlob: Blob | null = null;

  // 1. Resolve source to a Blob
  if (source instanceof Blob) {
    sourceBlob = source;
    originalSizeKB = Math.round(source.size / 1024);
  } else if (typeof source === 'string' && source.startsWith('data:')) {
    try {
      const stringLength = source.length - (source.indexOf(',') + 1);
      const sizeInBytes = 4 * Math.ceil(stringLength / 3) * 0.562489;
      originalSizeKB = Math.round(sizeInBytes / 1024);

      const parts = source.split(',');
      const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
      const bstr = atob(parts[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      sourceBlob = new Blob([u8arr], { type: mime });
    } catch {
      throw new Error('Định dạng chuỗi ảnh Base64 không hợp lệ.');
    }
  } else if (typeof source === 'string') {
    try {
      const response = await fetch(source);
      sourceBlob = await response.blob();
      originalSizeKB = Math.round(sourceBlob.size / 1024);
    } catch {
      throw new Error('Không thể tải tệp ảnh từ URL nguồn.');
    }
  }

  if (!sourceBlob) {
    throw new Error('Nguồn ảnh không hợp lệ.');
  }

  // 2. Decode metadata / calculate dimensions
  let origWidth = 0;
  let origHeight = 0;

  try {
    const tempBitmap = await createImageBitmap(sourceBlob);
    origWidth = tempBitmap.width;
    origHeight = tempBitmap.height;
    tempBitmap.close();
  } catch {
    // Canvas-based dimensions fallback on error
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      const objUrl = URL.createObjectURL(sourceBlob!);
      i.onload = () => {
        URL.revokeObjectURL(objUrl);
        resolve(i);
      };
      i.onerror = () => {
        URL.revokeObjectURL(objUrl);
        reject(new Error('Lỗi giải mã ảnh gốc.'));
      };
      i.src = objUrl;
    });
    origWidth = img.width;
    origHeight = img.height;
  }

  // Calculate scaled target boundaries
  let targetWidth = origWidth;
  let targetHeight = origHeight;

  if (targetWidth > maxWidth || targetHeight > maxHeight) {
    if (targetWidth / targetHeight > maxWidth / maxHeight) {
      targetHeight = Math.max(1, Math.round((targetHeight * maxWidth) / targetWidth));
      targetWidth = maxWidth;
    } else {
      targetWidth = Math.max(1, Math.round((targetWidth * maxHeight) / targetHeight));
      targetHeight = maxHeight;
    }
  }

  let compressedBlob: Blob | null = null;
  let finalQualityUsed = quality;
  let wasAccelerated = false;

  // 3. TRY CHROMIUM WEB WORKER & OFFSCREEN CANVAS COMPRESSION
  if (
    typeof window !== 'undefined' && 
    'Worker' in window && 
    'OffscreenCanvas' in window
  ) {
    try {
      const workerCode = `
        self.onmessage = async (e) => {
          const { 
            sourceBlob, 
            origWidth, 
            origHeight, 
            targetWidth, 
            targetHeight, 
            quality, 
            targetMaxSizeKB, 
            targetFormat 
          } = e.data;
          
          try {
            const imageBitmap = await createImageBitmap(sourceBlob);
            // Multi-stage step-down with OffscreenCanvas
            let currentCanvas = new OffscreenCanvas(origWidth, origHeight);
            let currentCtx = currentCanvas.getContext('2d', { alpha: false });
            if (!currentCtx) throw new Error('Failed to get 2D Offscreen context');
            
            currentCtx.imageSmoothingEnabled = true;
            currentCtx.imageSmoothingQuality = 'high';
            currentCtx.drawImage(imageBitmap, 0, 0, origWidth, origHeight);
            imageBitmap.close();

            let curW = origWidth;
            let curH = origHeight;

            // Reduce by step-down factors of 2 for maximum bilinear sampling preservation
            while (curW / 2 >= targetWidth && curH / 2 >= targetHeight) {
              const nextW = Math.floor(curW / 2);
              const nextH = Math.floor(curH / 2);
              const nextCanvas = new OffscreenCanvas(nextW, nextH);
              const nextCtx = nextCanvas.getContext('2d', { alpha: false });
              if (nextCtx) {
                nextCtx.imageSmoothingEnabled = true;
                nextCtx.imageSmoothingQuality = 'high';
                nextCtx.drawImage(currentCanvas, 0, 0, curW, curH, 0, 0, nextW, nextH);
                currentCanvas = nextCanvas;
                curW = nextW;
                curH = nextH;
              } else {
                break;
              }
            }

            // Final exact fit
            if (curW !== targetWidth || curH !== targetHeight) {
              const finalCanvas = new OffscreenCanvas(targetWidth, targetHeight);
              const finalCtx = finalCanvas.getContext('2d', { alpha: false });
              if (finalCtx) {
                finalCtx.imageSmoothingEnabled = true;
                finalCtx.imageSmoothingQuality = 'high';
                finalCtx.drawImage(currentCanvas, 0, 0, curW, curH, 0, 0, targetWidth, targetHeight);
                currentCanvas = finalCanvas;
              }
            }

            // Adaptive quality n-search loop
            let currentQuality = quality;
            let blob = null;
            for (let attempt = 0; attempt < 4; attempt++) {
              blob = await currentCanvas.convertToBlob({
                type: targetFormat,
                quality: currentQuality
              });
              if (!blob) break;
              const currentSizeKB = blob.size / 1024;
              
              if (currentSizeKB <= targetMaxSizeKB || currentQuality <= 0.6) {
                break;
              }
              currentQuality = Math.max(0.5, parseFloat((currentQuality - 0.1).toFixed(2)));
            }

            if (!blob) throw new Error('Offscreen blob creation failed');

            self.postMessage({
              success: true,
              blob,
              width: targetWidth,
              height: targetHeight,
              qualityUsed: currentQuality
            });
          } catch (err) {
            self.postMessage({ success: false, error: err.message });
          }
        };
      `;

      const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(workerBlob);
      const worker = new Worker(workerUrl);

      compressedBlob = await new Promise<Blob>((resolve, reject) => {
        worker.onmessage = (e) => {
          URL.revokeObjectURL(workerUrl);
          worker.terminate();
          if (e.data.success) {
            finalQualityUsed = e.data.qualityUsed;
            resolve(e.data.blob);
          } else {
            reject(new Error(e.data.error));
          }
        };

        worker.onerror = (err) => {
          URL.revokeObjectURL(workerUrl);
          worker.terminate();
          reject(err);
        };

        worker.postMessage({
          sourceBlob,
          origWidth,
          origHeight,
          targetWidth,
          targetHeight,
          quality,
          targetMaxSizeKB,
          targetFormat
        });
      });

      wasAccelerated = true;
    } catch (workerErr) {
      console.warn('[Web Worker OffscreenCanvas skipped, executing main thread fallback]:', workerErr);
    }
  }

  // 4. MAIN THREAD FALLBACK FOR COMPRESSION
  if (!compressedBlob) {
    const fallbackImage = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      const objUrl = URL.createObjectURL(sourceBlob!);
      i.onload = () => {
        URL.revokeObjectURL(objUrl);
        resolve(i);
      };
      i.onerror = () => {
        URL.revokeObjectURL(objUrl);
        reject(new Error('Lỗi giải mã ảnh cho phương án dự phòng.'));
      };
      i.src = objUrl;
    });

    // Step-down scale canvas
    const scaledCanvas = drawScaledCanvas(fallbackImage, origWidth, origHeight, targetWidth, targetHeight);
    
    // Adaptive quality loop on Main thread
    let currentQuality = quality;
    for (let attempt = 0; attempt < 4; attempt++) {
      const tempBlob = await new Promise<Blob | null>((resolve) => {
        scaledCanvas.toBlob(
          (b) => resolve(b),
          targetFormat,
          currentQuality
        );
      });

      if (!tempBlob) break;
      compressedBlob = tempBlob;
      const currentSizeKB = tempBlob.size / 1024;

      if (currentSizeKB <= targetMaxSizeKB || currentQuality <= 0.6) {
        break;
      }
      currentQuality = Math.max(0.5, parseFloat((currentQuality - 0.1).toFixed(2)));
    }
    
    finalQualityUsed = currentQuality;
  }

  if (!compressedBlob) {
    throw new Error('Nén ảnh thất bại hoàn toàn.');
  }

  // 5. Build response base64 & stats
  const compressedDataUrl = await blobToDataURL(compressedBlob);
  const compressedSizeKB = parseFloat((compressedBlob.size / 1024).toFixed(1));
  
  // Calculate reduction ratio
  const ratio = originalSizeKB > 0 ? Math.round((1 - compressedSizeKB / originalSizeKB) * 100) : 0;
  
  // High fidelity scale ratios
  const scaleX = parseFloat((targetWidth / origWidth).toFixed(4));
  const scaleY = parseFloat((targetHeight / origHeight).toFixed(4));
  const processingTimeMs = Math.round(performance.now() - startTime);

  return {
    dataUrl: compressedDataUrl,
    originalSizeKB,
    compressedSizeKB,
    width: targetWidth,
    height: targetHeight,
    compressionRatio: Math.max(0, ratio),
    originalWidth: origWidth,
    originalHeight: origHeight,
    scaleX,
    scaleY,
    processingTimeMs,
    outputMime: targetFormat,
    qualityUsed: finalQualityUsed,
    wasAccelerated
  };
}

export const DEFAULT_ANALYSIS_IMAGE_OPTIONS: Readonly<CompressionOptions> = {
  maxWidth: 1200,
  maxHeight: 1200,
  quality: 0.88,
  targetMaxSizeKB: 1000,
};

export interface PreparedAnalysisImage {
  dataUrl: string;
  cleanBase64: string;
  mimeType: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  processingTimeMs: number;
  wasCompressed: boolean;
}

/**
 * Extracts clean base64 data and mimeType from a data URL string.
 */
export function extractDataUrlMeta(dataUrl: string): { cleanBase64: string; mimeType: string } {
  let cleanBase64 = dataUrl;
  let mimeType = 'image/jpeg';
  if (dataUrl.startsWith('data:')) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      mimeType = match[1];
      cleanBase64 = match[2];
    } else {
      cleanBase64 = cleanBase64.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');
    }
  }
  return { cleanBase64, mimeType };
}

/**
 * Reads natural image dimensions from a Data URL without performing canvas drawing or re-encoding.
 */
export function getImageDimensionsFromDataUrl(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth || img.width || 640,
        height: img.naturalHeight || img.height || 480,
      });
    };
    img.onerror = () => reject(new Error('Lỗi nạp hình ảnh để đọc kích thước'));
    img.src = dataUrl;
  });
}

/**
 * Standardized helper for preparing radiograph images before analysis across both pipelines.
 * Enforces compression to <= 1200px (or custom options), extracts dimensions, and ensures clean base64/mimeType.
 * Reuses already-compressed prepared images without re-compressing or re-encoding.
 */
export async function prepareAnalysisImage(
  source: File | Blob | string,
  options: CompressionOptions = DEFAULT_ANALYSIS_IMAGE_OPTIONS,
  existingMetrics?: Partial<CompressionResult> | null
): Promise<PreparedAnalysisImage> {
  // Case A: source is already a prepared data URL
  if (typeof source === 'string' && source.startsWith('data:image/')) {
    const { cleanBase64, mimeType } = extractDataUrlMeta(source);

    // If dimensions already exist in metrics, reuse immediately (0ms, 0 loss)
    if (existingMetrics?.width && existingMetrics?.height) {
      return {
        dataUrl: source,
        cleanBase64,
        mimeType: existingMetrics.outputMime || mimeType,
        width: existingMetrics.width,
        height: existingMetrics.height,
        originalWidth: existingMetrics.originalWidth || existingMetrics.width,
        originalHeight: existingMetrics.originalHeight || existingMetrics.height,
        processingTimeMs: existingMetrics.processingTimeMs || 0,
        wasCompressed: false,
      };
    }

    // Otherwise, decode natural dimensions without re-encoding
    try {
      const dims = await getImageDimensionsFromDataUrl(source);
      return {
        dataUrl: source,
        cleanBase64,
        mimeType,
        width: dims.width,
        height: dims.height,
        originalWidth: existingMetrics?.originalWidth || dims.width,
        originalHeight: existingMetrics?.originalHeight || dims.height,
        processingTimeMs: 0,
        wasCompressed: false,
      };
    } catch {
      // Fall through to compressImage if decoding failed
    }
  }

  // Case B: source is a File, Blob, or blob: URL that requires initial compression
  let resolvedSource: File | Blob | string = source;

  if (typeof source === 'string' && source.startsWith('blob:')) {
    try {
      const resp = await fetch(source);
      resolvedSource = await resp.blob();
    } catch {
      resolvedSource = source;
    }
  }

  const comp = await compressImage(resolvedSource, {
    maxWidth: options.maxWidth ?? 1200,
    maxHeight: options.maxHeight ?? 1200,
    quality: options.quality ?? 0.88,
    targetMaxSizeKB: options.targetMaxSizeKB ?? 1000,
  });

  const { cleanBase64, mimeType } = extractDataUrlMeta(comp.dataUrl);

  return {
    dataUrl: comp.dataUrl,
    cleanBase64,
    mimeType: comp.outputMime || mimeType,
    width: comp.width,
    height: comp.height,
    originalWidth: comp.originalWidth,
    originalHeight: comp.originalHeight,
    processingTimeMs: comp.processingTimeMs,
    wasCompressed: comp.width !== comp.originalWidth || comp.height !== comp.originalHeight || comp.compressionRatio > 0,
  };
}
