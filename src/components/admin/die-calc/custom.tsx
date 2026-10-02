// Этот файл скопирован из tools/die-calc скриптом `node tools/die-calc/scripts/sync-site.mjs`.
// Не правьте его в src/ — правьте оригинал и запускайте синхронизацию.
'use client';

/** Интерактивный редактор произвольной развёртки штанцформы. */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { LAYER_COLOR, LAYER_NAME } from '@/lib/die-calc/engine';
import type { Vec2 } from '@/lib/die-calc/geo';
import { createTrayTemplate, emptyCustomDrawing, parseCustomDrawing, type CustomDimension, type CustomDrawing, type CustomLineKind, type CustomPolygon, type CustomStroke } from '@/lib/die-calc/custom';
import { renderUnfold } from '@/lib/die-calc/render2d';
import type { CalcResult, SheetFormat } from '@/lib/die-calc/model';
import { Card, Chk, fmt2, fmtMm, fmtRub } from './controls';
import { NestView } from './views';
import { ResultPanel } from './panels';
import { downloadText, exportCsv, exportDxf, exportJsonFallback, exportPng, exportReport, exportSvg, printPdf } from './exports';
import type { UseCalc } from './store';

const CUSTOM_KINDS: CustomLineKind[] = ['cut', 'crease', 'perf', 'tech'];
const KIND_DASH: Record<CustomLineKind, string | undefined> = {
  cut: undefined,
  crease: '7 4',
  perf: '2.5 2.5',
  tech: undefined,
};
const TOOL_LABEL: Record<EditorTool, string> = {
  select: 'Выбор',
  line: 'Линия',
  outline: 'Внешний контур',
  hole: 'Вырез / окно',
  circle: 'Круглый вырез',
  dimension: 'Размер',
};

type EditorTool = 'select' | 'line' | 'outline' | 'hole' | 'circle' | 'dimension';
type SelectedItem = { type: 'line' | 'polygon' | 'dimension'; id: string } | null;
type PhotoOverlay = { url: string; widthPx: number; heightPx: number; xMm: number; yMm: number; widthMm: number; heightMm: number };

