// =========================================================
// FILE: src/components/admin/ScanCode.tsx
// Клиентский компонент для страницы сканера /admin/scan/[code].
//
// Что умеет:
// 1) Показывать карточку товара: название, цена (с оптовой), наличие,
//    артикул, QR + штрихкод. Кнопки: «Открыть в админке»,
//    «Скопировать код», «Новый поиск».
// 2) Поле ручного ввода + Enter → переход на /admin/scan/{code}.
// 3) Кнопка камеры (только https / localhost) — getUserMedia +
//    BarcodeDetector API (если браузер поддерживает), иначе
//    ручной ввод. Распознанный код автоматически подставляется
//    в поле «код» и пользователь нажимает Enter.
//
// UI оптимизирован под мобильный: крупные кнопки, мало текста.
// =========================================================

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setCameraError("Камера недоступна в этом браузере. Введите код вручную.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);

      // BarcodeDetector (Chrome/Edge/Android, не Safari/Firefox).
      // Если есть — запускаем периодическое распознавание.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const BD = (window as any).BarcodeDetector;
      if (BD && typeof BD === "function") {
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
      } else {
        setCameraError(
          "Этот браузер не поддерживает автораспознавание кодов — введите код вручную."
        );
      }
    } catch (err: any) {
      setCameraError(
        err?.message ||
          "Не удалось включить камеру. Проверьте разрешения и попробуйте снова."
      );
      stopCamera();
    }
  }

  function stopCamera() {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
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
        {cameraOn && (
          <div className="scan-page__video-wrap">
            <video
              ref={videoRef}
              className="scan-page__video"
              playsInline
              muted
            />
            <p className="scan-page__video-hint">
              Наведите камеру на QR или штрихкод
            </p>
          </div>
        )}
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

      {cameraOn && (
        <div className="scan-page__video-wrap">
          <video
            ref={videoRef}
            className="scan-page__video"
            playsInline
            muted
          />
          <p className="scan-page__video-hint">
            Наведите камеру на QR или штрихкод
          </p>
        </div>
      )}

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
