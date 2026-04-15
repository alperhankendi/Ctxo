// Minimal sparkline SVG renderer — no d3 needed.

export function renderSparkline(
  values: readonly number[],
  opts: { width?: number; height?: number; stroke?: string } = {},
): SVGElement {
  const width = opts.width ?? 96;
  const height = opts.height ?? 24;
  const stroke = opts.stroke ?? 'currentColor';
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'sparkline');

  if (values.length === 0) return svg;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : width;

  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const path = document.createElementNS(ns, 'polyline');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', stroke);
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('points', points.join(' '));
  svg.appendChild(path);

  // Emphasis dot on last point
  const last = values[values.length - 1]!;
  const lastX = (values.length - 1) * stepX;
  const lastY = height - ((last - min) / range) * (height - 2) - 1;
  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('cx', lastX.toFixed(2));
  dot.setAttribute('cy', lastY.toFixed(2));
  dot.setAttribute('r', '2');
  dot.setAttribute('fill', stroke);
  svg.appendChild(dot);

  return svg;
}

export function computeTrendDelta(values: readonly number[]): {
  delta: number;
  direction: 'up' | 'down' | 'flat';
} {
  if (values.length < 2) return { delta: 0, direction: 'flat' };
  const first = values[0]!;
  const last = values[values.length - 1]!;
  const delta = last - first;
  const direction = Math.abs(delta) < 1e-6 ? 'flat' : delta > 0 ? 'up' : 'down';
  return { delta, direction };
}
