// =========================================================
// FILE: src/components/home/DealsRow.tsx
// =========================================================
// Акции и спецпредложения — всегда в одну строку.
// Если карточек больше 4 (ряд не помещается), появляются
// стрелки «влево/вправо» с плавной прокруткой. Без переноса строк.

"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function DealsRow({ children }: { children: ReactNode }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const update = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 2);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    update();
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [update]);

  function scrollStep(dir: 1 | -1) {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({
      left: dir * Math.max(280, el.clientWidth * 0.75),
      behavior: "smooth",
    });
  }

  /* Стрелки только если ряд реально не помещается */
  const needsArrows = canPrev || canNext;

  return (
    <div className={`deals-row${needsArrows ? " deals-row--scrollable" : ""}`}>
      <div className="deals-track" ref={trackRef}>
        {children}
      </div>

      {needsArrows && (
        <>
          <button
            type="button"
            className="deals-arrow deals-arrow--prev"
            onClick={() => scrollStep(-1)}
            disabled={!canPrev}
            aria-label="Предыдущие предложения"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            className="deals-arrow deals-arrow--next"
            onClick={() => scrollStep(1)}
            disabled={!canNext}
            aria-label="Следующие предложения"
          >
            <ChevronRight size={20} />
          </button>
        </>
      )}
    </div>
  );
}
