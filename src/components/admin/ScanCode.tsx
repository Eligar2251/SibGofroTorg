// =========================================================
// FILE: src/components/admin/ScanCode.tsx
// Клиентский экран сканера /admin/scan.
//
// Что умеет:
// 1) Показывать карточку товара прямо ПОД сканером без навигации —
//    удобно сканировать подряд.
// 2) Поддерживать ручной ввод, QR и штрихкоды.
// 3) Нормализовать данные из камеры: если QR содержит полный URL,
//    вытаскиваем из него slug / code и показываем товар сразу здесь.
// 4) Работать через BarcodeDetector (Chrome/Edge/Android) и ZXing
//    (Safari/Firefox/iOS) с одной и той же UI-логикой.
// =========================================================

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { IScannerControls } from "@zxing/browser";
import {
  ScanLine,
  Camera,
  CameraOff,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ExternalLink,
  Hash,
  Package,
  LoaderCircle,
  ScanSearch,
  Printer,
} from "lucide-react";
import { buildStockLabel, normalizeScanCode, type StockLabel } from "@/lib/scan";

type ScanProduct = {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  barcode: string;
  qrSlug: string;
  imageUrl: string | null;
  price: number;
  priceWholesale: number | null | undefined;
  stockQty: number | null | undefined;
  stockLabel: StockLabel;
};

type ScanLookupProduct = {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  barcode: string;
  qrSlug: string;
  imageUrl: string | null;
  price: number | null | undefined;
  priceWholesale: number | null | undefined;
  stockQty: number | null | undefined;
  inStock?: boolean | null | undefined;
  stockLabel?: StockLabel;
};

type NativeDetectedCode = { rawValue?: string | null };
type NativeBarcodeDetector = {
  detect(source: HTMLVideoElement): Promise<NativeDetectedCode[]>;
};
type NativeBarcodeDetectorCtor = {
  new (options?: { formats?: string[] }): NativeBarcodeDetector;
  getSupportedFormats(): Promise<string[]>;
};

interface Props {
  adminPath: string;
  initialCode: string;
  product?: ScanProduct;
  notFoundMessage?: string;
}

const fmt = (n: number) => n.toLocaleString("ru-RU");

function formatBarcode(s: string): string {
  if (s.length !== 13) return s;
  return `${s.slice(0, 3)} ${s.slice(3, 7)} ${s.slice(7, 12)} ${s.slice(12)}`;
}

function toScanProduct(product: ScanLookupProduct | ScanProduct): ScanProduct {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    sku: product.sku ?? null,
    barcode: product.barcode,
    qrSlug: product.qrSlug,
    imageUrl: product.imageUrl ?? null,
    price: product.price ?? 0,
    priceWholesale: product.priceWholesale ?? null,
    stockQty: product.stockQty ?? null,
    stockLabel:
      product.stockLabel ??
      buildStockLabel({
        stockQty: product.stockQty,
        inStock: "inStock" in product ? product.inStock : undefined,
      }),
  };
}

function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  return null;
}

/**
 * Constraints для камеры сканера.
 *
 * Ключевой момент — разрешение. Дефолт у getUserMedia/ZXing это
 * 640×480. QR с этикетки 26×26 мм, снятый с комфортных ~20 см,
 * занимает в таком кадре ~120 px: на 29 модулей приходится ~4 px
 * на модуль, и это ДО потерь на сжатие и расфокус. Отсюда и
 * «камера не распознаёт некоторые» — читались только те коды,
 * что покрупнее или поднесены вплотную.
 * 1920×1080 (с откатом на меньшее, т.к. это `ideal`, а не `exact`)
 * даёт втрое больше пикселей на модуль.
 */
function buildVideoConstraints(): MediaStreamConstraints {
  return {
    video: {
      // ideal, а не exact: если у устройства нет задней камеры
      // (десктоп с вебкамерой), поток всё равно откроется.
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      // Более высокая частота = больше попыток декодирования в
      // секунду и меньше смаза при дрожании руки.
      frameRate: { ideal: 30 },
    },
    audio: false,
  };
}

/**
 * Донастройка трека после старта: непрерывный автофокус.
 *
 * Без этого многие Android-камеры фиксируют фокус на «бесконечность»
 * и мелкий QR с близкого расстояния остаётся размытым — сканер
 * «не видит» код, пока не повезёт с автофокусом.
 * Свойства нестандартные (не во всех браузерах), поэтому всё
 * обёрнуто в try/catch и применяется best-effort.
 */
