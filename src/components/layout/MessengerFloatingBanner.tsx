"use client";

import {
  useEffect,
  useLayoutEffect,
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
  MessageCircle,
} from "lucide-react";
import { useSiteSettings } from "@/hooks/use-site-settings";

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type CollapsedSide = "left" | "right" | null;

const STORAGE_KEY = "messenger-floating-banner-position-v2";

function safeMessengerUrl(raw: string): string | null {
  const value = String(raw || "").trim();
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function cornerCoordinates(
  corner: Corner,
  width: number,
  height: number
): { x: number; y: number } {
  const horizontalGap = window.innerWidth <= 640 ? 8 : 14;
  const topGap = window.innerWidth <= 640 ? 72 : 18;
  const bottomGap = window.innerWidth <= 640 ? 72 : 24;
  return {
    x: corner.endsWith("left")
      ? horizontalGap
      : Math.max(horizontalGap, window.innerWidth - width - horizontalGap),
    y: corner.startsWith("top")
      ? topGap
      : Math.max(topGap, window.innerHeight - height - bottomGap),
  };
}

function nearestCorner(rect: DOMRect): Corner {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const horizontal = centerX < window.innerWidth / 2 ? "left" : "right";
  const vertical = centerY < window.innerHeight / 2 ? "top" : "bottom";
  return `${vertical}-${horizontal}` as Corner;
}

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
  const [corner, setCorner] = useState<Corner>("bottom-right");
  const [collapsedSide, setCollapsedSide] = useState<CollapsedSide>(null);
  const [dragging, setDragging] = useState(false);
  const bannerRef = useRef<HTMLElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    width: number;
    height: number;
    nextDx: number;
    nextDy: number;
  } | null>(null);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (
        saved?.corner === "top-left" ||
        saved?.corner === "top-right" ||
        saved?.corner === "bottom-left" ||
        saved?.corner === "bottom-right"
      ) {
        setCorner(saved.corner);
      }
      if (saved?.collapsedSide === "left" || saved?.collapsedSide === "right") {
        setCollapsedSide(saved.collapsedSide);
      }
    } catch {
      // Повреждённая настройка не должна скрывать баннер.
    }
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  useLayoutEffect(() => {
    if (!dragging && bannerRef.current) {
      bannerRef.current.style.transform = "";
    }
  }, [corner, dragging]);

  const channels = [
    { id: "telegram", label: "Telegram", short: "TG", ...messengerBanner.telegram },
    { id: "whatsapp", label: "WhatsApp", short: "WA", ...messengerBanner.whatsapp },
    { id: "max", label: "MAX", short: "MAX", ...messengerBanner.max },
  ].map((channel) => ({ ...channel, href: safeMessengerUrl(channel.url) }));

  function persist(nextCorner: Corner, side: CollapsedSide) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ corner: nextCorner, collapsedSide: side })
      );
    } catch {
      // localStorage может быть недоступен в приватном режиме.
    }
  }

  function collapse(side?: Exclude<CollapsedSide, null>) {
    const target = side || (corner.endsWith("left") ? "left" : "right");
    setCollapsedSide(target);
    persist(corner, target);
  }

  function expand() {
    setCollapsedSide(null);
    persist(corner, null);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    // Иконки мессенджеров и кнопка скрытия остаются обычными кликабельными зонами.
    if (target.closest("a, button")) return;
    const node = bannerRef.current;
    if (!node) return;
    event.preventDefault();
    const rect = node.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      width: rect.width,
      height: rect.height,
      nextDx: 0,
      nextDy: 0,
    };
    node.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    const node = bannerRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !node) return;
    event.preventDefault();

    const gap = 6;
    const desiredX = Math.max(
      gap,
      Math.min(
        drag.originX + event.clientX - drag.startX,
        window.innerWidth - drag.width - gap
      )
    );
    const desiredY = Math.max(
      gap,
      Math.min(
        drag.originY + event.clientY - drag.startY,
        window.innerHeight - drag.height - gap
      )
    );
    drag.nextDx = desiredX - drag.originX;
    drag.nextDy = desiredY - drag.originY;

    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const current = dragRef.current;
      if (!current || !bannerRef.current) return;
      // Только compositor transform: без React setState и layout на каждом кадре.
      bannerRef.current.style.transform = `translate3d(${current.nextDx}px, ${current.nextDy}px, 0)`;
    });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    const node = bannerRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !node) return;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    node.style.transform = `translate3d(${drag.nextDx}px, ${drag.nextDy}px, 0)`;
    const rect = node.getBoundingClientRect();
    const nextCorner = nearestCorner(rect);
    const horizontalMove = event.clientX - drag.startX;
    dragRef.current = null;
    setDragging(false);
    setCorner(nextCorner);
    if (rect.left <= 8 && horizontalMove < -24) {
      setCollapsedSide("left");
      persist(nextCorner, "left");
      return;
    }
    if (window.innerWidth - rect.right <= 8 && horizontalMove > 24) {
      setCollapsedSide("right");
      persist(nextCorner, "right");
      return;
    }
    persist(nextCorner, null);
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
    const atTop = corner.startsWith("top");
    return createPortal(
      <button
        type="button"
        className={`messenger-float-tab messenger-float-tab--${collapsedSide}`}
        style={{
          position: "fixed",
          zIndex: 850,
          top: atTop ? (window.innerWidth <= 640 ? 76 : 18) : "auto",
          bottom: atTop ? "auto" : window.innerWidth <= 640 ? 76 : 24,
          [collapsedSide]: 0,
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "10px 7px",
          color: "#fff",
          background: messengerBanner.color,
          border: 0,
          borderRadius:
            collapsedSide === "left" ? "0 12px 12px 0" : "12px 0 0 12px",
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

  const topCorner = corner.startsWith("top");
  const leftCorner = corner.endsWith("left");
  const bannerPosition: CSSProperties = {
    position: "fixed",
    zIndex: 850,
    top: topCorner ? (window.innerWidth <= 640 ? 72 : 18) : "auto",
    bottom: topCorner ? "auto" : window.innerWidth <= 640 ? 72 : 24,
    left: leftCorner ? (window.innerWidth <= 640 ? 8 : 14) : "auto",
    right: leftCorner ? "auto" : window.innerWidth <= 640 ? 8 : 14,
    display: "flex",
    alignItems: "center",
    gap: 9,
    maxWidth: "calc(100vw - 16px)",
    padding: "8px 9px",
    color: "#fff",
    background: messengerBanner.color,
    border: "1px solid rgba(255,255,255,.18)",
    borderRadius: 999,
    boxShadow: "0 8px 28px rgba(17,29,52,.24)",
    willChange: "transform",
    touchAction: "none",
  };

  return createPortal(
    <aside
      ref={bannerRef}
      className={`messenger-float${dragging ? " messenger-float--dragging" : ""}`}
      style={bannerPosition}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      aria-label="Мы есть в мессенджерах"
      title="Перетащите баннер в нужный угол"
    >
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
        title="Скрыть к краю"
      >
        {leftCorner ? <ChevronsLeft size={15} /> : <ChevronsRight size={15} />}
      </button>
    </aside>,
    document.body
  );
}
