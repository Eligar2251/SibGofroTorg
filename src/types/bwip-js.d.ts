// =========================================================
// FILE: src/types/bwip-js.d.ts
// Минимальный type declaration для bwip-js.
// У пакета есть свои .d.ts, но они спрятаны за conditional exports
// (`node` без `default`), что ломает TypeScript-резолвер при
// `moduleResolution: "bundler"` в Next 16. Импортируем как default
// и описываем API, которое реально используем.
// =========================================================

declare module "bwip-js" {
  export interface BwipOptions {
    /** Barcode type: "ean13", "code128", "qrcode" и т.п. */
    bcid: string;
    /** Значение для кодирования. */
    text: string;
    /** Масштаб (1 = 1px на модуль). По умолчанию 2-3 для печати. */
    scale?: number;
    /** Высота штрихкода в мм (для линейных). */
    height?: number;
    /** Показывать ли цифры под штрихкодом. */
    includetext?: boolean;
    /** Выравнивание текста под штрихкодом: left, center, right. */
    textxalign?: "left" | "center" | "right";
    /** Размер шрифта текста (pt). */
    textsize?: number;
    /** Отступы вокруг. */
    paddingwidth?: number;
    paddingheight?: number;
  }

  /**
   * Сгенерировать штрихкод в PNG-буфер.
   * @param opts — параметры штрихкода.
   * @returns Promise<Buffer> с PNG.
   */
  export function toBuffer(opts: BwipOptions): Promise<Buffer>;

  /** Default-импорт для совместимости с CommonJS-стилем. */
  const _default: { toBuffer: typeof toBuffer };
  export default _default;
}
