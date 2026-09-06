import React, { useRef, useEffect, useCallback, useState } from 'react';
import { AIDetection } from '../types/dental';
import { PATHOLOGY_DICT } from '../constants/dictionaries';

interface Props {
  imageDataUrl: string;
  detections: AIDetection[];
  selectedId: string | null;
  onPolygonUpdate: (id: string, newPoints: [number, number][]) => void;
  onSelect: (id: string | null) => void;
  className?: string;
}

const VERTEX_RADIUS = 5;
const HIT_RADIUS = 10;

interface DragState {
  detId: string;
  vertexIndex: number; // -1 if dragging the entire polygon
  startX: number;
  startY: number;
  origPoints: [number, number][];
  currentPoints: [number, number][];
}

export const PolygonContourEditor: React.FC<Props> = React.memo(({
  imageDataUrl,
  detections,
  selectedId,
  onPolygonUpdate,
  onSelect,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [canvasState, setCanvasState] = useState({ w: 0, h: 0, scaleX: 1, scaleY: 1 });

  // ─── Load Image & Calculate Canvas Dimensions ──────────────
  useEffect(() => {
    if (!imageDataUrl) return;
    let isMounted = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!isMounted) return;
      imgRef.current = img;
      const container = containerRef.current;
      const containerW = container?.clientWidth || 640;
      const nw = img.naturalWidth || 640;
      const nh = img.naturalHeight || 480;
      const aspectRatio = nh / nw;
      const h = Math.round(containerW * aspectRatio);
      setCanvasState({
        w: containerW,
        h: h || 480,
        scaleX: containerW / nw,
        scaleY: (h || 480) / nh,
      });
    };
    img.onerror = () => {
      if (!isMounted) return;
      setCanvasState({
        w: 640,
        h: 480,
        scaleX: 1,
        scaleY: 1,
      });
    };
    img.src = imageDataUrl;

    return () => {
      isMounted = false;
      imgRef.current = null;
    };
  }, [imageDataUrl]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let rafId: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (imgRef.current && container) {
          const containerW = container.clientWidth || 640;
          const nw = imgRef.current.naturalWidth || 640;
          const nh = imgRef.current.naturalHeight || 480;
          const aspectRatio = nh / nw;
          const h = Math.round(containerW * aspectRatio);
          setCanvasState({
            w: containerW,
            h: h || 480,
            scaleX: containerW / nw,
            scaleY: (h || 480) / nh,
          });
        }
      });
    });

    resizeObserver.observe(container);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
  }, []);

  // ─── Canvas Render Loop ────────────────────────────────────
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    const { w, h, scaleX, scaleY } = canvasState;
    if (!canvas || !img || w === 0) return;

    const ctx = canvas.getContext('2d')!;
    canvas.width = w;
    canvas.height = h;

    // 1. Draw radiograph background
    ctx.drawImage(img, 0, 0, w, h);

    // 2. Draw all polygon contours
    detections.forEach((det) => {
      const isSelected = det.id === selectedId;
      // Use local drafted points if this polygon is currently being dragged
      const points = (dragRef.current && dragRef.current.detId === det.id)
        ? dragRef.current.currentPoints
        : (det.polygonPoints || []);

      if (points.length < 3) return;

      // Draw filled smooth polygon contour
      ctx.beginPath();
      ctx.moveTo(points[0][0] * scaleX, points[0][1] * scaleY);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i][0] * scaleX, points[i][1] * scaleY);
      }
      ctx.closePath();

      ctx.fillStyle = det.fillColor;
      ctx.fill();

      ctx.strokeStyle = det.color;
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.shadowColor = det.color;
      ctx.shadowBlur = isSelected ? 8 : 2;
      ctx.stroke();
      ctx.shadowBlur = 0; // Reset shadow

      // Label chip above top-most vertex
      let minY = Infinity;
      let minX = Infinity;
      points.forEach(([px, py]) => {
        if (py < minY) { minY = py; minX = px; }
      });

      const label = PATHOLOGY_DICT[det.pathologyKey]?.label ?? det.pathologyKey;
      const text = typeof det.confidence === 'number' ? `${label} ${det.confidence}%` : label;
      ctx.font = 'bold 10px system-ui';
      const textW = ctx.measureText(text).width;

      const lx = Math.max(4, Math.min(w - textW - 12, minX * scaleX - textW / 2));
      const ly = Math.max(16, minY * scaleY - 8);

      ctx.fillStyle = det.color;
      ctx.fillRect(lx - 4, ly - 12, textW + 8, 15);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, lx, ly);

      // 3. Draw draggable control vertices for selected polygon
      if (isSelected) {
        points.forEach(([px, py]) => {
          const vx = px * scaleX;
          const vy = py * scaleY;

          ctx.beginPath();
          ctx.arc(vx, vy, VERTEX_RADIUS, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.strokeStyle = det.color;
          ctx.lineWidth = 2;
          ctx.stroke();
        });
      }
    });
  }, [detections, selectedId, canvasState]);

  useEffect(() => {
    render();
  }, [render]);

  // ─── Point in Polygon Test ─────────────────────────────────
  function isPointInsidePolygon(x: number, y: number, points: [number, number][], scaleX: number, scaleY: number): boolean {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i][0] * scaleX, yi = points[i][1] * scaleY;
      const xj = points[j][0] * scaleX, yj = points[j][1] * scaleY;
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // ─── Mouse Event Handlers ──────────────────────────────────
  const getMousePos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleCanvasX = canvasState.w / rect.width;
    const scaleCanvasY = canvasState.h / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleCanvasX,
      y: (e.clientY - rect.top) * scaleCanvasY,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getMousePos(e);
    const { scaleX, scaleY } = canvasState;

    // 1. Check if clicking on a vertex of the currently selected polygon
    if (selectedId) {
      const selDet = detections.find((d) => d.id === selectedId);
      if (selDet && selDet.polygonPoints && selDet.polygonPoints.length >= 3) {
        for (let i = 0; i < selDet.polygonPoints.length; i++) {
          const [px, py] = selDet.polygonPoints[i];
          const dist = Math.hypot(x - px * scaleX, y - py * scaleY);
          if (dist <= HIT_RADIUS) {
            dragRef.current = {
              detId: selDet.id,
              vertexIndex: i,
              startX: x,
              startY: y,
              origPoints: selDet.polygonPoints.map(([px, py]) => [px, py]),
              currentPoints: selDet.polygonPoints.map(([px, py]) => [px, py]),
            };
            e.preventDefault();
            return;
          }
        }
      }
    }

    // 2. Check if clicking inside any polygon
    for (const det of [...detections].reverse()) {
      if (det.polygonPoints && det.polygonPoints.length >= 3 && isPointInsidePolygon(x, y, det.polygonPoints, scaleX, scaleY)) {
        onSelect(det.id);
        dragRef.current = {
          detId: det.id,
          vertexIndex: -1, // Move entire polygon
          startX: x,
          startY: y,
          origPoints: det.polygonPoints.map(([px, py]) => [px, py]),
          currentPoints: det.polygonPoints.map(([px, py]) => [px, py]),
        };
        return;
      }
    }

    onSelect(null);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getMousePos(e);
    const { scaleX, scaleY } = canvasState;
    const canvas = canvasRef.current;

    if (dragRef.current) {
      const { vertexIndex, startX, startY, origPoints } = dragRef.current;
      const dx = (x - startX) / scaleX;
      const dy = (y - startY) / scaleY;

      if (vertexIndex >= 0) {
        // Move single vertex locally
        dragRef.current.currentPoints = origPoints.map(([px, py], i) =>
          i === vertexIndex ? [Math.round(px + dx), Math.round(py + dy)] : [px, py]
        );
      } else {
        // Move whole polygon locally
        dragRef.current.currentPoints = origPoints.map(([px, py]) => [
          Math.round(px + dx),
          Math.round(py + dy),
        ]);
      }
      if (canvas) canvas.style.cursor = 'grabbing';
      requestAnimationFrame(render);
      return;
    }

    // Update cursor hover
    if (selectedId && canvas) {
      const selDet = detections.find((d) => d.id === selectedId);
      if (selDet && selDet.polygonPoints && selDet.polygonPoints.length >= 3) {
        for (let i = 0; i < selDet.polygonPoints.length; i++) {
          const [px, py] = selDet.polygonPoints[i];
          const dist = Math.hypot(x - px * scaleX, y - py * scaleY);
          if (dist <= HIT_RADIUS) {
            canvas.style.cursor = 'pointer';
            return;
          }
        }
      }
    }
    if (canvas) canvas.style.cursor = 'default';
  };

  const handleMouseUp = () => {
    if (dragRef.current) {
      const { detId, currentPoints } = dragRef.current;
      // Commit drafted points to global store ONLY when user releases the mouse
      onPolygonUpdate(detId, currentPoints);
    }
    dragRef.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = 'default';
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <canvas
        ref={canvasRef}
        width={canvasState.w}
        height={canvasState.h}
        className="w-full rounded-xl cursor-default select-none shadow-inner"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
      {canvasState.w === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900 rounded-xl">
          <div className="w-6 h-6 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
});
