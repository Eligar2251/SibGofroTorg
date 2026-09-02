// src/components/admin/ReviewsManager.tsx
"use client";

import NextImage from "next/image";
import { useState, useEffect, useCallback } from "react";
import { Eye, Edit2, Trash2, Check, X, Filter, Star, ShieldCheck, AlertTriangle, Loader2, MessageSquare, Image, Download, ChevronRight, ChevronLeft } from "lucide-react";
import { GlyphIcon } from "@/components/ui/Glyph";
import { ModalPortal } from "@/components/admin/ModalPortal";

interface Review {
  id: string;
  productId: string;
  productName?: string;
  userId: string;
  userName: string;
  userAvatar?: string | null;
  orderId: string;
  rating: number;
  title?: string | null;
  text: string;
  pros?: string | null;
  cons?: string | null;
  images?: { url: string; publicId: string }[];
  isVerifiedPurchase: boolean;
  helpfulCount: number;
  isApproved: boolean;
  moderationStatus: "pending" | "approved" | "rejected";
  moderationNote?: string | null;
  createdAt: any;
  updatedAt?: any;
}

interface ReviewStats {
  averageRating: number;
  totalReviews: number;
  distribution: { 5: number; 4: number; 3: number; 2: number; 1: number };
  withPhotos: number;
  withProsCons: number;
}

