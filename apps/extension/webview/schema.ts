import type { SchemaDiagram, DiagramTable } from '../src/schema-diagram';
import { btn, h, INIT, rpc, vscode } from './lib';

type Point = { x: number; y: number };
type Layout = { positions: Record<string, Point>; x: number; y: number; zoom: number };
const saved = vscode.getState() as Layout | undefined;
let positions: Record<string, Point> = saved?.positions ?? {};
let x = saved?.x ?? 40;
let y = saved?.y ?? 40;
let zoom = saved?.zoom ?? 1;
let diagram: SchemaDiagram = { tables: [], relations: [] };
const cards = new Map<string, HTMLElement>();
const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
svg.classList.add('schema-links');
const world = h('div.schema-world', null, svg);
const viewport = h('div.schema-viewport', { tabindex: 0, 'aria-label': 'Schema diagram. Drag background to pan; use mouse wheel to zoom.' }, world);
const status = h('span.schema-status');
const scale = h('span', null, '100%');
const search = h('input', {
  placeholder: 'Find table or column…',
  'aria-label': 'Find table or column',
  onInput: () => {
    const query = search.value.toLowerCase();
    for (const table of diagram.tables)
      cards
        .get(table.id)
        ?.classList.toggle('schema-dim', !!query && ![table.table, table.schema ?? '', ...table.columns.map((c) => c.name)].some((name) => name.toLowerCase().includes(query)));
  },
});
function persist(): void {
  vscode.setState({ positions, x, y, zoom });
}
function transform(): void {
  world.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
  viewport.style.backgroundSize = `${24 * zoom}px ${24 * zoom}px`;
  viewport.style.backgroundPosition = `${x}px ${y}px`;
  scale.textContent = `${Math.round(zoom * 100)}%`;
}
function setZoom(value: number, cx = viewport.clientWidth / 2, cy = viewport.clientHeight / 2): void {
  const next = Math.max(0.15, Math.min(2.5, value));
  x = cx - ((cx - x) * next) / zoom;
  y = cy - ((cy - y) * next) / zoom;
  zoom = next;
  transform();
  persist();
}
function arrange(): void {
  positions = {};
  const columns = Math.max(1, Math.ceil(Math.sqrt(diagram.tables.length)));
  let rowY = 0;
  for (let i = 0; i < diagram.tables.length; i += columns) {
    const row = diagram.tables.slice(i, i + columns);
    row.forEach((table, j) => {
      positions[table.id] = { x: j * 350, y: rowY };
    });
    rowY += Math.max(...row.map((table) => 48 + table.columns.length * 28)) + 100;
  }
}
function fit(): void {
  if (!diagram.tables.length) return;
  const minX = Math.min(...diagram.tables.map((t) => positions[t.id].x));
  const minY = Math.min(...diagram.tables.map((t) => positions[t.id].y));
  const maxX = Math.max(...diagram.tables.map((t) => positions[t.id].x + 270));
  const maxY = Math.max(...diagram.tables.map((t) => positions[t.id].y + 48 + t.columns.length * 28));
  zoom = Math.max(0.15, Math.min(1, (viewport.clientWidth - 80) / (maxX - minX), (viewport.clientHeight - 80) / (maxY - minY)));
  x = (viewport.clientWidth - (maxX - minX) * zoom) / 2 - minX * zoom;
  y = (viewport.clientHeight - (maxY - minY) * zoom) / 2 - minY * zoom;
  transform();
  persist();
}
function draw(): void {
  for (const [id, card] of cards) {
    const point = positions[id];
    card.style.left = `${point.x}px`;
    card.style.top = `${point.y}px`;
  }
  svg.replaceChildren();
  const byId = new Map(diagram.tables.map((table) => [table.id, table]));
  for (const relation of diagram.relations) {
    const source = byId.get(relation.source)!;
    const target = byId.get(relation.target)!;
    const a = positions[source.id];
    const b = positions[target.id];
    const right = a.x <= b.x;
    const sx = a.x + (right ? 270 : 0);
    const tx = b.x + (right ? 0 : 270);
    const sy = a.y + 48 + source.columns.findIndex((c) => c.name === relation.sourceColumn) * 28 + 14;
    const ty = b.y + 48 + target.columns.findIndex((c) => c.name === relation.targetColumn) * 28 + 14;
    const bend = Math.max(50, Math.abs(tx - sx) / 2);
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', `M ${sx} ${sy} C ${sx + (right ? bend : -bend)} ${sy}, ${tx + (right ? -bend : bend)} ${ty}, ${tx} ${ty}`);
    const title = document.createElementNS(svg.namespaceURI, 'title');
    title.textContent = `${relation.name}: ${source.table}.${relation.sourceColumn} → ${target.table}.${relation.targetColumn}`;
    path.append(title);
    svg.append(path);
    for (const [px, py, label] of [
      [sx, sy, 'N'],
      [tx, ty, '1'],
    ] as const) {
      const text = document.createElementNS(svg.namespaceURI, 'text');
      text.setAttribute('x', String(px + (label === 'N' ? (right ? 10 : -18) : right ? -18 : 10)));
      text.setAttribute('y', String(py - 7));
      text.textContent = label;
      svg.append(text);
    }
  }
}
function cardFor(table: DiagramTable): HTMLElement {
  const header = h(
    'div.schema-card-header',
    {
      tabindex: 0,
      role: 'button',
      'aria-label': `Move ${table.table} with arrow keys`,
      onKeydown: (event: KeyboardEvent) => {
        const delta: Record<string, Point> = { ArrowLeft: { x: -20, y: 0 }, ArrowRight: { x: 20, y: 0 }, ArrowUp: { x: 0, y: -20 }, ArrowDown: { x: 0, y: 20 } };
        if (!delta[event.key]) return;
        event.preventDefault();
        positions[table.id].x += delta[event.key].x;
        positions[table.id].y += delta[event.key].y;
        draw();
        persist();
      },
    },
    h('strong', null, table.table),
    table.schema ? h('small', null, table.schema) : null,
  );
  header.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    header.setPointerCapture(event.pointerId);
    const start = { ...positions[table.id] };
    const cx = event.clientX;
    const cy = event.clientY;
    const move = (e: PointerEvent) => {
      positions[table.id] = { x: start.x + (e.clientX - cx) / zoom, y: start.y + (e.clientY - cy) / zoom };
      draw();
    };
    const end = () => {
      header.removeEventListener('pointermove', move);
      persist();
    };
    header.addEventListener('pointermove', move);
    header.addEventListener('lostpointercapture', end, { once: true });
  });
  return h(
    'section.schema-card',
    null,
    header,
    table.columns.map((column) => {
      const fk = diagram.relations.some((r) => r.source === table.id && r.sourceColumn === column.name);
      return h(
        'div.schema-column',
        { title: `${column.name}: ${column.type ?? ''}${column.nullable ? ' · nullable' : ''}` },
        h('span.schema-key', null, column.pk ? 'PK' : fk ? 'FK' : '•'),
        h('span.schema-column-name', null, column.name),
        h('span.schema-type', null, column.type ?? ''),
      );
    }),
  );
}
async function load(): Promise<void> {
  refresh.disabled = true;
  status.textContent = 'Loading schema…';
  try {
    diagram = await rpc<SchemaDiagram>('load');
    cards.forEach((card) => card.remove());
    cards.clear();
    const needsLayout = diagram.tables.some((t) => !positions[t.id]);
    if (needsLayout) arrange();
    diagram.tables.forEach((table) => {
      const card = cardFor(table);
      cards.set(table.id, card);
      world.append(card);
    });
    draw();
    if (needsLayout) fit();
    else transform();
    status.textContent = diagram.tables.length
      ? `${diagram.tables.length} tables · ${diagram.relations.length} FK column links${INIT.dialect === 'clickhouse' ? ' · ClickHouse has no foreign keys' : ''}`
      : 'No tables in this schema.';
  } catch (error) {
    status.textContent = `Could not load schema: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    refresh.disabled = false;
  }
}
const refresh = btn('Refresh', {
  icon: 'refresh',
  onClick: () => {
    void load();
  },
});
const toolbar = h(
  'div.schema-toolbar',
  null,
  h('strong', null, INIT.title),
  search,
  refresh,
  btn('Arrange', {
    onClick: () => {
      arrange();
      draw();
      fit();
    },
  }),
  btn('−', { title: 'Zoom out', onClick: () => setZoom(zoom / 1.2) }),
  scale,
  btn('+', { title: 'Zoom in', onClick: () => setZoom(zoom * 1.2) }),
  btn('Fit', { onClick: fit }),
);
viewport.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || (event.target as Element).closest('.schema-card')) return;
  viewport.setPointerCapture(event.pointerId);
  const startX = x;
  const startY = y;
  const cx = event.clientX;
  const cy = event.clientY;
  const move = (e: PointerEvent) => {
    x = startX + e.clientX - cx;
    y = startY + e.clientY - cy;
    transform();
  };
  const end = () => {
    viewport.removeEventListener('pointermove', move);
    persist();
  };
  viewport.addEventListener('pointermove', move);
  viewport.addEventListener('lostpointercapture', end, { once: true });
});
viewport.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    setZoom(zoom * Math.exp(-event.deltaY * 0.001), event.clientX - rect.left, event.clientY - rect.top);
  },
  { passive: false },
);
document
  .getElementById('app')!
  .append(
    toolbar,
    viewport,
    h('div.schema-footer', null, status, h('span', null, 'Drag tables to arrange · Drag canvas to pan · Scroll to zoom · PK primary key / FK foreign key')),
  );
void load();
