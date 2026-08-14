import type { Component } from 'solid-js';
import { Show, createEffect, createMemo, onCleanup, onMount, createSignal } from 'solid-js';
import katex from 'katex';
import type { InkConversion, Stroke } from '../lib/ink';

type EquationPanelProps = {
  conversion: InkConversion | null;
};

const PREVIEW_COLOR = '#f4f4f5';
const PREVIEW_LINE_WIDTH = 2;

const EquationPanel: Component<EquationPanelProps> = (props) => {
  const [copied, setCopied] = createSignal<boolean>(false);

  let canvasRef: HTMLCanvasElement | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let ctx: CanvasRenderingContext2D | null = null;
  let cssWidth = 0;
  let cssHeight = 0;

  const hasResult = createMemo(() => Boolean(props.conversion && props.conversion.commands.length > 0));
  const latexSource = createMemo(() => props.conversion?.latex ?? '\\text{No input}');
  const renderedLatex = createMemo(() =>
    katex.renderToString(latexSource(), {
      throwOnError: false,
      displayMode: true,
      strict: 'warn',
      trust: false,
    }),
  );

  const applyContextStyle = (): void => {
    if (!ctx) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = PREVIEW_COLOR;
    ctx.lineWidth = PREVIEW_LINE_WIDTH;
  };

  const setupContext = (): void => {
    if (!canvasRef) return;
    ctx = canvasRef.getContext('2d');
    applyContextStyle();
  };

  const renderStrokes = (strokes: Stroke[]): void => {
    if (!ctx) return;
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    for (const stroke of strokes) {
      if (stroke.points.length === 0) continue;
      const [first, ...rest] = stroke.points;
      ctx.beginPath();
      ctx.moveTo(first.x * cssWidth, first.y * cssHeight);
      for (const point of rest) ctx.lineTo(point.x * cssWidth, point.y * cssHeight);
      ctx.stroke();
    }
  };

  const redrawPreview = (): void => renderStrokes(props.conversion?.sampledStrokes ?? []);

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
    redrawPreview();
  };

  onMount(() => {
    setupContext();
    resizeCanvas();
    resizeObserver = new ResizeObserver(() => resizeCanvas());
    if (canvasRef) resizeObserver.observe(canvasRef);
  });

  onCleanup(() => {
    resizeObserver?.disconnect();
  });

  createEffect(() => {
    props.conversion;
    redrawPreview();
  });

  let copyTimer: number | undefined;
  const handleCopy = async () => {
    if (!props.conversion?.latexExpanded) return;
    try {
      await navigator.clipboard.writeText(props.conversion.latexExpanded);
      setCopied(true);
      window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(() => setCopied(false), 1400);
    } catch (e) {}
  };

  return (
    <aside class="panel equation-panel" aria-label="Equation panel">
      <div class="panel-header">
        <div>
          <h2 class="title">Equation</h2>
          <p class="desc">Vector commands and redraw preview from your ink input.</p>
        </div>
      </div>

      <div class="preview-canvas-wrap">
        <canvas ref={canvasRef} class="preview-canvas" aria-label="Equation redraw preview canvas" />
        <Show when={!hasResult()}>
          <p class="preview-placeholder">
            No equation yet.<br />
            Draw and convert to generate commands.
          </p>
        </Show>
      </div>

      <div class="section">
        <p class="section-label">LaTeX Preview</p>
        <div class="latex-render" innerHTML={renderedLatex()} />
        <code class="code-block wrap">{latexSource()}</code>
      </div>

      <div class="section">
        <p class="section-label">Equation Commands</p>
        <Show when={props.conversion?.commands.length} fallback={<span class="empty-text">No commands generated yet.</span>}>
          <pre class="code-block wrap">{(props.conversion?.commands ?? []).join('\n')}</pre>
        </Show>
      </div>

      <div class="section">
        <div class="export-row">
          <p class="export-title">Desmos Equations</p>
          <button type="button" class="small" onClick={handleCopy} disabled={!props.conversion?.latexExpanded}>
            {copied() ? 'Copied!' : 'Copy equations'}
          </button>
        </div>
        <Show when={props.conversion?.latexExpanded} fallback={<span class="empty-text">No expanded equations yet.</span>}>
          <pre class="code-block pre">{props.conversion?.latexExpanded}</pre>
        </Show>
      </div>
    </aside>
  );
};

export default EquationPanel;