async function applyCameraTuning(stream: MediaStream): Promise<void> {
  const track = stream.getVideoTracks()[0];
  if (!track) return;

  try {
    const caps = track.getCapabilities?.() as
      | (MediaTrackCapabilities & { focusMode?: string[] })
      | undefined;
    if (!caps) return;

    const advanced: Record<string, unknown>[] = [];
    if (caps.focusMode?.includes("continuous")) {
      advanced.push({ focusMode: "continuous" });
    }
    if (advanced.length > 0) {
      await track.applyConstraints({
        advanced,
      } as MediaTrackConstraints);
    }
  } catch {
    // Камера не поддерживает тонкую настройку — не критично,
    // сканирование продолжится с настройками по умолчанию.
  }
}

export function ScanCode({
  adminPath,
  initialCode,
  product,
  notFoundMessage,
}: Props) {
  const router = useRouter();

  const [code, setCode] = useState(initialCode);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(notFoundMessage || null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [currentProduct, setCurrentProduct] = useState<ScanProduct | null>(
    product ? toScanProduct(product) : null
  );
  const [lastResolvedCode, setLastResolvedCode] = useState<string>(() =>
    initialCode || product?.qrSlug || product?.barcode || ""
  );

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<NativeBarcodeDetector | null>(null);
  const intervalRef = useRef<number | null>(null);
  const zxingControlsRef = useRef<IScannerControls | null>(null);
  const cancelScanRef = useRef(false);
  const lookupInFlightRef = useRef(false);
  const pendingLookupRef = useRef<{ value: string; fromCamera: boolean } | null>(null);
  const lastHandledRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  useEffect(() => {
    setCode(initialCode);
    setLookupError(notFoundMessage || null);
    setCurrentProduct(product ? toScanProduct(product) : null);
    setLastResolvedCode(initialCode || product?.qrSlug || product?.barcode || "");
  }, [initialCode, notFoundMessage, product]);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  async function lookupProduct(rawValue: string, { fromCamera = false } = {}) {
    const normalized = normalizeScanCode(rawValue, adminPath);
    if (!normalized) return;

    const now = Date.now();
    if (
      fromCamera &&
      lastHandledRef.current.code === normalized &&
      now - lastHandledRef.current.at < 3000
    ) {
      return;
    }

    if (lookupInFlightRef.current) {
      pendingLookupRef.current = { value: rawValue, fromCamera };
      return;
    }

    lookupInFlightRef.current = true;
    lastHandledRef.current = { code: normalized, at: now };
    setCode(normalized);
    setLookupError(null);
    setIsLookingUp(true);

    try {
      const res = await fetch(`/api/admin/scan/${encodeURIComponent(normalized)}`, {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as
        | {
            found?: boolean;
            message?: string;
            product?: ScanLookupProduct;
          }
        | null;

      if (res.ok && data?.found && data.product) {
        setCurrentProduct(toScanProduct(data.product));
        setLastResolvedCode(normalized);
        setLookupError(null);
      } else {
        setCurrentProduct(null);
        setLastResolvedCode(normalized);
        setLookupError(data?.message || `Товар с кодом «${normalized}» не найден`);
      }
    } catch {
      setLookupError("Не удалось получить данные о товаре. Проверьте сеть и попробуйте снова.");
    } finally {
      setIsLookingUp(false);
      lookupInFlightRef.current = false;

      const pending = pendingLookupRef.current;
      pendingLookupRef.current = null;
      if (pending) {
        void lookupProduct(pending.value, { fromCamera: pending.fromCamera });
      }
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void lookupProduct(code);
  }

  async function startCamera() {
    setCameraError(null);
    cancelScanRef.current = false;

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setCameraError("Камера недоступна в этом браузере. Введите код вручную.");
      return;
    }

    const BD = (window as Window & { BarcodeDetector?: NativeBarcodeDetectorCtor })
      .BarcodeDetector;
    const hasBarcodeDetector = !!(BD && typeof BD === "function");

    // Safari / Firefox / iOS — через ZXing.
    if (!hasBarcodeDetector) {
      try {
        setCameraOn(true);
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] =
          await Promise.all([import("@zxing/browser"), import("@zxing/library")]);

        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.QR_CODE,
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.DATA_MATRIX,
        ]);
        // TRY_HARDER — ZXing делает дополнительные проходы (в т.ч.
        // поворот кадра). Заметно поднимает процент распознавания
        // мятых/подсвеченных бликом этикеток. Стоит лишних ~10-20 мс
        // на кадр, что на сканере товара несущественно.
        hints.set(DecodeHintType.TRY_HARDER, true);

        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 100,
          delayBetweenScanSuccess: 600,
        });

        const video = videoRef.current;
        if (!video) throw new Error("Видеоэлемент не смонтирован");

        // Запрашиваем поток сами (а не через decodeFromVideoDevice с
        // deviceId=undefined): так можно задать разрешение и заднюю
        // камеру. Дефолтный поток у ZXing — 640×480, на нём мелкий
        // QR с этикетки 26 мм занимает слишком мало пикселей и не
        // декодируется, пока не поднесёшь телефон вплотную.
        const stream = await navigator.mediaDevices.getUserMedia(
          buildVideoConstraints()
        );
        streamRef.current = stream;

        if (cancelScanRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          return;
        }

        await applyCameraTuning(stream);

        const controls = await reader.decodeFromStream(stream, video, (result) => {
          const value = result?.getText();
          if (value) {
            void lookupProduct(value, { fromCamera: true });
          }
        });

        if (cancelScanRef.current) {
          try {
            controls.stop();
          } catch {
            /* уже остановлено */
          }
          return;
        }

        zxingControlsRef.current = controls;
      } catch (err: unknown) {
        const message = getErrorMessage(err);
        setCameraError(
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Доступ к камере запрещён. Разрешите камеру в настройках браузера (в Safari: значок «аА» в адресной строке → Камера) и попробуйте ещё раз."
            : message ||
              "Не удалось включить камеру. Проверьте разрешения и попробуйте снова."
        );
        stopCamera();
      }
      return;
    }

    // Chrome / Edge / Android — через нативный BarcodeDetector.
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        buildVideoConstraints()
      );
      streamRef.current = stream;

      if (cancelScanRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        return;
      }

      await applyCameraTuning(stream);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // playsInline уже стоит в разметке; без него iOS уводит
        // видео в полноэкранный плеер и сканирование обрывается.
        await videoRef.current.play();
      }
      setCameraOn(true);

      const formats = await BD.getSupportedFormats();
      const wanted = [
        "ean_13",
        "ean_8",
        "code_128",
        "code_39",
        "qr_code",
        "data_matrix",
      ].filter((format: string) => formats.includes(format));

      if (wanted.length > 0) {
        detectorRef.current = new BD({ formats: wanted });

        // Интервал уменьшен 350 → 150 мс: больше попыток на тот
        // короткий момент, когда автофокус поймал резкость.
        // detectBusy защищает от наложения кадров — detect()
        // асинхронный, и при медленном кадре старый setInterval
        // запускал параллельные распознавания, которые забивали
        // main thread и роняли FPS (из-за чего сканирование
        // «залипало» на секунды).
        let detectBusy = false;
        intervalRef.current = window.setInterval(async () => {
          const video = videoRef.current;
          const detector = detectorRef.current;
          if (!video || !detector || detectBusy) return;
          // Кадра ещё нет — детектору нечего разбирать.
          if (video.readyState < 2) return;

          detectBusy = true;
          try {
            const codes = await detector.detect(video);
            if (codes && codes.length > 0) {
              const value = codes[0].rawValue || "";
              if (value) {
                void lookupProduct(value, { fromCamera: true });
              }
            }
          } catch {
            // кадр не успел — пропускаем
          } finally {
            detectBusy = false;
          }
        }, 150);
      }
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      setCameraError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Доступ к камере запрещён. Разрешите камеру в настройках браузера и попробуйте ещё раз."
          : message ||
            "Не удалось включить камеру. Проверьте разрешения и попробуйте снова."
      );
      stopCamera();
    }
  }

  function stopCamera() {
    cancelScanRef.current = true;

    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (zxingControlsRef.current) {
      try {
        zxingControlsRef.current.stop();
      } catch {
        /* уже остановлен */
      }
      zxingControlsRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    detectorRef.current = null;
    setCameraOn(false);
  }

  function clearResult() {
    setCode("");
    setLookupError(null);
    setCurrentProduct(null);
    setLastResolvedCode("");
  }

  return (
    <div className="scan-page">
      <div className="scan-page__top">
        <Link href={`/${adminPath}`} className="scan-page__back">
          ← В админку
        </Link>
        <h1 className="scan-page__title">
          <ScanLine size={22} /> Сканер
        </h1>
      </div>

      <form className="scan-page__form" onSubmit={onSubmit}>
        <input
          className="scan-page__input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Наведите камеру или введите код"
          autoFocus={!currentProduct && !cameraOn}
          inputMode="text"
          autoComplete="off"
        />
        <button
          type="button"
          className="scan-page__cam-btn"
          onClick={cameraOn ? stopCamera : startCamera}
          aria-label={cameraOn ? "Выключить камеру" : "Включить камеру"}
        >
          {cameraOn ? <CameraOff size={18} /> : <Camera size={18} />}
        </button>
        <button type="submit" className="scan-page__go" disabled={isLookingUp}>
          {isLookingUp ? "Поиск..." : "Найти"}
        </button>
      </form>

      <div
        className="scan-page__video-wrap"
        style={cameraOn ? undefined : { display: "none" }}
        aria-hidden={!cameraOn}
      >
        <video
          ref={videoRef}
          className="scan-page__video"
          playsInline
          muted
        />
        <p className="scan-page__video-hint">
          Наведите на штрихкод или QR — карточка появится ниже
        </p>
      </div>

      {cameraOn && !isLookingUp && (
        <div className="scan-page__status scan-page__status--live" aria-live="polite">
          <ScanSearch size={15} /> Камера включена — можно сканировать подряд, карточка будет обновляться ниже.
        </div>
      )}

      {isLookingUp && (
        <div className="scan-page__status scan-page__status--loading" aria-live="polite">
          <LoaderCircle size={15} className="animate-spin" /> Ищу товар по коду
          {lastResolvedCode || code ? ` «${code || lastResolvedCode}»` : ""}…
        </div>
      )}

      {cameraError && (
        <div className="scan-page__err">
          <AlertCircle size={15} /> {cameraError}
        </div>
      )}

      {lookupError && (
        <div className="scan-page__notfound" aria-live="polite">
          <XCircle size={28} />
          <p>{lookupError}</p>
          <p className="scan-page__hint">
            Можно сканировать полный QR-URL, QR-slug, EAN-13, SKU или обычный slug товара.
          </p>
        </div>
      )}

      {currentProduct ? (
        <div className="scan-page__card" aria-live="polite">
          <div className="scan-page__head">
            <div className="scan-page__thumb">
              {currentProduct.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={currentProduct.imageUrl} alt={currentProduct.name} />
              ) : (
                <Package size={42} />
              )}
            </div>

            <div className="scan-page__head-main">
              <h2 className="scan-page__name">{currentProduct.name}</h2>
              {currentProduct.sku && (
                <div className="scan-page__sku">
                  <Hash size={12} /> Артикул: {currentProduct.sku}
                </div>
              )}
            </div>
          </div>

          <div className="scan-page__price-row">
            <div className="scan-page__price-main">
              {currentProduct.price > 0
                ? `${fmt(currentProduct.price)} ₽`
                : "Цена не указана"}
            </div>
            {currentProduct.priceWholesale != null && currentProduct.priceWholesale > 0 && (
              <div className="scan-page__price-wholesale">
                опт: {fmt(currentProduct.priceWholesale)} ₽
              </div>
            )}
          </div>

          <div
            className={`scan-page__stock scan-page__stock--${currentProduct.stockLabel.tone}`}
          >
            {currentProduct.stockLabel.tone === "ok" && <CheckCircle2 size={16} />}
            {currentProduct.stockLabel.tone === "low" && <AlertCircle size={16} />}
            {currentProduct.stockLabel.tone === "out" && <XCircle size={16} />}
            <span>{currentProduct.stockLabel.text}</span>
          </div>

          <div className="scan-page__meta">
            <span>
              <strong>QR:</strong> {currentProduct.qrSlug}
            </span>
            <span>
              <strong>EAN:</strong> {formatBarcode(currentProduct.barcode)}
            </span>
          </div>

          {/* Превью постоянного штрихкода товара (тот самый код,
              что хранится в БД и печатается на этикетках) */}
          <div className="scan-page__bc-preview">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/admin/qr/barcode/${currentProduct.id}?height=12`}
              alt={`Штрихкод ${currentProduct.barcode}`}
              style={{ maxWidth: 240, width: "100%", height: "auto" }}
            />
          </div>

          <div className="scan-page__actions">
            <Link
              href={`/${adminPath}/products?edit=${currentProduct.id}`}
              className="scan-page__btn scan-page__btn--primary"
            >
              <ExternalLink size={15} /> Открыть в админке
            </Link>
            <Link
              href={`/${adminPath}/qr-print?q=${encodeURIComponent(
                currentProduct.barcode
              )}`}
              className="scan-page__btn"
            >
              <Printer size={15} /> Печатать этикетку
            </Link>
            <button type="button" className="scan-page__btn" onClick={clearResult}>
              <ScanLine size={15} /> Очистить карточку
            </button>
            <button
              type="button"
              className="scan-page__btn"
              onClick={() => router.push(`/${adminPath}/products`)}
            >
              <Package size={15} /> Все товары
            </button>
          </div>
        </div>
      ) : null}

      <p className="scan-page__footer-hint">
        Сканер принимает <strong>полный QR-URL</strong>, <strong>QR-slug</strong>, <strong>EAN-13</strong>, <strong>SKU</strong>, <strong>id</strong> и обычный <strong>slug</strong> товара.
      </p>
    </div>
  );
}
