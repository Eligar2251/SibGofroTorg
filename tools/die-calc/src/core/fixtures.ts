/**
 * fixtures.ts — эталонные чертежи штанцформ (9 шт.). Это «земля»: по ним
 * калибруются припуски и по ним же запускаются тесты.
 *
 * Размеры взяты из маркировки чертежей (формат «код-L*W*H-профиль»), площади
 * заготовок и длины ножей — с чертежей. Пустой construction = шаблон пока не
 * реализован: 0215 — крышки «встык» (четверик без клапанов), в текущем наборе
 * такого шаблона нет; 0470-235 — лоток + гильза (две разные детали на штампе).
 */

import type { ClosureId, ConstructionId } from './model';

export interface Fixture {
  id: string;
  order: string;
  /** маркировка на чертеже */
  mark: string;
  construction: ConstructionId | null;
  closure: ClosureId;
  L: number;
  W: number;
  H: number;
  profile: string;
  /** габарит заготовки по краям коробки, мм */
  blankW: number;
  blankH: number;
  /** штамп (заготовка + запас), мм */
  dieW: number;
  dieH: number;
  perDie: number;
  /** «лицо печати» => зеркальная развертка */
  face: 'stamp' | 'print';
  /** длины ножей, м */
  knives: {
    cut: number;
    crease: number;
    perf: number;
    tech: number;
    total: number;
    outline: number;
    mark: number;
  };
  note?: string;
}

export const FIXTURES: Fixture[] = [
  {
    id: 'f1',
    order: '0612-08-26',
    mark: '0470-235*103*60-E',
    construction: null,
    closure: 'full',
    L: 235,
    W: 103,
    H: 60,
    profile: 'E',
    blankW: 451,
    blankH: 364,
    dieW: 982,
    dieH: 459,
    perDie: 2,
    face: 'stamp',
    knives: { cut: 4.733, crease: 3.602, perf: 0, tech: 0.795, total: 9.13, outline: 3.083, mark: 0.916 },
    note: '0470 = лоток + гильза: на штампе две РАЗНЫЕ детали (451×364 каждая), нужен отдельный шаблон',
  },
  {
    id: 'f2',
    order: '2203-09-26',
    mark: '0427-100×100×350-BC',
    construction: null,
    closure: 'half',
    L: 100,
    W: 100,
    H: 350,
    profile: 'BC',
    blankW: 849,
    blankH: 530,
    dieW: 929,
    dieH: 610,
    perDie: 1,
    face: 'stamp',
    knives: { cut: 3.723, crease: 2.797, perf: 0, tech: 0.795, total: 7.315, outline: 3.279, mark: 0.917 },
    note: 'подпись 0427, но по виду длинный пенал: нужна расшифровка кода и DXF',
  },
  {
    id: 'f3',
    order: '2115-09-26',
    mark: '0436-255*190*60-B',
    construction: 'lotok',
    closure: 'none',
    L: 255,
    W: 190,
    H: 60,
    profile: 'B',
    blankW: 513,
    blankH: 400,
    dieW: 593,
    dieH: 480,
    perDie: 1,
    face: 'stamp',
    knives: { cut: 2.679, crease: 1.652, perf: 0.386, tech: 0.795, total: 5.512, outline: 2.132, mark: 1.094 },
    note: 'панели: 57+68+263+68+57 = 513 и 38+65+194+65+38 = 400',
  },
  {
    id: 'f4',
    order: '2104-09-26',
    mark: '0470-240*180*60-E',
    construction: 'bokovoy',
    closure: 'full',
    L: 240,
    W: 180,
    H: 60,
    profile: 'E',
    blankW: 610,
    blankH: 518,
    dieW: 690,
    dieH: 620,
    perDie: 1,
    face: 'stamp',
    knives: { cut: 3.785, crease: 2.228, perf: 0, tech: 0.795, total: 6.808, outline: 2.821, mark: 0.913 },
    note: 'запас штампа 102 мм (не 80) — вероятно, под маркировку',
  },
  {
    id: 'f5',
    order: '2103-09-26',
    mark: '0427-240*180*60-E',
    construction: 'lastochkin',
    closure: 'tuck',
    L: 240,
    W: 180,
    H: 60,
    profile: 'E',
    blankW: 550,
    blankH: 513,
    dieW: 630,
    dieH: 593,
    perDie: 1,
    face: 'stamp',
    knives: { cut: 3.283, crease: 2.662, perf: 0, tech: 0.795, total: 6.739, outline: 2.647, mark: 0.914 },
  },
  {
    id: 'f6',
    order: '0825-09-26',
    mark: '0427-240*180*60-E',
    construction: 'lastochkin',
    closure: 'tuck',
    L: 240,
    W: 180,
    H: 60,
    profile: 'E',
    blankW: 548.5,
    blankH: 503,
    dieW: 651,
    dieH: 583,
    perDie: 1,
    face: 'print',
    knives: { cut: 3.113, crease: 2.241, perf: 0, tech: 0.199, total: 5.552, outline: 2.668, mark: 0.927 },
    note: 'один техно-уголок (0,199 м); развертка зеркальная — «лицо печати»',
  },
  {
    id: 'f7',
    order: '0824-09-26',
    mark: '0427-125*110*115-E',
    construction: 'lastochkin',
    closure: 'half',
    L: 125,
    W: 110,
    H: 115,
    profile: 'E',
    blankW: 575,
    blankH: 618,
    dieW: 655,
    dieH: 698,
    perDie: 1,
    face: 'print',
    knives: { cut: 3.395, crease: 2.0, perf: 0, tech: 0.795, total: 6.189, outline: 2.907, mark: 0.867 },
  },
  {
    id: 'f8',
    order: '0313-09-26',
    mark: '0215-90*90*120-E',
    construction: null,
    closure: 'none',
    L: 90,
    W: 90,
    H: 120,
    profile: 'E',
    blankW: 387,
    blankH: 303,
    dieW: 467,
    dieH: 383,
    perDie: 1,
    face: 'print',
    knives: { cut: 1.831, crease: 1.222, perf: 0, tech: 0.795, total: 3.847, outline: 1.686, mark: 0.453 },
    note: '0215 (крышки встык) — в текущем наборе шаблонов нет',
  },
  {
    id: 'f9',
    order: '3109-08-26-1',
    mark: '0436-380*280*60-B',
    construction: 'lotok',
    closure: 'none',
    L: 380,
    W: 280,
    H: 60,
    profile: 'B',
    blankW: 666,
    blankH: 480,
    dieW: 746,
    dieH: 560,
    perDie: 1,
    face: 'stamp',
    knives: { cut: 3.423, crease: 2.36, perf: 0.412, tech: 0.795, total: 6.99, outline: 2.598, mark: 1.081 },
    note: 'панели: 35+63+284+63+35 = 480',
  },
];

/** только те эталоны, которые наш геометр.движок умеет пересчитывать */
export const CALIBRATABLE = FIXTURES.filter((f) => f.construction !== null);
