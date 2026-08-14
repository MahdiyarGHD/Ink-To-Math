export type NormalizedPoint = {
  x: number;
  y: number;
};

export type Stroke = {
  points: NormalizedPoint[];
};

export type InkConversion = {
  commands: string[];
  latex: string;
  sampledStrokes: Stroke[];
  latexExpanded?: string;
};

const MIN_POINT_DELTA = 0.0025;
const COEFF_SCALE = 1_000_000;
const COSINE_TERMS = 72;
const RESAMPLE_POINTS = 180;
const PREVIEW_POINTS_PER_STROKE = 260;
const PREVIEW_MARGIN = 0.08;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const quantizeCoeff = (value: number): number => Math.round(value * COEFF_SCALE);
const dequantizeCoeff = (value: number): number => value / COEFF_SCALE;

export const normalizePoint = (x: number, y: number): NormalizedPoint => ({
  x: clamp01(x),
  y: clamp01(y),
});

export const shouldAppendPoint = (
  lastPoint: NormalizedPoint,
  nextPoint: NormalizedPoint,
): boolean => {
  const dx = nextPoint.x - lastPoint.x;
  const dy = nextPoint.y - lastPoint.y;
  return dx * dx + dy * dy >= MIN_POINT_DELTA * MIN_POINT_DELTA;
};

type CosineStroke = {
  cx: number[];
  cy: number[];
};

const buildResampledStroke = (points: NormalizedPoint[], sampleCount: number): NormalizedPoint[] => {
  if (points.length === 0) {
    return [];
  }

  if (points.length === 1 || sampleCount <= 2) {
    const point = points[0];
    return Array.from({ length: Math.max(sampleCount, 2) }, () => ({ x: point.x, y: point.y }));
  }

  const lengths: number[] = [0];
  let totalLength = 0;
  for (let i = 1; i < points.length; i += 1) {
    totalLength += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    lengths.push(totalLength);
  }

  if (totalLength === 0) {
    const point = points[0];
    return Array.from({ length: sampleCount }, () => ({ x: point.x, y: point.y }));
  }

  const sampled: NormalizedPoint[] = [];
  let segment = 1;
  for (let i = 0; i < sampleCount; i += 1) {
    const target = (i / (sampleCount - 1)) * totalLength;
    while (segment < lengths.length - 1 && lengths[segment] < target) {
      segment += 1;
    }

    const d0 = lengths[segment - 1];
    const d1 = lengths[segment];
    const p0 = points[segment - 1];
    const p1 = points[segment];
    const ratio = d1 === d0 ? 0 : (target - d0) / (d1 - d0);
    sampled.push({
      x: p0.x + (p1.x - p0.x) * ratio,
      y: p0.y + (p1.y - p0.y) * ratio,
    });
  }

  return sampled;
};

const normalizeSprite = (strokes: Stroke[]): { strokes: Stroke[]; centerX: number; centerY: number; scale: number } => {
  const allPoints = strokes.flatMap((stroke) => stroke.points);
  if (allPoints.length === 0) {
    return { strokes: [], centerX: 0, centerY: 0, scale: 1 };
  }

  const centerX = allPoints.reduce((sum, point) => sum + point.x, 0) / allPoints.length;
  const centerY = allPoints.reduce((sum, point) => sum + point.y, 0) / allPoints.length;
  const meanRadiusSq =
    allPoints.reduce((sum, point) => {
      const dx = point.x - centerX;
      const dy = point.y - centerY;
      return sum + dx * dx + dy * dy;
    }, 0) / allPoints.length;
  const scale = Math.sqrt(Math.max(meanRadiusSq, 1e-8));

  return {
    strokes: strokes.map((stroke) => ({
      points: stroke.points.map((point) => ({
        x: (point.x - centerX) / scale,
        y: (point.y - centerY) / scale,
      })),
    })),
    centerX,
    centerY,
    scale,
  };
};

const computeCosineCoefficients = (values: number[], terms: number): number[] => {
  const n = values.length;
  const coeffs = Array.from({ length: terms + 1 }, () => 0);

  for (let k = 0; k <= terms; k += 1) {
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      const theta = (Math.PI * k * (i + 0.5)) / n;
      sum += values[i] * Math.cos(theta);
    }
    coeffs[k] = (2 * sum) / n;
  }

  coeffs[0] *= 0.5;
  return coeffs;
};

const strokeToCosine = (stroke: Stroke): CosineStroke => {
  const sampled = buildResampledStroke(stroke.points, RESAMPLE_POINTS);
  const xs = sampled.map((point) => point.x);
  const ys = sampled.map((point) => point.y);
  return {
    cx: computeCosineCoefficients(xs, COSINE_TERMS),
    cy: computeCosineCoefficients(ys, COSINE_TERMS),
  };
};

const encodeArray = (values: number[]): string => values.map((value) => quantizeCoeff(value)).join(',');

const decodeArray = (encoded: string): number[] =>
  encoded
    .split(',')
    .map((token) => Number(token))
    .filter((value) => Number.isFinite(value))
    .map((value) => dequantizeCoeff(value));

const buildStrokeCommand = (coeffs: CosineStroke, index: number): string =>
  `stroke_${index + 1}:B=cos;K=${COSINE_TERMS};cx=${encodeArray(coeffs.cx)};cy=${encodeArray(coeffs.cy)}`;

const parseStrokeCommand = (command: string): CosineStroke | null => {
  const separator = command.indexOf(':');
  if (separator < 0) {
    return null;
  }

  const entries = command
    .slice(separator + 1)
    .split(';')
    .map((entry) => entry.split('='))
    .filter((entry): entry is [string, string] => entry.length === 2);

  const map = new Map<string, string>(entries.map(([key, value]) => [key.trim(), value.trim()]));
  const cx = decodeArray(map.get('cx') ?? '');
  const cy = decodeArray(map.get('cy') ?? '');
  const expected = COSINE_TERMS + 1;

  if (cx.length !== expected || cy.length !== expected) {
    return null;
  }

  return { cx, cy };
};

