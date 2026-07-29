"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  GripVertical,
  MessageCircle,
} from "lucide-react";
import { useSiteSettings } from "@/hooks/use-site-settings";

type Point = { x: number; y: number };
type CollapsedSide = "left" | "right" | null;

const STORAGE_KEY = "messenger-floating-banner-position-v1";

function safeMessengerUrl(raw: string): string | null {
  const value = String(raw || "").trim();
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function clampPoint(point: Point, width: number, height: number): Point {
  const gap = 8;
  return {
    x: Math.max(gap, Math.min(point.x, window.innerWidth - width - gap)),
    y: Math.max(gap, Math.min(point.y, window.innerHeight - height - gap)),
  };
}

// Критическая геометрия продублирована inline: баннер остаётся плавающим
// даже при старом CSS в браузерном/CDN-кеше. Классы отвечают за hover,
// drag-состояние и мобильную донастройку.
const bannerStyle: CSSProperties = {
  position: "fixed",
  zIndex: 850,
  right: 14,
  bottom: 24,
  display: "flex",
  alignItems: "center",
  gap: 10,
  maxWidth: "calc(100vw - 28px)",
  padding: "8px 9px",
  color: "#fff",
  background: "rgba(27, 43, 75, 0.96)",
  border: "1px solid rgba(255,255,255,.18)",
  borderRadius: 999,
  boxShadow: "0 8px 28px rgba(17,29,52,.24)",
};
const linksStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
};
const linkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 38,
  height: 38,
  flex: "0 0 38px",
  overflow: "hidden",
  color: "#1b2b4b",
  background: "#fff",
  border: "2px solid rgba(255,255,255,.9)",
  borderRadius: "50%",
  boxShadow: "0 2px 8px rgba(0,0,0,.16)",
  textDecoration: "none",
};
const imageStyle: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

