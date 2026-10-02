import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCustomDrawing,
  createTrayTemplate,
  emptyCustomDrawing,
  parseCustomDrawing,
} from '../src/core/custom';
import { baseSettings, makeInput, packJob } from '../src/core/index';
import { jobToPatch, type DieCalcJobRow } from '../src/ui/jobs';
import { renderUnfold } from '../src/core/render2d';
import { toDxf } from '../src/core/export/dxf';

const input = makeInput({ L: 240, W: 180, H: 50, profile: 'E', qty: 1000 });
const settings = baseSettings();

test('шаблон лотка: контур, габарит, биговки и площадь ушек считаются автоматически', () => {
  const drawing = createTrayTemplate({ length: 240, width: 180, wall: 50 });
  const result = calculateCustomDrawing(drawing, input, settings);
  assert.equal(result.area.blankW, 340);
  assert.equal(result.area.blankH, 280);
  assert.equal(result.area.blankAreaM2, 0.0902);
  assert.equal(result.knives.cutM, 1.123);
  assert.equal(result.knives.creaseM, 1.04);
  assert.ok(result.nest.perSheet > 0);
  assert.ok(result.cost.die.total > 0);
  assert.ok(result.cost.batch.total > 0);
  assert.equal(result.input.construction, 'blank');
});

test('произвольное окно вычитается из площади, но его периметр остаётся ножом', () => {
  const drawing = emptyCustomDrawing();
  drawing.lines = [{ id: 'fold', kind: 'crease', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }];
  drawing.polygons = [
    { id: 'outer', name: 'контур', role: 'outline', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] },
    { id: 'hole', name: 'окно', role: 'hole', points: [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }] },
  ];
  const result = calculateCustomDrawing(drawing, input, settings);
  assert.equal(result.area.blankAreaM2, 0.0096);
  assert.equal(result.area.holesAreaM2, 0.0004);
  assert.equal(result.knives.cutM, 0.48);
  assert.equal(result.knives.creaseM, 0.1);
});

test('открытые ножи считаются, а площадь без замкнутого контура помечается как оценочная', () => {
  const drawing = emptyCustomDrawing();
  drawing.lines = [{ id: 'cut', kind: 'cut', a: { x: 20, y: 15 }, b: { x: 120, y: 65 } }];
  const result = calculateCustomDrawing(drawing, input, settings);
  assert.equal(result.area.blankW, 100);
  assert.equal(result.area.blankH, 50);
  assert.equal(result.area.blankAreaM2, 0.005);
  assert.ok(result.warnings.some((warning) => warning.includes('Замкнутый внешний контур')));
});

test('TECH-линии пользовательского изделия входят в экспорт и повторяются по числу гнёзд', () => {
  const drawing = emptyCustomDrawing();
  drawing.lines = [{ id: 'tech-line', kind: 'tech', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }];
  drawing.workspaceW = 140;
  drawing.workspaceH = 80;
  const twoUp = { ...input, options: { ...input.options, perDie: 2 } };
  const result = calculateCustomDrawing(drawing, twoUp, settings);
  const svg = renderUnfold(result, { showDie: false, theme: 'light' });
  assert.ok(svg.includes('layer-tech'));
  const dxf = toDxf(result, { includeDie: false });
  assert.ok(dxf.includes('TECH'));
  assert.equal(dxf.split('\n').filter((line, i, all) => line === 'LINE' && all[i + 1] === '8' && all[i + 2] === 'TECH').length, 2);
});

test('ручной метраж площади не меняет ножи и подписывается в SVG/DXF', () => {
  const drawing = createTrayTemplate({ length: 240, width: 180, wall: 50 });
  const automatic = calculateCustomDrawing(drawing, input, settings);
  drawing.areaOverrideMm2 = 80_000;
  drawing.dimensions[0].label = 'ДНО 240 мм';
  const manual = calculateCustomDrawing(drawing, input, settings);
  assert.equal(manual.area.blankAreaM2, 0.08);
  assert.equal(manual.knives.totalM, automatic.knives.totalM);
  const svg = renderUnfold(manual, { theme: 'light', showDims: true });
  assert.ok(svg.includes('ДНО 240 мм'));
  const dxf = toDxf(manual, { includeDie: false });
  assert.ok(dxf.includes('DIM'));
  assert.ok(dxf.includes('ДНО 240 мм'));
});

test('вынесенные за габарит размеры входят в границы SVG и DXF', () => {
  const drawing = emptyCustomDrawing();
  drawing.polygons = [{ id: 'outline', name: 'Контур', role: 'outline', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }];
  drawing.dimensions = [{ id: 'width', a: { x: -50, y: 0 }, b: { x: -10, y: 0 }, label: 'Вынесенный размер' }];
  const result = calculateCustomDrawing(drawing, input, settings);
  const svg = renderUnfold(result, { showDie: false, showDims: true, theme: 'light' });
  assert.match(svg, /viewBox="-100 -152 214 198"/);
  assert.match(toDxf(result, { includeDie: false }), /\$EXTMIN\n10\n-50(?:\.0+)?\n20\n-?\d+(?:\.\d+)?\n30\n0/);
});

test('пользовательский чертёж попадает в базовый пакет и восстанавливается из расчёта', () => {
  const drawing = createTrayTemplate({ length: 220, width: 160, wall: 45, name: 'Кастомный лоток' });
  const result = calculateCustomDrawing(drawing, input, settings);
  const payload = packJob(result, {
    name: drawing.name,
    customDrawing: drawing,
    prices: settings.prices,
    profiles: settings.profiles,
    sheets: settings.sheets,
  });
  assert.deepEqual(payload.settings.customDrawing, drawing);
  assert.equal(payload.blank_area_m2, Math.round(result.area.blankAreaM2 * 1e6) / 1e6);
  assert.notEqual(payload.blank_area_m2, result.area.bboxAreaM2, 'в колонку площади записывается полезная площадь формы, не прямоугольный габарит');
  const row = { ...payload, id: 'custom-job' } as unknown as DieCalcJobRow;
  const restored = jobToPatch(row);
  assert.deepEqual(restored.initial.customDrawing, drawing);
  assert.equal(restored.initial.construction, 'blank');
});

test('JSON-проект валидируется и ограничивает некорректные поля', () => {
  assert.equal(parseCustomDrawing(null), null);
  const drawing = parseCustomDrawing({
    name: 'Тест',
    workspaceW: 99_999,
    workspaceH: 0,
    gridStep: 0,
    lines: [{ id: 'l', kind: 'not-a-knife', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }],
    polygons: [{ id: 'too-short', name: '', role: 'outline', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }],
  });
  assert.ok(drawing);
  assert.equal(drawing?.workspaceW, 10_000);
  assert.equal(drawing?.workspaceH, 100);
  assert.equal(drawing?.gridStep, 0.1);
  assert.equal(drawing?.lines.length, 0);
  assert.equal(drawing?.polygons.length, 0);
});
