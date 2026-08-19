// =========================================================
// FILE: src/components/admin/PhotoTemplateGenerator.tsx
// Конструктор шаблонных фото (Figma-подобный): выбор товаров,
// редактор карточки на canvas (фон, элементы, перетаскивание),
// плейсхолдеры {{size}} {{name}} … и генерация по одному фото
// на товар с сохранением в Cloudinary.
// =========================================================

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  GripVertical,
  ImagePlus,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Square,
  Trash2,
  Type,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import {
  buildProductTokens,
  createDefaultTemplate,
  createElementId,
  PHOTO_PLACEHOLDERS,
  photoFontFamilies,
  substituteTokens,
  type PhotoArrowElement,
  type PhotoImageElement,
  type PhotoProduct,
  type PhotoRectElement,
  type PhotoTemplate,
  type PhotoTemplateElement,
  type PhotoTextElement,
} from "@/lib/photo-template";

/* ─────────────────────────  Canvas helpers  ───────────────────────── */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось загрузить изображение"));
    img.src = src;
  });
}

function applyFont(ctx: CanvasRenderingContext2D, el: PhotoTextElement) {
  ctx.font = `${el.italic ? "italic " : ""}${el.fontWeight} ${el.fontSize}px "${
    el.fontFamily
  }", sans-serif`;
}

