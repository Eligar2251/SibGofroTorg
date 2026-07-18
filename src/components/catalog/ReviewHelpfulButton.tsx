"use client";

import React, { useState } from "react";
import { ThumbsUp } from "lucide-react";

interface ReviewHelpfulButtonProps {
  productId: string;
  reviewId: string;
  initialCount: number;
}

/** Кнопка «Полезно» у отзыва — инкремент через PATCH API, блокируется после голоса. */
export function ReviewHelpfulButton({
  productId,
  reviewId,
  initialCount,
}: ReviewHelpfulButtonProps) {
  const [count, setCount] = useState(initialCount);
  const [voted, setVoted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleVote() {
    if (voted || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/products/${productId}/reviews`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        helpfulCount?: number;
      };
      setCount(
        typeof body.helpfulCount === "number" ? body.helpfulCount : count + 1
      );
      setVoted(true);
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
    >
      <ThumbsUp size={13} />
      Полезно{count > 0 ? ` (${count})` : ""}
    </button>
  );
}
