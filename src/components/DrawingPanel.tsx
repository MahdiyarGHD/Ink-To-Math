import type { Component } from 'solid-js';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { normalizePoint, shouldAppendPoint } from '../lib/ink';
import type { Stroke } from '../lib/ink';

type DrawingPanelProps = {
  onClear: () => void;
  onConvert: (strokes: Stroke[]) => void;
};

const CANVAS_COLOR = '#f4f4f5';
const CANVAS_LINE_WIDTH = 3;

const cloneStrokes = (strokes: Stroke[]): Stroke[] =>
  strokes.map((stroke) => ({
    points: stroke.points.map((point) => ({ ...point })),
  }));

const DrawingPanel: Component<DrawingPanelProps> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let ctx: CanvasRenderingContext2D | null = null;
  let cssWidth = 0;
  let cssHeight = 0;
  let isDrawing = false;
  let currentStroke: Stroke | null = null;
  const strokes: Stroke[] = [];
  const [hasInk, setHasInk] = createSignal(false);

  const applyContextStyle = (): void => {
    if (!ctx) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = CANVAS_COLOR;
    ctx.lineWidth = CANVAS_LINE_WIDTH;
  };

  const setupContext = (): void => {
    if (!canvasRef) return;
    ctx = canvasRef.getContext('2d');
    applyContextStyle();
  };

  const toCanvasPoint = (point: { x: number; y: number }): { x: number; y: number } => ({
    x: point.x * cssWidth,
    y: point.y * cssHeight,
  });

  const renderStroke = (stroke: Stroke): void => {
    if (!ctx || stroke.points.length === 0) return;
    const [first, ...rest] = stroke.points;
    const start = toCanvasPoint(first);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (const point of rest) {
      const mappedPoint = toCanvasPoint(point);
      ctx.lineTo(mappedPoint.x, mappedPoint.y);
    }
    ctx.stroke();
  };

  const drawPoint = (point: { x: number; y: number }): void => {
    if (!ctx) return;
    const mappedPoint = toCanvasPoint(point);
    const radius = CANVAS_LINE_WIDTH / 2;
    ctx.beginPath();
    ctx.arc(mappedPoint.x, mappedPoint.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = CANVAS_COLOR;
    ctx.fill();
  };

  const drawSegment = (startPoint: { x: number; y: number }, endPoint: { x: number; y: number }): void => {
    if (!ctx) return;
    const start = toCanvasPoint(startPoint);
    const end = toCanvasPoint(endPoint);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  };

  const redraw = (): void => {
    if (!ctx) return;
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    for (const stroke of strokes) renderStroke(stroke);
  };

  const resizeCanvas = (): void => {
    if (!canvasRef || !ctx) return;
    const rect = canvasRef.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    cssWidth = rect.width;
    cssHeight = rect.height;

    const dpr = window.devicePixelRatio || 1;
    canvasRef.width = Math.max(1, Math.floor(rect.width * dpr));
    canvasRef.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    applyContextStyle();
    redraw();
  };

  const mapPointer = (event: PointerEvent): { x: number; y: number } | null => {
    if (!canvasRef) return null;
    if (cssWidth === 0 || cssHeight === 0) {
      resizeCanvas();
      if (cssWidth === 0 || cssHeight === 0) return null;
    }
    const rect = canvasRef.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    return normalizePoint(x, y);
  };

  const handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    event.preventDefault();
    const point = mapPointer(event);
    if (!point) return;

    isDrawing = true;
    currentStroke = { points: [point] };
    strokes.push(currentStroke);
    setHasInk(true);
    drawPoint(point);
  };

  const handlePointerMove = (event: PointerEvent): void => {
    if (!currentStroke || !isDrawing) return;
    const isPointerPressed = event.buttons === 1 || event.pointerType === 'touch' || event.pointerType === 'pen';
    if (!isPointerPressed) return;
    event.preventDefault();
    const point = mapPointer(event);
    if (!point) return;

    const lastPoint = currentStroke.points[currentStroke.points.length - 1];
    if (!lastPoint || !shouldAppendPoint(lastPoint, point)) return;

    currentStroke.points.push(point);
    drawSegment(lastPoint, point);
  };

  const finishStroke = (): void => {
    if (!isDrawing) return;
    if (currentStroke && currentStroke.points.length === 1) {
      const point = currentStroke.points[0];
      currentStroke.points.push({ ...point });
    }
    currentStroke = null;
    isDrawing = false;
  };

  const handleClear = (): void => {
    strokes.length = 0;
    currentStroke = null;
    isDrawing = false;
    setHasInk(false);
    redraw();
    props.onClear();
  };

  const handleConvert = (): void => {
    if (strokes.length === 0) return;
    props.onConvert(cloneStrokes(strokes));
  };

  const handleWindowPointerMove = (event: PointerEvent): void => handlePointerMove(event);
  const handleWindowPointerUp = (): void => finishStroke();
  const handleWindowPointerCancel = (): void => finishStroke();

  onMount(() => {
    if (!canvasRef) return;
    setupContext();
    resizeCanvas();
    resizeObserver = new ResizeObserver(() => resizeCanvas());
    resizeObserver.observe(canvasRef);
    canvasRef.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerCancel);
  });

  onCleanup(() => {
    resizeObserver?.disconnect();
    if (!canvasRef) {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerCancel);
      return;
    }
    canvasRef.removeEventListener('pointerdown', handlePointerDown);
    window.removeEventListener('pointermove', handleWindowPointerMove);
    window.removeEventListener('pointerup', handleWindowPointerUp);
    window.removeEventListener('pointercancel', handleWindowPointerCancel);
  });

  return (
    <section class="panel draw-panel">
      <div class="row">
        <h1 class="title">Ink to Math</h1>
        <span class="tag">Draw Area</span>
      </div>

      <div class="canvas-wrap">
        <canvas ref={canvasRef} aria-label="Ink drawing canvas" />
      </div>

      <div class="actions">
        <button type="button" onClick={handleClear}>
          Clear
        </button>
        <button type="button" class="primary" onClick={handleConvert} disabled={!hasInk()}>
          Convert to Equations
        </button>
      </div>
    </section>
  );
};

export default DrawingPanel;
