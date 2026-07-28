// =========================================================
// FILE: src/components/admin/ScanCode.tsx
// Клиентский компонент для страницы сканера /admin/scan/[code].
//
// Что умеет:
// 1) Показывать карточку товара: название, цена (с оптовой), наличие,
//    артикул, QR + штрихкод. Кнопки: «Открыть в админке»,
//    «Скопировать код», «Новый поиск».
// 2) Поле ручного ввода + Enter → переход на /admin/scan/{code}.
// 3) Кнопка камеры (только https / localhost) — сканирование:
//    • Chrome/Edge/Android — нативный BarcodeDetector (быстрый);
//    • Safari / Firefox / iOS (там BarcodeDetector НЕТ совсем) —
//      JS-декодер ZXing (@zxing/browser), подгружается динамически
//      только когда нужен. Работает везде, где есть getUserMedia.
//    Распознанный код автоматически открывает страницу товара.
//
// UI оптимизирован под мобильный: крупные кнопки, мало текста.
// =========================================================

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
// Тип-only импорт: в бандл не попадает (стирается при компиляции),
// сам ZXing подгружается динамически — только в браузерах без
// нативного BarcodeDetector (Safari/Firefox/iOS).
import type { IScannerControls } from "@zxing/browser";
import {
  ScanLine,
  Camera,
  CameraOff,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ExternalLink,
  Copy,
  Hash,
  Package,
  RotateCcw,
} from "lucide-react";

