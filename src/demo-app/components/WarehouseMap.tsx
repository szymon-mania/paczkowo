import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  CSSProperties,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  Boxes,
  Building2,
  Check,
  CheckCircle2,
  Layers3,
  Map as MapIcon,
  Maximize2,
  Move,
  PackageOpen,
  Layers2,
  Pencil,
  PenLine,
  Plus,
  Redo2,
  Rows3,
  SquareDashedMousePointer,
  Thermometer,
  Trash2,
  Type,
  Undo2,
  Unlink,
  Warehouse,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  deleteLocation,
  getWarehouseMap,
  listProducts,
  type StockProduct,
  upsertLocation,
  type LocationInput,
  type LocationKind,
  type LocationMeta,
  type WarehouseMap as WarehouseMapData,
  type WarehouseNode,
} from "../lib/stockApi";
import { T, translateMessage, useI18n } from "../lib/i18n";
import "./WarehouseMap.css";

// ─────────────────────────────────────────────────────────────────────────────
// Edytor planu magazynu — nieskończone płótno:
//  • współrzędne elementów w PIKSELACH świata (absolutne), zoom do kursora,
//  • siatka ekranowa scalająca kratki przy oddalaniu, pan ograniczony do treści,
//  • gesty na listenerach window (niezawodny drag), snap do kratki (Shift = wolny),
//  • przynależność do strefy = parent_id elementu wskazuje strefę (zone),
//  • ściany rysowane PUNKTAMI (klik-klik…, dwuklik/Enter kończy, Esc anuluje),
//  • zaznaczenie → pływający panel na dole-środku płótna (zero bocznych paneli).
// ─────────────────────────────────────────────────────────────────────────────
const GRID = 32;
const SNAP = 16;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const KEEP_VISIBLE = 140;
const WALL_THICK = 18;   // grubość ściany (px świata)
const VERTEX = 13;       // rozmiar uchwytu narożnika na ekranie (px)
const SECTION_MARGIN = 24;
const WALL_COLOR = "#3a4250";

const PALETTE = ["#6c5fc7", "#4b82d0", "#2f9e73", "#d88935", "#b4794b", "#5a6b7b", "#c14953", "#7a5cd0"];

const panel: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12 };
const button: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 34, padding: "7px 11px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", cursor: "pointer", fontSize: 12.5, fontWeight: 650 };
const primary: CSSProperties = { ...button, background: "var(--accent)", color: "#fff", borderColor: "transparent" };
const field: CSSProperties = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 };

const KIND_KEY: Record<LocationKind, T> = {
  warehouse: T.wh_kind_warehouse,
  building: T.wh_kind_building,
  zone: T.wh_kind_zone,
  rack: T.wh_kind_rack,
  bin: T.wh_kind_bin,
};

type Box = Pick<WarehouseNode, "x" | "y" | "width" | "height">;
type Point = { x: number; y: number };
type View = { x: number; y: number; z: number };
type Rect = { x: number; y: number; w: number; h: number };
type Seg = { x1: number; y1: number; x2: number; y2: number };
type Cmd = { undo: () => Promise<void>; redo: () => Promise<void> };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const snap = (v: number) => Math.round(v / SNAP) * SNAP;
const mod = (a: number, n: number) => ((a % n) + n) % n;

function heatColor(occupied: number, hasCapacity: boolean) {
  if (!hasCapacity) return "#94a3b8";
  if (occupied >= 90) return "#dc2626";
  if (occupied >= 70) return "#e2673b";
  if (occupied >= 40) return "#d9a520";
  if (occupied > 0) return "#2f9e73";
  return "#7d99b4";
}

function iconFor(kind: LocationKind, size = 16) {
  if (kind === "warehouse") return <Warehouse size={size} />;
  if (kind === "building") return <Building2 size={size} />;
  if (kind === "zone") return <Layers3 size={size} />;
  if (kind === "rack") return <Boxes size={size} />;
  return <PackageOpen size={size} />;
}

function pct(units: number, capacity: number) {
  return capacity > 0 ? Math.min(100, Math.round((units / capacity) * 100)) : 0;
}

function inputFromNode(node: WarehouseNode, patch: Partial<LocationInput> = {}): LocationInput {
  return {
    id: node.id,
    parentId: node.parentId,
    kind: node.kind,
    name: node.name,
    code: node.code,
    color: node.color,
    capacity: node.capacity,
    pickable: node.pickable,
    priority: node.priority,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    shape: node.shape,
    rotation: node.rotation,
    meta: node.meta,
    ...patch,
  };
}

function defaultSize(kind: LocationKind): Pick<Box, "width" | "height"> {
  if (kind === "zone") return { width: 480, height: 384 };
  if (kind === "rack") return { width: 96, height: 256 };
  if (kind === "bin") return { width: 96, height: 96 };
  return { width: 96, height: 96 };
}

// Kontur sumy prostokątów — obwódka strefy biegnie po zewnętrznych krawędziach
// elementów; wspólne krawędzie znikają (blok → prostokąt, układ L → kontur L).
function unionOutline(rects: Rect[]): Seg[] {
  const eps = 0.75;
  const covered = (px: number, py: number) => rects.some((r) => px > r.x + 0.01 && px < r.x + r.w - 0.01 && py > r.y + 0.01 && py < r.y + r.h - 0.01);
  const xs = Array.from(new Set(rects.flatMap((r) => [r.x, r.x + r.w]))).sort((a, b) => a - b);
  const ys = Array.from(new Set(rects.flatMap((r) => [r.y, r.y + r.h]))).sort((a, b) => a - b);
  const segs: Seg[] = [];
  for (const r of rects) {
    for (const [edgeY, outY] of [[r.y, r.y - eps], [r.y + r.h, r.y + r.h + eps]] as const) {
      const bounds = xs.filter((x) => x >= r.x - eps && x <= r.x + r.w + eps);
      for (let i = 0; i < bounds.length - 1; i++) {
        const xa = bounds[i], xb = bounds[i + 1];
        if (!covered((xa + xb) / 2, outY)) segs.push({ x1: xa, y1: edgeY, x2: xb, y2: edgeY });
      }
    }
    for (const [edgeX, outX] of [[r.x, r.x - eps], [r.x + r.w, r.x + r.w + eps]] as const) {
      const bounds = ys.filter((y) => y >= r.y - eps && y <= r.y + r.h + eps);
      for (let i = 0; i < bounds.length - 1; i++) {
        const ya = bounds[i], yb = bounds[i + 1];
        if (!covered(outX, (ya + yb) / 2)) segs.push({ x1: edgeX, y1: ya, x2: edgeX, y2: yb });
      }
    }
  }
  return segs;
}

