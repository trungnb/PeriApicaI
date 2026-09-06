import React, { useRef, useEffect } from 'react';
import { AIDetection } from '../types/dental';
import { PATHOLOGY_DICT } from '../constants/dictionaries';

interface Props {
  imageDataUrl: string;
  detections: AIDetection[];
  selectedId: string | null;
  className?: string;
}

/** Read-only canvas overlay — used in Step 5 (TreatmentRecommendationScreen) */
export const PathologyOverlayCanvas: React.FC<Props> = React.memo(({
  imageDataUrl,
  detections,
  selectedId,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    let isMounted = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!isMounted) return;
      imgRef.current = img;
      render(img);
    };
    img.src = imageDataUrl;

    return () => {
      isMounted = false;
      imgRef.current = null;
    };
  }, [imageDataUrl]);

  useEffect(() => {
    if (!canvasRef.current || !canvasRef.current.parentElement) return;

    let rafId: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (imgRef.current) render(imgRef.current);
      });
    });

    resizeObserver.observe(canvasRef.current.parentElement);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
  }, [detections, selectedId]);

  function render(img: HTMLImageElement) {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const containerW = canvas.parentElement?.clientWidth ?? img.naturalWidth;
    const aspectRatio = img.naturalHeight / img.naturalWidth;
    canvas.width = containerW;
    canvas.height = Math.round(containerW * aspectRatio);

    const scaleX = canvas.width / img.naturalWidth;
    const scaleY = canvas.height / img.naturalHeight;

    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    detections.forEach((det) => {
      // Unlocalised findings must simply be skipped by the overlay drawing pipeline
      const hasGeometry = det.geometryStatus === 'valid' ||
        (!det.geometryStatus && Array.isArray(det.polygonPoints) && det.polygonPoints.length >= 3);
      if (!hasGeometry || !det.polygonPoints || det.polygonPoints.length < 3) {
        return;
      }

      const isSelected = det.id === selectedId;
      const getPt = (p: any): [number, number] => Array.isArray(p) ? [p[0], p[1]] : [p?.x ?? 0, p?.y ?? 0];
      const [p0x, p0y] = getPt(det.polygonPoints[0]);
      ctx.beginPath();
      ctx.moveTo(p0x * scaleX, p0y * scaleY);
      for (let i = 1; i < det.polygonPoints.length; i++) {
        const [px, py] = getPt(det.polygonPoints[i]);
        ctx.lineTo(px * scaleX, py * scaleY);
      }
      ctx.closePath();
      ctx.fillStyle = det.fillColor;
      ctx.fill();
      ctx.strokeStyle = det.color;
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.stroke();

      // Label chip above top-most vertex
      let minY = Infinity;
      let minX = Infinity;
      det.polygonPoints.forEach((rawP) => {
        const [px, py] = getPt(rawP);
        if (py < minY) { minY = py; minX = px; }
      });

      const label = PATHOLOGY_DICT[det.pathologyKey]?.label ?? det.pathologyKey;
      const text = `${label}`;
      ctx.font = `bold 10px system-ui`;
      const tw = ctx.measureText(text).width;
      const lx = Math.max(4, Math.min(canvas.width - tw - 12, minX * scaleX - tw / 2));
      const ly = Math.max(16, minY * scaleY - 8);

      ctx.fillStyle = det.color;
      ctx.fillRect(lx - 4, ly - 12, tw + 8, 15);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, lx, ly);
    });
  }

  return (
    <canvas
      ref={canvasRef}
      className={`w-full rounded-xl ${className}`}
    />
  );
});
