// =========================================================
// FILE: src/components/admin/PhotoTemplateGenerator.tsx
// Конструктор шаблонных фото (Figma-подобный): выбор товаров,
// редактор карточки на canvas (фон, элементы, перетаскивание),
// плейсхолдеры {{size}} {{name}} … и генерация по одному фото
// на товар с сохранением в Cloudinary.
//
// Возможности как в Figma:
//  • перетаскивание, вращение, ресайз за углы, стрелки;
//  • мультивыбор (Shift+клик), выравнивание по краям/центру
//    (к холсту или выделению), группировка/разгруппировка (Ctrl+G);
//  • отступы текста (padding) с фоном-подложкой — видно расстояние
//    от текста до края блока;
//  • направляющие при перетаскивании с привязкой к краям/центру
//    холста и соседним элементам + подписи расстояний.
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
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Group,
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
  Ungroup,
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
  type PhotoGroupElement,
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

/* ── Геометрия: поворот, габариты, AABB ── */

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

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

function normDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return Math.round(d);
}

interface BoxGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

type LeafBoxEl = PhotoTextElement | PhotoRectElement | PhotoImageElement;

/** Размер текстового блока (ширина + высота по переносам). */
function textSize(
  ctx: CanvasRenderingContext2D,
  el: PhotoTextElement,
  tokens: Record<string, string>
): { w: number; h: number } {
  applyFont(ctx, el);
  const lines = wrapText(
    ctx,
    substituteTokens(el.text, tokens),
    el.width,
    el.letterSpacing
  );
  const h = Math.max(el.fontSize, lines.length * el.fontSize * el.lineHeight);
  return { w: el.width, h };
}

/** Габариты «коробочного» элемента (с учётом подложки текста). */
function leafBoxGeom(
  ctx: CanvasRenderingContext2D,
  el: LeafBoxEl,
  tokens: Record<string, string>
): BoxGeom {
  if (el.type === "text") {
    const { w, h } = textSize(ctx, el, tokens);
    if (el.background) {
      const px = el.paddingX ?? 0;
      const py = el.paddingY ?? 0;
      return {
        x: el.x - px,
        y: el.y - py,
        w: w + 2 * px,
        h: h + 2 * py,
        rotation: el.rotation ?? 0,
      };
    }
    return { x: el.x, y: el.y, w, h, rotation: el.rotation ?? 0 };
  }
  return {
    x: el.x,
    y: el.y,
    w: el.width,
    h: el.height,
    rotation: el.rotation ?? 0,
  };
}

/** Мировые координаты четырёх углов повёрнутого бокса. */
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

/** Точка внутри (повёрнутого) прямоугольника. */
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

/** Локальные габариты группы (обёртка всех детей в локальных координатах). */
function groupLocalBounds(
  ctx: CanvasRenderingContext2D,
  tokens: Record<string, string>,
  items: PhotoTemplateElement[]
): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const it of items) {
    if (it.type === "group") {
      const b = groupLocalBounds(ctx, tokens, it.items);
      const g: BoxGeom = { x: it.x, y: it.y, w: b.w, h: b.h, rotation: it.rotation ?? 0 };
      for (const [cx, cy] of boxCorners(g)) {
        minX = Math.min(minX, cx);
        minY = Math.min(minY, cy);
        maxX = Math.max(maxX, cx);
        maxY = Math.max(maxY, cy);
      }
    } else if (it.type === "arrow") {
      minX = Math.min(minX, it.x, it.x2);
      minY = Math.min(minY, it.y, it.y2);
      maxX = Math.max(maxX, it.x, it.x2);
      maxY = Math.max(maxY, it.y, it.y2);
    } else {
      const g = leafBoxGeom(ctx, it, tokens);
      for (const [cx, cy] of boxCorners(g)) {
        minX = Math.min(minX, cx);
        minY = Math.min(minY, cy);
        maxX = Math.max(maxX, cx);
        maxY = Math.max(maxY, cy);
      }
    }
  }
  if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Габариты любого элемента в его собственной (для группы — мировой) системе. */
