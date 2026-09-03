"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  DoorOpen,
  Loader2,
  Phone,
  Printer,
  RotateCcw,
  Save,
} from "lucide-react";
import Link from "next/link";
import {
  DOOR_SIGN_DEFAULTS,
  doorSignToSettings,
  type DoorSignConfig,
} from "@/lib/door-sign";
import "./DoorSign.css";

interface DoorSignPrintProps {
  initial: DoorSignConfig;
  adminPath: string;
  canSave: boolean;
}

function phoneFontSize(phone: string): number {
  const len = phone.replace(/[^\d+]/g, "").length;
  if (len >= 20) return 46;
  if (len >= 17) return 52;
  if (len >= 14) return 58;
  return 66;
}

function resetConfig(): DoorSignConfig {
  return { ...DOOR_SIGN_DEFAULTS };
}

export function DoorSignPrint({
  initial,
  adminPath,
  canSave,
}: DoorSignPrintProps) {
  const [config, setConfig] = useState<DoorSignConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.add("door-sign-mode");
    return () => document.body.classList.remove("door-sign-mode");
  }, []);

  function update<K extends keyof DoorSignConfig>(
    key: K,
    value: DoorSignConfig[K],
  ) {
    setConfig((current) => ({ ...current, [key]: value }));
    setSaved(false);
    setError("");
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(doorSignToSettings(config)),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Не удалось сохранить настройки");
      }
      setSaved(true);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Ошибка сохранения",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handlePrint() {
    if (printing) return;
    setPrinting(true);
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      const root = document.querySelector<HTMLElement>(".door-sign__sheet");
      const images = Array.from(root?.querySelectorAll("img") || []);
      await Promise.all(
        images.map(
          (image) =>
            new Promise<void>((resolve) => {
              if (image.complete && image.naturalWidth > 0) {
                image
                  .decode()
                  .catch(() => undefined)
                  .finally(resolve);
                return;
              }
              const done = () => resolve();
              image.addEventListener("load", done, { once: true });
              image.addEventListener("error", done, { once: true });
              window.setTimeout(done, 8000);
            }),
        ),
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      window.print();
    } finally {
      setPrinting(false);
    }
  }

  const phonePt = phoneFontSize(config.phone);

  return (
    <div className="door-sign">
      <style>
        {`@media print { @page { size: A4 landscape; margin: 0; } }`}
      </style>

      <div className="door-sign__controls admin-card no-print">
        <div className="admin-card__pad">
          <div className="admin-page-head" style={{ marginBottom: 14 }}>
            <div>
              <h1 className="admin-h1">Табличка на дверь · A4, альбомная</h1>
              <p className="admin-sub">
                Крупный номер телефона, чтобы клиент увидел его сразу. Печать
                чёрно-белая — лист рассчитан под обычный принтер без цветной
                краски.
              </p>
            </div>
            <div className="door-sign__actions">
              <Link
                href={`/${adminPath}/print-sheet`}
                className="admin-btn admin-btn--ghost"
                prefetch={false}
              >
                <ArrowLeft size={15} /> Печать А4
              </Link>
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => setConfig(resetConfig())}
              >
                <RotateCcw size={15} /> Сбросить
              </button>
              {canSave && (
                <button
                  type="button"
                  className="admin-btn admin-btn--navy"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : saved ? (
                    <Check size={15} />
                  ) : (
                    <Save size={15} />
                  )}
                  {saved ? "Сохранено" : "Сохранить в настройках"}
                </button>
              )}
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={handlePrint}
                disabled={printing}
              >
                {printing ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Printer size={15} />
                )}
                Печать A4 альбомная
              </button>
            </div>
          </div>

          <div className="door-sign__hint" style={{ marginBottom: 12 }}>
            Настройки на этой странице хранятся в админке и будут заполнены при
            следующем открытии. Пока лист не сохранён, печатается текущий
            предпросмотр.
            {!canSave && (
              <strong>
                {" "}
                Сохранять настройки может только администратор — менеджер видит
                и печатает табличку, но не меняет постоянные значения.
              </strong>
            )}
          </div>

          <div className="door-sign__controls-grid">
            <label className="door-sign__field">
              <span>Компания</span>
              <input
                type="text"
                className="admin-input"
                value={config.company}
                onChange={(e) => update("company", e.target.value)}
                placeholder="СибГофроТорг"
              />
            </label>
            <label className="door-sign__field">
              <span>Номер телефона (крупно)</span>
              <input
                type="text"
                className="admin-input"
                value={config.phone}
                onChange={(e) => update("phone", e.target.value)}
                placeholder="+7 (913) 915-81-46"
              />
            </label>
            <label className="door-sign__field">
              <span>Верхняя надпись</span>
              <input
                type="text"
                className="admin-input"
                value={config.line1}
                onChange={(e) => update("line1", e.target.value)}
                placeholder="Если никого нет —"
              />
            </label>
            <label className="door-sign__field">
              <span>Нижняя надпись</span>
              <input
                type="text"
                className="admin-input"
                value={config.line2}
                onChange={(e) => update("line2", e.target.value)}
                placeholder="Позвоните, выдадим товар"
              />
            </label>
            <label className="door-sign__field">
              <span>Адрес</span>
              <input
                type="text"
                className="admin-input"
                value={config.address}
                onChange={(e) => update("address", e.target.value)}
                placeholder="г. Новосибирск, ул. Ватутина, 42а к1"
              />
            </label>
            <label className="door-sign__field">
              <span>Часы работы</span>
              <input
                type="text"
                className="admin-input"
                value={config.hours}
                onChange={(e) => update("hours", e.target.value)}
                placeholder="Пн–Пт 8:30–17:00"
              />
            </label>
          </div>

          <div className="door-sign__actions" style={{ marginTop: 12 }}>
            <label className="door-sign__check">
              <input
                type="checkbox"
                checked={config.showCompany}
                onChange={(e) => update("showCompany", e.target.checked)}
              />
              Компания
            </label>
            <label className="door-sign__check">
              <input
                type="checkbox"
                checked={config.showAddress}
                onChange={(e) => update("showAddress", e.target.checked)}
              />
              Адрес
            </label>
            <label className="door-sign__check">
              <input
                type="checkbox"
                checked={config.showHours}
                onChange={(e) => update("showHours", e.target.checked)}
              />
              Часы работы
            </label>
          </div>

          {error && <div className="admin-error">{error}</div>}
        </div>
      </div>

      <div className="door-sign__preview">
        <div className="door-sign__sheet" id="door-sign-sheet">
          <div className="door-sign__frame">
            <header className="door-sign__header">
              {config.showCompany && (
                <div className="door-sign__company">{config.company}</div>
              )}
              {!config.showCompany && <span />}
              <div className="door-sign__header-tag">Позвоните нам</div>
            </header>

            <div className="door-sign__main">
              <div className="door-sign__line1">{config.line1}</div>
              <div className="door-sign__phone-box">
                <div className="door-sign__phone-row">
                  <Phone
                    className="door-sign__phone-icon"
                    strokeWidth={2.6}
                    aria-hidden="true"
                  />
                  <div
                    className="door-sign__phone"
                    style={{ fontSize: `${phonePt}pt` }}
                  >
                    {config.phone || "—"}
                  </div>
                </div>
              </div>
              <div className="door-sign__line2">{config.line2}</div>
            </div>

            <footer className="door-sign__footer">
              {config.showAddress ? (
                <div className="door-sign__footer-address">
                  {config.address}
                </div>
              ) : (
                <span />
              )}
              {config.showHours && (
                <div className="door-sign__footer-hours">{config.hours}</div>
              )}
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}
