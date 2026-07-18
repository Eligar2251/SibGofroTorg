"use client";

import React, { useState } from "react";
import { ThumbsUp } from "lucide-react";

interface ReviewHelpfulButtonProps {
  productId: string;
  reviewId: string;
  initialCount: number;
}

const VID_KEY = "sgt_vid";
const VOTED_PREFIX = "sgt_helpful_";

/** ID анонимного посетителя (как у трекера просмотров) */
function getVisitorId(): string | null {
  try {
    let sid = localStorage.getItem(VID_KEY);
    if (!sid) {
      sid =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(VID_KEY, sid);
    }
    return sid;
  } catch {
    return null; /* приватный режим и т.п. */
  }
}

function getVotedLocal(reviewId: string): boolean {
  try {
    return localStorage.getItem(VOTED_PREFIX + reviewId) === "1";
  } catch {
    return false;
  }
}

function setVotedLocal(reviewId: string) {
  try {
    localStorage.setItem(VOTED_PREFIX + reviewId, "1");
  } catch {}
}

/**
 * Кнопка «Полезно» у отзыва.
 * Один голос от одного уникального посетителя: сервер дедуплицирует
 * по uid (авторизован) или по ID анонимного посетителя из localStorage,
 * клиент дополнительно запоминает голос, чтобы кнопка была неактивна.
 */
export function ReviewHelpfulButton({
  productId,
  reviewId,
  initialCount,
}: ReviewHelpfulButtonProps) {
  const [count, setCount] = useState(initialCount);
  const [voted, setVoted] = useState(() => getVotedLocal(reviewId));
  const [loading, setLoading] = useState(false);

  async function handleVote() {
    if (voted || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/products/${productId}/reviews`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId, vid: getVisitorId() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        helpfulCount?: number;
        already?: boolean;
      };
      if (res.ok) {
        if (typeof body.helpfulCount === "number") setCount(body.helpfulCount);
        setVoted(true);
        setVotedLocal(reviewId);
      }
    } catch {
      /* тихо игнорируем — кнопка не критична */
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      className={`review-helpful${voted ? " review-helpful--done" : ""}`}
      onClick={handleVote}
      disabled={voted || loading}
      aria-pressed={voted}
      title={voted ? "Вы уже отметили этот отзыв" : "Отзыв полезен"}
    >
      <ThumbsUp size={13} />
      Полезно{count > 0 ? ` (${count})` : ""}
    </button>
  );
}
