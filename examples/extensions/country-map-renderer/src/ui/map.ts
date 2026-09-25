import type { Feature, Geometry, Position } from 'geojson';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import world from 'world-atlas/countries-110m.json';

import { countryColumn, numericCode } from './countries';

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

function project([lon = 0, lat = 0]: Position): string {
  // Equirectangular, cropped to 60°S–84°N.
  const x = ((lon + 180) / 360) * WIDTH;
  const y = ((84 - lat) / 144) * HEIGHT;
  return `${x.toFixed(1)},${y.toFixed(1)}`;
}

function pathOf(geometry: Geometry | null): string {
  if (geometry === null) return '';
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
  return polygons
    .flatMap((polygon) => polygon.map((ring) => `M${ring.map(project).join('L')}Z`))
    .join('');
}

const shapes = countries.map((c) => ({
  id: String(c.id),
  name: c.properties.name,
  d: pathOf(c.geometry),
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
    svg.append(path);
  }
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