function measure(ctx: CanvasRenderingContext2D, text: string, ls: number) {
  if (ls <= 0) return ctx.measureText(text).width;
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    w += ctx.measureText(text[i]).width;
    if (i > 0) w += ls;
  }
  return w;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  ls: number
): string[] {
  const lines: string[] = [];
  const safe = Math.max(10, maxWidth);
  for (const para of text.split("\n")) {
    if (para === "") {
      lines.push("");
      continue;
    }
    const words = para.split(" ");
    let cur = "";
    for (const w of words) {
      const candidate = cur ? `${cur} ${w}` : w;
      if (cur && measure(ctx, candidate, ls) > safe) {
        lines.push(cur);
        cur = w;
      } else {
        cur = candidate;
      }
    }
    lines.push(cur);
  }
  return lines;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function drawContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;
  const scale = Math.min(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/* ── Вращение ── */
function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Поворот точки (x, y) вокруг (cx, cy) на deg градусов. */
function rotatePoint(
  cx: number,
  cy: number,
  x: number,
  y: number,
  deg: number
): [number, number] {
  const rad = degToRad(deg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

/** Нормализует угол в диапазон (-180, 180]. */
function normDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return Math.round(d);
}

/** Габариты «коробочного» элемента в его локальной системе координат. */
interface BoxGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

function boxGeom(
  ctx: CanvasRenderingContext2D,
  el: PhotoTextElement | PhotoRectElement | PhotoImageElement,
  tokens: Record<string, string>
): BoxGeom {
  if (el.type === "rect" || el.type === "image") {
    return {
      x: el.x,
      y: el.y,
      w: el.width,
      h: el.height,
      rotation: el.rotation ?? 0,
    };
  }
  applyFont(ctx, el);
  const lines = wrapText(
    ctx,
    substituteTokens(el.text, tokens),
    el.width,
    el.letterSpacing
  );
  const h = Math.max(el.fontSize, lines.length * el.fontSize * el.lineHeight);
  return { x: el.x, y: el.y, w: el.width, h, rotation: el.rotation ?? 0 };
}

/** Мировые координаты четырёх углов повёрнутого элемента. */
function boxCorners(g: BoxGeom): [number, number][] {
  const cx = g.x + g.w / 2;
  const cy = g.y + g.h / 2;
  return [
    rotatePoint(cx, cy, g.x, g.y, g.rotation),
    rotatePoint(cx, cy, g.x + g.w, g.y, g.rotation),
    rotatePoint(cx, cy, g.x + g.w, g.y + g.h, g.rotation),
    rotatePoint(cx, cy, g.x, g.y + g.h, g.rotation),
  ];
}

/** Точка внутри (повёрнутого) прямоугольника элемента. */
function pointInBox(px: number, py: number, g: BoxGeom): boolean {
  const cx = g.x + g.w / 2;
  const cy = g.y + g.h / 2;
  const rad = degToRad(g.rotation);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - cx;
  const dy = py - cy;
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  return Math.abs(lx) <= g.w / 2 + 3 && Math.abs(ly) <= g.h / 2 + 3;
}

/** Расстояние от точки до отрезка (для хит-теста стрелки). */
function segmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Сдвиг элемента (у стрелки двигаются оба конца). */
function translateElement(
  el: PhotoTemplateElement,
  dx: number,
  dy: number
): PhotoTemplateElement {
  if (el.type === "arrow") {
    return { ...el, x: el.x + dx, y: el.y + dy, x2: el.x2 + dx, y2: el.y2 + dy };
  }
  return { ...el, x: el.x + dx, y: el.y + dy } as PhotoTemplateElement;
}

function drawText(
  ctx: CanvasRenderingContext2D,
  el: PhotoTextElement,
  tokens: Record<string, string>
) {
  const text = substituteTokens(el.text, tokens);
  applyFont(ctx, el);
  const lines = wrapText(ctx, text, el.width, el.letterSpacing);
  const lh = el.fontSize * el.lineHeight;
  const h = Math.max(el.fontSize, lines.length * lh);
  const cx = el.x + el.width / 2;
  const cy = el.y + h / 2;

  ctx.save();
  if (el.rotation) {
    ctx.translate(cx, cy);
    ctx.rotate(degToRad(el.rotation));
    ctx.translate(-cx, -cy);
  }
  ctx.textAlign = el.align;
  ctx.textBaseline = "top";
  ctx.fillStyle = el.color;
  lines.forEach((line, i) => {
    const y = el.y + i * lh;
    if (el.letterSpacing > 0) {
      const total = measure(ctx, line, el.letterSpacing);
      let lineX =
        el.align === "left"
          ? el.x
          : el.align === "center"
            ? el.x + (el.width - total) / 2
            : el.x + el.width - total;
      for (const ch of line) {
        ctx.fillText(ch, lineX, y);
        lineX += ctx.measureText(ch).width + el.letterSpacing;
      }
    } else {
      const ax =
        el.align === "left"
          ? el.x
          : el.align === "center"
            ? el.x + el.width / 2
            : el.x + el.width;
      ctx.fillText(line, ax, y);
    }
  });
  ctx.restore();
}

function drawRectEl(ctx: CanvasRenderingContext2D, el: PhotoRectElement) {
  ctx.save();
  if (el.rotation) {
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(degToRad(el.rotation));
    ctx.translate(-cx, -cy);
  }
  ctx.fillStyle = el.color;
  if (el.radius > 0) {
    roundRectPath(ctx, el.x, el.y, el.width, el.height, el.radius);
    ctx.fill();
  } else {
    ctx.fillRect(el.x, el.y, el.width, el.height);
  }
  ctx.restore();
}

async function drawImageEl(
  ctx: CanvasRenderingContext2D,
  el: PhotoImageElement
) {
  if (!el.src) return;
  const img = await loadImage(el.src);
  ctx.save();
  if (el.rotation) {
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(degToRad(el.rotation));
    ctx.translate(-cx, -cy);
  }
  if (el.radius > 0) {
    roundRectPath(ctx, el.x, el.y, el.width, el.height, el.radius);
    ctx.clip();
  }
  if (el.fit === "cover") drawCover(ctx, img, el.x, el.y, el.width, el.height);
  else drawContain(ctx, img, el.x, el.y, el.width, el.height);
  ctx.restore();
}

function drawArrowEl(ctx: CanvasRenderingContext2D, el: PhotoArrowElement) {
  ctx.save();
  ctx.strokeStyle = el.color;
  ctx.lineWidth = Math.max(1, el.width);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(el.x, el.y);
  ctx.lineTo(el.x2, el.y2);
  ctx.stroke();

  const ang = Math.atan2(el.y2 - el.y, el.x2 - el.x);
  const hs = Math.max(6, el.headSize);
  ctx.beginPath();
  ctx.moveTo(el.x2, el.y2);
  ctx.lineTo(
    el.x2 - hs * Math.cos(ang - Math.PI / 6),
    el.y2 - hs * Math.sin(ang - Math.PI / 6)
  );
  ctx.moveTo(el.x2, el.y2);
  ctx.lineTo(
    el.x2 - hs * Math.cos(ang + Math.PI / 6),
    el.y2 - hs * Math.sin(ang + Math.PI / 6)
  );
  ctx.stroke();
  ctx.restore();
}

async function renderTemplate(
  canvas: HTMLCanvasElement,
  template: PhotoTemplate,
  tokens: Record<string, string>
) {
  canvas.width = template.width;
  canvas.height = template.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (template.background.type === "color") {
    ctx.fillStyle = template.background.color;
    ctx.fillRect(0, 0, template.width, template.height);
  } else if (template.background.src) {
    try {
      const img = await loadImage(template.background.src);
      if (template.background.fit === "cover")
        drawCover(ctx, img, 0, 0, template.width, template.height);
      else drawContain(ctx, img, 0, 0, template.width, template.height);
    } catch {
      ctx.fillStyle = "#f4f1ea";
      ctx.fillRect(0, 0, template.width, template.height);
    }
  }

  for (const el of template.elements) {
    if (el.type === "rect") drawRectEl(ctx, el);
    else if (el.type === "text") drawText(ctx, el, tokens);
    else if (el.type === "arrow") drawArrowEl(ctx, el);
    else if (el.type === "image") {
      try {
        await drawImageEl(ctx, el);
      } catch {
        /* битая картинка — просто пропускаем */
      }
    }
  }
}

/** Габариты элемента для рамки выделения и хит-теста (стрелки — AABB). */
function elementBox(
  ctx: CanvasRenderingContext2D,
  el: PhotoTemplateElement,
  tokens: Record<string, string>
): { x: number; y: number; w: number; h: number } {
  if (el.type === "arrow") {
    const x = Math.min(el.x, el.x2);
    const y = Math.min(el.y, el.y2);
    return {
      x,
      y,
      w: Math.abs(el.x2 - el.x),
      h: Math.abs(el.y2 - el.y),
    };
  }
  if (el.type === "rect" || el.type === "image") {
    return { x: el.x, y: el.y, w: el.width, h: el.height };
  }
  applyFont(ctx, el);
  const lines = wrapText(
    ctx,
    substituteTokens(el.text, tokens),
    el.width,
    el.letterSpacing
  );
  const h = Math.max(el.fontSize, lines.length * el.fontSize * el.lineHeight);
  return { x: el.x, y: el.y, w: el.width, h };
}

function drawSelection(
  canvas: HTMLCanvasElement,
  template: PhotoTemplate,
  selectedId: string | null,
  tokens: Record<string, string>
) {
  const ctx = canvas.getContext("2d");
  if (!ctx || !selectedId) return;
  const el = template.elements.find((e) => e.id === selectedId);
  if (!el) return;
  const handle = Math.max(9, template.width / 60);

  ctx.save();
  ctx.strokeStyle = "#2563eb";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = Math.max(1.5, template.width / 500);

  if (el.type === "arrow") {
    const box = elementBox(ctx, el, tokens);
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(box.x - 8, box.y - 8, box.w + 16, box.h + 16);
    ctx.setLineDash([]);
    for (const [hx, hy] of [
      [el.x, el.y],
      [el.x2, el.y2],
    ] as [number, number][]) {
      ctx.fillRect(hx - handle / 2, hy - handle / 2, handle, handle);
      ctx.strokeRect(hx - handle / 2, hy - handle / 2, handle, handle);
    }
  } else {
    const g = boxGeom(ctx, el, tokens);
    const corners = boxCorners(g);

    // Повёрнутая рамка
    ctx.beginPath();
    corners.forEach((c, i) => {
      if (i === 0) ctx.moveTo(c[0], c[1]);
      else ctx.lineTo(c[0], c[1]);
    });
    ctx.closePath();
    ctx.stroke();

    // Угловые ручки ресайза
    for (const [hx, hy] of corners) {
      ctx.fillRect(hx - handle / 2, hy - handle / 2, handle, handle);
      ctx.strokeRect(hx - handle / 2, hy - handle / 2, handle, handle);
    }

    // Ручка вращения — над верхней гранью
    const cx = g.x + g.w / 2;
    const cy = g.y + g.h / 2;
    const topCenter = rotatePoint(cx, cy, cx, g.y, g.rotation);
    const rotHandle = rotatePoint(cx, cy, cx, g.y - 34, g.rotation);
    ctx.beginPath();
    ctx.moveTo(topCenter[0], topCenter[1]);
    ctx.lineTo(rotHandle[0], rotHandle[1]);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rotHandle[0], rotHandle[1], handle * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/* ─────────────────────────  Factories  ───────────────────────── */

function makeText(partial: Partial<PhotoTextElement> = {}): PhotoTextElement {
  return {
    id: createElementId(),
    type: "text",
    x: 60,
    y: 60,
    text: "Текст",
    fontSize: 48,
    fontFamily: "Oswald",
    color: "#1e4d38",
    fontWeight: 700,
    italic: false,
    align: "left",
    width: 500,
    lineHeight: 1.1,
    letterSpacing: 0,
    ...partial,
  };
}

function makeRect(partial: Partial<PhotoRectElement> = {}): PhotoRectElement {
  return {
    id: createElementId(),
    type: "rect",
    x: 100,
    y: 100,
    width: 300,
    height: 180,
    color: "#2d6a4f",
    radius: 12,
    ...partial,
  };
}

function makeImage(partial: Partial<PhotoImageElement> = {}): PhotoImageElement {
  return {
    id: createElementId(),
    type: "image",
    x: 100,
    y: 100,
    width: 300,
    height: 300,
    src: "",
    fit: "cover",
    radius: 0,
    ...partial,
  };
}

function makeArrow(partial: Partial<PhotoArrowElement> = {}): PhotoArrowElement {
  return {
    id: createElementId(),
    type: "arrow",
    x: 160,
    y: 180,
    x2: 460,
    y2: 180,
    color: "#dc2626",
    width: 6,
    headSize: 18,
    ...partial,
  };
}

/* ─────────────────────────  Component  ───────────────────────── */

const SAMPLE_PRODUCT: PhotoProduct = {
  id: "sample",
  name: "Гофрокороб Т-23",
  sku: "Т-23",
  price: 35,
  categoryId: null,
  dimensionLength: 600,
  dimensionWidth: 400,
  dimensionHeight: 400,
  dimensionUnit: "мм",
  material: "3-слойный",
  volume: 96,
  barcode: "2000000000007",
  imageUrl: null,
};

function formatDims(p: PhotoProduct): string {
  const dims = [p.dimensionLength, p.dimensionWidth, p.dimensionHeight]
    .filter((v): v is number => v != null && v > 0)
    .map((v) => String(parseFloat(v.toFixed(2))));
  return dims.length ? `${dims.join("×")} ${p.dimensionUnit || "мм"}` : "—";
}

interface ResultItem {
  productId: string;
  name: string;
  url: string | null;
  ok: boolean;
  error?: string;
}

export function PhotoTemplateGenerator({
  products,
  categories,
  adminPath,
}: {
  products: PhotoProduct[];
  categories: { id: string; name: string }[];
  adminPath: string;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [catFilter, setCatFilter] = useState("all");

  const [template, setTemplate] = useState<PhotoTemplate>(() =>
    createDefaultTemplate()
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewProductId, setPreviewProductId] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [replaceImages, setReplaceImages] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<ResultItem[]>([]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    mode: "move" | "resize" | "rotate" | "arrow-end";
    elementId: string;
    startX: number;
    startY: number;
    origEl: PhotoTemplateElement;
    cx: number;
    cy: number;
    startAngle: number;
    which: "start" | "end";
  } | null>(null);
  // Перетаскивание слоёв в панели «Слои» (индексы в отображаемом списке).
  const [dragLayerIndex, setDragLayerIndex] = useState<number | null>(null);
  const [overLayerIndex, setOverLayerIndex] = useState<number | null>(null);

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const categoryName = useMemo(() => {
    const m = new Map(categories.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? m.get(id) || "—" : "—");
  }, [categories]);

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (catFilter !== "all" && p.categoryId !== catFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q)
      );
    });
  }, [products, query, catFilter]);

  const previewProduct = useMemo(() => {
    if (previewProductId && productById.has(previewProductId)) {
      return productById.get(previewProductId)!;
    }
    const firstWithDims = products.find(
      (p) => selected.has(p.id) && (p.dimensionLength || p.dimensionWidth)
    );
    if (firstWithDims) return firstWithDims;
    const anySelected = products.find((p) => selected.has(p.id));
    if (anySelected) return anySelected;
    return SAMPLE_PRODUCT;
  }, [previewProductId, productById, products, selected]);

  const tokens = useMemo(
    () => buildProductTokens(previewProduct),
    [previewProduct]
  );

  /* ── Отрисовка превью ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    (async () => {
      try {
        await renderTemplate(canvas, template, tokens);
        if (!cancelled) drawSelection(canvas, template, selectedId, tokens);
      } catch (err) {
        console.error(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [template, tokens, selectedId]);

  /* ── Выбор элементов на холсте ── */
  const clientToCanvas = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    };
  }, []);

  const hitTest = useCallback(
    (px: number, py: number): PhotoTemplateElement | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      // Перебираем сверху вниз (последний в массиве — самый верхний).
      for (let i = template.elements.length - 1; i >= 0; i--) {
        const el = template.elements[i];
        if (el.type === "arrow") {
          if (
            segmentDistance(px, py, el.x, el.y, el.x2, el.y2) <=
            Math.max(el.width / 2 + 8, 12)
          ) {
            return el;
          }
          continue;
        }
        const g = boxGeom(ctx, el, tokens);
        if (pointInBox(px, py, g)) return el;
      }
      return null;
    },
    [template, tokens]
  );

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { x, y } = clientToCanvas(e.clientX, e.clientY);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const handle = Math.max(9, template.width / 60);

    // Ручки выбранного элемента: вращение, углы ресайза, концы стрелки.
    if (selectedId) {
      const sel = template.elements.find((el) => el.id === selectedId);
      if (sel) {
        if (sel.type === "arrow") {
          const ends: ["start" | "end", number, number][] = [
            ["start", sel.x, sel.y],
            ["end", sel.x2, sel.y2],
          ];
          for (const [which, hx, hy] of ends) {
            if (Math.abs(x - hx) <= handle && Math.abs(y - hy) <= handle) {
              dragRef.current = {
                mode: "arrow-end",
                elementId: sel.id,
                startX: x,
                startY: y,
                origEl: { ...sel },
                cx: 0,
                cy: 0,
                startAngle: 0,
                which,
              };
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              return;
            }
          }
        } else {
          const g = boxGeom(ctx, sel, tokens);
          const cx = g.x + g.w / 2;
          const cy = g.y + g.h / 2;

          // Ручка вращения
          const [rhx, rhy] = rotatePoint(cx, cy, cx, g.y - 34, g.rotation);
          if (Math.hypot(x - rhx, y - rhy) <= handle * 1.2) {
            dragRef.current = {
              mode: "rotate",
              elementId: sel.id,
              startX: x,
              startY: y,
              origEl: { ...sel },
              cx,
              cy,
              startAngle: (Math.atan2(y - cy, x - cx) * 180) / Math.PI,
              which: "start",
            };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            return;
          }

          // Угловые ручки ресайза
          for (const [hx, hy] of boxCorners(g)) {
            if (Math.abs(x - hx) <= handle && Math.abs(y - hy) <= handle) {
              dragRef.current = {
                mode: "resize",
                elementId: sel.id,
                startX: x,
                startY: y,
                origEl: { ...sel },
                cx,
                cy,
                startAngle: 0,
                which: "start",
              };
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              return;
            }
          }
        }
      }
    }

    const hit = hitTest(x, y);
    if (hit) {
      setSelectedId(hit.id);
      dragRef.current = {
        mode: "move",
        elementId: hit.id,
        startX: x,
        startY: y,
        origEl: { ...hit },
        cx: 0,
        cy: 0,
        startAngle: 0,
        which: "start",
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } else {
      setSelectedId(null);
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const { x, y } = clientToCanvas(e.clientX, e.clientY);
    const dx = x - drag.startX;
    const dy = y - drag.startY;

    setTemplate((t) => ({
      ...t,
      elements: t.elements.map((el) => {
        if (el.id !== drag.elementId) return el;
        if (drag.mode === "move") {
          return translateElement(drag.origEl, dx, dy);
        }
        if (drag.mode === "arrow-end") {
          if (drag.which === "end") {
            return { ...drag.origEl, x2: x, y2: y } as PhotoTemplateElement;
          }
          return { ...drag.origEl, x, y } as PhotoTemplateElement;
        }
        if (drag.mode === "rotate") {
          const angle = (Math.atan2(y - drag.cy, x - drag.cx) * 180) / Math.PI;
          const base = drag.origEl as
            | PhotoTextElement
            | PhotoRectElement
            | PhotoImageElement;
          const rotation = normDeg(
            (base.rotation ?? 0) + (angle - drag.startAngle)
          );
          return { ...base, rotation } as PhotoTemplateElement;
        }
        // resize: симметрично вокруг центра (в локальных осях элемента)
        const orig = drag.origEl as
          | PhotoTextElement
          | PhotoRectElement
          | PhotoImageElement;
        const rot = orig.rotation ?? 0;
        const rad = degToRad(rot);
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const ddx = x - drag.cx;
        const ddy = y - drag.cy;
        const lx = ddx * cos + ddy * sin;
        const ly = -ddx * sin + ddy * cos;
        if (orig.type === "text") {
          const w = Math.max(20, Math.round(2 * Math.abs(lx)));
          return { ...orig, width: w, x: drag.cx - w / 2 } as PhotoTemplateElement;
        }
        const w = Math.max(10, Math.round(2 * Math.abs(lx)));
        const h = Math.max(10, Math.round(2 * Math.abs(ly)));
        return {
          ...orig,
          width: w,
          height: h,
          x: drag.cx - w / 2,
          y: drag.cy - h / 2,
        } as PhotoTemplateElement;
      }),
    }));
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (dragRef.current) {
      dragRef.current = null;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }

  /* ── Клавиатура: стрелки двигают, Delete удаляет ── */
  function onCanvasKeyDown(e: React.KeyboardEvent) {
    if (!selectedId) return;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      const stepPx = e.shiftKey ? 10 : 1;
      const dx =
        e.key === "ArrowLeft" ? -stepPx : e.key === "ArrowRight" ? stepPx : 0;
      const dy =
        e.key === "ArrowUp" ? -stepPx : e.key === "ArrowDown" ? stepPx : 0;
      setTemplate((t) => ({
        ...t,
        elements: t.elements.map((el) =>
          el.id === selectedId ? translateElement(el, dx, dy) : el
        ),
      }));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeElement(selectedId);
    }
  }

  /* ── Операции с элементами ── */
  function updateElement(id: string, patch: Record<string, unknown>) {
    setTemplate((t) => ({
      ...t,
      elements: t.elements.map((el) =>
        el.id === id ? ({ ...el, ...patch } as PhotoTemplateElement) : el
      ),
    }));
  }

  function removeElement(id: string) {
    setTemplate((t) => ({
      ...t,
      elements: t.elements.filter((el) => el.id !== id),
    }));
    if (selectedId === id) setSelectedId(null);
  }

  function duplicateElement(id: string) {
    setTemplate((t) => {
      const idx = t.elements.findIndex((el) => el.id === id);
      if (idx < 0) return t;
      const src = t.elements[idx];
      const copy =
        src.type === "arrow"
          ? {
              ...src,
              id: createElementId(),
              x: src.x + 24,
              y: src.y + 24,
              x2: src.x2 + 24,
              y2: src.y2 + 24,
            }
          : { ...src, id: createElementId(), x: src.x + 24, y: src.y + 24 };
      const next = [...t.elements];
      next.splice(idx + 1, 0, copy as PhotoTemplateElement);
      setSelectedId(copy.id);
      return { ...t, elements: next };
    });
  }

  function moveElement(id: string, dir: -1 | 1) {
    setTemplate((t) => {
      const idx = t.elements.findIndex((el) => el.id === id);
      if (idx < 0) return t;
      const target = idx + dir;
      if (target < 0 || target >= t.elements.length) return t;
      const next = [...t.elements];
      const [el] = next.splice(idx, 1);
      next.splice(target, 0, el);
      return { ...t, elements: next };
    });
  }

  function addElement(el: PhotoTemplateElement) {
    setTemplate((t) => ({ ...t, elements: [...t.elements, el] }));
    setSelectedId(el.id);
  }

  /** Слои в порядке отображения (верхний — первым). */
  const displayedLayers = useMemo(
    () => [...template.elements].reverse(),
    [template.elements]
  );

  /** Перетащили слой на позицию targetIndex (в отображаемом списке). */
  function reorderLayer(targetIndex: number) {
    if (dragLayerIndex == null || dragLayerIndex === targetIndex) return;
    const next = [...displayedLayers];
    const [moved] = next.splice(dragLayerIndex, 1);
    next.splice(targetIndex, 0, moved);
    setTemplate((t) => ({ ...t, elements: [...next].reverse() }));
  }

  async function uploadFile(file: File): Promise<string | null> {
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) throw new Error(data?.error || "Ошибка");
      return data.url as string;
    } catch (err) {
      alert(err instanceof Error ? err.message : "Не удалось загрузить файл");
      return null;
    }
  }

  /* ── Выбор товаров ── */
  function toggleProduct(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      filteredProducts.forEach((p) => next.add(p.id));
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  /* ── Генерация ── */
  async function renderToDataUrl(product: PhotoProduct): Promise<string> {
    const canvas = document.createElement("canvas");
    try {
      await document.fonts.ready;
    } catch {
      /* шрифты ещё грузятся — не критично */
    }
    await renderTemplate(canvas, template, buildProductTokens(product));
    return canvas.toDataURL("image/png");
  }

  async function handleGenerate() {
    const ids = Array.from(selected);
    if (!ids.length || generating) return;
    setGenerating(true);
    setResults([]);
    setProgress({ done: 0, total: ids.length });

    const nextResults: ResultItem[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const product = productById.get(id);
      const name = product?.name || id;
      try {
        const image = await renderToDataUrl(product ?? SAMPLE_PRODUCT);
        const res = await fetch("/api/admin/products/generate-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId: id,
            image,
            replace: replaceImages,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || "Ошибка сохранения");
        }
        nextResults.push({ productId: id, name, url: data.url, ok: true });
      } catch (err) {
        nextResults.push({
          productId: id,
          name,
          url: null,
          ok: false,
          error: err instanceof Error ? err.message : "Ошибка",
        });
      }
      setProgress({ done: i + 1, total: ids.length });
      setResults([...nextResults]);
    }
    setGenerating(false);
  }

  const selectedWithDims = useMemo(
    () =>
      products.filter(
        (p) =>
          selected.has(p.id) &&
          (p.dimensionLength != null || p.dimensionWidth != null)
      ).length,
    [products, selected]
  );

  const selectedEl = selectedId
    ? template.elements.find((el) => el.id === selectedId) || null
    : null;

  return (
    <div className="ptg">
      {/* ── Шаги ── */}
      <div className="ptg-steps">
        <button
          type="button"
          className={`ptg-step${step === 1 ? " ptg-step--active" : ""}${step > 1 ? " ptg-step--done" : ""}`}
          onClick={() => setStep(1)}
        >
          <span className="ptg-step__num">1</span>
          <span>Товары</span>
        </button>
        <button
          type="button"
          className={`ptg-step${step === 2 ? " ptg-step--active" : ""}${step > 2 ? " ptg-step--done" : ""}`}
          onClick={() => setStep(2)}
        >
          <span className="ptg-step__num">2</span>
          <span>Дизайн карточки</span>
        </button>
        <button
          type="button"
          className={`ptg-step${step === 3 ? " ptg-step--active" : ""}`}
          onClick={() => setStep(3)}
        >
          <span className="ptg-step__num">3</span>
          <span>Генерация</span>
        </button>
        <div className="ptg-steps__count">
          Выбрано товаров: <strong>{selected.size}</strong>
          {selectedWithDims > 0 && (
            <span className="ptg-steps__hint"> · с размерами: {selectedWithDims}</span>
          )}
        </div>
      </div>

      {/* ═════════ ШАГ 1 — выбор товаров ═════════ */}
      {step === 1 && (
        <div className="ptg-panel">
          <div className="ptg-toolbar">
            <div className="ptg-search">
              <Search size={15} />
              <input
                type="text"
                placeholder="Поиск по названию или артикулу…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              className="admin-select"
              style={{ minWidth: 200 }}
            >
              <option value="all">Все категории</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={selectAllFiltered}
            >
              <Check size={14} /> Выбрать все (фильтр)
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={clearSelection}
            >
              <X size={14} /> Сбросить
            </button>
          </div>

          <div className="ptg-list">
            {filteredProducts.length === 0 ? (
              <div className="ptg-empty">Ничего не найдено</div>
            ) : (
              filteredProducts.map((p) => {
                const isSel = selected.has(p.id);
                return (
                  <label key={p.id} className={`ptg-item${isSel ? " ptg-item--on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggleProduct(p.id)}
                    />
                    <div className="ptg-item__thumb">
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt="" />
                      ) : (
                        <span>📦</span>
                      )}
                    </div>
                    <div className="ptg-item__body">
                      <div className="ptg-item__name">{p.name}</div>
                      <div className="ptg-item__meta">
                        {p.sku || "—"} · {categoryName(p.categoryId)}
                      </div>
                    </div>
                    <div className="ptg-item__dims" title="Размер на карточке">
                      {formatDims(p)}
                    </div>
                  </label>
                );
              })
            )}
          </div>

          <div className="ptg-footer">
            <span className="admin-sub">
              Для шаблонного размера выбирайте товары с заполненными
              габаритами (колонка справа).
            </span>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              disabled={selected.size === 0}
              onClick={() => setStep(2)}
            >
              Далее: дизайн карточки <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ═════════ ШАГ 2 — конструктор ═════════ */}
      {step === 2 && (
        <div className="ptg-designer">
          {/* Панель инструментов */}
          <div className="ptg-toolbar ptg-toolbar--design">
            <div className="ptg-tools">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => addElement(makeText({ text: "{{size}}", fontSize: 88, align: "center", width: 900, x: 50 }))}
                title="Добавить размер — подставится из карточки товара"
              >
                <Wand2 size={14} /> Размер
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => addElement(makeText({ text: "{{name}}", fontSize: 56 }))}
              >
                <Type size={14} /> Название
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => addElement(makeText({ text: "{{price}}", fontSize: 64 }))}
              >
                <Type size={14} /> Цена
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => addElement(makeText())}
              >
                <Type size={14} /> Текст
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => addElement(makeRect())}
              >
                <Square size={14} /> Прямоугольник
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => addElement(makeImage())}
              >
                <ImagePlus size={14} /> Картинка
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => addElement(makeArrow())}
                title="Стрелка — тяните за концы, чтобы растянуть/уменьшить"
              >
                <ArrowRight size={14} /> Стрелка
              </button>
            </div>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={() => {
                if (confirm("Сбросить шаблон к исходному виду?")) {
                  setTemplate(createDefaultTemplate());
                  setSelectedId(null);
                }
              }}
            >
              <RotateCcw size={14} /> Сбросить шаблон
            </button>
          </div>

          <div className="ptg-designer__grid">
            {/* Левая колонка: холст + параметры фона */}
            <div className="ptg-canvas-col">
              <div
                ref={wrapRef}
                className="ptg-canvas-wrap"
                tabIndex={0}
                onKeyDown={onCanvasKeyDown}
              >
                <canvas
                  ref={canvasRef}
                  className="ptg-canvas"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                />
              </div>

              <div className="ptg-canvas-settings">
                <div className="ptg-field">
                  <label>Ширина (px)</label>
                  <input
                    type="number"
                    min={200}
                    max={2000}
                    value={template.width}
                    onChange={(e) =>
                      setTemplate((t) => ({
                        ...t,
                        width: Math.max(200, Number(e.target.value) || 1000),
                      }))
                    }
                  />
                </div>
                <div className="ptg-field">
                  <label>Высота (px)</label>
                  <input
                    type="number"
                    min={200}
                    max={2000}
                    value={template.height}
                    onChange={(e) =>
                      setTemplate((t) => ({
                        ...t,
                        height: Math.max(200, Number(e.target.value) || 1000),
                      }))
                    }
                  />
                </div>
                <div className="ptg-field">
                  <label>Фон — цвет</label>
                  <input
                    type="color"
                    value={
                      template.background.type === "color"
                        ? template.background.color
                        : "#f4f1ea"
                    }
                    onChange={(e) =>
                      setTemplate((t) => ({
                        ...t,
                        background: { type: "color", color: e.target.value },
                      }))
                    }
                  />
                </div>
                <div className="ptg-field ptg-field--grow">
                  <label>Фон — картинка (URL)</label>
                  <input
                    type="text"
                    placeholder="https://… (или загрузите файл)"
                    value={
                      template.background.type === "image"
                        ? template.background.src
                        : ""
                    }
                    onChange={(e) =>
                      setTemplate((t) => ({
                        ...t,
                        background: {
                          type: "image",
                          src: e.target.value,
                          fit:
                            t.background.type === "image"
                              ? t.background.fit
                              : "cover",
                        },
                      }))
                    }
                  />
                </div>
                <label className="ptg-upload-mini">
                  <Upload size={13} /> Загрузить фон
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    style={{ display: "none" }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const url = await uploadFile(file);
                        if (url)
                          setTemplate((t) => ({
                            ...t,
                            background: { type: "image", src: url, fit: "cover" },
                          }));
                      }
                    }}
                  />
                </label>
                <label className="ptg-check">
                  <input
                    type="checkbox"
                    checked={template.background.type === "color"}
                    onChange={(e) =>
                      setTemplate((t) => ({
                        ...t,
                        background: e.target.checked
                          ? { type: "color", color: "#f4f1ea" }
                          : { type: "image", src: "", fit: "cover" },
                      }))
                    }
                  />
                  <span>Сплошной цвет</span>
                </label>
              </div>
            </div>

            {/* Правая колонка: свойства + слои */}
            <div className="ptg-side">
              <div className="ptg-side__block">
                <div className="ptg-side__title">Предпросмотр на товаре</div>
                <select
                  className="admin-select"
                  value={previewProductId || ""}
                  onChange={(e) => setPreviewProductId(e.target.value || null)}
                >
                  <option value="">— образец —</option>
                  {products
                    .filter((p) => selected.has(p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>

              {/* Свойства выбранного элемента */}
              {selectedEl && (
                <div className="ptg-side__block">
                  <div className="ptg-side__title">
                    {selectedEl.type === "text"
                      ? "Текст"
                      : selectedEl.type === "rect"
                        ? "Прямоугольник"
                        : selectedEl.type === "arrow"
                          ? "Стрелка"
                          : "Картинка"}
                  </div>

                  {selectedEl.type === "arrow" && (
                    <>
                      <div className="ptg-grid2">
                        <div className="ptg-field">
                          <label>X1</label>
                          <input
                            type="number"
                            value={Math.round(selectedEl.x)}
                            onChange={(e) =>
                              updateElement(selectedEl.id, { x: Number(e.target.value) || 0 })
                            }
                          />
                        </div>
                        <div className="ptg-field">
                          <label>Y1</label>
                          <input
                            type="number"
                            value={Math.round(selectedEl.y)}
                            onChange={(e) =>
                              updateElement(selectedEl.id, { y: Number(e.target.value) || 0 })
                            }
                          />
                        </div>
                      </div>
                      <div className="ptg-grid2">
                        <div className="ptg-field">
                          <label>X2</label>
                          <input
                            type="number"
                            value={Math.round(selectedEl.x2)}
                            onChange={(e) =>
                              updateElement(selectedEl.id, { x2: Number(e.target.value) || 0 })
                            }
                          />
                        </div>
                        <div className="ptg-field">
                          <label>Y2</label>
                          <input
                            type="number"
                            value={Math.round(selectedEl.y2)}
                            onChange={(e) =>
                              updateElement(selectedEl.id, { y2: Number(e.target.value) || 0 })
                            }
                          />
                        </div>
                      </div>
                      <div className="ptg-grid2">
                        <div className="ptg-field">
                          <label>Цвет</label>
                          <input
                            type="color"
                            value={selectedEl.color}
                            onChange={(e) =>
                              updateElement(selectedEl.id, { color: e.target.value })
                            }
                          />
                        </div>
                        <div className="ptg-field">
                          <label>Толщина</label>
                          <input
                            type="number"
                            min={1}
                            value={selectedEl.width}
                            onChange={(e) =>
                              updateElement(selectedEl.id, {
                                width: Math.max(1, Number(e.target.value) || 1),
                              })
                            }
                          />
                        </div>
                      </div>
                      <div className="ptg-field">
                        <label>Наконечник (px)</label>
                        <input
                          type="number"
                          min={6}
                          value={selectedEl.headSize}
                          onChange={(e) =>
                            updateElement(selectedEl.id, {
                              headSize: Math.max(6, Number(e.target.value) || 6),
                            })
                          }
                        />
                      </div>
                    </>
                  )}

                  {selectedEl.type === "text" && (
                    <>
                      <div className="ptg-field">
                        <label>Содержимое</label>
                        <textarea
                          rows={2}
                          value={selectedEl.text}
                          onChange={(e) =>
                            updateElement(selectedEl.id, { text: e.target.value })
                          }
                        />
                      </div>
                      <div className="ptg-placeholders">
                        <span>Подставить:</span>
                        {PHOTO_PLACEHOLDERS.map((ph) => (
                          <button
                            key={ph.token}
                            type="button"
                            title={ph.label}
                            onClick={() => {
                              const el = selectedEl as PhotoTextElement;
                              const before = el.text;
                              const after =
                                before.slice(0, before.length) +
                                ph.token;
                              updateElement(selectedEl.id, { text: after });
                            }}
                          >
                            {ph.token}
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  {selectedEl.type !== "arrow" && (
                    <>
                      <div className="ptg-grid2">
                        <div className="ptg-field">
                          <label>X</label>
                          <input
                            type="number"
                            value={Math.round(selectedEl.x)}
                            onChange={(e) =>
                              updateElement(selectedEl.id, { x: Number(e.target.value) || 0 })
                            }
                          />
                        </div>
                        <div className="ptg-field">
                          <label>Y</label>
                          <input
                            type="number"
                            value={Math.round(selectedEl.y)}
                            onChange={(e) =>
                              updateElement(selectedEl.id, { y: Number(e.target.value) || 0 })
                            }
                          />
                        </div>
                      </div>

                  {selectedEl.type === "rect" || selectedEl.type === "image" ? (
                    <div className="ptg-grid2">
                      <div className="ptg-field">
                        <label>Ширина</label>
                        <input
                          type="number"
                          value={Math.round(selectedEl.width)}
                          onChange={(e) =>
                            updateElement(selectedEl.id, {
                              width: Math.max(1, Number(e.target.value) || 0),
                            })
                          }
                        />
                      </div>
                      <div className="ptg-field">
                        <label>Высота</label>
                        <input
                          type="number"
                          value={Math.round(selectedEl.height)}
                          onChange={(e) =>
                            updateElement(selectedEl.id, {
                              height: Math.max(1, Number(e.target.value) || 0),
                            })
                          }
                        />
                      </div>
                    </div>
                  ) : null}

                  {selectedEl.type === "text" && (
                    <>
                      <div className="ptg-grid2">
                        <div className="ptg-field">
                          <label>Размер шрифта</label>
                          <input
                            type="number"
                            value={selectedEl.fontSize}
                            onChange={(e) =>
                              updateElement(selectedEl.id, {
                                fontSize: Math.max(6, Number(e.target.value) || 12),
                              })
                            }
                          />
                        </div>
                        <div className="ptg-field">
                          <label>Шрифт</label>
                          <select
                            value={selectedEl.fontFamily}
                            onChange={(e) =>
                              updateElement(selectedEl.id, { fontFamily: e.target.value })
                            }
                          >
                            {photoFontFamilies().map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="ptg-grid2">
                        <div className="ptg-field">
                          <label>Ширина текста</label>
                          <input
                            type="number"
                            value={Math.round(selectedEl.width)}
                            onChange={(e) =>
                              updateElement(selectedEl.id, {
                                width: Math.max(20, Number(e.target.value) || 0),
                              })
                            }
                          />
                        </div>
                        <div className="ptg-field">
                          <label>Межстрочный ×</label>
                          <input
                            type="number"
                            step={0.1}
                            value={selectedEl.lineHeight}
                            onChange={(e) =>
                              updateElement(selectedEl.id, {
                                lineHeight: Math.max(0.5, Number(e.target.value) || 1),
                              })
                            }
                          />
                        </div>
                      </div>
                      <div className="ptg-grid2">
                        <div className="ptg-field">
                          <label>Трекинг (px)</label>
                          <input
                            type="number"
                            value={selectedEl.letterSpacing}
                            onChange={(e) =>
                              updateElement(selectedEl.id, {
                                letterSpacing: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                          />
                        </div>
                        <div className="ptg-field">
                          <label>Цвет</label>
                          <input
                            type="color"
                            value={selectedEl.color}
                            onChange={(e) =>
                              updateElement(selectedEl.id, { color: e.target.value })
                            }
                          />
                        </div>
                      </div>
                      <div className="ptg-row">
                        <button
                          type="button"
                          className={`ptg-chip${selectedEl.fontWeight >= 700 ? " ptg-chip--on" : ""}`}
                          onClick={() =>
                            updateElement(selectedEl.id, {
                              fontWeight: selectedEl.fontWeight >= 700 ? 400 : 700,
                            })
                          }
                        >
                          <strong>Ж</strong>
                        </button>
                        <button
                          type="button"
                          className={`ptg-chip${selectedEl.italic ? " ptg-chip--on" : ""}`}
                          onClick={() =>
                            updateElement(selectedEl.id, { italic: !selectedEl.italic })
                          }
                        >
                          <em>К</em>
                        </button>
                        {(["left", "center", "right"] as const).map((a) => (
                          <button
                            key={a}
                            type="button"
                            className={`ptg-chip${selectedEl.align === a ? " ptg-chip--on" : ""}`}
                            onClick={() => updateElement(selectedEl.id, { align: a })}
                          >
                            {a === "left" ? "⟵" : a === "center" ? "↔" : "⟶"}
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  {selectedEl.type === "rect" && (
                    <div className="ptg-grid2">
                      <div className="ptg-field">
                        <label>Цвет</label>
                        <input
                          type="color"
                          value={selectedEl.color}
                          onChange={(e) =>
                            updateElement(selectedEl.id, { color: e.target.value })
                          }
                        />
                      </div>
                      <div className="ptg-field">
                        <label>Скругление</label>
                        <input
                          type="number"
                          value={selectedEl.radius}
                          onChange={(e) =>
                            updateElement(selectedEl.id, {
                              radius: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                        />
                      </div>
                    </div>
                  )}

                  {selectedEl.type === "image" && (
                    <>
                      <div className="ptg-field">
                        <label>Ссылка на картинку</label>
                        <input
                          type="text"
                          placeholder="https://…"
                          value={selectedEl.src}
                          onChange={(e) =>
                            updateElement(selectedEl.id, { src: e.target.value })
                          }
                        />
                      </div>
                      <div className="ptg-row">
                        <label className="ptg-upload-mini">
                          <Upload size={13} /> Загрузить файл
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            style={{ display: "none" }}
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const url = await uploadFile(file);
                                if (url) updateElement(selectedEl.id, { src: url });
                              }
                            }}
                          />
                        </label>
                        <select
                          className="admin-select"
                          value={selectedEl.fit}
                          onChange={(e) =>
                            updateElement(selectedEl.id, {
                              fit: e.target.value as "cover" | "contain",
                            })
                          }
                        >
                          <option value="cover">cover (заполнить)</option>
                          <option value="contain">contain (вписать)</option>
                        </select>
                      </div>
                      <div className="ptg-field">
                        <label>Скругление</label>
                        <input
                          type="number"
                          value={selectedEl.radius}
                          onChange={(e) =>
                            updateElement(selectedEl.id, {
                              radius: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                        />
                      </div>
                    </>
                  )}

                  {/* Поворот (для текста/прямоугольника/картинки) */}
                  <div className="ptg-row">
                    <div className="ptg-field" style={{ minWidth: 120 }}>
                      <label>Поворот (°)</label>
                      <input
                        type="number"
                        value={Math.round((selectedEl as any).rotation ?? 0)}
                        onChange={(e) =>
                          updateElement(selectedEl.id, {
                            rotation: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </div>
                    {(selectedEl as any).rotation ? (
                      <button
                        type="button"
                        className="admin-btn admin-btn--ghost"
                        style={{ alignSelf: "flex-end" }}
                        onClick={() => updateElement(selectedEl.id, { rotation: 0 })}
                      >
                        Сбросить
                      </button>
                    ) : null}
                  </div>
                  </>
                  )}

                  <div className="ptg-actions">
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost"
                      onClick={() => duplicateElement(selectedEl.id)}
                    >
                      <Copy size={14} /> Копия
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--danger"
                      onClick={() => removeElement(selectedEl.id)}
                    >
                      <Trash2 size={14} /> Удалить
                    </button>
                  </div>
                </div>
              )}

              {/* Слои */}
              <div className="ptg-side__block">
                <div className="ptg-side__title">Слои</div>
                <div className="ptg-side__hint">
                  Перетаскивайте слои, чтобы менять порядок наложения
                </div>
                <div className="ptg-layers">
                  {displayedLayers.map((el, i) => (
                    <div
                      key={el.id}
                      draggable
                      onDragStart={(e) => {
                        setDragLayerIndex(i);
                        e.dataTransfer.effectAllowed = "move";
                        try {
                          e.dataTransfer.setData("text/plain", el.id);
                        } catch {
                          /* drag API без данных */
                        }
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (overLayerIndex !== i) setOverLayerIndex(i);
                      }}
                      onDragLeave={() => {
                        if (overLayerIndex === i) setOverLayerIndex(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        reorderLayer(i);
                        setDragLayerIndex(null);
                        setOverLayerIndex(null);
                      }}
                      onDragEnd={() => {
                        setDragLayerIndex(null);
                        setOverLayerIndex(null);
                      }}
                      className={`ptg-layer${selectedId === el.id ? " ptg-layer--on" : ""}${overLayerIndex === i && dragLayerIndex !== i ? " ptg-layer--over" : ""}${dragLayerIndex === i ? " ptg-layer--drag" : ""}`}
                      onClick={() => setSelectedId(el.id)}
                    >
                      <GripVertical size={13} className="ptg-layer__grip" />
                      <span className="ptg-layer__name">
                        {el.type === "text"
                          ? (el.text || "пустой текст").slice(0, 30)
                          : el.type === "rect"
                            ? "Прямоугольник"
                            : el.type === "arrow"
                              ? "Стрелка"
                              : "Картинка"}
                      </span>
                      <span className="ptg-layer__btns">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            moveElement(el.id, -1);
                          }}
                          title="Выше"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            moveElement(el.id, 1);
                          }}
                          title="Ниже"
                        >
                          <ArrowDown size={12} />
                        </button>
                      </span>
                    </div>
                  ))}
                  {template.elements.length === 0 && (
                    <div className="ptg-empty">Элементов пока нет</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="ptg-footer">
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={() => setStep(1)}
            >
              <ChevronLeft size={15} /> Назад
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              onClick={() => setStep(3)}
            >
              Далее: генерация <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ═════════ ШАГ 3 — генерация ═════════ */}
      {step === 3 && (
        <div className="ptg-panel">
          <div className="ptg-summary">
            <div className="ptg-summary__card">
              <strong>{selected.size}</strong>
              <span>товаров выбрано</span>
            </div>
            <div className="ptg-summary__card">
              <strong>{selectedWithDims}</strong>
              <span>с заполненным размером</span>
            </div>
            <div className="ptg-summary__card">
              <strong>
                {template.width}×{template.height}
              </strong>
              <span>размер карточки</span>
            </div>
          </div>

          <div className="ptg-options">
            <label className="ptg-check">
              <input
                type="checkbox"
                checked={replaceImages}
                onChange={(e) => setReplaceImages(e.target.checked)}
              />
              <span>Заменить текущие фото товара (иначе новое фото станет первым)</span>
            </label>
          </div>

          {!generating && results.length === 0 && (
            <div className="ptg-footer">
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setStep(2)}
              >
                <ChevronLeft size={15} /> Назад к дизайну
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                disabled={selected.size === 0}
                onClick={handleGenerate}
              >
                <Sparkles size={15} /> Сгенерировать {selected.size} фото
              </button>
            </div>
          )}

          {(generating || results.length > 0) && (
            <div className="ptg-progress">
              <div className="ptg-progress__head">
                <span>
                  {generating
                    ? `Генерация: ${progress.done} из ${progress.total}`
                    : `Готово: ${results.filter((r) => r.ok).length} из ${results.length}`}
                </span>
                {generating && (
                  <Loader2 size={15} className="animate-spin" />
                )}
              </div>
              <div className="ptg-progress__bar">
                <div
                  className="ptg-progress__fill"
                  style={{
                    width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                  }}
                />
              </div>
              <div className="ptg-results">
                {results.map((r) => (
                  <div
                    key={r.productId}
                    className={`ptg-result${r.ok ? " ptg-result--ok" : " ptg-result--err"}`}
                  >
                    {r.ok ? <Check size={14} /> : <X size={14} />}
                    <span className="ptg-result__name">{r.name}</span>
                    {r.ok && r.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.url} alt="" />
                    ) : (
                      <span className="ptg-result__errtext">{r.error}</span>
                    )}
                  </div>
                ))}
              </div>
              {!generating && (
                <div className="ptg-footer" style={{ border: 0, padding: 0 }}>
                  <Link
                    href={`/${adminPath}/products`}
                    className="admin-btn admin-btn--primary"
                    prefetch={false}
                  >
                    Готово — к товарам <ChevronRight size={15} />
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