export function ReviewsManager() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const pageSize = 20;

  const [moderationData, setModerationData] = useState<{
    reviewId: string;
    action: "approve" | "reject";
    note: string;
  } | null>(null);

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(currentPage),
        limit: String(pageSize),
        status: filterStatus,
        search: searchQuery,
      });
      const res = await fetch(`/api/admin/reviews?${params}`);
      const data = await res.json();
      if (res.ok) {
        setReviews(data.reviews);
        setStats(data.stats);
        setTotalPages(data.totalPages || 1);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, [currentPage, filterStatus, searchQuery]);

  useEffect(() => {
    void fetchReviews();
  }, [fetchReviews]);

  // ... rest of the component remains the same

  async function handleModerate(reviewId: string, action: "approve" | "reject", note?: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/reviews/${reviewId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, moderationNote: note }),
      });
      if (res.ok) {
        fetchReviews();
        setModerationData(null);
      }
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  }

  async function handleDelete(reviewId: string) {
    if (!confirm("Удалить отзыв?")) return;
    try {
      const res = await fetch(`/api/admin/reviews/${reviewId}`, { method: "DELETE" });
      if (res.ok) fetchReviews();
    } catch (e) {
      console.error(e);
    }
  }

  async function handleView(reviewId: string) {
    setViewingId(reviewId);
  }

  function startModeration(reviewId: string, action: "approve" | "reject") {
    setModerationData({ reviewId, action, note: "" });
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case "approved":
        return <span className="admin-badge admin-badge--green">Одобрен</span>;
      case "rejected":
        return <span className="admin-badge admin-badge--red">Отклонен</span>;
      default:
        return <span className="admin-badge admin-badge--amber">На модерации</span>;
    }
  }

  function renderStars(rating: number) {
    return (
      <span className="admin-rating-stars" style={{ display: "inline-flex", gap: 2 }}>
        {[1, 2, 3, 4, 5].map(n => (
          <Star key={n} size={14} className={n <= rating ? "filled" : ""} style={{ color: n <= rating ? "var(--adm-kraft)" : "var(--adm-border-mid)" }} />
        ))}
      </span>
    );
  }

  function getDistributionBar(stats: ReviewStats | null, star: number) {
    if (!stats || stats.totalReviews === 0) return 0;
    const count = stats.distribution[star as keyof typeof stats.distribution] || 0;
    return (count / stats.totalReviews) * 100;
  }

  return (
    <div className="admin-stack">
      {/* Stats Summary */}
      {stats && (
        <div className="admin-card" style={{ marginBottom: 24, padding: 20 }}>
          <h3 className="admin-h2" style={{ marginBottom: 16 }}>Статистика отзывов</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "center" }}>
            <div style={{ textAlign: "center", minWidth: 100 }}>
              <div style={{ fontSize: 48, fontWeight: 800, color: "var(--ink)", lineHeight: 1 }}>
                {stats.averageRating.toFixed(1)}
              </div>
              <div style={{ color: "var(--ink-muted)", fontSize: 14 }}>Средний рейтинг</div>
            </div>
            <div style={{ width: 1, height: 60, background: "var(--border)" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 200 }}>
              {[5,4,3,2,1].map(star => (
                <div key={star} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Star size={14} style={{ color: "var(--adm-kraft)" }} />
                  <span style={{ width: 30, textAlign: "right", fontSize: 13 }}>{star}</span>
                  <div style={{ flex: 1, height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
                    <div 
                      style={{ 
                        width: `${getDistributionBar(stats, star)}%`, 
                        height: "100%", 
                        background: star >= 4 ? "var(--adm-pine)" : star === 3 ? "var(--adm-kraft)" : "var(--adm-rust)",
                        borderRadius: 4,
                        transition: "width 0.3s"
                      }} 
                    />
                  </div>
                  <span style={{ width: 50, textAlign: "right", fontSize: 13, color: "var(--ink-muted)" }}>
                    {stats.distribution[star as keyof typeof stats.distribution] || 0}%
                  </span>
                </div>
              ))}
            </div>
            <div style={{ width: 1, height: 60, background: "var(--border)" }} />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--ink)" }}>{stats.totalReviews}</div>
              <div style={{ color: "var(--ink-muted)", fontSize: 13 }}>Всего отзывов</div>
            </div>
            <div style={{ width: 1, height: 60, background: "var(--border)" }} />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--ink)" }}>{stats.withPhotos}</div>
              <div style={{ color: "var(--ink-muted)", fontSize: 13 }}>С фото</div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <p className="admin-sub">
          Управление отзывами покупателей. Всего: <strong style={{ color: "var(--adm-navy)" }}>{stats?.totalReviews || 0}</strong>
        </p>
      </div>

      {/* Filters */}
      <div className="admin-card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
            <Filter size={16} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ink-muted)" }} />
            <input
              type="text"
              className="admin-input"
              placeholder="Поиск по тексту, автору, товару..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              style={{ paddingLeft: 36 }}
            />
          </div>
          
          <select
            className="admin-select"
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value as any); setCurrentPage(1); }}
            style={{ minWidth: 160 }}
          >
            <option value="all">Все статусы</option>
            <option value="pending">На модерации</option>
            <option value="approved">Одобренные</option>
            <option value="rejected">Отклоненные</option>
          </select>
        </div>
      </div>

      {/* Moderation Modal */}
      {moderationData && (
        <ModalPortal>
        <div className="admin-modal-overlay" onClick={() => setModerationData(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <h3 className="admin-h2" style={{ marginBottom: 16 }}>
              {moderationData.action === "approve" ? "Одобрить отзыв?" : "Отклонить отзыв?"}
            </h3>
            <p style={{ color: "var(--ink-muted)", marginBottom: 16 }}>
              {moderationData.action === "approve" 
                ? "Отзыв станет видимым на сайте." 
                : "Отзыв не будет показан покупателям. Укажите причину отклонения."}
            </p>
            {moderationData.action === "reject" && (
              <div className="admin-field">
                <label className="admin-label">Причина отклонения (для модератора)</label>
                <textarea
                  className="admin-input"
                  style={{ minHeight: 80, resize: "vertical" }}
                  value={moderationData.note}
                  onChange={(e) => setModerationData({...moderationData, note: e.target.value})}
                  placeholder="Например: спам, нецензурная лексика, не по теме..."
                />
              </div>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setModerationData(null)} className="admin-btn admin-btn--ghost">Отмена</button>
              <button
                onClick={() => handleModerate(moderationData.reviewId, moderationData.action, moderationData.note)}
                disabled={saving}
                className={`admin-btn ${moderationData.action === "approve" ? "admin-btn--primary" : "admin-btn--danger"}`}
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : (moderationData.action === "approve" ? "Одобрить" : "Отклонить")}
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* View Modal */}
      {viewingId && (
        <ModalPortal>
        <div className="admin-modal-overlay" onClick={() => setViewingId(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 800, maxHeight: "80dvh", overflow: "auto" }}>
            {(() => {
              const r = reviews.find(x => x.id === viewingId);
              if (!r) return null;
              return (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h3 className="admin-h2">Отзыв #{r.id.slice(0,8)}</h3>
                    <button onClick={() => setViewingId(null)} className="admin-modal__close"><X size={20} /></button>
                  </div>
                  <div className="admin-grid-2" style={{ marginBottom: 16 }}>
                    <div>
                      <p style={{ fontWeight: 600, marginBottom: 4 }}>Товар:</p>
                      <p>{r.productName || "—"}</p>
                    </div>
                    <div>
                      <p style={{ fontWeight: 600, marginBottom: 4 }}>Автор:</p>
                      <p>{r.userName} ({r.userId.slice(0,8)}…)</p>
                    </div>
                    <div>
                      <p style={{ fontWeight: 600, marginBottom: 4 }}>Рейтинг:</p>
                      <p>{renderStars(r.rating)} {r.rating}/5</p>
                    </div>
                    <div>
                      <p style={{ fontWeight: 600, marginBottom: 4 }}>Статус:</p>
                      <p>{getStatusBadge(r.moderationStatus)}</p>
                    </div>
                    <div>
                      <p style={{ fontWeight: 600, marginBottom: 4 }}>Дата:</p>
                      <p>{r.createdAt ? new Date(r.createdAt).toLocaleString("ru-RU") : "—"}</p>
                    </div>
                    <div>
                      <p style={{ fontWeight: 600, marginBottom: 4 }}>Верифицированная покупка:</p>
                      <p>
                        {r.isVerifiedPurchase ? (
                          <><GlyphIcon value="ok" size={14} /> Да</>
                        ) : (
                          <><GlyphIcon value="cancel" size={14} /> Нет</>
                        )}
                      </p>
                    </div>
                  </div>
                  {r.title && (
                    <div style={{ marginBottom: 12 }}>
                      <p style={{ fontWeight: 600, marginBottom: 4 }}>Заголовок:</p>
                      <p>{r.title}</p>
                    </div>
                  )}
                  <div style={{ marginBottom: 12 }}>
                    <p style={{ fontWeight: 600, marginBottom: 4 }}>Текст отзыва:</p>
                    <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{r.text}</p>
                  </div>
                  {r.pros && (
                    <div style={{ marginBottom: 8, padding: 12, background: "var(--adm-pine-pale)", borderRadius: 8, border: "1px solid var(--adm-pine-line)" }}>
                      <p style={{ fontWeight: 600, color: "var(--adm-pine)", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}><GlyphIcon value="ok" size={14} /> Достоинства:</p>
                      <p style={{ color: "var(--adm-pine)" }}>{r.pros}</p>
                    </div>
                  )}
                  {r.cons && (
                    <div style={{ marginBottom: 8, padding: 12, background: "var(--adm-rust-pale)", borderRadius: 8, border: "1px solid var(--adm-rust-line)" }}>
                      <p style={{ fontWeight: 600, color: "var(--adm-rust)", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}><GlyphIcon value="cancel" size={14} /> Недостатки:</p>
                      <p style={{ color: "var(--adm-rust)" }}>{r.cons}</p>
                    </div>
                  )}
                  {r.images && r.images.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <p style={{ fontWeight: 600, marginBottom: 8 }}>Фото ({r.images.length}):</p>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {r.images.map((img, i) => (
                          <NextImage key={i} src={img.url} alt="" width={100} height={100} sizes="100px" style={{ width: 100, height: 100, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }} />
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                    {r.moderationStatus === "pending" && (
                      <>
                        <button onClick={() => { setViewingId(null); startModeration(r.id, "approve"); }} className="admin-btn admin-btn--primary">Одобрить</button>
                        <button onClick={() => { setViewingId(null); startModeration(r.id, "reject"); }} className="admin-btn admin-btn--danger">Отклонить</button>
                      </>
                    )}
                    <button onClick={() => handleDelete(r.id)} className="admin-btn admin-btn--ghost">Удалить</button>
                    <button onClick={() => setViewingId(null)} className="admin-btn admin-btn--ghost">Закрыть</button>
                  </div>
                </>
            )})()}
          </div>
        </div>
        </ModalPortal>
      )}

      {/* Reviews Table */}
      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>ID</th>
                <th>Товар</th>
                <th>Автор</th>
                <th style={{ width: 100 }}>Рейтинг</th>
                <th style={{ width: 140 }}>Статус</th>
                <th style={{ width: 160 }}>Дата</th>
                <th style={{ width: 100 }}>Покупка</th>
                <th style={{ width: 180, textAlign: "right" }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="admin-table__empty">Загрузка...</td></tr>
              ) : reviews.length === 0 ? (
                <tr><td colSpan={8} className="admin-table__empty">Отзывы не найдены</td></tr>
              ) : (
                reviews.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.id.slice(0,10)}…</td>
                    <td>
                      <div style={{ fontWeight: 600, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.productName || "Товар не найден"}
                      </div>
                    </td>
                    <td>{r.userName} <span className="admin-muted">({r.userId.slice(0,8)}…)</span></td>
                    <td>
                      <span className="admin-rating-stars" style={{ display: "inline-flex", gap: 2 }}>
                        {[1,2,3,4,5].map(n => (
                          <Star key={n} size={14} className={n <= r.rating ? "filled" : ""} style={{ color: n <= r.rating ? "var(--adm-kraft)" : "var(--adm-border-mid)" }} />
                        ))}
                      </span>
                      <span className="admin-muted" style={{ marginLeft: 4 }}>{r.rating}/5</span>
                    </td>
                    <td>{getStatusBadge(r.moderationStatus)}</td>
                    <td className="admin-muted" style={{ fontSize: 13 }}>
                      {r.createdAt ? new Date(r.createdAt).toLocaleString("ru-RU") : "—"}
                    </td>
                    <td>
                      {r.isVerifiedPurchase ? (
                        <span className="admin-badge admin-badge--green" style={{ fontSize: 11 }}><GlyphIcon value="ok" size={11} /> Верифицировано</span>
                      ) : (
                        <span className="admin-badge admin-badge--amber" style={{ fontSize: 11 }}><GlyphIcon value="warning" size={11} /> Не верифицировано</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div className="admin-actions" style={{ justifyContent: "flex-end", gap: 6 }}>
                        <button
                          onClick={() => handleView(r.id)}
                          className="admin-btn admin-btn--icon"
                          title="Просмотр"
                        >
                          <Eye size={14} />
                        </button>
                        {r.moderationStatus === "pending" && (
                          <>
                            <button
                              onClick={() => startModeration(r.id, "approve")}
                              className="admin-btn admin-btn--icon"
                              title="Одобрить"
                              style={{ color: "var(--adm-pine)" }}
                            >
                              <Check size={14} />
                            </button>
                            <button
                              onClick={() => startModeration(r.id, "reject")}
                              className="admin-btn admin-btn--icon"
                              title="Отклонить"
                              style={{ color: "var(--adm-rust)" }}
                            >
                              <X size={14} />
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleDelete(r.id)}
                          className="admin-btn admin-btn--icon"
                          title="Удалить"
                        >
                          <Trash2 size={14} style={{ color: "var(--adm-rust)" }} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1 || loading}
              className="admin-btn admin-btn--icon"
            >
              <ChevronLeft size={16} />
            </button>
            <span style={{ padding: "0 16px", color: "var(--ink-muted)" }}>
              Страница {currentPage} из {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages || loading}
              className="admin-btn admin-btn--icon"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}