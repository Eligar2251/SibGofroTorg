// src/components/admin/QuestionsManager.tsx
"use client";

import { useState, useEffect } from "react";
import { Eye, Edit2, Trash2, Check, X, Filter, MessageSquare, Loader2, ChevronRight, ChevronLeft, Mail, Send, ShieldCheck, AlertTriangle } from "lucide-react";

interface Question {
  id: string;
  productId: string;
  productName?: string;
  userId: string;
  userName: string;
  userAvatar?: string | null;
  question: string;
  answer?: string | null;
  answerAuthor?: string | null;
  answeredAt?: any;
  isAnswered: boolean;
  helpfulCount: number;
  isApproved: boolean;
  moderationStatus: "pending" | "approved" | "rejected";
  createdAt: any;
  updatedAt?: any;
}

interface Product {
  id: string;
  name: string;
}

export function QuestionsManager() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [filterAnswered, setFilterAnswered] = useState<"all" | "answered" | "unanswered">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const pageSize = 20;

  const [answerData, setAnswerData] = useState<{
    questionId: string;
    answer: string;
    answerAuthor: "seller" | "admin";
  } | null>(null);

  async function fetchQuestions() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(currentPage),
        limit: String(pageSize),
        status: filterStatus,
        answered: filterAnswered,
        search: searchQuery,
      });
      // Use first product for now - in real app you'd have a product selector
      const productId = products[0]?.id || "";
      if (!productId) {
        setQuestions([]);
        setTotalPages(1);
        return;
      }
      const res = await fetch(`/api/admin/questions?productId=${productId}&${params}`);
      const data = await res.json();
      if (res.ok) {
        setQuestions(data.questions);
        setTotalPages(data.totalPages);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  async function fetchProducts() {
    try {
      const res = await fetch("/api/admin/products?limit=1000");
      const data = await res.json();
      if (res.ok) {
        setProducts(data.products);
        if (data.products.length > 0) {
          fetchQuestions();
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    fetchProducts();
  }, []);

  useEffect(() => {
    if (products.length > 0) {
      fetchQuestions();
    }
  }, [currentPage, filterStatus, filterAnswered, searchQuery, products.length]);

  async function handleAnswer(questionId: string, answer: string, answerAuthor: "seller" | "admin") {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/questions/${questionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "answer", answer, answerAuthor }),
      });
      if (res.ok) {
        fetchQuestions();
        setAnswerData(null);
      }
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  }

  async function handleModerate(questionId: string, action: "approve" | "reject") {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/questions/${questionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) fetchQuestions();
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  }

  async function handleDelete(questionId: string) {
    if (!confirm("Удалить вопрос?")) return;
    try {
      const res = await fetch(`/api/admin/questions/${questionId}`, { method: "DELETE" });
      if (res.ok) fetchQuestions();
    } catch (e) {
      console.error(e);
    }
  }

  async function handleView(questionId: string) {
    setViewingId(questionId);
  }

  function startAnswer(questionId: string) {
    setAnswerData({ questionId, answer: "", answerAuthor: "seller" });
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

  function getAnsweredBadge(isAnswered: boolean) {
    return isAnswered 
      ? <span className="admin-badge admin-badge--green" style={{ fontSize: 11 }}>Отвечен</span>
      : <span className="admin-badge admin-badge--amber" style={{ fontSize: 11 }}>Ожидает ответа</span>;
  }

  return (
    <div className="admin-stack">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <p className="admin-sub">
          Управление вопросами покупателей. Всего: <strong style={{ color: "var(--adm-navy)" }}>{questions.length} на странице</strong>
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
              placeholder="Поиск по вопросу, автору, товару..."
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

          <select
            className="admin-select"
            value={filterAnswered}
            onChange={(e) => { setFilterAnswered(e.target.value as any); setCurrentPage(1); }}
            style={{ minWidth: 180 }}
          >
            <option value="all">Все вопросы</option>
            <option value="answered">Отвеченные</option>
            <option value="unanswered">Ожидают ответа</option>
          </select>
        </div>
      </div>

      {/* Answer Modal */}
      {answerData && (
        <div className="admin-modal-overlay" onClick={() => setAnswerData(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <h3 className="admin-h2" style={{ marginBottom: 16 }}>Ответить на вопрос</h3>
            <textarea
              className="admin-input"
              style={{ minHeight: 120, resize: "vertical" }}
              value={answerData.answer}
              onChange={(e) => setAnswerData({...answerData, answer: e.target.value})}
              placeholder="Напишите ответ покупателю..."
            />
            <div className="admin-field" style={{ marginTop: 12 }}>
              <label className="admin-label">От имени кого отвечаем?</label>
              <select
                className="admin-select"
                value={answerData.answerAuthor}
                onChange={(e) => setAnswerData({...answerData, answerAuthor: e.target.value as "seller" | "admin"})}
              >
                <option value="seller">Продавец</option>
                <option value="admin">Администратор</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setAnswerData(null)} className="admin-btn admin-btn--ghost">Отмена</button>
              <button
                onClick={() => handleAnswer(answerData.questionId, answerData.answer, answerData.answerAuthor)}
                disabled={saving || !answerData.answer.trim()}
                className="admin-btn admin-btn--primary"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : "Отправить ответ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View/Answer Modal */}
      {viewingId && (
        <div className="admin-modal-overlay" onClick={() => setViewingId(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 800, maxHeight: "80vh", overflow: "auto" }}>
            {(() => {
              const q = questions.find(x => x.id === viewingId);
              if (!q) return null;
              return (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h3 className="admin-h2">Вопрос #{q.id.slice(0,8)}</h3>
                    <button onClick={() => setViewingId(null)} className="admin-modal__close"><X size={20} /></button>
                  </div>
                  <div className="admin-grid-2" style={{ marginBottom: 16 }}>
                    <div>
                      <p style={{ fontWeight: 600, marginBottom: 4 }}>Товар:</p>
                      <p>{q.productName || "—"}</p>
                    </div>
                    <div>
                      <p style={{ fontWeight: 600, marginBottom: 4 }}>Автор:</p>
                      <p>{q.userName} ({q.userId.slice(0,8)}…)</p>
                    </div>
                    <div>
                      <p style={{ fontWeight: 600, marginBottom: 4 }}>Статус:</p>
                      <p>{(() => {
                        switch (q.moderationStatus) {
                          case "approved": return <span className="admin-badge admin-badge--green">Одобрен</span>;
                          case "rejected": return <span className="admin-badge admin-badge--red">Отклонен</span>;
                          default: return <span className="admin-badge admin-badge--amber">На модерации</span>;
                        }
                      })()}</p>
                    </div>
                    <div>
                      <p style={{ fontWeight: 600, marginBottom: 4 }}>Ответ:</p>
                      <p>{getAnsweredBadge(q.isAnswered)}</p>
                    </div>
                    <div>
                      <p style={{ fontWeight: 600, marginBottom: 4 }}>Дата:</p>
                      <p>{q.createdAt ? new Date(q.createdAt).toLocaleString("ru-RU") : "—"}</p>
                    </div>
                  </div>
                  <div style={{ marginBottom: 16, padding: 16, background: "var(--bg-main)", borderRadius: 8, border: "1px solid var(--border)" }}>
                    <p style={{ fontWeight: 600, marginBottom: 8 }}>Вопрос:</p>
                    <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{q.question}</p>
                  </div>
                  {q.answer && (
                    <div style={{ marginBottom: 16, padding: 16, background: "#f0fdf4", borderRadius: 8, border: "1px solid #bbf7d0" }}>
                      <p style={{ fontWeight: 600, color: "#15803d", marginBottom: 8 }}>
                        Ответ ({q.answerAuthor === "seller" ? "от продавца" : "от администратора"}) 
                        {q.answeredAt ? `• ${new Date(q.answeredAt).toLocaleString("ru-RU")}` : ""}:
                      </p>
                      <p style={{ color: "#15803d", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{q.answer}</p>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                    {!q.isAnswered && (
                      <button onClick={() => { setViewingId(null); startAnswer(q.id); }} className="admin-btn admin-btn--primary">
                        <Mail size={14} style={{ marginRight: 6 }} /> Ответить
                      </button>
                    )}
                    {q.moderationStatus === "pending" && (
                      <>
                        <button onClick={() => { setViewingId(null); handleModerate(q.id, "approve"); }} className="admin-btn admin-btn--primary" disabled={saving}>
                          <Check size={14} style={{ marginRight: 4 }} /> Одобрить
                        </button>
                        <button onClick={() => { setViewingId(null); handleModerate(q.id, "reject"); }} className="admin-btn admin-btn--danger" disabled={saving}>
                          <X size={14} style={{ marginRight: 4 }} /> Отклонить
                        </button>
                      </>
                    )}
                    <button onClick={() => handleDelete(q.id)} className="admin-btn admin-btn--ghost">Удалить</button>
                    <button onClick={() => setViewingId(null)} className="admin-btn admin-btn--ghost">Закрыть</button>
                  </div>
                </>
              )})()}
          </div>
        </div>
      )}

      {/* Questions Table */}
      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>ID</th>
                <th>Товар</th>
                <th>Автор</th>
                <th style={{ width: 300 }}>Вопрос</th>
                <th style={{ width: 140 }}>Статус</th>
                <th style={{ width: 120 }}>Ответ</th>
                <th style={{ width: 160 }}>Дата</th>
                <th style={{ width: 180, textAlign: "right" }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="admin-table__empty">Загрузка...</td></tr>
              ) : questions.length === 0 ? (
                <tr><td colSpan={8} className="admin-table__empty">Вопросы не найдены</td></tr>
              ) : (
                questions.map((q) => (
                  <tr key={q.id}>
                    <td style={{ fontFamily: "monospace", fontSize: 12 }}>{q.id.slice(0,10)}…</td>
                    <td>
                      <div style={{ fontWeight: 600, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {q.productName || "Товар не найден"}
                      </div>
                    </td>
                    <td>{q.userName} <span className="admin-muted">({q.userId.slice(0,8)}…)</span></td>
                    <td>
                      <div style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink)" }}>
                        {q.question}
                      </div>
                    </td>
                    <td>
                      {(() => {
                        switch (q.moderationStatus) {
                          case "approved": return <span className="admin-badge admin-badge--green">Одобрен</span>;
                          case "rejected": return <span className="admin-badge admin-badge--red">Отклонен</span>;
                          default: return <span className="admin-badge admin-badge--amber">На модерации</span>;
                        }
                      })()}
                    </td>
                    <td>{getAnsweredBadge(q.isAnswered)}</td>
                    <td className="admin-muted" style={{ fontSize: 13 }}>
                      {q.createdAt ? new Date(q.createdAt).toLocaleString("ru-RU") : "—"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div className="admin-actions" style={{ justifyContent: "flex-end", gap: 6 }}>
                        <button
                          onClick={() => handleView(q.id)}
                          className="admin-btn admin-btn--icon"
                          title="Просмотр"
                        >
                          <Eye size={14} />
                        </button>
                        {!q.isAnswered && (
                          <button
                            onClick={() => startAnswer(q.id)}
                            className="admin-btn admin-btn--icon"
                            title="Ответить"
                            style={{ color: "#005bff" }}
                          >
                            <Mail size={14} />
                          </button>
                        )}
                        {q.moderationStatus === "pending" && (
                          <>
                            <button
                              onClick={() => handleModerate(q.id, "approve")}
                              className="admin-btn admin-btn--icon"
                              title="Одобрить"
                              style={{ color: "#16a34a" }}
                            >
                              <Check size={14} />
                            </button>
                            <button
                              onClick={() => handleModerate(q.id, "reject")}
                              className="admin-btn admin-btn--icon"
                              title="Отклонить"
                              style={{ color: "#dc2626" }}
                            >
                              <X size={14} />
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleDelete(q.id)}
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