const evaluateCosine = (coeffs: number[], t: number): number => {
  let value = coeffs[0];
  for (let k = 1; k <= COSINE_TERMS; k += 1) {
    value += coeffs[k] * Math.cos(Math.PI * k * t);
  }
  return value;
};

const reconstructStroke = (coeffs: CosineStroke, sampleCount: number): Stroke => {
  const points: NormalizedPoint[] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / (sampleCount - 1);
    points.push({
      x: evaluateCosine(coeffs.cx, t),
      y: evaluateCosine(coeffs.cy, t),
    });
  }
  return { points };
};

const fitStrokesToPreview = (strokes: Stroke[]): Stroke[] => {
  const points = strokes.flatMap((stroke) => stroke.points);
  if (points.length === 0) {
    return [];
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  const width = Math.max(maxX - minX, 1e-6);
  const height = Math.max(maxY - minY, 1e-6);
  const scale = Math.min((1 - PREVIEW_MARGIN * 2) / width, (1 - PREVIEW_MARGIN * 2) / height);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return strokes.map((stroke) => ({
    points: stroke.points.map((point) =>
      normalizePoint(0.5 + (point.x - centerX) * scale, 0.5 + (point.y - centerY) * scale),
    ),
  }));
};
export function buildExpandedEquations(
  cosineStrokes: { cx: number[]; cy: number[] }[],
  {
    terms = COSINE_TERMS,
    coefThreshold = 1e-7,
    decimals = 6,
    transform,
  }: {
    terms?: number;
    coefThreshold?: number;
    decimals?: number;
    transform?: { X: number; Y: number; S: number } | null;
  } = {},
): string {
  const fmt = (n: number | undefined | null) => {
    if (n === undefined || n === null) return null;
    if (Math.abs(n) < coefThreshold) return null;
    const val = Math.abs(Number(n));
    const s = val < 1e-12 ? '0' : val.toFixed(decimals);
    return (n < 0 ? '-' : '') + s;
  };

  const lines: string[] = [];

  let tx: string | null = null;
  let ty: string | null = null;
  let tS: string | null = null;
  if (transform) {
    tx = transform.X.toFixed(decimals);
    ty = transform.Y.toFixed(decimals);
    tS = transform.S.toFixed(decimals);
  }

  cosineStrokes.forEach((st, i) => {
    const partsX: string[] = [];
    const partsY: string[] = [];

    const c0x = fmt(st.cx[0]) ?? '0';
    const c0y = fmt(st.cy[0]) ?? '0';

    for (let k = 1; k <= terms; k += 1) {
      const ax = fmt(st.cx[k]);
      if (ax !== null) {
        const freq = k === 1 ? '\\pi t' : `${k}\\pi t`;
        partsX.push(`${ax}\\cos(${freq})`);
      }
      const ay = fmt(st.cy[k]);
      if (ay !== null) {
        const freq = k === 1 ? '\\pi t' : `${k}\\pi t`;
        partsY.push(`${ay}\\cos(${freq})`);
      }
    }

    const innerX = [c0x, ...partsX].filter(Boolean).join(' + ').replace(/\+\s*-/g, ' - ');
    const innerY = [c0y, ...partsY].filter(Boolean).join(' + ').replace(/\+\s*-/g, ' - ');

    let finalX: string;
    let finalY: string;
    if (transform && tx !== null && tS !== null) {
      finalX = `${tx} + ${tS}(${innerX})`;
      finalY = `${ty} + ${tS}(${innerY})`;
    } else {
      finalX = innerX;
      finalY = innerY;
    }

    // Clean Desmos-ready output without comments or LaTeX sizing artifacts
    lines.push(`x_${i + 1}(t) = ${finalX}`);
    lines.push(`y_${i + 1}(t) = ${finalY}`);
    lines.push('');
  });

  return lines.join('\n').trim();
}

export const convertStrokesToInk = (rawStrokes: Stroke[]): InkConversion => {
  const usableStrokes = rawStrokes.filter((stroke) => stroke.points.length > 0);
  if (usableStrokes.length === 0) {
    return {
      commands: [],
      latex: '\\text{No input}',
      sampledStrokes: [],
    };
  }

  const normalizedResult = normalizeSprite(usableStrokes);
  const normalizedStrokes = normalizedResult.strokes;
  const { centerX, centerY, scale } = normalizedResult;

  const cosineStrokes = normalizedStrokes.map(strokeToCosine);
  const commands = cosineStrokes.map(buildStrokeCommand);
  const reconstructed = commands
    .map(parseStrokeCommand)
    .filter((stroke): stroke is CosineStroke => stroke !== null)
    .map((stroke) => reconstructStroke(stroke, PREVIEW_POINTS_PER_STROKE));

  return {
    commands,
    latex: `x_i(t) = X + S \\left( c_{i,0}^{(x)} + \\sum_{k=1}^{${COSINE_TERMS}} c_{i,k}^{(x)} \\cos(\\pi k t) \\right), \\quad y_i(t) = Y + S \\left( c_{i,0}^{(y)} + \\sum_{k=1}^{${COSINE_TERMS}} c_{i,k}^{(y)} \\cos(\\pi k t) \\right)`,
    latexExpanded: buildExpandedEquations(cosineStrokes, {
      terms: 20,
      coefThreshold: 1e-4,
      decimals: 3,
      transform: { X: centerX, Y: centerY, S: scale },
    }),
    sampledStrokes: fitStrokesToPreview(reconstructed),
  };
};