export function CustomDieEditor({
  calc,
  result,
}: {
  calc: UseCalc;
  result: CalcResult | null;
}): ReactNode {
  const drawing = calc.state.customDrawing;
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const minorGridId = `custom-grid-minor-${id}`;
  const majorGridId = `custom-grid-major-${id}`;
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<string | null>(null);
  const drawingRef = useRef(drawing);
  const undoStack = useRef<CustomDrawing[]>([]);
  const redoStack = useRef<CustomDrawing[]>([]);
  const [tool, setTool] = useState<EditorTool>('select');
  const [lineKind, setLineKind] = useState<CustomLineKind>('cut');
  const [pending, setPending] = useState<Vec2[]>([]);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [selected, setSelected] = useState<SelectedItem>(null);
  const [snap, setSnap] = useState(true);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [visible, setVisible] = useState<Record<CustomLineKind, boolean>>({ cut: true, crease: true, perf: true, tech: true });
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [canvasTab, setCanvasTab] = useState<'draw' | 'nest'>('draw');
  const [photo, setPhoto] = useState<PhotoOverlay | null>(null);
  const [photoOpacity, setPhotoOpacity] = useState(0.38);
  const [calibratePhoto, setCalibratePhoto] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState<Vec2[]>([]);
  const [knownLength, setKnownLength] = useState('100');
  const [templateDims, setTemplateDims] = useState({ length: 240, width: 180, wall: 50 });

  useEffect(() => {
    drawingRef.current = drawing;
  }, [drawing]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const applyDrawing = useCallback(
    (next: CustomDrawing, record = true): void => {
      const current = drawingRef.current;
      if (record) {
        undoStack.current.push(current);
        if (undoStack.current.length > 80) undoStack.current.shift();
        redoStack.current = [];
        setCanUndo(true);
        setCanRedo(false);
      }
      drawingRef.current = next;
      calc.setState({ customDrawing: next });
    },
    [calc],
  );

  const undo = useCallback((): void => {
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current.push(drawingRef.current);
    drawingRef.current = previous;
    calc.setState({ customDrawing: previous });
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
    setPending([]);
    setSelected(null);
  }, [calc]);

  const redo = useCallback((): void => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(drawingRef.current);
    drawingRef.current = next;
    calc.setState({ customDrawing: next });
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
    setPending([]);
    setSelected(null);
  }, [calc]);

  const setDrawing = (patch: Partial<CustomDrawing>): void => applyDrawing({ ...drawingRef.current, ...patch });
  const updateStroke = (strokeId: string, patch: Partial<CustomStroke>): void =>
    setDrawing({ lines: drawingRef.current.lines.map((line) => (line.id === strokeId ? { ...line, ...patch } : line)) });
  const updatePolygon = (polygonId: string, patch: Partial<CustomPolygon>): void =>
    setDrawing({ polygons: drawingRef.current.polygons.map((polygon) => (polygon.id === polygonId ? { ...polygon, ...patch } : polygon)) });
  const updateDimension = (dimensionId: string, patch: Partial<CustomDimension>): void =>
    setDrawing({ dimensions: drawingRef.current.dimensions.map((dimension) => (dimension.id === dimensionId ? { ...dimension, ...patch } : dimension)) });

  const snapPoint = (point: Vec2, shouldSnap = snap): Vec2 => {
    const step = shouldSnap ? Math.max(0.1, drawingRef.current.gridStep) : 0;
    const round = (n: number): number => (step ? Math.round(n / step) * step : n);
    return {
      x: round(Math.max(0, Math.min(drawingRef.current.workspaceW, point.x))),
      y: round(Math.max(0, Math.min(drawingRef.current.workspaceH, point.y))),
    };
  };

  const pointFromEvent = (event: ReactMouseEvent<SVGSVGElement>, shouldSnap = snap): Vec2 | null => {
    const svg = event.currentTarget;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const p = svg.createSVGPoint();
    p.x = event.clientX;
    p.y = event.clientY;
    const local = p.matrixTransform(matrix.inverse());
    return snapPoint({ x: local.x, y: local.y }, shouldSnap);
  };

  const makeId = (prefix: string): string => {
    try {
      return `${prefix}-${crypto.randomUUID()}`;
    } catch {
      return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
  };

  const completePolygon = (role: 'outline' | 'hole'): void => {
    const points = pending.slice();
    if (points.length < 3) {
      setNotice({ kind: 'warn', text: 'Для контура нужно минимум 3 точки.' });
      return;
    }
    const polygon: CustomPolygon = {
      id: makeId(role),
      name: role === 'outline' ? `Контур ${drawingRef.current.polygons.filter((p) => p.role === 'outline').length + 1}` : `Вырез ${drawingRef.current.polygons.filter((p) => p.role === 'hole').length + 1}`,
      role,
      points,
    };
    setDrawing({ polygons: [...drawingRef.current.polygons, polygon] });
    setSelected({ type: 'polygon', id: polygon.id });
    setPending([]);
    setNotice({ kind: 'ok', text: role === 'outline' ? 'Внешний контур замкнут. Его периметр добавлен в нож реза.' : 'Вырез добавлен; его периметр считается ножом, площадь вычитается.' });
  };

  const handleCanvasClick = (event: ReactMouseEvent<SVGSVGElement>): void => {
    if (tool === 'select' && !calibratePhoto) {
      setSelected(null);
      return;
    }
    const rawPoint = pointFromEvent(event, !calibratePhoto);
    if (!rawPoint) return;
    if (calibratePhoto && photo) {
      const next = [...calibrationPoints, rawPoint].slice(-2);
      setCalibrationPoints(next);
      if (next.length === 2) {
        const currentLength = Math.hypot(next[1].x - next[0].x, next[1].y - next[0].y);
        const known = parseFloat(knownLength.replace(',', '.'));
        if (!(currentLength > 0) || !(known > 0) || !Number.isFinite(known)) {
          setNotice({ kind: 'err', text: 'Введите известный размер больше нуля и выберите две разные точки.' });
          setCalibrationPoints([]);
          return;
        }
        const ratio = known / currentLength;
        const scalePoint = (p: Vec2): Vec2 => ({ x: p.x * ratio, y: p.y * ratio });
        const current = drawingRef.current;
        const scaled: CustomDrawing = {
          ...current,
          workspaceW: Math.min(10_000, Math.max(100, current.workspaceW * ratio)),
          workspaceH: Math.min(10_000, Math.max(100, current.workspaceH * ratio)),
          lines: current.lines.map((line) => ({ ...line, a: scalePoint(line.a), b: scalePoint(line.b) })),
          polygons: current.polygons.map((polygon) => ({ ...polygon, points: polygon.points.map(scalePoint) })),
          dimensions: current.dimensions.map((dimension) => ({ ...dimension, a: scalePoint(dimension.a), b: scalePoint(dimension.b) })),
          areaOverrideMm2: current.areaOverrideMm2 ? current.areaOverrideMm2 * ratio * ratio : null,
        };
        applyDrawing(scaled);
        setPhoto({ ...photo, xMm: photo.xMm * ratio, yMm: photo.yMm * ratio, widthMm: photo.widthMm * ratio, heightMm: photo.heightMm * ratio });
        setCalibrationPoints([]);
        setCalibratePhoto(false);
        setNotice({ kind: 'ok', text: `Масштаб фото откалиброван: ${fmtMm(known)} мм между выбранными точками.` });
      }
      return;
    }

    const p = snapPoint(rawPoint);
    if (tool === 'line') {
      if (pending.length === 0) {
        setPending([p]);
        return;
      }
      const a = pending[pending.length - 1];
      if (Math.hypot(p.x - a.x, p.y - a.y) < 0.01) return;
      const stroke: CustomStroke = { id: makeId('line'), kind: lineKind, a, b: p };
      setDrawing({ lines: [...drawingRef.current.lines, stroke] });
      setSelected({ type: 'line', id: stroke.id });
      setPending([p]);
      return;
    }
    if (tool === 'outline' || tool === 'hole') {
      if (pending.length >= 3 && Math.hypot(p.x - pending[0].x, p.y - pending[0].y) <= Math.max(2, drawing.gridStep * 0.6)) {
        completePolygon(tool === 'outline' ? 'outline' : 'hole');
      } else {
        setPending((current) => [...current, p]);
      }
      return;
    }
    if (tool === 'circle') {
      if (pending.length === 0) {
        setPending([p]);
        return;
      }
      const center = pending[0];
      const radius = Math.hypot(p.x - center.x, p.y - center.y);
      if (radius < 0.5) return;
      const points = Array.from({ length: 32 }, (_, i) => {
        const angle = (i / 32) * Math.PI * 2;
        return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
      });
      const polygon: CustomPolygon = { id: makeId('circle'), name: 'Круглый вырез', role: 'hole', points };
      setDrawing({ polygons: [...drawingRef.current.polygons, polygon] });
      setSelected({ type: 'polygon', id: polygon.id });
      setPending([]);
      setNotice({ kind: 'ok', text: `Круглый вырез Ø ${fmtMm(radius * 2)} мм добавлен (32 сегмента).` });
      return;
    }
    if (tool === 'dimension') {
      if (pending.length === 0) {
        setPending([p]);
        return;
      }
      const a = pending[0];
      const length = Math.hypot(p.x - a.x, p.y - a.y);
      const dimension: CustomDimension = { id: makeId('dim'), a, b: p, label: `${fmtMm(length)} мм` };
      setDrawing({ dimensions: [...drawingRef.current.dimensions, dimension] });
      setSelected({ type: 'dimension', id: dimension.id });
      setPending([]);
    }
  };

  const handlePointerMove = (event: ReactMouseEvent<SVGSVGElement>): void => {
    const point = pointFromEvent(event, !calibratePhoto);
    if (point) setCursor(point);
  };

  const finishCurrent = (): void => {
    if (tool === 'outline') completePolygon('outline');
    else if (tool === 'hole') completePolygon('hole');
    else setPending([]);
  };

  const deleteSelection = (): void => {
    if (!selected) return;
    if (selected.type === 'line') setDrawing({ lines: drawingRef.current.lines.filter((line) => line.id !== selected.id) });
    if (selected.type === 'polygon') setDrawing({ polygons: drawingRef.current.polygons.filter((polygon) => polygon.id !== selected.id) });
    if (selected.type === 'dimension') setDrawing({ dimensions: drawingRef.current.dimensions.filter((dimension) => dimension.id !== selected.id) });
    setSelected(null);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      const editing = target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (editing) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      } else if (event.key === 'Escape') {
        setPending([]);
        setCalibrationPoints([]);
        setCalibratePhoto(false);
      } else if (event.key === 'Enter' && (tool === 'outline' || tool === 'hole')) {
        finishCurrent();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selected) {
        event.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // Handlers deliberately use the latest selection/drawing through the current render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, selected, pending, redo, undo]);

  const handlePhotoFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(file);
    urlRef.current = url;
    const image = new Image();
    image.onload = () => {
      const current = drawingRef.current;
      const widthMm = Math.max(100, Math.min(500, current.workspaceW - 40));
      const heightMm = widthMm * (image.naturalHeight / image.naturalWidth);
      setPhoto({ url, widthPx: image.naturalWidth, heightPx: image.naturalHeight, xMm: 0, yMm: 0, widthMm, heightMm });
      if (current.workspaceW < widthMm + 40 || current.workspaceH < heightMm + 40) {
        setDrawing({ workspaceW: Math.max(current.workspaceW, widthMm + 40), workspaceH: Math.max(current.workspaceH, heightMm + 40) });
      }
      setNotice({ kind: 'warn', text: 'Фото показано как подложка только в этом сеансе. Перед точной обводкой откалибруйте масштаб по известному размеру.' });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      if (urlRef.current === url) urlRef.current = null;
      setNotice({ kind: 'err', text: 'Не удалось открыть это изображение.' });
    };
    image.src = url;
  };

  const clearPhoto = (): void => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setPhoto(null);
    setCalibratePhoto(false);
    setCalibrationPoints([]);
  };

  const applyTemplate = (): void => {
    const hasDrawing = drawingRef.current.lines.length || drawingRef.current.polygons.length || drawingRef.current.dimensions.length;
    if (hasDrawing && !window.confirm('Заменить текущий чертёж примером лотка? Сначала сохраните проект JSON, если он нужен.')) return;
    const next = createTrayTemplate({ ...templateDims, name: 'Лоток с ушками' });
    next.gridStep = drawingRef.current.gridStep;
    applyDrawing(next);
    setSelected(null);
    setPending([]);
    setNotice({ kind: 'ok', text: 'Шаблон лотка создан: зелёный — рез, синий — биговка. Подправьте точки и размеры под своё фото.' });
  };

  const exportName = (drawing.name || 'custom-die').toLowerCase().replace(/[^a-zа-яё0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'custom-die';
  const exportDrawing = (kind: 'svg' | 'dxf' | 'png' | 'pdf' | 'txt' | 'csv' | 'json'): void => {
    if (!result) return;
    const title = `${calc.state.orderNo || 'штанцформа'} · ${drawing.name}`;
    if (kind === 'svg') exportSvg(result, { showDie: false, showDims: true, showFills: true, theme: 'light', title }, exportName);
    if (kind === 'dxf') exportDxf(result, exportName, false);
    if (kind === 'png') void exportPng(result, { showDie: false, showDims: true, showFills: true, theme: 'light', title }, exportName, 3);
    if (kind === 'pdf') printPdf(title, renderUnfold(result, { showDie: false, showDims: true, showFills: true, theme: 'light', title }), result.area.blankW, result.area.blankH);
    if (kind === 'txt') exportReport(result, exportName);
    if (kind === 'csv') exportCsv(result, exportName);
    if (kind === 'json') exportJsonFallback(result, exportName);
  };

  const saveProject = (): void => {
    downloadText(`${exportName}-проект.json`, JSON.stringify({ type: 'sibgofro-custom-die', version: 1, drawing }, null, 2), 'application/json;charset=utf-8');
  };

  const loadProject = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
      const parsed = parseCustomDrawing(record && 'drawing' in record ? record.drawing : payload);
      if (!parsed) throw new Error('В файле нет корректной геометрии штанцформы.');
      const hasDrawing = drawingRef.current.lines.length || drawingRef.current.polygons.length || drawingRef.current.dimensions.length;
      if (hasDrawing && !window.confirm(`Открыть «${parsed.name}» вместо текущего чертежа?`)) return;
      applyDrawing(parsed);
      setSelected(null);
      setPending([]);
      setNotice({ kind: 'ok', text: `Проект «${parsed.name}» открыт. Фото-подложку при необходимости загрузите заново.` });
    } catch (error) {
      setNotice({ kind: 'err', text: error instanceof Error ? error.message : 'Не удалось прочитать JSON-проект.' });
    }
  };

  const fitWorkspace = (): void => {
    const points = [
      ...drawingRef.current.polygons.flatMap((p) => p.points),
      ...drawingRef.current.lines.flatMap((line) => [line.a, line.b]),
      ...drawingRef.current.dimensions.flatMap((dimension) => [dimension.a, dimension.b]),
      ...(photo ? [{ x: photo.xMm, y: photo.yMm }, { x: photo.xMm + photo.widthMm, y: photo.yMm + photo.heightMm }] : []),
    ];
    if (!points.length) return;
    const bounds = points.reduce((box, point) => ({
      minX: Math.min(box.minX, point.x),
      maxX: Math.max(box.maxX, point.x),
      minY: Math.min(box.minY, point.y),
      maxY: Math.max(box.maxY, point.y),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    const { minX, maxX, minY, maxY } = bounds;
    const padding = 30;
    const dx = padding - minX;
    const dy = padding - minY;
    const translate = (p: Vec2): Vec2 => ({ x: p.x + dx, y: p.y + dy });
    if (photo) setPhoto({ ...photo, xMm: photo.xMm + dx, yMm: photo.yMm + dy });
    const current = drawingRef.current;
    applyDrawing({
      ...current,
      workspaceW: Math.max(100, Math.ceil(maxX - minX + padding * 2)),
      workspaceH: Math.max(100, Math.ceil(maxY - minY + padding * 2)),
      lines: current.lines.map((line) => ({ ...line, a: translate(line.a), b: translate(line.b) })),
      polygons: current.polygons.map((polygon) => ({ ...polygon, points: polygon.points.map(translate) })),
      dimensions: current.dimensions.map((dimension) => ({ ...dimension, a: translate(dimension.a), b: translate(dimension.b) })),
    });
    setNotice({ kind: 'ok', text: 'Поле подогнано по контуру с отступом 30 мм.' });
  };

  const cancelPhotoCalibration = (): void => {
    setCalibratePhoto(false);
    setCalibrationPoints([]);
  };

  const selectedStroke = selected?.type === 'line' ? drawing.lines.find((line) => line.id === selected.id) : undefined;
  const selectedPolygon = selected?.type === 'polygon' ? drawing.polygons.find((polygon) => polygon.id === selected.id) : undefined;
  const selectedDimension = selected?.type === 'dimension' ? drawing.dimensions.find((dimension) => dimension.id === selected.id) : undefined;
  const viewPadding = 24;
  const viewBox = `${-viewPadding} ${-viewPadding} ${drawing.workspaceW + viewPadding * 2} ${drawing.workspaceH + viewPadding * 2}`;
  const minor = Math.max(0.1, drawing.gridStep);
  const major = minor * 5;
  const dist = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);
  const showLine = (kind: CustomLineKind): boolean => visible[kind];
  const dimensionText = (dimension: CustomDimension): string => dimension.label?.trim() || `${fmtMm(dist(dimension.a, dimension.b))} мм`;
  const handleSvgClick = handleCanvasClick;

  return (
    <div className="dgc-custom">
      <div className="dgc-custom__head">
        <div>
          <h3>Своя развертка</h3>
          <p>Нарисуйте контур по миллиметровой сетке, назначьте каждому отрезку тип ножа и добавьте линии биговки, вырезы и размеры. Расчёт листа, ножей и цены обновляется сразу.</p>
        </div>
        <div className="dgc-custom__head-actions">
          <button type="button" className="dgc-btn small ghost" onClick={undo} disabled={!canUndo} title="Ctrl+Z">↶ Отменить</button>
          <button type="button" className="dgc-btn small ghost" onClick={redo} disabled={!canRedo} title="Ctrl+Y">↷ Повторить</button>
          <button type="button" className="dgc-btn small ghost" onClick={() => importRef.current?.click()}>Открыть проект</button>
          <button type="button" className="dgc-btn small ghost" onClick={saveProject}>Сохранить проект JSON</button>
          <button type="button" className="dgc-btn small ghost" onClick={() => fileRef.current?.click()}>Фото-подложка</button>
          <button type="button" className="dgc-btn small ghost" onClick={() => {
            const hasDrawing = drawingRef.current.lines.length || drawingRef.current.polygons.length || drawingRef.current.dimensions.length;
            if (hasDrawing && !window.confirm('Очистить текущий чертёж? Сохраните проект JSON, если он нужен.')) return;
            applyDrawing(emptyCustomDrawing());
            clearPhoto();
            setSelected(null);
            setPending([]);
            setNotice({ kind: 'ok', text: 'Создан новый пустой чертёж.' });
          }}>Новый пустой</button>
          <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={(event) => void loadProject(event)} />
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={handlePhotoFile} />
          {(['svg', 'dxf', 'png', 'pdf', 'txt', 'csv', 'json'] as const).map((kind) => (
            <button key={kind} type="button" className="dgc-btn small" onClick={() => exportDrawing(kind)} disabled={!result}>
              {kind === 'pdf' ? 'PDF' : kind.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="dgc-custom__columns">
        <main className="dgc-custom__main">
          <Card title="Чертёж в миллиметрах" right={<div className="dgc-seg"><button type="button" aria-pressed={canvasTab === 'draw'} onClick={() => setCanvasTab('draw')}>Рисование</button><button type="button" aria-pressed={canvasTab === 'nest'} onClick={() => setCanvasTab('nest')}>Раскладка</button></div>}>
            {canvasTab === 'draw' ? (
              <>
                <div className="dgc-custom__projectbar">
                  <DText label="Название формы" value={drawing.name} onCommit={(name) => setDrawing({ name })} />
                  <DNumber label="Поле X, мм" value={drawing.workspaceW} min={100} max={10_000} step={10} onCommit={(workspaceW) => setDrawing({ workspaceW })} />
                  <DNumber label="Поле Y, мм" value={drawing.workspaceH} min={100} max={10_000} step={10} onCommit={(workspaceH) => setDrawing({ workspaceH })} />
                  <label className="dgc-field"><span>Клетка, мм</span><select value={String(drawing.gridStep)} onChange={(event) => setDrawing({ gridStep: Number(event.target.value) })}>{[1, 2, 5, 10, 20, 50].map((step) => <option key={step} value={step}>{step} × {step} мм</option>)}</select></label>
                  <Chk label="Привязка к клетке" checked={snap} onChange={setSnap} />
                  <button type="button" className="dgc-btn small ghost" onClick={fitWorkspace} title="Подогнать рабочее поле по нарисованной геометрии">Вписать чертёж</button>
                </div>

                <div className="dgc-custom__tools" role="toolbar" aria-label="Инструменты чертежа">
                  {(Object.keys(TOOL_LABEL) as EditorTool[]).map((item) => (
                    <button key={item} type="button" className="dgc-btn small ghost" aria-pressed={tool === item} onClick={() => { setTool(item); setPending([]); setSelected(null); cancelPhotoCalibration(); }}>
                      {TOOL_LABEL[item]}
                    </button>
                  ))}
                  {tool === 'line' ? (
                    <label className="dgc-field dgc-custom__kind"><span>Слой линии</span><select value={lineKind} onChange={(event) => { setLineKind(event.target.value as CustomLineKind); setPending([]); }}>
                      {CUSTOM_KINDS.map((kind) => <option key={kind} value={kind}>{LAYER_NAME[kind]}</option>)}
                    </select></label>
                  ) : null}
                  {pending.length > 0 ? <button type="button" className="dgc-btn small" onClick={finishCurrent}>{tool === 'outline' || tool === 'hole' ? 'Замкнуть контур' : 'Завершить'}</button> : null}
                  {selected ? <button type="button" className="dgc-btn small ghost" onClick={deleteSelection}>Удалить выбранное</button> : null}
                </div>

                <div className="dgc-custom__legend">
                  {CUSTOM_KINDS.map((kind) => (
                    <button type="button" key={kind} aria-pressed={showLine(kind)} onClick={() => setVisible((current) => ({ ...current, [kind]: !current[kind] }))}>
                      <i className="dgc-swatch" style={{ borderTopColor: LAYER_COLOR[kind], borderTopStyle: KIND_DASH[kind] ? 'dashed' : 'solid' }} />
                      {LAYER_NAME[kind]} <b>{result?.knives.segCount[kind] ?? 0}</b>
                    </button>
                  ))}
                  <span className="dgc-custom__legend-note">клик по клетке — координата; два клика — отрезок/размер. Esc отменяет текущий ввод.</span>
                </div>

                {photo ? (
                  <div className="dgc-custom__photo">
                    <span>Фото {photo.widthPx}×{photo.heightPx} px · ширина основы {fmtMm(photo.widthMm)} мм</span>
                    <label>Прозрачность <input type="range" min="0.08" max="0.85" step="0.01" value={photoOpacity} onChange={(event) => setPhotoOpacity(Number(event.target.value))} /></label>
                    <label>Известный размер, мм <input type="number" min="0.1" step="1" value={knownLength} onChange={(event) => setKnownLength(event.target.value)} /></label>
                    <button type="button" className="dgc-btn small ghost" aria-pressed={calibratePhoto} onClick={() => { setTool('select'); setPending([]); setCalibrationPoints([]); setCalibratePhoto((current) => !current); }}>
                      {calibratePhoto ? `Выберите точки ${calibrationPoints.length + 1}/2` : 'Калибровать по 2 точкам'}
                    </button>
                    <button type="button" className="dgc-btn small ghost" onClick={clearPhoto}>Убрать фото</button>
                    {calibratePhoto ? <span className="dgc-muted">Щёлкните на фото по концам известного размера (например, ширина дна коробки).</span> : null}
                  </div>
                ) : null}

                {calibratePhoto ? <div className="dgc-note dgc-note--warn">Режим калибровки фото: отметьте две точки с известным расстоянием между ними.</div> : null}

                <div className={`dgc-custom__canvas ${calibratePhoto ? 'is-calibrating' : ''} ${tool !== 'select' ? 'is-drawing' : ''}`}>
                  <svg
                    role="img"
                    aria-label="Редактор чертежа штанцформы по сетке в миллиметрах"
                    viewBox={viewBox}
                    preserveAspectRatio="xMidYMid meet"
                    onClick={handleSvgClick}
                    onMouseMove={handlePointerMove}
                    onMouseLeave={() => setCursor(null)}
                    style={{ cursor: calibratePhoto ? 'crosshair' : tool === 'select' ? 'default' : 'crosshair' }}
                  >
                    <defs>
                      <pattern id={minorGridId} width={minor} height={minor} patternUnits="userSpaceOnUse">
                        <path d={`M ${minor} 0 H 0 V ${minor}`} fill="none" stroke="#e9edf0" strokeWidth="0.45" vectorEffect="non-scaling-stroke" />
                      </pattern>
                      <pattern id={majorGridId} width={major} height={major} patternUnits="userSpaceOnUse">
                        <path d={`M ${major} 0 H 0 V ${major}`} fill="none" stroke="#d7dfe4" strokeWidth="0.75" vectorEffect="non-scaling-stroke" />
                      </pattern>
                    </defs>
                    <rect x={0} y={0} width={drawing.workspaceW} height={drawing.workspaceH} fill="#fff" />
                    {photo ? <image href={photo.url} x={photo.xMm} y={photo.yMm} width={photo.widthMm} height={photo.heightMm} opacity={photoOpacity} preserveAspectRatio="none" pointerEvents="none" /> : null}
                    <rect x={0} y={0} width={drawing.workspaceW} height={drawing.workspaceH} fill={`url(#${minorGridId})`} pointerEvents="none" />
                    <rect x={0} y={0} width={drawing.workspaceW} height={drawing.workspaceH} fill={`url(#${majorGridId})`} pointerEvents="none" />
                    <rect x={0} y={0} width={drawing.workspaceW} height={drawing.workspaceH} fill="none" stroke="#87949c" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                    <g fontSize={8} fill="#77838b" pointerEvents="none">
                      {Array.from({ length: Math.floor(drawing.workspaceW / major) + 1 }, (_, i) => <text key={`x-${i}`} x={i * major} y={-4} textAnchor="middle">{i * major}</text>)}
                      {Array.from({ length: Math.floor(drawing.workspaceH / major) + 1 }, (_, i) => <text key={`y-${i}`} x={-4} y={i * major + 2} textAnchor="end">{i * major}</text>)}
                    </g>
                    {drawing.polygons.map((polygon) => (
                      <polygon
                        key={polygon.id}
                        points={polygon.points.map((p) => `${p.x},${p.y}`).join(' ')}
                        fill={polygon.role === 'hole' ? '#ffffff' : '#d9c29b'}
                        fillOpacity={polygon.role === 'hole' ? 0.85 : 0.38}
                        stroke={selected?.type === 'polygon' && selected.id === polygon.id ? '#f08c00' : LAYER_COLOR.cut}
                        strokeWidth={selected?.type === 'polygon' && selected.id === polygon.id ? 3 : 1.6}
                        vectorEffect="non-scaling-stroke"
                        onClick={(event) => {
                          if (tool === 'select' && !calibratePhoto) {
                            event.stopPropagation();
                            setSelected({ type: 'polygon', id: polygon.id });
                          }
                        }}
                      />
                    ))}
                    {drawing.lines.filter((line) => showLine(line.kind)).map((line) => (
                      <g key={line.id}>
                        <line x1={line.a.x} y1={line.a.y} x2={line.b.x} y2={line.b.y} stroke="transparent" strokeWidth={12} vectorEffect="non-scaling-stroke" pointerEvents={tool === 'select' && !calibratePhoto ? 'stroke' : 'none'} onClick={(event) => {
                          if (tool === 'select' && !calibratePhoto) {
                            event.stopPropagation();
                            setSelected({ type: 'line', id: line.id });
                          }
                        }} />
                        <line x1={line.a.x} y1={line.a.y} x2={line.b.x} y2={line.b.y} stroke={selected?.type === 'line' && selected.id === line.id ? '#f08c00' : LAYER_COLOR[line.kind]} strokeWidth={selected?.type === 'line' && selected.id === line.id ? 3 : 1.6} strokeDasharray={KIND_DASH[line.kind]} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                      </g>
                    ))}
                    {drawing.dimensions.map((dimension) => (
                      <g key={dimension.id} onClick={(event) => {
                        if (tool === 'select' && !calibratePhoto) {
                          event.stopPropagation();
                          setSelected({ type: 'dimension', id: dimension.id });
                        }
                      }} style={{ cursor: tool === 'select' ? 'pointer' : undefined }}>
                        <line x1={dimension.a.x} y1={dimension.a.y} x2={dimension.b.x} y2={dimension.b.y} stroke="transparent" strokeWidth={12} vectorEffect="non-scaling-stroke" pointerEvents={tool === 'select' && !calibratePhoto ? 'stroke' : 'none'} />
                        <line x1={dimension.a.x} y1={dimension.a.y} x2={dimension.b.x} y2={dimension.b.y} stroke={selected?.type === 'dimension' && selected.id === dimension.id ? '#f08c00' : '#6b7480'} strokeWidth={1} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" pointerEvents="none" />
                        <text x={(dimension.a.x + dimension.b.x) / 2} y={(dimension.a.y + dimension.b.y) / 2 - 3} textAnchor="middle" fontSize={8} fill="#424b52" pointerEvents="none">{dimensionText(dimension)}</text>
                      </g>
                    ))}
                    {selectedPolygon ? selectedPolygon.points.map((p, index) => <circle key={`vertex-${index}`} cx={p.x} cy={p.y} r={2.2} fill="#f08c00" stroke="#fff" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />) : null}
                    {pending.length > 0 && cursor ? (
                      <g pointerEvents="none">
                        {tool === 'line' ? <line x1={pending[pending.length - 1].x} y1={pending[pending.length - 1].y} x2={cursor.x} y2={cursor.y} stroke={LAYER_COLOR[lineKind]} strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" /> : null}
                        {tool === 'outline' || tool === 'hole' ? <polyline points={[...pending, cursor].map((p) => `${p.x},${p.y}`).join(' ')} fill={pending.length >= 2 ? 'rgba(45,106,79,.08)' : 'none'} stroke={tool === 'hole' ? '#c92a2a' : LAYER_COLOR.cut} strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" /> : null}
                        {tool === 'dimension' ? <line x1={pending[0].x} y1={pending[0].y} x2={cursor.x} y2={cursor.y} stroke="#6b7480" strokeWidth={1} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" /> : null}
                        {tool === 'circle' ? <circle cx={pending[0].x} cy={pending[0].y} r={dist(pending[0], cursor)} fill="rgba(201,42,42,.05)" stroke="#c92a2a" strokeDasharray="3 2" strokeWidth={1} vectorEffect="non-scaling-stroke" /> : null}
                      </g>
                    ) : null}
                    {calibrationPoints.map((p, index) => <circle key={`cal-point-${index}`} cx={p.x} cy={p.y} r={4} fill="#ff922b" stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
                    {cursor && (tool !== 'select' || calibratePhoto) ? <circle cx={cursor.x} cy={cursor.y} r={1.8} fill="#2d6a4f" fillOpacity={0.55} pointerEvents="none" /> : null}
                  </svg>
                </div>
                <div className="dgc-custom__canvas-note">
                  {calibratePhoto ? `Калибровка фото: отмечено точек ${calibrationPoints.length}/2.` : pending.length ? `Текущая точка ${fmtMm(pending[pending.length - 1].x)} × ${fmtMm(pending[pending.length - 1].y)} мм · ${pending.length} точек.` : 'Все координаты и длины — в миллиметрах. Фото можно обвести вручную; контур замыкается кнопкой или щелчком по первой точке.'}
                  {cursor ? <span>Курсор: {fmtMm(cursor.x)} × {fmtMm(cursor.y)} мм</span> : null}
                </div>
              </>
            ) : result ? <NestView res={result} state={calc.state} setState={calc.setState} sheets={calc.settings.sheets} pricePerM2={calc.settings.profiles.find((p) => p.id === calc.state.profileId)?.priceM2 ?? 0} waste={calc.settings.prices.waste} /> : <p className="dgc-notes">Раскладка появится после добавления геометрии.</p>}
          </Card>

          {canvasTab === 'draw' ? (
            <Card title={selected ? 'Свойства выбранного элемента' : 'Редактирование и подсказки'}>
              {selectedStroke ? (
                <div className="dgc-custom__inspector">
                  <label className="dgc-field"><span>Тип ножа</span><select value={selectedStroke.kind} onChange={(event) => updateStroke(selectedStroke.id, { kind: event.target.value as CustomLineKind })}>{CUSTOM_KINDS.map((kind) => <option key={kind} value={kind}>{LAYER_NAME[kind]}</option>)}</select></label>
                  <CoordinateFields a={selectedStroke.a} b={selectedStroke.b} onChange={(next) => updateStroke(selectedStroke.id, next)} />
                  <span className="dgc-custom__measure">Длина: <b>{fmtMm(dist(selectedStroke.a, selectedStroke.b))} мм</b></span>
                  <button type="button" className="dgc-btn small ghost" onClick={deleteSelection}>Удалить отрезок</button>
                </div>
              ) : selectedPolygon ? (
                <div className="dgc-custom__inspector">
                  <DText label="Название контура" value={selectedPolygon.name} onCommit={(name) => updatePolygon(selectedPolygon.id, { name })} />
                  <label className="dgc-field"><span>Назначение</span><select value={selectedPolygon.role} onChange={(event) => updatePolygon(selectedPolygon.id, { role: event.target.value as CustomPolygon['role'] })}><option value="outline">Внешний контур (+ площадь)</option><option value="hole">Вырез / отверстие (− площадь)</option></select></label>
                  <div className="dgc-custom__vertices"><b>Вершины ({selectedPolygon.points.length})</b>{selectedPolygon.points.map((point, index) => <div className="dgc-custom__vertex" key={`${selectedPolygon.id}-${index}`}><span>{index + 1}</span><DNumber label="X" value={point.x} step={0.1} onCommit={(x) => updatePolygon(selectedPolygon.id, { points: selectedPolygon.points.map((p, i) => i === index ? { ...p, x } : p) })} /><DNumber label="Y" value={point.y} step={0.1} onCommit={(y) => updatePolygon(selectedPolygon.id, { points: selectedPolygon.points.map((p, i) => i === index ? { ...p, y } : p) })} /><button type="button" className="dgc-btn small ghost" disabled={selectedPolygon.points.length <= 3} title="Удалить вершину" onClick={() => updatePolygon(selectedPolygon.id, { points: selectedPolygon.points.filter((_, i) => i !== index) })}>×</button></div>)}</div>
                  <button type="button" className="dgc-btn small ghost" onClick={deleteSelection}>Удалить контур</button>
                </div>
              ) : selectedDimension ? (
                <div className="dgc-custom__inspector">
                  <DText label="Подпись размера" value={selectedDimension.label ?? ''} onCommit={(label) => updateDimension(selectedDimension.id, { label })} placeholder={`${fmtMm(dist(selectedDimension.a, selectedDimension.b))} мм`} />
                  <CoordinateFields a={selectedDimension.a} b={selectedDimension.b} onChange={(next) => updateDimension(selectedDimension.id, next)} />
                  <span className="dgc-custom__measure">Фактическое расстояние между точками: <b>{fmtMm(dist(selectedDimension.a, selectedDimension.b))} мм</b></span>
                  <button type="button" className="dgc-btn small ghost" onClick={deleteSelection}>Удалить размер</button>
                </div>
              ) : (
                <div className="dgc-custom__help">
                  <b>Быстрые действия</b>
                  <ul>
                    <li><b>Внешний контур</b> — точки по периметру заготовки; замкнутый контур считает площадь и нож реза.</li>
                    <li><b>Линия</b> — клики по началу/концу; можно продолжать ломаную и менять слой на рез, биговку, перфорацию или техно-нож.</li>
                    <li><b>Вырез / окно</b> — замкнутый внутренний контур; площадь вычитается, периметр добавляется к ножу реза.</li>
                    <li><b>Размер</b> — подпись и фактическая длина не влияют на расход ножей.</li>
                    <li>Точные координаты элемента вводятся в миллиметрах справа после выбора.</li>
                  </ul>
                </div>
              )}
              {notice ? <div className={`dgc-note ${notice.kind === 'err' ? 'dgc-note--err' : notice.kind === 'warn' ? 'dgc-note--warn' : 'dgc-note--ok'}`}>{notice.text}</div> : null}
            </Card>
          ) : null}
        </main>

        <aside className="dgc-custom__aside">
          <Card title="Расчёт и материал">
            <div className="dgc-custom__fields">
              <label className="dgc-field"><span>Профиль картона</span><select value={calc.state.profileId} onChange={(event) => calc.setState({ profileId: event.target.value })}>{calc.settings.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.priceM2} ₽/м²</option>)}</select></label>
              <DNumber label="Тираж, шт" value={calc.state.qty} min={1} step={100} onCommit={(qty) => calc.setState({ qty: Math.max(1, Math.round(qty)) })} />
              <label className="dgc-field"><span>Формат листа</span><select value={calc.state.sheetId} onChange={(event) => calc.setState({ sheetId: event.target.value })}><option value="auto">Автоподбор</option>{calc.settings.sheets.map((sheet: SheetFormat) => <option key={sheet.id} value={sheet.id}>{sheet.name} · {sheet.w}×{sheet.h}</option>)}</select></label>
              <DNumber label="Гнёзд на штампе" value={calc.state.options.perDie} min={1} max={12} step={1} onCommit={(perDie) => calc.setOptions({ perDie: Math.max(1, Math.round(perDie)) })} />
              <DNumber label="Шаг гнёзд, мм" value={calc.state.options.diePitch} min={0} step={1} onCommit={(diePitch) => calc.setOptions({ diePitch: Math.max(0, diePitch) })} />
              <DNumber label="Запас штампа с каждой стороны, мм" value={calc.state.die.frameMargin} min={0} step={1} onCommit={(frameMargin) => calc.setDie({ frameMargin: Math.max(0, frameMargin) })} />
              <DNumber label="Перемычка: шаг, мм" value={calc.state.die.nickEvery} min={0} step={5} onCommit={(nickEvery) => calc.setDie({ nickEvery: Math.max(0, nickEvery) })} />
              <DNumber label="Перемычка: длина, мм" value={calc.state.die.nickLen} min={0} step={0.5} onCommit={(nickLen) => calc.setDie({ nickLen: Math.max(0, nickLen) })} />
              <DNumber label="Отступ от края листа, мм" value={calc.state.nesting.edgeMargin} min={0} step={1} onCommit={(edgeMargin) => calc.setNesting({ edgeMargin: Math.max(0, edgeMargin) })} />
              <DNumber label="Зазор между заготовками, мм" value={calc.state.nesting.gapX} min={0} step={1} onCommit={(gap) => calc.setNesting({ gapX: Math.max(0, gap), gapY: Math.max(0, gap) })} />
            </div>
            <Chk label="Разрешить поворот на листе" checked={calc.state.nesting.allowRotate} onChange={(allowRotate) => calc.setNesting({ allowRotate })} />
            <div className="dgc-custom__area">
              <DNumber label="Точная полезная площадь, м² (необязательно)" value={drawing.areaOverrideMm2 ? drawing.areaOverrideMm2 / 1e6 : 0} min={0} step={0.0001} onCommit={(area) => setDrawing({ areaOverrideMm2: area > 0 ? area * 1e6 : null })} />
              <small>{drawing.areaOverrideMm2 ? 'Введено вручную. Ножи и габарит считаются по чертежу.' : 'Если замкнут внешний контур, площадь определяется автоматически. Иначе временно берётся прямоугольный габарит.'}</small>
            </div>
            <div className="dgc-custom__summary">
              <div><span>Заготовка</span><b>{result ? `${fmtMm(result.area.blankW)}×${fmtMm(result.area.blankH)} мм` : '—'}</b></div>
              <div><span>Рез / биговка</span><b>{result ? `${result.knives.cutM.toFixed(2)} / ${result.knives.creaseM.toFixed(2)} м` : '—'}</b></div>
              <div><span>С листа</span><b>{result ? `${result.nest.perSheet} шт` : '—'}</b></div>
              <div><span>Цена за штуку</span><b>{result ? `${fmt2(result.cost.perPcs)} ₽` : '—'}</b></div>
              <div><span>Штамп</span><b>{result ? fmtRub(result.cost.die.total) : '—'}</b></div>
              <div><span>Тираж</span><b>{result ? fmtRub(result.cost.batch.total) : '—'}</b></div>
            </div>
          </Card>

          <details className="dgc-card dgc-custom__template">
            <summary>Стартовый шаблон: лоток с ушками</summary>
            <p className="dgc-notes">Создаёт крестовую развёртку с треугольными угловыми ушками. Это обычная геометрия — после создания можно передвинуть точки, менять линии и добавлять элементы.</p>
            <div className="dgc-custom__template-fields">
              <DNumber label="Дно L, мм" value={templateDims.length} min={20} step={5} onCommit={(length) => setTemplateDims((v) => ({ ...v, length }))} />
              <DNumber label="Дно W, мм" value={templateDims.width} min={20} step={5} onCommit={(width) => setTemplateDims((v) => ({ ...v, width }))} />
              <DNumber label="Высота стенки, мм" value={templateDims.wall} min={5} step={5} onCommit={(wall) => setTemplateDims((v) => ({ ...v, wall }))} />
            </div>
            <button type="button" className="dgc-btn small" onClick={applyTemplate}>Вставить шаблон</button>
          </details>

          {result ? <ResultPanel res={result} settings={calc.settings} /> : <Card title="Результат"><p className="dgc-notes">Не удалось рассчитать пользовательскую форму. Проверьте профиль картона и размеры.</p></Card>}
        </aside>
      </div>
    </div>
  );
}

function CoordinateFields({
  a,
  b,
  onChange,
}: {
  a: Vec2;
  b: Vec2;
  onChange: (next: { a?: Vec2; b?: Vec2 }) => void;
}): ReactNode {
  return (
    <div className="dgc-custom__coords">
      <b>Начало</b>
      <DNumber label="X₁, мм" value={a.x} step={0.1} onCommit={(x) => onChange({ a: { ...a, x } })} />
      <DNumber label="Y₁, мм" value={a.y} step={0.1} onCommit={(y) => onChange({ a: { ...a, y } })} />
      <b>Конец</b>
      <DNumber label="X₂, мм" value={b.x} step={0.1} onCommit={(x) => onChange({ b: { ...b, x } })} />
      <DNumber label="Y₂, мм" value={b.y} step={0.1} onCommit={(y) => onChange({ b: { ...b, y } })} />
    </div>
  );
}

function DNumber({
  label,
  value,
  onCommit,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
}): ReactNode {
  const [text, setText] = useState(String(Number.isFinite(value) ? value : 0));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(Number.isFinite(value) ? value : 0));
  }, [value]);
  return (
    <label className="dgc-field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={text}
        onFocus={() => { focused.current = true; }}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          focused.current = false;
          const n = Number(text.replace(',', '.'));
          if (!Number.isFinite(n) || text.trim() === '') {
            setText(String(value));
            return;
          }
          const bounded = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n));
          setText(String(bounded));
          onCommit(bounded);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}

function DText({
  label,
  value,
  onCommit,
  placeholder,
}: {
  label: string;
  value: string;
  onCommit: (text: string) => void;
  placeholder?: string;
}): ReactNode {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  return (
    <label className="dgc-field">
      <span>{label}</span>
      <input
        value={text}
        placeholder={placeholder}
        onFocus={() => { focused.current = true; }}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          focused.current = false;
          onCommit(text.trim());
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}