export function MessengerFloatingBanner() {
  const { messengerBanner, ready } = useSiteSettings();
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<Point | null>(null);
  const [collapsedSide, setCollapsedSide] = useState<CollapsedSide>(null);
  const [dragging, setDragging] = useState(false);
  const bannerRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        setPosition({ x: Number(saved.x), y: Number(saved.y) });
      }
      if (saved?.collapsedSide === "left" || saved?.collapsedSide === "right") {
        setCollapsedSide(saved.collapsedSide);
      }
    } catch {
      // Повреждённая локальная настройка не должна скрывать баннер.
    }
  }, []);

  useEffect(() => {
    if (!mounted || collapsedSide) return;
    const keepInsideViewport = () => {
      const node = bannerRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      setPosition((current) =>
        current ? clampPoint(current, rect.width, rect.height) : current
      );
    };
    keepInsideViewport();
    window.addEventListener("resize", keepInsideViewport);
    return () => window.removeEventListener("resize", keepInsideViewport);
  }, [collapsedSide, mounted]);

  const channels = [
    {
      id: "telegram",
      label: "Telegram",
      short: "TG",
      ...messengerBanner.telegram,
    },
    {
      id: "whatsapp",
      label: "WhatsApp",
      short: "WA",
      ...messengerBanner.whatsapp,
    },
    {
      id: "max",
      label: "MAX",
      short: "MAX",
      ...messengerBanner.max,
    },
  ].map((channel) => ({ ...channel, href: safeMessengerUrl(channel.url) }));

  function savePosition(nextPosition: Point, side: CollapsedSide) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...nextPosition, collapsedSide: side })
      );
    } catch {
      // localStorage может быть недоступен в приватном режиме.
    }
  }

  function collapse(side?: Exclude<CollapsedSide, null>) {
    const node = bannerRef.current;
    const rect = node?.getBoundingClientRect();
    const current = rect
      ? { x: rect.left, y: rect.top }
      : position || { x: 8, y: Math.max(8, window.innerHeight * 0.65) };
    const targetSide =
      side || (current.x + (rect?.width || 0) / 2 < window.innerWidth / 2 ? "left" : "right");
    setPosition(current);
    setCollapsedSide(targetSide);
    savePosition(current, targetSide);
  }

  function expand() {
    const side = collapsedSide;
    const y = position?.y ?? Math.max(8, window.innerHeight * 0.65);
    const estimatedWidth = Math.min(300, window.innerWidth - 16);
    const next = {
      x: side === "left" ? 8 : Math.max(8, window.innerWidth - estimatedWidth - 8),
      y,
    };
    setCollapsedSide(null);
    setPosition(next);
    savePosition(next, null);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const node = bannerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const origin = { x: rect.left, y: rect.top };
    setPosition(origin);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: origin.x,
      originY: origin.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    const node = bannerRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !node) return;
    const rect = node.getBoundingClientRect();
    setPosition(
      clampPoint(
        {
          x: drag.originX + event.clientX - drag.startX,
          y: drag.originY + event.clientY - drag.startY,
        },
        rect.width,
        rect.height
      )
    );
  }

  function onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    const node = bannerRef.current;
    const rect = node?.getBoundingClientRect();
    if (!rect) return;
    const next = { x: rect.left, y: rect.top };
    const horizontalMove = event.clientX - drag.startX;
    const edgeDistance = 12;
    if (rect.left <= edgeDistance && horizontalMove < -20) {
      collapse("left");
      return;
    }
    if (window.innerWidth - rect.right <= edgeDistance && horizontalMove > 20) {
      collapse("right");
      return;
    }
    setPosition(next);
    savePosition(next, null);
  }

  if (
    !mounted ||
    !ready ||
    !messengerBanner.enabled ||
    !channels.some((channel) => channel.href)
  ) {
    return null;
  }

  if (collapsedSide) {
    const top = Math.max(
      8,
      Math.min(position?.y ?? window.innerHeight * 0.65, window.innerHeight - 56)
    );
    return createPortal(
      <button
        type="button"
        className={`messenger-float-tab messenger-float-tab--${collapsedSide}`}
        style={{
          position: "fixed",
          zIndex: 850,
          top,
          [collapsedSide]: 0,
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "10px 7px",
          color: "#fff",
          background: "#d97706",
          border: 0,
          borderRadius: collapsedSide === "left" ? "0 12px 12px 0" : "12px 0 0 12px",
          boxShadow: "0 4px 16px rgba(0,0,0,.22)",
          cursor: "pointer",
        }}
        onClick={expand}
        aria-label="Показать мессенджеры"
        title="Показать мессенджеры"
      >
        {collapsedSide === "right" && <ChevronLeft size={15} />}
        <MessageCircle size={18} />
        {collapsedSide === "left" && <ChevronRight size={15} />}
      </button>,
      document.body
    );
  }

  const positionedStyle: CSSProperties = position
    ? { ...bannerStyle, left: position.x, top: position.y, right: "auto", bottom: "auto" }
    : {
        ...bannerStyle,
        right: window.innerWidth <= 640 ? 8 : 14,
        bottom: window.innerWidth <= 640 ? 72 : 24,
      };

  return createPortal(
    <aside
      ref={bannerRef}
      className={`messenger-float${dragging ? " messenger-float--dragging" : ""}`}
      style={positionedStyle}
      aria-label="Мы есть в мессенджерах"
    >
      <button
        type="button"
        className="messenger-float__drag"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label="Перетащить баннер"
        title="Перетащить баннер"
      >
        <GripVertical size={15} />
      </button>
      <span
        className="messenger-float__text"
        style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.2 }}
      >
        {messengerBanner.text || "Мы есть в мессенджерах"}
      </span>
      <div className="messenger-float__links" style={linksStyle}>
        {channels.map((channel) => {
          const content = channel.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={channel.iconUrl} alt="" style={imageStyle} />
          ) : (
            <span>{channel.short}</span>
          );

          return channel.href ? (
            <a
              key={channel.id}
              href={channel.href}
              target="_blank"
              rel="noopener noreferrer"
              className={`messenger-float__link messenger-float__link--${channel.id}`}
              style={linkStyle}
              aria-label={`Открыть чат в ${channel.label}`}
              title={channel.label}
            >
              {content}
            </a>
          ) : (
            <span
              key={channel.id}
              className="messenger-float__link messenger-float__link--disabled"
              style={{ ...linkStyle, opacity: 0.38, filter: "grayscale(1)" }}
              aria-label={`${channel.label}: ссылка не настроена`}
              title={`${channel.label}: ссылка не настроена`}
            >
              {content}
            </span>
          );
        })}
      </div>
      <button
        type="button"
        className="messenger-float__collapse"
        onClick={() => collapse()}
        aria-label="Скрыть баннер к краю"
        title="Скрыть к ближайшему краю"
      >
        {position && position.x < window.innerWidth / 2 ? (
          <ChevronsLeft size={15} />
        ) : (
          <ChevronsRight size={15} />
        )}
      </button>
    </aside>,
    document.body
  );
}
