"use client";

import { useState } from "react";
import { mergePublicSnapshots } from "@/lib/merge-public-snapshots";

/** Owner-only parent. No database or input file is changed. */
export function MergeBackupPanel() {
  const [base, setBase] = useState<File | null>(null);
  const [left, setLeft] = useState<File | null>(null);
  const [right, setRight] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function merge() {
    if (!base || !left || !right) { setMessage("Выберите общий исходный файл и обе копии."); return; }
    if (!window.confirm("Исходный файл должен быть общим предком обеих копий ДО их независимых изменений. Проверить происхождение автоматически нельзя. Если исходный файл выбран неверно, данные могут быть потеряны при последующем восстановлении. Продолжить?")) return;
    setBusy(true); setMessage("");
    try {
      const [a, b, c] = await Promise.all([base.text(), left.text(), right.text()]);
      const merged = mergePublicSnapshots(JSON.parse(a), JSON.parse(b), JSON.parse(c));
      const url = URL.createObjectURL(new Blob([JSON.stringify(merged)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `sgt-merged-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`Файл собран: ${merged.totalRows} строк. Базы не изменены. Перед восстановлением проверьте файл на тестовой БД.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <section style={{ display: "grid", gap: 8, padding: 16, border: "1px solid var(--adm-border, #ddd)", borderRadius: 12, marginBottom: 16 }}>
    <strong>Сопоставить две полные копии</strong>
    <div style={{ fontSize: 12 }}>Нужен общий исходный снимок и две копии, созданные из него. Если обе копии по-разному изменили одну таблицу или счётчик, объединение остановится. Удаления учитываются. Сборка выполняется на этом ПК и не меняет исходные файлы или базы.</div>
    <label>Общий исходный снимок <input type="file" accept=".json,application/json" onChange={e => setBase(e.target.files?.[0] || null)} /></label>
    <label>Копия первого ПК <input type="file" accept=".json,application/json" onChange={e => setLeft(e.target.files?.[0] || null)} /></label>
    <label>Копия второго ПК <input type="file" accept=".json,application/json" onChange={e => setRight(e.target.files?.[0] || null)} /></label>
    <div><button className="admin-btn admin-btn--outline admin-btn--sm" disabled={busy} onClick={merge}>{busy ? "Сравнение…" : "Сравнить и скачать объединённый файл"}</button></div>
    {message && <div role="status" style={{ fontSize: 12 }}>{message}</div>}
  </section>;
}