function elementGeom(
  ctx: CanvasRenderingContext2D,
  el: PhotoTemplateElement,
  tokens: Record<string, string>
): BoxGeom {
  if (el.type === "group") {
    const b = groupLocalBounds(ctx, tokens, el.items);
    return { x: el.x, y: el.y, w: b.w, h: b.h, rotation: el.rotation ?? 0 };
  }
  if (el.type === "arrow") {
    return {
      x: Math.min(el.x, el.x2),
      y: Math.min(el.y, el.y2),
      w: Math.abs(el.x2 - el.x),
      h: Math.abs(el.y2 - el.y),
      rotation: 0,
    };
  }
  return leafBoxGeom(ctx, el, tokens);
}

interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Выровненный по осям bounding box элемента (в мировых координатах). */
function elementAABB(
  ctx: CanvasRenderingContext2D,
  el: PhotoTemplateElement,
  tokens: Record<string, string>
): AABB {
  const g = elementGeom(ctx, el, tokens);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [cx, cy] of boxCorners(g)) {
    minX = Math.min(minX, cx);
    minY = Math.min(minY, cy);
    maxX = Math.max(maxX, cx);
    maxY = Math.max(maxY, cy);
  }
  return { minX, minY, maxX, maxY };
}

function selectionAABB(
  ctx: CanvasRenderingContext2D,
  els: PhotoTemplateElement[],
  tokens: Record<string, string>
): AABB {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of els) {
    const b = elementAABB(ctx, el, tokens);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** Расстояние от точки до отрезка (хит-тест стрелки). */
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

/** Сдвиг элемента (стрелка — оба конца, группа — только позиция). */
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

/* ── Отрисовка ── */

function drawText(
  ctx: CanvasRenderingContext2D,
  el: PhotoTextElement,
  tokens: Record<string, string>
) {
  const text = substituteTokens(el.text, tokens);
  applyFont(ctx, el);
  const lines = wrapText(ctx, text, el.width, el.letterSpacing);
  const lh = el.fontSize * el.lineHeight;
  const textH = Math.max(el.fontSize, lines.length * lh);
  const px = el.paddingX ?? 0;
  const py = el.paddingY ?? 0;
  const hasBg = !!el.background;
  const blockX = el.x - px;
  const blockY = el.y - py;
  const blockW = el.width + 2 * px;
  const blockH = textH + 2 * py;

  const cx = el.x + el.width / 2;
  const cy = el.y + textH / 2;

  ctx.save();
  if (el.rotation) {
    ctx.translate(cx, cy);
    ctx.rotate(degToRad(el.rotation));
    ctx.translate(-cx, -cy);
  }

  if (hasBg && el.background) {
    ctx.fillStyle = el.background.color;
    if (el.background.radius > 0) {
      roundRectPath(ctx, blockX, blockY, blockW, blockH, el.background.radius);
      ctx.fill();
    } else {
      ctx.fillRect(blockX, blockY, blockW, blockH);
    }
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

async function drawGroup(
  ctx: CanvasRenderingContext2D,
  el: PhotoGroupElement,
  tokens: Record<string, string>
) {
  const b = groupLocalBounds(ctx, tokens, el.items);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  ctx.save();
  ctx.translate(el.x - b.x, el.y - b.y);
  ctx.translate(cx, cy);
  ctx.rotate(degToRad(el.rotation ?? 0));
  ctx.translate(-cx, -cy);
  for (const it of el.items) {
    await drawElement(ctx, it, tokens);
  }
  ctx.restore();
}

async function drawElement(
  ctx: CanvasRenderingContext2D,
  el: PhotoTemplateElement,
  tokens: Record<string, string>
) {
  if (el.type === "rect") drawRectEl(ctx, el);
  else if (el.type === "text") drawText(ctx, el, tokens);
  else if (el.type === "arrow") drawArrowEl(ctx, el);
  else if (el.type === "group") await drawGroup(ctx, el, tokens);
  else if (el.type === "image") {
    try {
      await drawImageEl(ctx, el);
    } catch {
      /* битая картинка — просто пропускаем */
    }
  }
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
    await drawElement(ctx, el, tokens);
  }
}

/* ── Выделение и направляющие ── */

interface Guide {
  v: { x: number; label: string }[];
  h: { y: number; label: string }[];
}

function drawGuides(canvas: HTMLCanvasElement, guides: Guide) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.save();
  ctx.strokeStyle = "#ff3b6b";
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.fillStyle = "#ff3b6b";
  ctx.font = "11px Inter, sans-serif";
  ctx.textBaseline = "top";
  for (const g of guides.v) {
    ctx.beginPath();
    ctx.moveTo(g.x, 0);
    ctx.lineTo(g.x, canvas.height);
    ctx.stroke();
    if (g.label) ctx.fillText(g.label, g.x + 4, 4);
  }
  for (const g of guides.h) {
    ctx.beginPath();
    ctx.moveTo(0, g.y);
    ctx.lineTo(canvas.width, g.y);
    ctx.stroke();
    if (g.label) ctx.fillText(g.label, 4, g.y + 4);
  }
  ctx.restore();
}

function drawSelection(
  canvas: HTMLCanvasElement,
  template: PhotoTemplate,
  selectedIds: string[],
  tokens: Record<string, string>,
  guides: Guide
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const els = template.elements.filter((e) => selectedIds.includes(e.id));
  const handle = Math.max(9, template.width / 60);

  ctx.save();
  ctx.strokeStyle = "#2563eb";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = Math.max(1.5, template.width / 500);

  for (const el of els) {
    if (el.type === "arrow") {
      const g = elementGeom(ctx, el, tokens);
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(g.x - 8, g.y - 8, g.w + 16, g.h + 16);
      ctx.setLineDash([]);
      if (els.length === 1) {
        for (const [hx, hy] of [
          [el.x, el.y],
          [el.x2, el.y2],
        ] as [number, number][]) {
          ctx.fillRect(hx - handle / 2, hy - handle / 2, handle, handle);
          ctx.strokeRect(hx - handle / 2, hy - handle / 2, handle, handle);
        }
      }
      continue;
    }

    const g = elementGeom(ctx, el, tokens);
    const corners = boxCorners(g);

    ctx.beginPath();
    corners.forEach((c, i) => {
      if (i === 0) ctx.moveTo(c[0], c[1]);
      else ctx.lineTo(c[0], c[1]);
    });
    ctx.closePath();
    ctx.stroke();

    if (els.length === 1) {
      // Угловые ручки ресайза (кроме групп)
      if (el.type !== "group") {
        for (const [hx, hy] of corners) {
          ctx.fillRect(hx - handle / 2, hy - handle / 2, handle, handle);
          ctx.strokeRect(hx - handle / 2, hy - handle / 2, handle, handle);
        }
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
  }
  ctx.restore();

  drawGuides(canvas, guides);
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
    background: null,
    paddingX: 24,
    paddingY: 16,
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

/** Глубокое клонирование элемента с новыми id (для групп — рекурсивно). */
function cloneElementDeep(el: PhotoTemplateElement): PhotoTemplateElement {
  if (el.type === "group") {
    return {
      ...el,
      id: createElementId(),
      items: el.items.map(cloneElementDeep),
    };
  }
  return { ...el, id: createElementId() };
}

/** Перевод элемента в локальные координаты группы (вычитание ox, oy). */
function localizeElement(
  el: PhotoTemplateElement,
  ox: number,
  oy: number
): PhotoTemplateElement {
  if (el.type === "arrow") {
    return { ...el, x: el.x - ox, y: el.y - oy, x2: el.x2 - ox, y2: el.y2 - oy };
  }
  return { ...el, x: el.x - ox, y: el.y - oy } as PhotoTemplateElement;
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

/** Привязка к краям/центру холста и соседним элементам. */
const SNAP_TOLERANCE = 6;

function computeSnap(
  ctx: CanvasRenderingContext2D,
  aabb: AABB,
  others: PhotoTemplateElement[],
  tokens: Record<string, string>,
  W: number,
  H: number
): { dx: number; dy: number; v: Guide["v"][number] | null; h: Guide["h"][number] | null } {
  const vCands: { x: number; label: string }[] = [
    { x: 0, label: "0" },
    { x: Math.round(W / 2), label: "центр" },
    { x: Math.round(W), label: String(Math.round(W)) },
  ];
  const hCands: { y: number; label: string }[] = [
    { y: 0, label: "0" },
    { y: Math.round(H / 2), label: "центр" },
    { y: Math.round(H), label: String(Math.round(H)) },
  ];
  for (const o of others) {
    const b = elementAABB(ctx, o, tokens);
    vCands.push(
      { x: Math.round(b.minX), label: "" },
      { x: Math.round(b.maxX), label: "" },
      { x: Math.round((b.minX + b.maxX) / 2), label: "" }
    );
    hCands.push(
      { y: Math.round(b.minY), label: "" },
      { y: Math.round(b.maxY), label: "" },
      { y: Math.round((b.minY + b.maxY) / 2), label: "" }
    );
  }

  const srcV = [aabb.minX, (aabb.minX + aabb.maxX) / 2, aabb.maxX];
  const srcH = [aabb.minY, (aabb.minY + aabb.maxY) / 2, aabb.maxY];

  let bestVD = SNAP_TOLERANCE + 1;
  let bestHD = SNAP_TOLERANCE + 1;
  let bestV: { x: number; label: string } | null = null;
  let bestH: { y: number; label: string } | null = null;

  for (const s of srcV) {
    for (const c of vCands) {
      const d = c.x - s;
      if (Math.abs(d) <= SNAP_TOLERANCE && Math.abs(d) < Math.abs(bestVD)) {
        bestVD = d;
        bestV = c;
      }
    }
  }
  for (const s of srcH) {
    for (const c of hCands) {
      const d = c.y - s;
      if (Math.abs(d) <= SNAP_TOLERANCE && Math.abs(d) < Math.abs(bestHD)) {
        bestHD = d;
        bestH = c;
      }
    }
  }

  return {
    dx: bestVD <= SNAP_TOLERANCE ? bestVD : 0,
    dy: bestHD <= SNAP_TOLERANCE ? bestHD : 0,
    v: bestV,
    h: bestH,
  };
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [previewProductId, setPreviewProductId] = useState<string | null>(null);
  const [guides, setGuides] = useState<Guide>({ v: [], h: [] });

  const [generating, setGenerating] = useState(false);
  const [replaceImages, setReplaceImages] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<ResultItem[]>([]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<
    | {
        mode: "move";
        ids: string[];
        origEls: PhotoTemplateElement[];
        startX: number;
        startY: number;
      }
    | {
        mode: "resize" | "rotate" | "arrow-end";
        elementId: string;
        origEl: PhotoTemplateElement;
        startX: number;
        startY: number;
        cx: number;
        cy: number;
        startAngle: number;
        which: "start" | "end";
      }
    | null
  >(null);
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
        if (!cancelled)
          drawSelection(canvas, template, selectedIds, tokens, guides);
      } catch (err) {
        console.error(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [template, tokens, selectedIds, guides]);

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
        const g = elementGeom(ctx, el, tokens);
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

    // Ручки у единственного выбранного элемента
    if (selectedIds.length === 1) {
      const sel = template.elements.find((el) => el.id === selectedIds[0]);
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
                origEl: { ...sel },
                startX: x,
                startY: y,
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
          const g = elementGeom(ctx, sel, tokens);
          const cx = g.x + g.w / 2;
          const cy = g.y + g.h / 2;

          // Ручка вращения
          const [rhx, rhy] = rotatePoint(cx, cy, cx, g.y - 34, g.rotation);
          if (Math.hypot(x - rhx, y - rhy) <= handle * 1.2) {
            dragRef.current = {
              mode: "rotate",
              elementId: sel.id,
              origEl: { ...sel },
              startX: x,
              startY: y,
              cx,
              cy,
              startAngle: (Math.atan2(y - cy, x - cx) * 180) / Math.PI,
              which: "start",
            };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            return;
          }

          // Угловые ручки ресайза (группы не ресайзятся)
          if (sel.type !== "group") {
            for (const [hx, hy] of boxCorners(g)) {
              if (Math.abs(x - hx) <= handle && Math.abs(y - hy) <= handle) {
                dragRef.current = {
                  mode: "resize",
                  elementId: sel.id,
                  origEl: { ...sel },
                  startX: x,
                  startY: y,
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
    }

    const hit = hitTest(x, y);
    if (hit) {
      if (e.shiftKey) {
        setSelectedIds((prev) =>
          prev.includes(hit.id)
            ? prev.filter((id) => id !== hit.id)
            : [...prev, hit.id]
        );
        return;
      }
      const alreadySelected = selectedIds.includes(hit.id);
      if (!alreadySelected) setSelectedIds([hit.id]);
      const moveIds = alreadySelected ? selectedIds : [hit.id];
      const origEls = moveIds
        .map((id) => template.elements.find((el) => el.id === id))
        .filter((el): el is PhotoTemplateElement => Boolean(el));
      dragRef.current = {
        mode: "move",
        ids: moveIds,
        origEls,
        startX: x,
        startY: y,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } else {
      if (!e.shiftKey) setSelectedIds([]);
      setGuides({ v: [], h: [] });
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const { x, y } = clientToCanvas(e.clientX, e.clientY);
    const dx = x - drag.startX;
    const dy = y - drag.startY;

    if (drag.mode === "move") {
      const ctx = canvasRef.current?.getContext("2d") || null;
      let adjX = dx;
      let adjY = dy;
      let nextGuides: Guide = { v: [], h: [] };
      if (ctx) {
        const base = selectionAABB(ctx, drag.origEls, tokens);
        const proposed: AABB = {
          minX: base.minX + dx,
          minY: base.minY + dy,
          maxX: base.maxX + dx,
          maxY: base.maxY + dy,
        };
        const others = template.elements.filter(
          (el) => !drag.ids.includes(el.id)
        );
        const snap = computeSnap(
          ctx,
          proposed,
          others,
          tokens,
          template.width,
          template.height
        );
        adjX = dx + snap.dx;
        adjY = dy + snap.dy;
        nextGuides = {
          v: snap.v ? [snap.v] : [],
          h: snap.h ? [snap.h] : [],
        };
      }
      setGuides(nextGuides);
      setTemplate((t) => ({
        ...t,
        elements: t.elements.map((el) => {
          const idx = drag.ids.indexOf(el.id);
          if (idx < 0) return el;
          return translateElement(drag.origEls[idx], adjX, adjY);
        }),
      }));
      return;
    }

    setGuides({ v: [], h: [] });
    setTemplate((t) => ({
      ...t,
      elements: t.elements.map((el) => {
        if (el.id !== drag.elementId) return el;
        if (drag.mode === "arrow-end") {
          const orig = drag.origEl as PhotoArrowElement;
          if (drag.which === "end") {
            return { ...orig, x2: x, y2: y };
          }
          return { ...orig, x, y };
        }
        if (drag.mode === "rotate") {
          const angle = (Math.atan2(y - drag.cy, x - drag.cx) * 180) / Math.PI;
          const base = drag.origEl as
            | PhotoTextElement
            | PhotoRectElement
            | PhotoImageElement
            | PhotoGroupElement;
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
      setGuides({ v: [], h: [] });
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }

  /* ── Клавиатура: стрелки, Delete, Ctrl+G / Ctrl+Shift+G ── */
  function onCanvasKeyDown(e: React.KeyboardEvent) {
    if (!selectedIds.length) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "g" || e.key === "G" || e.key === "п" || e.key === "П")) {
      e.preventDefault();
      if (e.shiftKey) ungroupSelected();
      else groupSelected();
      return;
    }
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
          selectedIds.includes(el.id) ? translateElement(el, dx, dy) : el
        ),
      }));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeSelected();
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

  function removeSelected() {
    setTemplate((t) => ({
      ...t,
      elements: t.elements.filter((el) => !selectedIds.includes(el.id)),
    }));
    setSelectedIds([]);
  }

  function duplicateElement(id: string) {
    setTemplate((t) => {
      const idx = t.elements.findIndex((el) => el.id === id);
      if (idx < 0) return t;
      const src = t.elements[idx];
      const copy = cloneElementDeep(src);
      if (copy.type === "arrow") {
        copy.x += 24;
        copy.y += 24;
        copy.x2 += 24;
        copy.y2 += 24;
      } else {
        copy.x += 24;
        copy.y += 24;
      }
      const next = [...t.elements];
      next.splice(idx + 1, 0, copy);
      setSelectedIds([copy.id]);
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
    setSelectedIds([el.id]);
  }

  /* ── Выравнивание ── */
  type AlignMode =
    | "left"
    | "centerH"
    | "right"
    | "top"
    | "middle"
    | "bottom";

  function alignSelected(mode: AlignMode) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || selectedIds.length === 0) return;
    const els = template.elements.filter((el) => selectedIds.includes(el.id));
    const single = els.length === 1;

    let target: { minX: number; maxX: number; minY: number; maxY: number; cx: number; cy: number };
    if (single) {
      target = {
        minX: 0,
        maxX: template.width,
        minY: 0,
        maxY: template.height,
        cx: template.width / 2,
        cy: template.height / 2,
      };
    } else {
      const b = selectionAABB(ctx, els, tokens);
      target = {
        minX: b.minX,
        maxX: b.maxX,
        minY: b.minY,
        maxY: b.maxY,
        cx: (b.minX + b.maxX) / 2,
        cy: (b.minY + b.maxY) / 2,
      };
    }

    setTemplate((t) => ({
      ...t,
      elements: t.elements.map((el) => {
        if (!selectedIds.includes(el.id)) return el;
        const b = elementAABB(ctx, el, tokens);
        let dx = 0;
        let dy = 0;
        if (mode === "left") dx = target.minX - b.minX;
        else if (mode === "centerH") dx = target.cx - (b.minX + b.maxX) / 2;
        else if (mode === "right") dx = target.maxX - b.maxX;
        else if (mode === "top") dy = target.minY - b.minY;
        else if (mode === "middle") dy = target.cy - (b.minY + b.maxY) / 2;
        else if (mode === "bottom") dy = target.maxY - b.maxY;
        return translateElement(el, Math.round(dx), Math.round(dy));
      }),
    }));
  }

  /* ── Группы ── */
  function groupLocalToWorld(
    ctx: CanvasRenderingContext2D,
    g: PhotoGroupElement,
    lx: number,
    ly: number
  ): [number, number] {
    const b = groupLocalBounds(ctx, tokens, g.items);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const [rx, ry] = rotatePoint(0, 0, lx - cx, ly - cy, g.rotation ?? 0);
    return [g.x - b.x + cx + rx, g.y - b.y + cy + ry];
  }

  function groupSelected() {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const idxs = selectedIds
      .map((id) => template.elements.findIndex((el) => el.id === id))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    if (idxs.length < 2) return;

    const els = idxs.map((i) => template.elements[i]);
    const b = selectionAABB(ctx, els, tokens);
    const gx = Math.round(b.minX);
    const gy = Math.round(b.minY);
    const group: PhotoGroupElement = {
      id: createElementId(),
      type: "group",
      x: gx,
      y: gy,
      rotation: 0,
      items: els.map((el) => localizeElement(el, gx, gy)),
    };

    const next = [...template.elements];
    for (const i of [...idxs].reverse()) next.splice(i, 1);
    next.splice(idxs[0], 0, group);
    setTemplate((t) => ({ ...t, elements: next }));
    setSelectedIds([group.id]);
  }

  function ungroupItems(
    ctx: CanvasRenderingContext2D,
    g: PhotoGroupElement
  ): PhotoTemplateElement[] {
    const out: PhotoTemplateElement[] = [];
    for (const it of g.items) {
      if (it.type === "group") {
        const [wx, wy] = groupLocalToWorld(ctx, g, it.x, it.y);
        out.push({
          ...it,
          x: wx,
          y: wy,
          rotation: (it.rotation ?? 0) + (g.rotation ?? 0),
        });
      } else if (it.type === "arrow") {
        const [wx, wy] = groupLocalToWorld(ctx, g, it.x, it.y);
        const [wx2, wy2] = groupLocalToWorld(ctx, g, it.x2, it.y2);
        out.push({ ...it, x: wx, y: wy, x2: wx2, y2: wy2 });
      } else {
        const [wx, wy] = groupLocalToWorld(ctx, g, it.x, it.y);
        out.push({
          ...it,
          x: wx,
          y: wy,
          rotation: (it.rotation ?? 0) + (g.rotation ?? 0),
        } as PhotoTemplateElement);
      }
    }
    return out;
  }

  function ungroupSelected() {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const groups = template.elements.filter(
      (el) => selectedIds.includes(el.id) && el.type === "group"
    ) as PhotoGroupElement[];
    if (groups.length === 0) return;

    const groupIds = new Set(groups.map((g) => g.id));
    const out: PhotoTemplateElement[] = [];
    const newSel: string[] = [];
    for (const el of template.elements) {
      if (groupIds.has(el.id)) {
        const items = ungroupItems(ctx, el as PhotoGroupElement);
        for (const it of items) {
          out.push(it);
          newSel.push(it.id);
        }
      } else {
        out.push(el);
      }
    }
    setTemplate((t) => ({ ...t, elements: out }));
    setSelectedIds(newSel);
  }

  /* ── Слои ── */
  const displayedLayers = useMemo(
    () => [...template.elements].reverse(),
    [template.elements]
  );

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

  const selectedEl =
    selectedIds.length === 1
      ? template.elements.find((el) => el.id === selectedIds[0]) || null
      : null;

  const alignButtons: { mode: AlignMode; icon: typeof AlignStartHorizontal; title: string }[] = [
    { mode: "left", icon: AlignStartHorizontal, title: "По левому краю" },
    { mode: "centerH", icon: AlignCenterHorizontal, title: "По центру (горизонталь)" },
    { mode: "right", icon: AlignEndHorizontal, title: "По правому краю" },
    { mode: "top", icon: AlignStartVertical, title: "По верхнему краю" },
    { mode: "middle", icon: AlignCenterVertical, title: "По центру (вертикаль)" },
    { mode: "bottom", icon: AlignEndVertical, title: "По нижнему краю" },
  ];

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
                  setSelectedIds([]);
                }
              }}
            >
              <RotateCcw size={14} /> Сбросить шаблон
            </button>
          </div>

          {/* Выравнивание + группы */}
          {selectedIds.length > 0 && (
            <div className="ptg-toolbar ptg-toolbar--design">
              <div className="ptg-tools">
                <span className="ptg-align-label">Выравнивание:</span>
                {alignButtons.map((b) => (
                  <button
                    key={b.mode}
                    type="button"
                    className="admin-btn admin-btn--ghost"
                    title={b.title}
                    onClick={() => alignSelected(b.mode)}
                  >
                    <b.icon size={15} />
                  </button>
                ))}
              </div>
              <div className="ptg-tools">
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost"
                  disabled={selectedIds.length < 2}
                  onClick={groupSelected}
                  title="Объединить в группу (Ctrl+G)"
                >
                  <Group size={14} /> Группа
                </button>
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost"
                  disabled={!selectedIds.some((id) =>
                    template.elements.some((el) => el.id === id && el.type === "group")
                  )}
                  onClick={ungroupSelected}
                  title="Разгруппировать (Ctrl+Shift+G)"
                >
                  <Ungroup size={14} /> Разгруппировать
                </button>
                <span className="ptg-align-label ptg-align-label--hint">
                  Shift+клик — несколько элементов
                </span>
              </div>
            </div>
          )}

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
                  onPointerCancel={onPointerUp}
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

              {/* Мультивыбор */}
              {selectedIds.length > 1 && (
                <div className="ptg-side__block">
                  <div className="ptg-side__title">
                    Выбрано элементов: {selectedIds.length}
                  </div>
                  <div className="ptg-actions">
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost"
                      onClick={groupSelected}
                    >
                      <Group size={14} /> Сгруппировать
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--danger"
                      onClick={removeSelected}
                    >
                      <Trash2 size={14} /> Удалить
                    </button>
                  </div>
                </div>
              )}

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
                          : selectedEl.type === "group"
                            ? "Группа"
                            : "Картинка"}
                  </div>

                  {selectedEl.type === "group" && (
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
                      <div className="ptg-field">
                        <label>Поворот (°)</label>
                        <input
                          type="number"
                          value={Math.round(selectedEl.rotation ?? 0)}
                          onChange={(e) =>
                            updateElement(selectedEl.id, { rotation: Number(e.target.value) || 0 })
                          }
                        />
                      </div>
                      <div className="ptg-field">
                        <label>Элементов</label>
                        <input type="text" readOnly value={selectedEl.items.length} />
                      </div>
                    </div>
                  )}

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
                              updateElement(selectedEl.id, {
                                text: el.text + ph.token,
                              });
                            }}
                          >
                            {ph.token}
                          </button>
                        ))}
                      </div>

                      {/* Отступы + подложка */}
                      <div className="ptg-side__title" style={{ marginTop: 4 }}>
                        Блок (отступы от текста)
                      </div>
                      <label className="ptg-check" style={{ padding: 0 }}>
                        <input
                          type="checkbox"
                          checked={!!selectedEl.background}
                          onChange={(e) =>
                            updateElement(selectedEl.id, {
                              background: e.target.checked
                                ? { color: "#2d6a4f", radius: 12 }
                                : null,
                            })
                          }
                        />
                        <span>Фон-подложка</span>
                      </label>
                      {selectedEl.background && (
                        <div className="ptg-grid2">
                          <div className="ptg-field">
                            <label>Цвет фона</label>
                            <input
                              type="color"
                              value={selectedEl.background.color}
                              onChange={(e) =>
                                updateElement(selectedEl.id, {
                                  background: { ...selectedEl.background!, color: e.target.value },
                                })
                              }
                            />
                          </div>
                          <div className="ptg-field">
                            <label>Скругление</label>
                            <input
                              type="number"
                              value={selectedEl.background.radius}
                              onChange={(e) =>
                                updateElement(selectedEl.id, {
                                  background: {
                                    ...selectedEl.background!,
                                    radius: Math.max(0, Number(e.target.value) || 0),
                                  },
                                })
                              }
                            />
                          </div>
                        </div>
                      )}
                      <div className="ptg-grid2">
                        <div className="ptg-field">
                          <label>Отступ по X (px)</label>
                          <input
                            type="number"
                            min={0}
                            value={Math.round(selectedEl.paddingX ?? 0)}
                            onChange={(e) =>
                              updateElement(selectedEl.id, {
                                paddingX: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                          />
                        </div>
                        <div className="ptg-field">
                          <label>Отступ по Y (px)</label>
                          <input
                            type="number"
                            min={0}
                            value={Math.round(selectedEl.paddingY ?? 0)}
                            onChange={(e) =>
                              updateElement(selectedEl.id, {
                                paddingY: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                          />
                        </div>
                      </div>
                    </>
                  )}

                  {selectedEl.type !== "arrow" && selectedEl.type !== "group" && (
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
                    </>
                  )}

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

                  {selectedEl.type !== "group" && (
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
                      onClick={() => {
                        setSelectedIds([selectedEl.id]);
                        removeSelected();
                      }}
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
                      className={`ptg-layer${selectedIds.includes(el.id) ? " ptg-layer--on" : ""}${overLayerIndex === i && dragLayerIndex !== i ? " ptg-layer--over" : ""}${dragLayerIndex === i ? " ptg-layer--drag" : ""}`}
                      onClick={(e) => {
                        if (e.shiftKey) {
                          setSelectedIds((prev) =>
                            prev.includes(el.id)
                              ? prev.filter((id) => id !== el.id)
                              : [...prev, el.id]
                          );
                        } else {
                          setSelectedIds([el.id]);
                        }
                      }}
                    >
                      <GripVertical size={13} className="ptg-layer__grip" />
                      <span className="ptg-layer__name">
                        {el.type === "text"
                          ? (el.text || "пустой текст").slice(0, 30)
                          : el.type === "rect"
                            ? "Прямоугольник"
                            : el.type === "arrow"
                              ? "Стрелка"
                              : el.type === "group"
                                ? `Группа (${el.items.length})`
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
                {generating && <Loader2 size={15} className="animate-spin" />}
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