// Bounding box łamanej (punkty ściany).
function ptsBBox(pts: Point[]): Box {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(1, Math.max(...xs) - minX), height: Math.max(1, Math.max(...ys) - minY) };
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export default function WarehouseMap(_props: { onStockChanged: () => void }) {
  const { t } = useI18n();
  const [data, setData] = useState<WarehouseMapData | null>(null);
  const [activeBuildingId, setActiveBuildingId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [editing, setEditing] = useState<{ node?: WarehouseNode; parentId?: number | null; kind?: LocationKind } | null>(null);
  const [editMode, setEditMode] = useState(true);
  const [heatmap, setHeatmap] = useState(false);
  const [showZones, setShowZones] = useState(true);   // nakładki stref potrafią zasłaniać drobne elementy
  const [tool, setTool] = useState<"select" | "wall" | "text" | "marquee">("select");
  const [wallPts, setWallPts] = useState<Point[]>([]);        // rysowana łamana
  const [wallCursor, setWallCursor] = useState<Point | null>(null);
  const [wallEdit, setWallEdit] = useState<Record<number, Point[]>>({}); // edycja punktów istniejących ścian
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null); // ramka zaznaczania (px ekranu)
  const [view, setViewState] = useState<View>({ x: 60, y: 40, z: 0.8 });
  const [drafts, setDrafts] = useState<Record<number, Box>>({});
  const [nameDraft, setNameDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<WarehouseNode | null>(null); // popup „usuń podwórko?"
  const [products, setProducts] = useState<StockProduct[]>([]);             // co fizycznie leży w miejscach
  const [contentsOpen, setContentsOpen] = useState(false);                  // rozwinięta lista zawartości
  const [, setHistVer] = useState(0);      // wymusza przerysowanie przycisków cofnij/ponów
  const canvasRef = useRef<HTMLDivElement>(null);
  const clipboardRef = useRef<WarehouseNode[]>([]);
  const viewRef = useRef<View>(view);
  const canvasNodesRef = useRef<WarehouseNode[]>([]);
  const migratedRef = useRef(false);
  const undoStack = useRef<Cmd[]>([]);
  const redoStack = useRef<Cmd[]>([]);

  const setView = (v: View) => { viewRef.current = v; setViewState(v); };

  // ── Dane ──────────────────────────────────────────────────────────────────
  const nodes = data?.nodes ?? [];
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const children = (id: number) => nodes
    .filter((node) => node.parentId === id)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  const warehouses = nodes.filter((node) => node.kind === "warehouse");
  const buildings = nodes.filter((node) => node.kind === "building");
  const activeBuilding = activeBuildingId ? byId.get(activeBuildingId) ?? null : null;
  const primaryId = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;
  const selected = primaryId ? byId.get(primaryId) ?? null : null;

  // Płaski widok budynku: strefy i ściany są dziećmi budynku, a regały/palety
  // dziećmi budynku LUB strefy (parent_id = członkostwo, pozycje absolutne).
  const buildingKids = activeBuilding ? children(activeBuilding.id) : [];
  const isSectionNode = (n: WarehouseNode) => n.kind === "zone" && n.shape !== "wall" && n.shape !== "text";
  const sections = buildingKids.filter(isSectionNode);
  const walls = buildingKids.filter((n) => n.shape === "wall");
  const texts = buildingKids.filter((n) => n.shape === "text");
  const isElement = (n: WarehouseNode) => (n.kind === "rack" || n.kind === "bin") && n.shape !== "wall" && n.shape !== "text";
  const elements = [
    ...buildingKids.filter(isElement),
    ...sections.flatMap((s) => children(s.id).filter(isElement)),
  ];
  const canvasNodes = [...sections, ...walls, ...texts, ...elements];
  const selectedElements = selectedIds.map((id) => byId.get(id)).filter((n): n is WarehouseNode => !!n && isElement(n));
  const membersOf = (section: WarehouseNode) => children(section.id).filter(isElement);
  const boxOf = (n: WarehouseNode): Box => drafts[n.id] ?? n;

  useEffect(() => { canvasNodesRef.current = canvasNodes; });

  // Węzeł kontekstowy dla pływającego panelu (nie pokazujemy go dla budynków).
  const ctxNode = selected && selected.kind !== "building" && selected.kind !== "warehouse" ? selected : null;
  const isMulti = selectedElements.length > 1;
  useEffect(() => { setNameDraft(ctxNode?.name ?? ""); }, [primaryId]);

  // Stara mapa trzymała pozycje w % świata 2400×1600 px — przelicz raz na piksele.
  const migrateLegacy = async (all: WarehouseNode[]) => {
    if (migratedRef.current) return false;
    const updates: { node: WarehouseNode; box: Box }[] = [];
    for (const b of all.filter((n) => n.kind === "building")) {
      const kids = all.filter((n) => n.parentId === b.id);
      if (!kids.length) continue;
      const legacy = kids.every((k) => k.x >= 0 && k.y >= 0 && k.x + k.width <= 101 && k.y + k.height <= 101 && k.width <= 60 && k.height <= 60);
      if (!legacy) continue;
      for (const k of kids) {
        updates.push({ node: k, box: { x: Math.round(k.x * 24), y: Math.round(k.y * 16), width: Math.max(SNAP, Math.round(k.width * 24)), height: Math.max(SNAP, Math.round(k.height * 16)) } });
      }
    }
    if (!updates.length) return false;
    migratedRef.current = true;
    try { for (const u of updates) await upsertLocation(inputFromNode(u.node, u.box)); }
    catch { /* best effort */ }
    return true;
  };

  const reload = async () => {
    try {
      let response = await getWarehouseMap();
      if (await migrateLegacy(response.nodes)) response = await getWarehouseMap();
      setData(response);
      setErr(null);
      const buildingList = response.nodes.filter((n) => n.kind === "building");
      setActiveBuildingId((id) => id && buildingList.some((n) => n.id === id) ? id : buildingList[0]?.id ?? null);
    } catch (e) {
      setErr(translateMessage(e, t));
    }
  };

  useEffect(() => { reload(); listProducts().then(setProducts).catch(() => {}); }, []);
  useEffect(() => { setContentsOpen(false); }, [primaryId]);

  // Co leży w danym miejscu — produkty przypisane do jego kodu albo kodu potomka
  // (dzięki temu strefa pokazuje sumę swoich regałów i palet).
  const productsAt = (n: WarehouseNode): StockProduct[] => {
    const codes = new Set<string>([n.code.toUpperCase()]);
    const walk = (pid: number) => { for (const c of nodes.filter((x) => x.parentId === pid)) { codes.add(c.code.toUpperCase()); walk(c.id); } };
    walk(n.id);
    return products.filter((p) => {
      const loc = p.location?.toUpperCase();
      if (!loc) return false;
      if (codes.has(loc)) return true;
      const shelf = loc.match(/^(.*)-\d+$/);   // adres półki → doliczamy do regału
      return !!shelf && codes.has(shelf[1]);
    });
  };

  // ── Widok ────────────────────────────────────────────────────────────────
  const bboxOf = (items: WarehouseNode[]): Rect => {
    if (!items.length) return { x: 0, y: 0, w: 1200, h: 800 };
    const minX = Math.min(...items.map((n) => n.x));
    const minY = Math.min(...items.map((n) => n.y));
    const maxX = Math.max(...items.map((n) => n.x + n.width));
    const maxY = Math.max(...items.map((n) => n.y + n.height));
    return { x: minX, y: minY, w: Math.max(64, maxX - minX), h: Math.max(64, maxY - minY) };
  };

  const clampView = (v: View): View => {
    const el = canvasRef.current;
    if (!el) return v;
    const b = bboxOf(canvasNodesRef.current);
    const vw = el.clientWidth, vh = el.clientHeight;
    const loX = KEEP_VISIBLE - (b.x + b.w) * v.z, hiX = vw - KEEP_VISIBLE - b.x * v.z;
    const loY = KEEP_VISIBLE - (b.y + b.h) * v.z, hiY = vh - KEEP_VISIBLE - b.y * v.z;
    return {
      x: clamp(v.x, Math.min(loX, hiX), Math.max(loX, hiX)),
      y: clamp(v.y, Math.min(loY, hiY), Math.max(loY, hiY)),
      z: v.z,
    };
  };

  const fitView = () => {
    const el = canvasRef.current;
    if (!el) return;
    const b = bboxOf(canvasNodesRef.current);
    const vw = el.clientWidth, vh = el.clientHeight;
    const z = clamp(Math.min(vw / (b.w + 200), vh / (b.h + 200)), MIN_ZOOM, 1.4);
    setView({ x: vw / 2 - (b.x + b.w / 2) * z, y: vh / 2 - (b.y + b.h / 2) * z, z });
  };

  const fittedForRef = useRef<number | null>(null);
  useEffect(() => {
    if (!activeBuildingId || !canvasRef.current) return;
    if (fittedForRef.current === activeBuildingId) return;
    fittedForRef.current = activeBuildingId;
    setTimeout(() => fitView(), 0);
  });

  const screenToWorld = (clientX: number, clientY: number): Point => {
    const r = canvasRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - (r?.left ?? 0) - v.x) / v.z, y: (clientY - (r?.top ?? 0) - v.y) / v.z };
  };

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = viewRef.current;
      const nz = clamp(v.z * Math.exp(-e.deltaY * 0.0014), MIN_ZOOM, MAX_ZOOM);
      const k = nz / v.z;
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      setView(clampView({ x: mx - (mx - v.x) * k, y: my - (my - v.y) * k, z: nz }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [!!data && nodes.length > 0]);

  const zoomBy = (factor: number) => {
    const el = canvasRef.current;
    const v = viewRef.current;
    const nz = clamp(v.z * factor, MIN_ZOOM, MAX_ZOOM);
    const k = nz / v.z;
    const cx = (el?.clientWidth ?? 0) / 2, cy = (el?.clientHeight ?? 0) / 2;
    setView(clampView({ x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k, z: nz }));
  };

  const gridStep = useMemo(() => {
    let s = GRID * view.z;
    while (s < 26) s *= 2;
    while (s > 104) s /= 2;
    return s;
  }, [view.z]);

  // ── Operacje + historia (cofnij/ponów) ───────────────────────────────────
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); }
    catch (e) { setErr(translateMessage(e, t)); }
    finally { setBusy(false); }
  };

  const record = (cmd: Cmd) => {
    undoStack.current.push(cmd);
    if (undoStack.current.length > 120) undoStack.current.shift();
    redoStack.current = [];
    setHistVer((v) => v + 1);
  };

  // Zapisuje zmiany geometrii/nazwy/przynależności wielu węzłów jednym cofnięciem.
  const recordBatch = (items: { node: WarehouseNode; before: Partial<LocationInput>; after: Partial<LocationInput> }[]) => {
    if (!items.length) return;
    record({
      undo: async () => { for (const it of items) await upsertLocation(inputFromNode(it.node, it.before)); },
      redo: async () => { for (const it of items) await upsertLocation(inputFromNode(it.node, it.after)); },
    });
  };

  // Tworzy węzeł i rejestruje cofnięcie (usuń), z ponowieniem (utwórz na nowo).
  const createRecorded = async (input: LocationInput): Promise<number> => {
    const id = await upsertLocation(input);
    const holder = { id };
    record({
      undo: async () => { await deleteLocation(holder.id); },
      redo: async () => { holder.id = await upsertLocation({ ...input, id: null }); },
    });
    return id;
  };

  // Usuwa węzły; cofnięcie odtwarza je (i przywraca członków stref).
  const deleteRecorded = async (targets: WarehouseNode[]) => {
    if (!activeBuilding) return;
    const buildingId = activeBuilding.id;
    const snaps = targets.map((n) => {
      const members = isSectionNode(n) ? membersOf(n).map((m) => ({ ...m })) : [];
      return { input: inputFromNode(n, { id: null }), members, holder: { id: n.id } };
    });
    for (const n of targets) {
      if (isSectionNode(n)) for (const m of membersOf(n)) await upsertLocation(inputFromNode(m, { parentId: buildingId }));
      await deleteLocation(n.id);
    }
    record({
      undo: async () => {
        for (const s of snaps) {
          s.holder.id = await upsertLocation(s.input);
          for (const m of s.members) await upsertLocation(inputFromNode(m, { parentId: s.holder.id }));
        }
      },
      redo: async () => {
        for (const s of snaps) {
          for (const m of s.members) await upsertLocation(inputFromNode(m, { parentId: buildingId }));
          await deleteLocation(s.holder.id);
        }
      },
    });
  };

  const doUndo = () => {
    const cmd = undoStack.current.pop();
    if (!cmd) return;
    redoStack.current.push(cmd);
    setHistVer((v) => v + 1);
    run(async () => { await cmd.undo(); await reload(); });
  };
  const doRedo = () => {
    const cmd = redoStack.current.pop();
    if (!cmd) return;
    undoStack.current.push(cmd);
    setHistVer((v) => v + 1);
    run(async () => { await cmd.redo(); await reload(); });
  };

  const createBuilding = () => run(async () => {
    const number = buildings.length + 1;
    const id = await createRecorded({
      id: null, parentId: warehouses[0]?.id ?? null, kind: "building",
      name: `Podwórko ${number}`, code: `P${number}`, color: PALETTE[number % PALETTE.length],
      capacity: 0, pickable: false, priority: number * 10,
      x: 0, y: 0, width: 100, height: 100, shape: "rect", rotation: 0,
    });
    await reload();
    setActiveBuildingId(id);
    setSelectedIds([]);
  });

  const createQuick = (kind: LocationKind) => run(async () => {
    const el = canvasRef.current;
    if (!activeBuilding || !el) return;
    const siblings = canvasNodes.filter((node) => node.kind === kind && node.shape !== "wall");
    const number = siblings.length + 1;
    const labels: Record<LocationKind, string> = { warehouse: "Magazyn", building: "Hala", zone: "Strefa", rack: "Regał", bin: "Paleta" };
    const suffix: Record<LocationKind, string> = { warehouse: "MAG", building: "H", zone: "S", rack: "R", bin: "P" };
    const size = defaultSize(kind);
    // Środek AKTUALNEGO widoku w px świata (współrzędne lokalne płótna → świat).
    const v = viewRef.current;
    const center = { x: (el.clientWidth / 2 - v.x) / v.z, y: (el.clientHeight / 2 - v.y) / v.z };
    const offset = (siblings.length % 5) * SNAP * 2;
    const id = await createRecorded({
      id: null, parentId: activeBuilding.id, kind,
      name: `${labels[kind]} ${number}`,
      code: `${activeBuilding.code}-${suffix[kind]}${String(number).padStart(2, "0")}`,
      color: kind === "zone" ? PALETTE[(number + 2) % PALETTE.length] : activeBuilding.color,
      capacity: kind === "rack" ? 40 : kind === "bin" ? 1 : 0,
      pickable: kind === "rack" || kind === "bin",
      priority: kind === "zone" ? number : 100 + number,
      x: snap(center.x - size.width / 2) + offset,
      y: snap(center.y - size.height / 2) + offset,
      width: size.width, height: size.height, shape: "rect", rotation: 0,
    });
    await reload();
    setSelectedIds([id]);
  });

  // Pole tekstowe — napis wprost na planie (bez ramki). Skala = wysokość (px świata).
  const createText = (at: Point) => run(async () => {
    if (!activeBuilding) return;
    const number = canvasNodes.filter((n) => n.shape === "text").length + 1;
    const id = await createRecorded({
      id: null, parentId: activeBuilding.id, kind: "zone",
      name: "Napis", code: `${activeBuilding.code}-T${String(number).padStart(2, "0")}`,
      color: "var-text", capacity: 0, pickable: false, priority: 800 + number,
      x: snap(at.x), y: snap(at.y), width: 240, height: 40, shape: "text", rotation: 0,
    });
    await reload();
    setSelectedIds([id]);
  });

  // Kod elementu z prefiksem strefy: H1-P01 + strefa H1-S01 → H1-S01-P01
  // (pomija zmianę, gdy docelowy kod już zajęty).
  const codeWithZone = (elCode: string, baseCode: string, selfId: number): string => {
    const seg = elCode.split("-").pop() ?? elCode;
    const wanted = `${baseCode}-${seg}`;
    const taken = nodes.some((n) => n.id !== selfId && n.code.toUpperCase() === wanted.toUpperCase());
    return taken ? elCode : wanted;
  };

  // Strefa z zaznaczenia: tworzy zone, przypina elementy i wpisuje jej prefiks w ich kody.
  const createSection = () => run(async () => {
    if (!activeBuilding || selectedElements.length === 0) return;
    const buildingId = activeBuilding.id;
    const members = selectedElements.map((n) => ({ ...n }));
    const minX = Math.min(...members.map((n) => boxOf(n).x));
    const minY = Math.min(...members.map((n) => boxOf(n).y));
    const maxX = Math.max(...members.map((n) => boxOf(n).x + boxOf(n).width));
    const maxY = Math.max(...members.map((n) => boxOf(n).y + boxOf(n).height));
    const number = sections.length + 1;
    const zoneCode = `${activeBuilding.code}-S${String(number).padStart(2, "0")}`;
    const input: LocationInput = {
      id: null, parentId: buildingId, kind: "zone",
      name: `Strefa ${number}`, code: zoneCode,
      color: PALETTE[(number + 2) % PALETTE.length], capacity: 0, pickable: false, priority: number,
      x: minX - SECTION_MARGIN, y: minY - SECTION_MARGIN,
      width: maxX - minX + SECTION_MARGIN * 2, height: maxY - minY + SECTION_MARGIN * 2,
      shape: "rect", rotation: 0,
    };
    const holder = { id: await upsertLocation(input) };
    const applied = members.map((el) => ({ el, oldCode: el.code, newCode: codeWithZone(el.code, zoneCode, el.id) }));
    for (const a of applied) await upsertLocation(inputFromNode(a.el, { parentId: holder.id, code: a.newCode }));
    record({
      undo: async () => {
        for (const a of applied) await upsertLocation(inputFromNode(a.el, { parentId: buildingId, code: a.oldCode }));
        await deleteLocation(holder.id);
      },
      redo: async () => {
        holder.id = await upsertLocation({ ...input, id: null });
        for (const a of applied) await upsertLocation(inputFromNode(a.el, { parentId: holder.id, code: a.newCode }));
      },
    });
    await reload();
    setSelectedIds([holder.id]);
  });

  // Zmiana przynależności: do strefy (kod z prefiksem strefy) albo luzem do podwórka (kod bez prefiksu).
  const assignElements = (els: WarehouseNode[], sectionId: number | null) => run(async () => {
    if (!activeBuilding || els.length === 0) return;
    const parent = sectionId ?? activeBuilding.id;
    const zone = sectionId ? byId.get(sectionId) ?? null : null;
    const base = zone ? zone.code : activeBuilding.code;
    const items = els.map((el) => ({
      node: el,
      before: { parentId: el.parentId, code: el.code },
      after: { parentId: parent, code: codeWithZone(el.code, base, el.id) },
    }));
    recordBatch(items);
    for (const it of items) await upsertLocation(inputFromNode(it.node, it.after));
    await reload();
  });

  // Usuwanie bez natywnego okna — od razu, z możliwością cofnięcia (Ctrl+Z).
  const deleteNodes = (targets: WarehouseNode[]) => run(async () => {
    if (!activeBuilding || targets.length === 0) return;
    await deleteRecorded(targets);
    setSelectedIds([]);
    await reload();
  });

  const deleteSelected = () => {
    const targets = selectedIds.map((id) => byId.get(id)).filter((n): n is WarehouseNode => !!n && n.kind !== "building" && n.kind !== "warehouse");
    if (targets.length) deleteNodes(targets);
  };

  // ── Kopiuj / wklej / duplikuj ─────────────────────────────────────────────
  const copySelection = () => {
    const picked = selectedIds.map((id) => byId.get(id)).filter((n): n is WarehouseNode => !!n && n.kind !== "building" && n.kind !== "warehouse");
    if (picked.length) clipboardRef.current = picked.map((n) => ({ ...n, meta: n.meta ? { ...n.meta } : null }));
  };

  const pasteClipboard = (src: WarehouseNode[] = clipboardRef.current) => run(async () => {
    if (!activeBuilding || src.length === 0) return;
    const dx = SNAP * 4, dy = SNAP * 4;
    const used = new Set(nodes.map((n) => n.code.toUpperCase()));
    const freshCode = (n: WarehouseNode) => {
      const suffix = n.shape === "wall" ? "W" : n.shape === "text" ? "T" : n.kind === "zone" ? "S" : n.kind === "rack" ? "R" : "P";
      let i = 1, code = "";
      do { code = `${activeBuilding.code}-${suffix}${String(i).padStart(2, "0")}`; i += 1; } while (used.has(code.toUpperCase()) && i < 9999);
      used.add(code.toUpperCase());
      return code;
    };
    const created: { input: LocationInput; holder: { id: number } }[] = [];
    const newIds: number[] = [];
    for (const n of src) {
      let extra: Partial<LocationInput> = { x: n.x + dx, y: n.y + dy };
      if (n.shape === "wall" && n.meta?.pts) {
        const pts = n.meta.pts.map(([x, y]) => [x + dx, y + dy] as [number, number]);
        const bb = ptsBBox(pts.map(([x, y]) => ({ x, y })));
        extra = { x: bb.x, y: bb.y, width: bb.width, height: bb.height, meta: { ...n.meta, pts } };
      }
      const input = inputFromNode(n, { id: null, parentId: activeBuilding.id, code: freshCode(n), ...extra });
      const holder = { id: await upsertLocation(input) };
      created.push({ input, holder });
      newIds.push(holder.id);
    }
    record({
      undo: async () => { for (const c of created) await deleteLocation(c.holder.id); },
      redo: async () => { for (const c of created) c.holder.id = await upsertLocation({ ...c.input, id: null }); },
    });
    await reload();
    setSelectedIds(newIds);
  });

  const duplicateSelection = () => {
    const picked = selectedIds.map((id) => byId.get(id)).filter((n): n is WarehouseNode => !!n && n.kind !== "building" && n.kind !== "warehouse");
    if (picked.length) pasteClipboard(picked.map((n) => ({ ...n, meta: n.meta ? { ...n.meta } : null })));
  };

  // ── Usuwanie podwórka (z potwierdzeniem w popupie) ────────────────────────
  const deletePodworko = (b: WarehouseNode) => run(async () => {
    const descendants: WarehouseNode[] = [];
    const collect = (id: number) => { for (const n of nodes.filter((x) => x.parentId === id)) { collect(n.id); descendants.push(n); } };
    collect(b.id);                                   // post-order: dzieci przed rodzicem
    for (const n of descendants) await deleteLocation(n.id);
    await deleteLocation(b.id);
    undoStack.current = []; redoStack.current = [];  // ID się zmieniły — czyścimy historię
    setHistVer((v) => v + 1);
    setConfirmDel(null);
    await reload();
  });

  const commitName = async () => {
    const name = nameDraft.trim();
    if (!ctxNode || !name || name === ctxNode.name) return;
    const before = ctxNode;
    recordBatch([{ node: before, before: { name: before.name }, after: { name } }]);
    try { await upsertLocation(inputFromNode(before, { name })); await reload(); }
    catch (e) { setErr(translateMessage(e, t)); }
  };

  // ── Ściany = łamane/kształty z punktów ───────────────────────────────────
  // Punkty ściany (z edycji na żywo albo z zapisanego meta.pts).
  const wallPtsOf = (w: WarehouseNode): Point[] | null => {
    const raw = w.meta?.pts;
    return wallEdit[w.id] ?? (raw ? raw.map(([x, y]) => ({ x, y })) : null);
  };

  const addWallPoint = (raw: Point) => {
    setWallPts((pts) => {
      const p = { x: snap(raw.x), y: snap(raw.y) };
      const last = pts[pts.length - 1];
      if (last && last.x === p.x && last.y === p.y) return pts;
      return [...pts, p];
    });
  };

  // Kończy rysowanie jako JEDNA ściana (łamana albo zamknięty kształt).
  const finishWall = (closed = false) => {
    const pts = wallPts;
    setWallPts([]);
    setWallCursor(null);
    setTool("select");
    if (!activeBuilding || pts.length < 2) return;
    const bb = ptsBBox(pts);
    const number = walls.length + 1;
    run(async () => {
      const id = await createRecorded({
        id: null, parentId: activeBuilding.id, kind: "zone",
        name: "Ściana", code: `${activeBuilding.code}-W${String(number).padStart(2, "0")}`,
        color: WALL_COLOR, capacity: 0, pickable: false, priority: 900 + number,
        x: bb.x, y: bb.y, width: bb.width, height: bb.height, shape: "wall", rotation: 0,
        meta: { pts: pts.map((p) => [p.x, p.y] as [number, number]), closed },
      });
      await reload();
      setSelectedIds([id]);
    });
  };

  const cancelWall = () => { setWallPts([]); setWallCursor(null); };

  // Zapisz nowy zestaw punktów ściany (po przesunięciu/dodaniu/usunięciu narożnika).
  const saveWallPts = async (wall: WarehouseNode, pts: Point[]) => {
    if (pts.length < 2) { deleteNodes([wall]); return; }
    const bb = ptsBBox(pts);
    const meta: LocationMeta = { ...(wall.meta ?? {}), pts: pts.map((p) => [p.x, p.y] as [number, number]) };
    const beforeMeta: LocationMeta = wall.meta ?? null;
    const beforeBox: Partial<LocationInput> = { x: wall.x, y: wall.y, width: wall.width, height: wall.height, meta: beforeMeta };
    recordBatch([{ node: wall, before: beforeBox, after: { ...bb, meta } }]);
    setData((cur) => cur ? { ...cur, nodes: cur.nodes.map((n) => n.id === wall.id ? { ...n, ...bb, meta } : n) } : cur);
    setWallEdit((cur) => { const nx = { ...cur }; delete nx[wall.id]; return nx; });
    try { await upsertLocation(inputFromNode(wall, { ...bb, meta })); }
    catch (e) { setErr(translateMessage(e, t)); await reload(); }
  };

  // Przeciąganie całej ściany (przesuwa wszystkie punkty).
  const beginWallMove = (event: ReactPointerEvent, wall: WarehouseNode) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    setSelectedIds([wall.id]);
    if (!editMode) return;
    event.preventDefault();
    const startX = event.clientX, startY = event.clientY;
    const z = viewRef.current.z;
    const origin = wallPtsOf(wall) ?? [];
    let moved = false, out = origin;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4) moved = true;
      if (!moved) return;
      const dx = (ev.clientX - startX) / z, dy = (ev.clientY - startY) / z;
      const sn = (v: number) => (ev.shiftKey ? v : snap(v));
      out = origin.map((p) => ({ x: sn(p.x + dx), y: sn(p.y + dy) }));
      setWallEdit((cur) => ({ ...cur, [wall.id]: out }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) saveWallPts(wall, out);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Przeciąganie pojedynczego narożnika.
  const beginVertexDrag = (event: ReactPointerEvent, wall: WarehouseNode, i: number) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    event.preventDefault();
    setSelectedIds([wall.id]);
    const startX = event.clientX, startY = event.clientY;
    const z = viewRef.current.z;
    const origin = wallPtsOf(wall) ?? [];
    let out = origin;
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / z, dy = (ev.clientY - startY) / z;
      const sn = (v: number) => (ev.shiftKey ? v : snap(v));
      out = origin.map((p, k) => k === i ? { x: sn(p.x + dx), y: sn(p.y + dy) } : p);
      setWallEdit((cur) => ({ ...cur, [wall.id]: out }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      saveWallPts(wall, out);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Dodanie narożnika w połowie odcinka `seg` (między pkt seg a seg+1).
  const addVertex = (event: ReactPointerEvent, wall: WarehouseNode, seg: number) => {
    event.stopPropagation();
    const pts = wallPtsOf(wall) ?? [];
    const a = pts[seg], b = pts[(seg + 1) % pts.length];
    if (!a || !b) return;
    const mid = { x: snap((a.x + b.x) / 2), y: snap((a.y + b.y) / 2) };
    const next = [...pts.slice(0, seg + 1), mid, ...pts.slice(seg + 1)];
    saveWallPts(wall, next);
  };

  // Usunięcie narożnika (dwuklik). Poniżej 2 punktów usuwa całą ścianę.
  const deleteVertex = (event: { stopPropagation: () => void }, wall: WarehouseNode, i: number) => {
    event.stopPropagation();
    const pts = wallPtsOf(wall) ?? [];
    saveWallPts(wall, pts.filter((_, k) => k !== i));
  };

  // Strefa odkładcza — można na nią przyjmować towar (np. pole przyjęć),
  // a nie tylko grupować regały.
  const togglePickable = async () => {
    if (!ctxNode) return;
    const node = ctxNode;
    const next = !node.pickable;
    recordBatch([{ node, before: { pickable: node.pickable }, after: { pickable: next } }]);
    setData((d) => d ? { ...d, nodes: d.nodes.map((n) => n.id === node.id ? { ...n, pickable: next } : n) } : d);
    try { await upsertLocation(inputFromNode(node, { pickable: next })); }
    catch (e) { setErr(translateMessage(e, t)); await reload(); }
  };

  const adjustMeta = async (key: "shelves" | "tiers", delta: number) => {
    if (!ctxNode) return;
    const node = ctxNode;
    const cur: NonNullable<LocationMeta> = node.meta ?? {};
    const val = clamp((cur[key] ?? 1) + delta, 1, 40);
    const meta: LocationMeta = { ...cur, [key]: val };
    recordBatch([{ node, before: { meta: node.meta ?? null }, after: { meta } }]);
    setData((d) => d ? { ...d, nodes: d.nodes.map((n) => n.id === node.id ? { ...n, meta } : n) } : d);
    try { await upsertLocation(inputFromNode(node, { meta })); }
    catch (e) { setErr(translateMessage(e, t)); await reload(); }
  };

  // ── Klawiatura: Esc / Enter / Delete ─────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); doRedo(); return; }
      if (mod && e.key.toLowerCase() === "c") { copySelection(); return; }
      if (mod && e.key.toLowerCase() === "v") { e.preventDefault(); pasteClipboard(); return; }
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateSelection(); return; }
      if (e.key === "Escape") {
        if (wallPts.length) cancelWall();
        else if (tool !== "select") setTool("select");
        else setSelectedIds([]);
      }
      if (e.key === "Enter" && tool === "wall" && wallPts.length > 1) finishWall();
      if ((e.key === "Delete" || e.key === "Backspace") && editMode && selectedIds.length) deleteSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── Gesty ────────────────────────────────────────────────────────────────
  const beginItemsDrag = (event: ReactPointerEvent, node: WarehouseNode, mode: "move" | "resize") => {
    event.stopPropagation();
    if (event.button !== 0) return;
    if (mode === "move" && (event.ctrlKey || event.metaKey)) {
      setSelectedIds((cur) => cur.includes(node.id) ? cur.filter((x) => x !== node.id) : [...cur, node.id]);
      return;
    }
    const wasSelected = selectedIds.includes(node.id);
    const group = mode === "move" && wasSelected && selectedIds.length > 1 ? [...selectedIds] : [node.id];
    const ids = new Set<number>(group);
    if (mode === "move") {
      for (const gid of group) {
        const g = byId.get(gid);
        if (g && isSectionNode(g)) for (const m of membersOf(g)) ids.add(m.id);
      }
    }
    if (!wasSelected) setSelectedIds([node.id]);
    if (!editMode) return;
    event.preventDefault();
    const startX = event.clientX, startY = event.clientY;
    const z = viewRef.current.z;
    const items = [...ids].flatMap((id) => {
      const n = byId.get(id);
      return n ? [{ id, node: n, origin: boxOf(n) }] : [];
    });
    let moved = false;
    const last: Record<number, Box> = {};
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4) moved = true;
      if (!moved) return;
      const dx = (ev.clientX - startX) / z, dy = (ev.clientY - startY) / z;
      const sn = (v: number) => (ev.shiftKey ? v : snap(v));
      const next: Record<number, Box> = {};
      for (const it of items) {
        next[it.id] = mode === "move"
          ? { ...it.origin, x: sn(it.origin.x + dx), y: sn(it.origin.y + dy) }
          : { ...it.origin, width: Math.max(SNAP, sn(it.origin.width + dx)), height: Math.max(SNAP, sn(it.origin.height + dy)) };
        last[it.id] = next[it.id];
      }
      setDrafts((cur) => ({ ...cur, ...next }));
    };
    const onUp = async () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!moved) { setSelectedIds([node.id]); return; }
      recordBatch(items.filter((it) => last[it.id]).map((it) => ({ node: it.node, before: it.origin, after: last[it.id] })));
      setData((cur) => cur ? { ...cur, nodes: cur.nodes.map((n) => last[n.id] ? { ...n, ...last[n.id] } : n) } : cur);
      setDrafts((cur) => { const nx = { ...cur }; for (const it of items) delete nx[it.id]; return nx; });
      try { for (const it of items) if (last[it.id]) await upsertLocation(inputFromNode(it.node, last[it.id])); }
      catch (e) { setErr(translateMessage(e, t)); await reload(); }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const beginCanvasDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    const wallMode = tool === "wall" && !!activeBuilding && editMode;
    // Tekst: klik stawia napis w punkcie i przełącza z powrotem na wybór.
    if (tool === "text" && activeBuilding && editMode) {
      createText(screenToWorld(event.clientX, event.clientY));
      setTool("select");
      return;
    }
    const v = viewRef.current;
    const startX = event.clientX, startY = event.clientY;
    let moved = false;
    // Ramka zaznaczania (rubber band) — współrzędne lokalne płótna.
    const marqueeMode = tool === "marquee";
    const lx0 = startX - (rect?.left ?? 0), ly0 = startY - (rect?.top ?? 0);
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 3) moved = true;
      if (!moved) return;
      if (marqueeMode) {
        setMarquee({ x0: lx0, y0: ly0, x1: ev.clientX - (rect?.left ?? 0), y1: ev.clientY - (rect?.top ?? 0) });
      } else {
        setView(clampView({ x: v.x + ev.clientX - startX, y: v.y + ev.clientY - startY, z: v.z }));
      }
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (marqueeMode) {
        setMarquee(null);
        if (!moved) { setSelectedIds([]); return; }
        const a = screenToWorld(startX, startY), b = screenToWorld(ev.clientX, ev.clientY);
        const r: Rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
        const hits = canvasNodes.filter((n) => {
          if (!showZones && isSectionNode(n)) return false;   // ukrytych stref nie łapiemy
          const box = boxOf(n);
          return box.x < r.x + r.w && box.x + box.width > r.x && box.y < r.y + r.h && box.y + box.height > r.y;
        }).map((n) => n.id);
        setSelectedIds(hits);
        return;
      }
      if (moved) return;
      if (wallMode) {
        const p = { x: snap(screenToWorld(startX, startY).x), y: snap(screenToWorld(startX, startY).y) };
        if (wallPts.length >= 3 && dist(p, wallPts[0]) < 22 / viewRef.current.z) finishWall(true);
        else addWallPoint(p);
      } else setSelectedIds([]);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onCanvasMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (tool !== "wall" || wallPts.length === 0) return;
    const p = screenToWorld(event.clientX, event.clientY);
    setWallCursor({ x: snap(p.x), y: snap(p.y) });
  };

  const adjustCapacity = async (delta: number) => {
    if (!ctxNode) return;
    const node = ctxNode;
    const capacity = Math.max(0, node.capacity + delta);
    recordBatch([{ node, before: { capacity: node.capacity }, after: { capacity } }]);
    setData((current) => current ? {
      ...current,
      nodes: current.nodes.map((item) => item.id === node.id ? { ...item, capacity } : item),
    } : current);
    try { await upsertLocation(inputFromNode(node, { capacity })); }
    catch (e) { setErr(translateMessage(e, t)); await reload(); }
  };

  if (!data) return <div style={{ ...panel, padding: 28, color: "var(--muted2)" }}>{err ?? t(T.common_loading)}</div>;

  if (nodes.length === 0) return (
    <div className="wh-empty" style={panel}>
      <div className="wh-empty-icon"><MapIcon size={30} /></div>
      <h3>{t(T.wh_map_empty_title)}</h3>
      <p>{t(T.wh_map_empty_body)}</p>
      {err && <div className="wh-error">{err}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        <button style={primary} disabled={busy} onClick={createBuilding}><Plus size={15} />Dodaj podwórko</button>
      </div>
    </div>
  );

  // ── Render ───────────────────────────────────────────────────────────────
  const renderNode = (node: WarehouseNode) => {
    const box = boxOf(node);
    const occupied = pct(node.units, node.capacity);
    const displayColor = heatmap ? heatColor(occupied, node.capacity > 0) : node.color;
    const isSelected = selectedIds.includes(node.id);
    const background = `color-mix(in srgb, ${displayColor} ${heatmap ? 26 : 15}%, var(--surface))`;
    const shelves = node.kind === "rack" ? Math.min(20, node.meta?.shelves ?? 0) : 0;
    const tiers = node.kind === "bin" ? Math.min(9, node.meta?.tiers ?? 1) : 1;
    return (
      <div
        key={node.id}
        role="button"
        tabIndex={0}
        className={`wh-node wh-element kind-${node.kind} ${tiers > 1 ? "wh-tiered" : ""} ${isSelected ? "selected" : ""} ${editMode ? "editable" : ""}`}
        style={{ left: box.x, top: box.y, width: box.width, height: box.height, "--node-color": displayColor, background } as CSSProperties}
        onPointerDown={(event) => beginItemsDrag(event, node, "move")}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedIds([node.id]); }}
      >
        {shelves > 1 && Array.from({ length: shelves - 1 }).map((_, k) => (
          <span key={k} className="wh-shelf-line" style={{ top: `${((k + 1) / shelves) * 100}%` }} />
        ))}
        <div className="wh-node-label"><strong>{node.name}</strong></div>
        {tiers > 1 && <span className="wh-tier-badge">×{tiers}</span>}
        {editMode && (
          <span className="wh-resize-handle" onPointerDown={(event) => beginItemsDrag(event, node, "resize")} />
        )}
      </div>
    );
  };

  // Napis na planie — sama nazwa, bez ramki. Wysokość = rozmiar czcionki (px świata).
  const renderText = (node: WarehouseNode) => {
    const box = boxOf(node);
    const isSelected = selectedIds.includes(node.id);
    return (
      <div
        key={node.id}
        className={`wh-text ${isSelected ? "selected" : ""} ${editMode ? "editable" : ""}`}
        style={{ left: box.x, top: box.y, fontSize: box.height, color: node.color?.startsWith("#") && node.color !== "#6c5fc7" ? node.color : "var(--text)" } as CSSProperties}
        onPointerDown={(event) => beginItemsDrag(event, node, "move")}
      >
        {node.name || "Napis"}
        {editMode && <span className="wh-resize-handle" onPointerDown={(event) => beginItemsDrag(event, node, "resize")} />}
      </div>
    );
  };

  // Ściana = łamana/kształt z rogami. Klik w linię zaznacza/przesuwa; w trybie edycji
  // narożniki i „+" na środkach odcinków pozwalają zmieniać kształt.
  const renderWall = (wall: WarehouseNode) => {
    const pts = wallPtsOf(wall);
    if (!pts || pts.length < 2) return renderNode(wall); // stara ściana-prostokąt (fallback)
    const closed = !!wall.meta?.closed;
    const isSelected = selectedIds.includes(wall.id);
    const pad = WALL_THICK;
    const bb = ptsBBox(pts);
    const w = bb.width + pad * 2, h = bb.height + pad * 2;
    const lx = (p: Point) => p.x - bb.x + pad, ly = (p: Point) => p.y - bb.y + pad;
    const seq = pts.map((p) => `${lx(p)},${ly(p)}`).join(" ");
    const hz = VERTEX / view.z; // uchwyty stałej wielkości na ekranie
    const segCount = closed ? pts.length : pts.length - 1;
    const onLineDown = (e: ReactPointerEvent<SVGElement>) => beginWallMove(e, wall);
    return (
      <div key={wall.id} className={`wh-wall-shape ${isSelected ? "selected" : ""}`} style={{ left: bb.x - pad, top: bb.y - pad, width: w, height: h }}>
        <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          {closed
            ? <polygon points={seq} className="wh-wall-line" strokeWidth={WALL_THICK} onPointerDown={onLineDown} />
            : <polyline points={seq} className="wh-wall-line" strokeWidth={WALL_THICK} onPointerDown={onLineDown} />}
        </svg>
        {isSelected && editMode && (
          <>
            {Array.from({ length: segCount }).map((_, s) => {
              const a = pts[s], b = pts[(s + 1) % pts.length];
              const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
              return <span key={`m${s}`} className="wh-wall-mid" title="Dodaj narożnik" style={{ left: mx - bb.x + pad - hz / 2, top: my - bb.y + pad - hz / 2, width: hz, height: hz }} onPointerDown={(e) => addVertex(e, wall, s)} />;
            })}
            {pts.map((p, i) => (
              <span key={`v${i}`} className="wh-wall-vertex" title="Przeciągnij · dwuklik usuwa" style={{ left: lx(p) - hz / 2, top: ly(p) - hz / 2, width: hz, height: hz }} onPointerDown={(e) => beginVertexDrag(e, wall, i)} onDoubleClick={(e) => deleteVertex(e, wall, i)} />
            ))}
          </>
        )}
      </div>
    );
  };

  const renderSection = (section: WarehouseNode) => {
    const members = membersOf(section);
    const isSelected = selectedIds.includes(section.id);
    if (members.length === 0) {
      const b = boxOf(section);
      return (
        <div
          key={section.id}
          className={`wh-node wh-zone-empty ${isSelected ? "selected" : ""} ${editMode ? "editable" : ""}`}
          style={{ left: b.x, top: b.y, width: b.width, height: b.height, "--node-color": section.color } as CSSProperties}
          onPointerDown={(event) => beginItemsDrag(event, section, "move")}
        >
          <div className="wh-node-label"><strong>{section.name}</strong></div>
          {editMode && <span className="wh-resize-handle" onPointerDown={(event) => beginItemsDrag(event, section, "resize")} />}
        </div>
      );
    }
    const rects: Rect[] = members.map((n) => { const b = boxOf(n); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
    const minX = Math.min(...rects.map((r) => r.x)), minY = Math.min(...rects.map((r) => r.y));
    const maxX = Math.max(...rects.map((r) => r.x + r.w)), maxY = Math.max(...rects.map((r) => r.y + r.h));
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    const segs = unionOutline(rects);
    const nx = (v: number) => ((v - minX) / bw) * 100, ny = (v: number) => ((v - minY) / bh) * 100;
    return (
      <div key={section.id} className={`wh-section-layer ${isSelected ? "selected" : ""}`} style={{ left: minX, top: minY, width: bw, height: bh, "--node-color": section.color } as CSSProperties}>
        <svg
          className="wh-section-outline"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ color: section.color }}
          aria-hidden
          onPointerDown={(e) => beginItemsDrag(e as unknown as ReactPointerEvent, section, "move")}
        >
          {segs.map((s, i) => <line key={i} x1={nx(s.x1)} y1={ny(s.y1)} x2={nx(s.x2)} y2={ny(s.y2)} />)}
        </svg>
        <button className="wh-section-tag" style={{ color: section.color }} title="Kliknij, aby zaznaczyć · przeciągnij, aby przenieść całą strefę" onPointerDown={(e) => beginItemsDrag(e as unknown as ReactPointerEvent, section, "move")}>{section.name}</button>
      </div>
    );
  };

  const elementParentSection = (n: WarehouseNode) => {
    const p = n.parentId ? byId.get(n.parentId) : null;
    return p && isSectionNode(p) ? p : null;
  };

  return (
    <div>
      {err && <div className="wh-error" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="wh-layout">
        <aside className="wh-tree" style={panel}>
          <div className="wh-panel-title">Podwórka</div>
          <div className="wh-building-cards">
            {buildings.map((b) => {
              const direct = children(b.id);
              const zones = direct.filter((k) => k.kind === "zone" && k.shape !== "wall");
              const all = [...direct, ...zones.flatMap((z) => children(z.id))];
              const racks = all.filter((k) => k.kind === "rack" && k.shape !== "wall").length;
              const pallets = all.filter((k) => k.kind === "bin").length;
              return (
                <button key={b.id} className={`wh-building-card ${activeBuildingId === b.id ? "active" : ""}`} onClick={() => { setActiveBuildingId(b.id); setSelectedIds([]); }}>
                  <span className="wh-card-bar" style={{ background: b.color }} />
                  <span className="wh-card-body">
                    <strong>{b.name}</strong>
                    <small>{racks} rg · {pallets} pal · {zones.length} stref</small>
                    <small className="wh-card-units">{b.units.toLocaleString("pl-PL")} szt.</small>
                  </span>
                </button>
              );
            })}
          </div>
          <button className="wh-add-building" disabled={busy} onClick={createBuilding}><Plus size={15} />Dodaj podwórko</button>
          {data.unassignedProducts > 0 && (
            <div className="wh-unassigned">
              <div><PackageOpen size={15} /> {t(T.wh_map_unassigned)}</div>
              <strong>{data.unassignedProducts}</strong>
              <small>{data.unassignedUnits} szt.</small>
            </div>
          )}
        </aside>

        <section className="wh-floor" style={panel}>
          <div className="wh-editor-head">
            <div className="wh-floor-title">
              {activeBuilding ? (
                <><span style={{ color: activeBuilding.color }}>{iconFor("building", 17)}</span><strong>{activeBuilding.name}</strong><code>{activeBuilding.code}</code>
                  <button className="wh-floor-del" title="Usuń podwórko" onClick={() => setConfirmDel(activeBuilding)}><Trash2 size={14} /></button></>
              ) : <span style={{ color: "var(--muted2)" }}>Wybierz podwórko</span>}
            </div>
            <div className="wh-editor-tools">
              <button className="wh-icon-btn" disabled={undoStack.current.length === 0} onClick={doUndo} title="Cofnij (Ctrl+Z)"><Undo2 size={15} /></button>
              <button className="wh-icon-btn" disabled={redoStack.current.length === 0} onClick={doRedo} title="Ponów (Ctrl+Shift+Z)"><Redo2 size={15} /></button>
              <button className={`wh-heat-toggle wh-zone-toggle ${showZones ? "active" : ""}`} onClick={() => setShowZones((v) => !v)} title="Pokaż / ukryj nakładki stref">
                {showZones ? <Check size={14} /> : <Layers3 size={14} />}Strefy
              </button>
              <button className={`wh-heat-toggle ${heatmap ? "active" : ""}`} onClick={() => setHeatmap((v) => !v)} title="Mapa ciepła zajętości">
                <Thermometer size={14} />Zajętość
              </button>
              <div className="wh-editor-mode">
                <button className={!editMode ? "active" : ""} onClick={() => setEditMode(false)}><Boxes size={14} />Podgląd</button>
                <button className={editMode ? "active" : ""} onClick={() => setEditMode(true)}><Move size={14} />Edytuj</button>
              </div>
            </div>
          </div>

          <div className="wh-palette">
            <button disabled={busy || !activeBuilding} onClick={() => createQuick("rack")}>{iconFor("rack", 14)}Regał</button>
            <button disabled={busy || !activeBuilding} onClick={() => createQuick("bin")}>{iconFor("bin", 14)}Paleta</button>
            <button disabled={busy || !activeBuilding} onClick={() => createQuick("zone")}><Layers3 size={14} />Strefa</button>
            <button className={tool === "wall" ? "active" : ""} disabled={!activeBuilding} onClick={() => tool === "wall" ? (wallPts.length > 1 ? finishWall() : (cancelWall(), setTool("select"))) : setTool("wall")}>
              <PenLine size={14} />Ściana
            </button>
            <button className={tool === "text" ? "active" : ""} disabled={!activeBuilding} onClick={() => setTool((v) => v === "text" ? "select" : "text")}><Type size={14} />Tekst</button>
            <button className={tool === "marquee" ? "active" : ""} disabled={!activeBuilding} onClick={() => setTool((v) => v === "marquee" ? "select" : "marquee")}><SquareDashedMousePointer size={14} />Zaznacz</button>
            <button className="wh-palette-custom" disabled={!activeBuilding} onClick={() => setEditing({ parentId: activeBuilding?.id ?? null, kind: "rack" })}><Pencil size={13} />Własny…</button>
          </div>

          <div className="wh-canvas-shell">
            <div
              ref={canvasRef}
              className={`wh-canvas ${tool === "wall" || tool === "text" ? "wall-tool" : ""} ${tool === "marquee" ? "marquee-tool" : ""}`}
              onPointerDown={beginCanvasDrag}
              onPointerMove={onCanvasMove}
              onDoubleClick={() => { if (tool === "wall" && wallPts.length > 1) finishWall(false); }}
            >
              <div
                className="wh-grid"
                style={{
                  backgroundSize: `${gridStep}px ${gridStep}px`,
                  backgroundPosition: `${mod(view.x, gridStep)}px ${mod(view.y, gridStep)}px`,
                }}
              />
              <div
                className="wh-grid major"
                style={{
                  backgroundSize: `${gridStep * 4}px ${gridStep * 4}px`,
                  backgroundPosition: `${mod(view.x, gridStep * 4)}px ${mod(view.y, gridStep * 4)}px`,
                }}
              />
              <div className="wh-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
                {walls.map(renderWall)}
                {elements.map(renderNode)}
                {texts.map(renderText)}
                {showZones && sections.map(renderSection)}
                {wallPts.length > 0 && (() => {
                  const chain = wallCursor ? [...wallPts, wallCursor] : wallPts;
                  const pad = WALL_THICK, bb = ptsBBox(chain.length > 1 ? chain : [chain[0], chain[0]]);
                  const w = bb.width + pad * 2, h = bb.height + pad * 2;
                  const loc = (p: Point) => `${p.x - bb.x + pad},${p.y - bb.y + pad}`;
                  const near = wallPts.length >= 3 && wallCursor && dist(wallCursor, wallPts[0]) < 22 / view.z;
                  return (
                    <div className="wh-wall-shape drawing" style={{ left: bb.x - pad, top: bb.y - pad, width: w, height: h }}>
                      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
                        {chain.length > 1 && <polyline points={chain.map(loc).join(" ")} className="wh-wall-line preview" strokeWidth={WALL_THICK} />}
                      </svg>
                      {wallPts.map((p, i) => <span key={i} className={`wh-wall-pt ${i === 0 && near ? "close" : ""}`} style={{ left: p.x - bb.x + pad - 7, top: p.y - bb.y + pad - 7 }} />)}
                    </div>
                  );
                })()}
              </div>
              {marquee && (
                <div className="wh-marquee" style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }} />
              )}
              {!activeBuilding && <div className="wh-canvas-empty">Wybierz albo dodaj podwórko po lewej.</div>}
              {activeBuilding && canvasNodes.length === 0 && <div className="wh-canvas-empty">Narysuj ściany, dodaj regały, palety i strefy z paska powyżej.</div>}
              {tool === "wall" && <div className="wh-wall-banner"><PenLine size={13} /> Klikaj rogi · klik w start = zamknij kształt · dwuklik/Enter kończy · Esc anuluje</div>}
              {tool === "text" && <div className="wh-wall-banner"><Type size={13} /> Kliknij, aby wstawić napis · treść wpiszesz w panelu na dole</div>}
              {tool === "marquee" && <div className="wh-wall-banner"><SquareDashedMousePointer size={13} /> Przeciągnij ramkę, aby zaznaczyć wiele · Esc wychodzi</div>}
              <div className="wh-zoom-controls" onPointerDown={(event) => event.stopPropagation()}>
                <button title="Pomniejsz" onClick={() => zoomBy(1 / 1.25)}><ZoomOut size={15} /></button>
                <span>{Math.round(view.z * 100)}%</span>
                <button title="Powiększ" onClick={() => zoomBy(1.25)}><ZoomIn size={15} /></button>
                <button title="Wróć do środka" onClick={fitView}><Maximize2 size={15} /></button>
              </div>
            </div>

            {/* Pływający panel właściwości — zawsze na dole-środku edytora. */}
            {(ctxNode || isMulti) && (
              <div className="wh-context" onPointerDown={(e) => e.stopPropagation()}>
                {contentsOpen && ctxNode && (() => {
                  const items = productsAt(ctxNode);
                  return (
                    <div className="wh-contents">
                      <div className="wh-contents-head">Zawartość · {ctxNode.code}</div>
                      {items.length === 0 ? (
                        <div className="wh-contents-empty">Nic tu nie leży. Przypisz produkty przy przyjęciu dostawy.</div>
                      ) : items.map((p) => (
                        <div key={p.id} className="wh-contents-row">
                          <span className="wh-contents-name" title={p.name}>{p.name}</span>
                          <code>{p.location && p.location.toUpperCase() !== ctxNode.code.toUpperCase() ? p.location : p.sku}</code>
                          <b>{p.qty} szt.</b>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                {isMulti ? (
                  <>
                    <span className="wh-ctx-count">{selectedElements.length} zazn.</span>
                    <button className="wh-ctx-btn accent" disabled={busy} onClick={createSection}><Layers3 size={14} />Utwórz strefę</button>
                    {sections.length > 0 && (
                      <select className="wh-ctx-select" defaultValue="" onChange={(e) => { const v = e.target.value; assignElements(selectedElements, v ? Number(v) : null); }}>
                        <option value="" disabled>Do strefy…</option>
                        {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        <option value="">— bez strefy —</option>
                      </select>
                    )}
                    <button className="wh-ctx-btn danger" disabled={busy} onClick={deleteSelected}><Trash2 size={14} /></button>
                    <button className="wh-ctx-btn" onClick={() => setSelectedIds([])}><X size={14} /></button>
                  </>
                ) : ctxNode && (
                  <>
                    <span className="wh-ctx-icon" style={{ color: ctxNode.color }}>{ctxNode.shape === "wall" ? <PenLine size={15} /> : ctxNode.shape === "text" ? <Type size={15} /> : iconFor(ctxNode.kind, 15)}</span>
                    {ctxNode.shape !== "wall" && (
                      <input
                        className="wh-ctx-name"
                        value={nameDraft}
                        placeholder={ctxNode.shape === "text" ? "Wpisz tekst…" : ""}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onBlur={commitName}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      />
                    )}
                    {ctxNode.shape !== "wall" && ctxNode.shape !== "text" && <code className="wh-ctx-code">{ctxNode.code}</code>}
                    {isElement(ctxNode) && (
                      <span className="wh-ctx-cap" title="Miejsca paletowe">
                        <button onClick={() => adjustCapacity(-1)}>−</button>
                        <b>{ctxNode.capacity}</b>
                        <button onClick={() => adjustCapacity(1)}>+</button>
                      </span>
                    )}
                    {ctxNode.kind === "rack" && (
                      <span className="wh-ctx-cap" title="Liczba półek">
                        <Rows3 size={13} />
                        <button onClick={() => adjustMeta("shelves", -1)}>−</button>
                        <b>{ctxNode.meta?.shelves ?? 1}</b>
                        <button onClick={() => adjustMeta("shelves", 1)}>+</button>
                      </span>
                    )}
                    {ctxNode.kind === "bin" && (
                      <span className="wh-ctx-cap" title="Piętra palet">
                        <Layers2 size={13} />
                        <button onClick={() => adjustMeta("tiers", -1)}>−</button>
                        <b>{ctxNode.meta?.tiers ?? 1}</b>
                        <button onClick={() => adjustMeta("tiers", 1)}>+</button>
                      </span>
                    )}
                    {isElement(ctxNode) && (elementParentSection(ctxNode) ? (
                      <button className="wh-ctx-btn" title={`Odłącz ze strefy „${elementParentSection(ctxNode)?.name}"`} disabled={busy} onClick={() => assignElements([ctxNode], null)}><Unlink size={14} /></button>
                    ) : sections.length > 0 && (
                      <select className="wh-ctx-select" defaultValue="" onChange={(e) => { const v = e.target.value; if (v) assignElements([ctxNode], Number(v)); }}>
                        <option value="" disabled>Do strefy…</option>
                        {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    ))}
                    {(isElement(ctxNode) || isSectionNode(ctxNode)) && (() => {
                      const items = productsAt(ctxNode);
                      const units = items.reduce((s, p) => s + Math.max(0, p.qty), 0);
                      return (
                        <button className={`wh-ctx-btn ${contentsOpen ? "on" : ""}`} title="Co tu leży" onClick={() => setContentsOpen((v) => !v)}>
                          <PackageOpen size={14} />{items.length} prod. · {units} szt.
                        </button>
                      );
                    })()}
                    {isSectionNode(ctxNode) && (
                      <button className={`wh-ctx-btn ${ctxNode.pickable ? "on" : ""}`} disabled={busy}
                        title={ctxNode.pickable ? "Strefa odkładcza — można tu przyjmować towar" : "Oznacz jako strefę odkładczą (pole przyjęć)"}
                        onClick={togglePickable}>
                        <PackageOpen size={14} />{ctxNode.pickable ? "Odkładcza" : "Zwykła"}
                      </button>
                    )}
                    {isSectionNode(ctxNode) && <span className="wh-ctx-static muted">{membersOf(ctxNode).length} elem.</span>}
                    {ctxNode.shape !== "wall" && ctxNode.shape !== "text" && (
                      <button className="wh-ctx-btn" title="Edytuj szczegóły" onClick={() => setEditing({ node: ctxNode, parentId: ctxNode.parentId, kind: ctxNode.kind })}><Pencil size={14} /></button>
                    )}
                    <button className="wh-ctx-btn danger" title={isSectionNode(ctxNode) ? "Usuń strefę (elementy zostają)" : "Usuń"} disabled={busy} onClick={deleteSelected}><Trash2 size={14} /></button>
                    <button className="wh-ctx-btn" onClick={() => setSelectedIds([])}><X size={14} /></button>
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {confirmDel && (() => {
        const inside = nodes.filter((n) => {
          let p = n.parentId; while (p) { if (p === confirmDel.id) return true; p = byId.get(p)?.parentId ?? null; } return false;
        }).length;
        return (
          <div className="wh-modal-backdrop" onMouseDown={() => setConfirmDel(null)}>
            <div className="wh-confirm" onMouseDown={(e) => e.stopPropagation()}>
              <div className="wh-confirm-icon"><Trash2 size={22} /></div>
              <strong>Usunąć podwórko „{confirmDel.name}"?</strong>
              <p>{inside > 0 ? `Skasuje to wszystko, co na nim narysowano (${inside} ${inside === 1 ? "element" : "elementów"}). Tej operacji nie da się cofnąć.` : "Podwórko jest puste."}</p>
              <div className="wh-confirm-actions">
                <button style={button} onClick={() => setConfirmDel(null)}>Anuluj</button>
                <button style={{ ...button, background: "#dc2626", color: "#fff", borderColor: "transparent" }} disabled={busy} onClick={() => deletePodworko(confirmDel)}><Trash2 size={14} />Usuń podwórko</button>
              </div>
            </div>
          </div>
        );
      })()}
      {editing && <LocationModal nodes={nodes} state={editing} onClose={() => setEditing(null)} onSaved={async (id) => { setEditing(null); if (id > 0) setSelectedIds([id]); await reload(); }} />}
    </div>
  );
}

function LocationModal({ nodes, state, onClose, onSaved }: {
  nodes: WarehouseNode[];
  state: { node?: WarehouseNode; parentId?: number | null; kind?: LocationKind };
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const { t } = useI18n();
  const parent = state.parentId ? nodes.find((node) => node.id === state.parentId) : null;
  const initialKind = state.node?.kind ?? state.kind ?? "rack";
  const size = defaultSize(initialKind);
  const [form, setForm] = useState<LocationInput>({
    id: state.node?.id ?? null,
    parentId: state.node?.parentId ?? state.parentId ?? null,
    kind: initialKind,
    name: state.node?.name ?? "",
    code: state.node?.code ?? "",
    color: state.node?.color ?? parent?.color ?? "#6c5fc7",
    capacity: state.node?.capacity ?? 0,
    pickable: state.node?.pickable ?? ["rack", "bin"].includes(initialKind),
    priority: state.node?.priority ?? 100,
    x: state.node?.x ?? 0,
    y: state.node?.y ?? 0,
    width: state.node?.width ?? size.width,
    height: state.node?.height ?? size.height,
    shape: state.node?.shape ?? "rect",
    rotation: state.node?.rotation ?? 0,
    meta: state.node?.meta ?? null,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const kindOptions: LocationKind[] = state.node?.kind === "building" ? ["building"] : ["rack", "bin", "zone"];
  const set = (key: keyof LocationInput) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = event.target instanceof HTMLInputElement && event.target.type === "number" ? Number(event.target.value) : event.target.value;
    setForm((current) => ({ ...current, [key]: value }));
  };
  const save = async () => {
    setBusy(true); setErr(null);
    try { onSaved(await upsertLocation(form)); }
    catch (e) { setErr(translateMessage(e, t)); setBusy(false); }
  };
  const remove = async () => {
    if (!form.id) return;
    setBusy(true); setErr(null);
    try { await deleteLocation(form.id); onSaved(-1); }
    catch (e) { setErr(translateMessage(e, t)); setBusy(false); }
  };

  return (
    <div className="wh-modal-backdrop" onMouseDown={onClose}>
      <div className="wh-modal wh-location-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="wh-modal-head"><div><small>{t(KIND_KEY[form.kind])}</small><strong>{state.node ? t(T.wh_map_edit) : "Nowy element"}</strong></div><button onClick={onClose}><X size={18} /></button></div>
        <div className="wh-form-grid">
          <Label text={t(T.wh_map_name)} wide><input autoFocus style={field} value={form.name} onChange={set("name")} placeholder="np. Regał wysokiego składowania" /></Label>
          <Label text={t(T.wh_map_code)}><input style={field} value={form.code} onChange={set("code")} placeholder="H1-R01" /></Label>
          <Label text="Typ"><select style={field} value={form.kind} onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value as LocationKind }))}>{kindOptions.map((kind) => <option key={kind} value={kind}>{t(KIND_KEY[kind])}</option>)}</select></Label>
          <Label text="Miejsca paletowe / pojemność"><input type="number" min={0} style={field} value={form.capacity} onChange={set("capacity")} /></Label>
          <Label text={t(T.wh_map_color)}><div className="wh-color-field"><input type="color" value={form.color} onChange={set("color")} /><input style={field} value={form.color} onChange={set("color")} /></div></Label>
          <label className="wh-check"><input type="checkbox" checked={form.pickable} onChange={(event) => setForm((current) => ({ ...current, pickable: event.target.checked }))} /><span><CheckCircle2 size={16} />{t(T.wh_map_pickable)}</span></label>
        </div>
        {err && <div className="wh-error">{err}</div>}
        <div className="wh-modal-actions">
          {form.id && <button style={{ ...button, color: "#dc2626", marginRight: "auto" }} disabled={busy} onClick={remove}><Trash2 size={14} />{t(T.wh_map_delete)}</button>}
          <button style={button} onClick={onClose}>{t(T.common_cancel)}</button>
          <button style={primary} disabled={busy || !form.name.trim() || !form.code.trim()} onClick={save}>{t(T.common_save)}</button>
        </div>
      </div>
    </div>
  );
}

function Label({ text, children, wide }: { text: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={wide ? "wh-wide" : ""}><span>{text}</span>{children}</label>;
}
