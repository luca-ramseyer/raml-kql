import type { Feature, Geometry, Position } from 'geojson';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import world from 'world-atlas/countries-110m.json';

import { countryColumn, numericCode } from './countries';
import { unwrap } from './geometry';

/**
 * The Country Map result renderer. It runs in a sandboxed iframe with no network: the world
 * map (Natural Earth 110m, public domain, via world-atlas) is bundled. The workbench posts the
 * theme's colours and the result (after the user allowed `results.read` for this run).
 */
interface RenderMessage {
  type: 'render';
  table: {
    name: string;
    columns: { name: string; type: string }[];
    rows: unknown[][];
    truncated: boolean;
  };
}

interface ThemeMessage {
  type: 'theme';
  variables: Record<string, string>;
}

const topology = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
const countries = feature(topology, topology.objects.countries).features as Feature<
  Geometry,
  { name: string }
>[];
const names = new Map(countries.map((c) => [c.properties.name.toLowerCase(), String(c.id)]));
const WIDTH = 960;
const HEIGHT = 500;

/** Equirectangular, cropped to 60°S–84°N. Longitudes outside −180…180 are fine (see `unwrap`). */
function project([lon = 0, lat = 0]: Position): [number, number] {
  return [((lon + 180) / 360) * WIDTH, ((84 - lat) / 144) * HEIGHT];
}

const SHIFTS = [-360, 0, 360];

function ringPath(ring: Position[], shift: number): string {
  const points = ring.map(([lon = 0, lat = 0]) => project([lon + shift, lat]));
  return `M${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`;
}

interface Shape {
  id: string;
  name: string;
  d: string;
  /** Centre of the biggest part, for the marker that keeps tiny countries visible. */
  marker: [number, number] | undefined;
}

function shapeOf(geometry: Geometry | null): { d: string; marker: [number, number] | undefined } {
  if (geometry === null) return { d: '', marker: undefined };
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
  let d = '';
  let marker: [number, number] | undefined;
  let largest = -1;
  for (const polygon of polygons) {
    const rings = polygon.map(unwrap);
    for (const ring of rings) for (const shift of SHIFTS) d += ringPath(ring, shift);
    const outer = rings[0];
    if (outer === undefined) continue;
    const lons = outer.map((p) => p[0] ?? 0);
    const lats = outer.map((p) => p[1] ?? 0);
    const width = Math.max(...lons) - Math.min(...lons);
    const height = Math.max(...lats) - Math.min(...lats);
    if (width * height > largest) {
      largest = width * height;
      marker = project([
        (Math.max(...lons) + Math.min(...lons)) / 2,
        (Math.max(...lats) + Math.min(...lats)) / 2,
      ]);
      // Keep the marker inside the map for parts that were shifted past an edge.
      if (marker[0] < 0) marker = [marker[0] + WIDTH, marker[1]];
      if (marker[0] > WIDTH) marker = [marker[0] - WIDTH, marker[1]];
    }
  }
  return { d, marker };
}

const shapes: Shape[] = countries.map((c) => ({
  id: String(c.id),
  name: c.properties.name,
  ...shapeOf(c.geometry),
}));

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function render({ table }: RenderMessage): void {
  const app = document.getElementById('app');
  if (app === null) return;
  app.replaceChildren();
  const column = countryColumn(table.columns, table.rows, names);
  if (column < 0) {
    app.append(
      element(
        'p',
        'No country column found. Add one, for example: | extend Country = tostring(LocationDetails.countryOrRegion)',
      ),
    );
    return;
  }
  // Sum a count column when the query already aggregated, else count rows.
  const countIndex = table.columns.findIndex(
    (c, i) =>
      i !== column &&
      ['long', 'int', 'real'].includes(c.type) &&
      /count|total|^n$|signins|events/i.test(c.name),
  );
  const counts = new Map<string, number>();
  let unmatched = 0;
  for (const row of table.rows) {
    const code = numericCode(row[column], names);
    if (code === undefined) {
      unmatched += 1;
      continue;
    }
    const add = countIndex < 0 ? 1 : Number(row[countIndex]) || 0;
    counts.set(code, (counts.get(code) ?? 0) + add);
  }
  const max = Math.max(1, ...counts.values());

  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', `0 0 ${String(WIDTH)} ${String(HEIGHT)}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Rows per country (${table.columns[column]?.name ?? ''})`);
  const clipId = 'map-clip';
  const defs = document.createElementNS(svgNs, 'defs');
  const clip = document.createElementNS(svgNs, 'clipPath');
  clip.setAttribute('id', clipId);
  const clipRect = document.createElementNS(svgNs, 'rect');
  clipRect.setAttribute('width', String(WIDTH));
  clipRect.setAttribute('height', String(HEIGHT));
  clip.append(clipRect);
  defs.append(clip);
  const group = document.createElementNS(svgNs, 'g');
  group.setAttribute('clip-path', `url(#${clipId})`);
  svg.append(defs, group);
  const markers = document.createElementNS(svgNs, 'g');
  for (const shape of shapes) {
    const path = document.createElementNS(svgNs, 'path');
    path.setAttribute('d', shape.d);
    const count = counts.get(shape.id);
    path.setAttribute('class', count === undefined ? 'country' : 'country hit');
    if (count !== undefined)
      path.setAttribute('fill-opacity', (0.25 + 0.75 * Math.sqrt(count / max)).toFixed(2));
    const title = document.createElementNS(svgNs, 'title');
    title.textContent = `${shape.name}: ${String(count ?? 0)}`;
    path.append(title);
    group.append(path);
    if (count !== undefined && shape.marker !== undefined) {
      // A ring around the country: at world scale, Switzerland is a pixel or two wide.
      const ring = document.createElementNS(svgNs, 'circle');
      ring.setAttribute('cx', shape.marker[0].toFixed(1));
      ring.setAttribute('cy', shape.marker[1].toFixed(1));
      ring.setAttribute('r', '5');
      ring.setAttribute('class', 'marker');
      ring.append(title.cloneNode(true));
      markers.append(ring);
    }
  }
  svg.append(markers);
  const map = element('div');
  map.className = 'map';
  map.append(svg);

  const side = element('aside');
  side.className = 'side';
  side.append(element('h2', 'Top countries'));
  const list = element('table');
  const nameOf = new Map(shapes.map((s) => [s.id, s.name]));
  for (const [code, count] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    const tr = element('tr');
    const cell = element('td', count.toLocaleString());
    cell.className = 'count';
    tr.append(element('td', nameOf.get(code) ?? code), cell);
    list.append(tr);
  }
  side.append(list);
  const notes = [
    unmatched > 0 ? `${unmatched.toLocaleString()} rows without a known country.` : '',
    table.truncated ? 'Only the first 10,000 rows are drawn.' : '',
  ].filter((n) => n !== '');
  for (const note of notes) {
    const p = element('p', note);
    p.className = 'note';
    side.append(p);
  }
  app.append(map, side);
}

window.addEventListener('message', (event: MessageEvent<RenderMessage | ThemeMessage>) => {
  // Only the workbench (the parent) talks to this frame.
  if (event.source !== window.parent) return;
  const message = event.data;
  if (message.type === 'theme') {
    for (const [name, value] of Object.entries(message.variables)) {
      if (name.startsWith('--vscode-')) document.documentElement.style.setProperty(name, value);
    }
  } else {
    render(message);
  }
});