type StockTone = "ok" | "low" | "out";
type StockLabel = { text: string; tone: StockTone };

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
  const [copied, setCopied] = useState<"barcode" | "slug" | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);
  const intervalRef = useRef<number | null>(null);
  // ZXing-сканер (Safari/Firefox): controls.stop() останавливает
  // и декодер, и камеру. cancelScanRef — защита от гонки «юзер
  // выключил камеру, пока ZXing ещё загружался динамическим import».
  const zxingControlsRef = useRef<IScannerControls | null>(null);
  const cancelScanRef = useRef(false);

  // Остановка камеры при размонтировании
  useEffect(() => {
    return () => stopCamera();
  }, []);

  function navigateToScan(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    // Если код распознан как «не нашёный» (например, попал в чужой QR)
    // — страница /admin/scan/[code] вернёт 404, и мы покажем
    // сообщение через notFound-флаг в URL.
    router.push(`/${adminPath}/scan/${encodeURIComponent(trimmed)}`);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    navigateToScan(code);
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const BD = (window as any).BarcodeDetector;
    const hasBarcodeDetector = !!(BD && typeof BD === "function");

    // ── Safari / Firefox / iOS-webview: нативного BarcodeDetector НЕТ ──
    // Декодируем кадры на JS через ZXing (@zxing/browser) — библиотека
    // подгружается динамически, только когда она реально нужна (в основной
    // бандл админки не попадает). Камера включается самим ZXing.
    if (!hasBarcodeDetector) {
      try {
        // <video> в DOM всегда (скрыт display:none) — показываем
        // превью до запроса разрешения, чтобы не было «чёрного кадра».
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
        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 250,
          delayBetweenScanSuccess: 600,
        });

        const video = videoRef.current;
        if (!video) throw new Error("Видеоэлемент не смонтирован");

        let navigated = false;
        const controls = await reader.decodeFromVideoDevice(
          undefined, // без deviceId → ZXing просит заднюю камеру (facingMode: environment)
          video,
          (result) => {
            const value = result?.getText();
            if (value && !navigated) {
              navigated = true;
              setCode(value);
              stopCamera();
              navigateToScan(value);
            }
          }
        );
        // Юзер успел выключить камеру, пока ZXing запускался?
        if (cancelScanRef.current) {
          try {
            controls.stop();
          } catch {
            /* уже остановлено */
          }
          return;
        }
        zxingControlsRef.current = controls;
      } catch (err: any) {
        setCameraError(
          err?.name === "NotAllowedError"
            ? "Доступ к камере запрещён. Разрешите камеру в настройках браузера (в Safari: значок «аА» в адресной строке → Камера) и попробуйте ещё раз."
            : err?.message ||
              "Не удалось включить камеру. Проверьте разрешения и попробуйте снова."
        );
        stopCamera();
      }
      return;
    }

    // ── Chrome / Edge / Android: нативный BarcodeDetector ──
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      // Юзер успел выключить камеру, пока ждали getUserMedia? — гасим
      // свежие треки и выходим, чтобы не «воскрешать» превью.
      if (cancelScanRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        return;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);

      // Периодическое распознавание нативным детектором.
      const formats = await BD.getSupportedFormats();
      const wanted = [
        "ean_13",
        "ean_8",
        "code_128",
        "code_39",
        "qr_code",
        "data_matrix",
      ].filter((f) => formats.includes(f));
      if (wanted.length > 0) {
        detectorRef.current = new BD({ formats: wanted });
        intervalRef.current = window.setInterval(async () => {
          if (!videoRef.current || !detectorRef.current) return;
          try {
            const codes = await detectorRef.current.detect(videoRef.current);
            if (codes && codes.length > 0) {
              const value = codes[0].rawValue || "";
              if (value) {
                setCode(value);
                stopCamera();
                navigateToScan(value);
              }
            }
          } catch {
            // кадр не успел — пропускаем
          }
        }, 350);
      }
    } catch (err: any) {
      setCameraError(
        err?.name === "NotAllowedError"
          ? "Доступ к камере запрещён. Разрешите камеру в настройках браузера и попробуйте ещё раз."
          : err?.message ||
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
    // Останавливаем ZXing-сканер (он сам гасит свой видеопоток)
    if (zxingControlsRef.current) {
      try {
        zxingControlsRef.current.stop();
      } catch {
        /* уже остановлен */
      }
      zxingControlsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    detectorRef.current = null;
    setCameraOn(false);
  }

  async function copy(text: string, kind: "barcode" | "slug") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard не доступен */
    }
  }

  // ── Экран «товар не найден» (пришёл notFound-флаг) ──
  if (notFoundMessage) {
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
            placeholder="Введите код (EAN-13 или slug) и нажмите Enter"
            autoFocus
            inputMode="text"
            autoComplete="off"
          />
          <button type="button" className="scan-page__cam-btn" onClick={cameraOn ? stopCamera : startCamera}>
            {cameraOn ? <CameraOff size={18} /> : <Camera size={18} />}
          </button>
        </form>
        {/* <video> смонтирован всегда (скрыт display:none, когда камера
            выкл): иначе ref ещё пуст на момент запуска getUserMedia и
            превью не стартует с первого нажатия. */}
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
            Наведите камеру на QR или штрихкод — сканирует и в Safari
          </p>
        </div>
        {cameraError && (
          <div className="scan-page__err">
            <AlertCircle size={15} /> {cameraError}
          </div>
        )}
        <div className="scan-page__notfound">
          <XCircle size={32} />
          <p>{notFoundMessage}</p>
          <p className="scan-page__hint">
            Проверьте правильность кода. QR генерируется из id товара —
            если вы пересоздавали товар с тем же id, ссылка должна
            сработать.
          </p>
        </div>
      </div>
    );
  }

  // ── Главный экран с товаром или пустой формой поиска ──
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
          placeholder="Введите код или отсканируйте"
          autoFocus={!product}
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
        <button type="submit" className="scan-page__go">
          Найти
        </button>
      </form>

      {/* <video> смонтирован всегда (скрыт display:none, когда камера
          выкл): иначе ref ещё пуст на момент запуска getUserMedia и
          превью не стартует с первого нажатия. */}
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
          Наведите камеру на QR или штрихкод — сканирует и в Safari
        </p>
      </div>

      {cameraError && (
        <div className="scan-page__err">
          <AlertCircle size={15} /> {cameraError}
        </div>
      )}

      {product ? (
        <div className="scan-page__card">
          <div className="scan-page__head">
            <div className="scan-page__thumb">
              {product.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.imageUrl} alt={product.name} />
              ) : (
                <Package size={42} />
              )}
            </div>
            <div className="scan-page__head-main">
              <h2 className="scan-page__name">{product.name}</h2>
              {product.sku && (
                <div className="scan-page__sku">
                  <Hash size={12} /> Артикул: {product.sku}
                </div>
              )}
            </div>
          </div>

          <div className="scan-page__price-row">
            <div className="scan-page__price-main">
              {product.price > 0
                ? `${fmt(product.price)} ₽`
                : "Цена не указана"}
            </div>
            {product.priceWholesale != null &&
              product.priceWholesale > 0 && (
                <div className="scan-page__price-wholesale">
                  опт: {fmt(product.priceWholesale)} ₽
                </div>
              )}
          </div>

          <div
            className={`scan-page__stock scan-page__stock--${product.stockLabel.tone}`}
          >
            {product.stockLabel.tone === "ok" && <CheckCircle2 size={16} />}
            {product.stockLabel.tone === "low" && <AlertCircle size={16} />}
            {product.stockLabel.tone === "out" && <XCircle size={16} />}
            <span>{product.stockLabel.text}</span>
          </div>

          <div className="scan-page__codes">
            <div className="scan-page__code-block">
              <img
                src={`/api/admin/qr/${product.id}?size=180`}
                alt="QR-код"
                className="scan-page__qr"
                width={180}
                height={180}
              />
              <button
                type="button"
                className="scan-page__copy"
                onClick={() => copy(product.qrSlug, "slug")}
                title="Скопировать slug"
              >
                {copied === "slug" ? (
                  <CheckCircle2 size={13} />
                ) : (
                  <Copy size={13} />
                )}
                <span>QR · {product.qrSlug}</span>
              </button>
            </div>
            <div className="scan-page__code-block">
              <img
                src={`/api/admin/qr/barcode/${product.id}`}
                alt="Штрихкод"
                className="scan-page__barcode"
                width={180}
                height={70}
              />
              <button
                type="button"
                className="scan-page__copy"
                onClick={() => copy(product.barcode, "barcode")}
                title="Скопировать штрихкод"
              >
                {copied === "barcode" ? (
                  <CheckCircle2 size={13} />
                ) : (
                  <Copy size={13} />
                )}
                <span>EAN-13 · {formatBarcode(product.barcode)}</span>
              </button>
            </div>
          </div>

          <div className="scan-page__actions">
            <Link
              href={`/${adminPath}/products?edit=${product.id}`}
              className="scan-page__btn scan-page__btn--primary"
            >
              <ExternalLink size={15} /> Открыть в админке
            </Link>
            <Link
              href={`/${adminPath}/products`}
              className="scan-page__btn"
            >
              <Package size={15} /> Все товары
            </Link>
            <button
              type="button"
              className="scan-page__btn"
              onClick={() => {
                setCode("");
                router.push(`/${adminPath}/scan`);
              }}
            >
              <RotateCcw size={15} /> Новый поиск
            </button>
          </div>
        </div>
      ) : null}

      <p className="scan-page__footer-hint">
        Можно вводить <strong>QR-slug</strong>, <strong>EAN-13</strong>,{" "}
        <strong>id</strong> или обычный <strong>slug</strong> товара.
      </p>
    </div>
  );
}
