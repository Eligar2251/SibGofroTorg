"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import type { AdminRole } from "@/lib/admin-rbac";

type AdminUser = {
  id: string;
  username: string;
  role: AdminRole;
  displayName: string;
  isActive: boolean;
  isCurrent: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

const roleLabels: Record<AdminRole, string> = {
  admin: "Администратор",
  manager: "Менеджер",
  lawyer: "Юрист",
  wastepaper: "Макулатурщик",
};

const roleDescriptions: Record<AdminRole, string> = {
  admin: "Полный доступ, включая настройки и журнал действий",
  manager: "Все рабочие разделы, кроме настроек и журнала действий",
  lawyer: "Только финансы, движение средств и перевозки на дашборде",
  wastepaper: "Только отдельный учёт макулатуры (без доступа к сайту и основному учёту)",
};

function formatDate(raw: string | null): string {
  if (!raw) return "—";
  const date = new Date(raw);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function AdminUsersManager() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editing, setEditing] = useState<AdminUser | null | undefined>(undefined);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<AdminRole>("manager");
  const [isActive, setIsActive] = useState(true);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadUsers = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/admin-users", {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Не удалось загрузить пользователей");
      }
      setUsers(Array.isArray(body.users) ? body.users : []);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось загрузить пользователей"
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  function clearPasswordFields() {
    setPassword("");
    setPasswordConfirm("");
    setShowPassword(false);
  }

  function closeEditor() {
    setEditing(undefined);
    setError("");
    setUsername("");
    setDisplayName("");
    setRole("manager");
    setIsActive(true);
    clearPasswordFields();
  }

  function openCreate() {
    setError("");
    setSuccess("");
    setEditing(null);
    setUsername("");
    setDisplayName("");
    setRole("manager");
    setIsActive(true);
    clearPasswordFields();
  }

  function openEdit(user: AdminUser) {
    setError("");
    setSuccess("");
    setEditing(user);
    setUsername(user.username);
    setDisplayName(user.displayName);
    setRole(user.role);
    setIsActive(user.isActive);
    clearPasswordFields();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const isCreate = editing === null;
    if (isCreate && !password) {
      setError("Задайте пароль нового пользователя");
      return;
    }
    if (password && password.length < 8) {
      setError("Пароль должен содержать не менее 8 символов");
      return;
    }
    if (password !== passwordConfirm) {
      setError("Пароли не совпадают");
      return;
    }

    const passwordToSend = password;
    // Пароль не остаётся в React-state после отправки и никогда не пишется
    // в localStorage/sessionStorage. Сервер также не возвращает его или хэш.
    clearPasswordFields();
    setSaving(true);

    try {
      const response = await fetch(
        isCreate
          ? "/api/admin/admin-users"
          : `/api/admin/admin-users/${encodeURIComponent(editing!.id)}`,
        {
          method: isCreate ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(isCreate ? { username: username.trim() } : {}),
            displayName: displayName.trim(),
            role,
            isActive,
            ...(passwordToSend ? { password: passwordToSend } : {}),
          }),
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Не удалось сохранить пользователя");
      }

      const saved = body.user as AdminUser;
      setUsers((current) =>
        isCreate
          ? [...current, saved]
          : current.map((user) => (user.id === saved.id ? saved : user))
      );
      setSuccess(
        isCreate
          ? `Пользователь ${saved.username} создан`
          : `Пользователь ${saved.username} обновлён`
      );
      closeEditor();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось сохранить пользователя"
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(user: AdminUser) {
    const nextActive = !user.isActive;
    if (
      !nextActive &&
      !confirm(`Отключить вход для пользователя «${user.username}»?`)
    ) {
      return;
    }
    setBusyId(user.id);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(
        `/api/admin/admin-users/${encodeURIComponent(user.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: nextActive }),
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось изменить доступ");
      const saved = body.user as AdminUser;
      setUsers((current) =>
        current.map((item) => (item.id === saved.id ? saved : item))
      );
      setSuccess(
        nextActive
          ? `Вход для ${saved.username} включён`
          : `Вход для ${saved.username} отключён`
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось изменить доступ");
    } finally {
      setBusyId(null);
    }
  }

  async function removeUser(user: AdminUser) {
    if (
      !confirm(
        `Удалить пользователя «${user.username}»?\n\nЭто удалит только аккаунт входа. Журнал ранее выполненных действий сохранится.`
      )
    ) {
      return;
    }
    setBusyId(user.id);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(
        `/api/admin/admin-users/${encodeURIComponent(user.id)}`,
        { method: "DELETE" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось удалить пользователя");
      setUsers((current) => current.filter((item) => item.id !== user.id));
      setSuccess(`Пользователь ${user.username} удалён`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось удалить пользователя");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="admin-users-card admin-card" aria-labelledby="admin-users-title">
      <div className="admin-users-card__head">
        <div>
          <span className="admin-users-card__eyebrow">
            <ShieldCheck size={13} /> Только для администратора
          </span>
          <h2 id="admin-users-title" className="admin-h2">
            Пользователи админ-панели
          </h2>
          <p className="admin-sub">
            Создание аккаунтов, назначение ролей и смена пароля. В браузер и
            базу открытый пароль не сохраняется — в БД записывается только
            уникальный scrypt-хэш.
          </p>
        </div>
        <div className="admin-users-card__actions">
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => loadUsers(true)}
            disabled={refreshing}
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            Обновить
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            onClick={openCreate}
          >
            <Plus size={14} /> Добавить пользователя
          </button>
        </div>
      </div>

      {error && <div className="admin-error admin-users-card__message">{error}</div>}
      {success && (
        <div className="admin-success admin-users-card__message">{success}</div>
      )}

      {loading ? (
        <div className="admin-users-state">
          <Loader2 size={20} className="animate-spin" /> Загружаем пользователей…
        </div>
      ) : users.length === 0 ? (
        <div className="admin-users-state">
          <UsersRound size={24} /> Пользователей пока нет
        </div>
      ) : (
        <div className="admin-users-list">
          {users.map((user) => (
            <article
              key={user.id}
              className={`admin-user-row${!user.isActive ? " admin-user-row--disabled" : ""}`}
            >
              <span className="admin-user-row__icon">
                <UserRound size={17} />
              </span>
              <div className="admin-user-row__identity">
                <div className="admin-user-row__name">
                  <strong>{user.displayName}</strong>
                  {user.isCurrent && (
                    <span className="admin-badge admin-badge--green">вы</span>
                  )}
                </div>
                <span>@{user.username}</span>
              </div>
              <div className="admin-user-row__role">
                <span
                  className={`admin-badge ${
                    user.role === "admin"
                      ? "admin-badge--indigo"
                      : user.role === "manager"
                        ? "admin-badge--blue"
                        : user.role === "wastepaper"
                          ? "admin-badge--teal"
                          : "admin-badge--amber"
                  }`}
                >
                  {roleLabels[user.role]}
                </span>
                <small>{roleDescriptions[user.role]}</small>
              </div>
              <div className="admin-user-row__status">
                <span
                  className={`admin-badge ${
                    user.isActive ? "admin-badge--green" : "admin-badge--muted"
                  }`}
                >
                  {user.isActive ? "Активен" : "Отключён"}
                </span>
                <small>Обновлён {formatDate(user.updatedAt)}</small>
              </div>
              <div className="admin-user-row__buttons">
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  onClick={() => openEdit(user)}
                  disabled={busyId === user.id}
                >
                  <Pencil size={12} /> Изменить
                </button>
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  onClick={() => toggleActive(user)}
                  disabled={busyId === user.id || user.isCurrent}
                  title={user.isCurrent ? "Текущий аккаунт нельзя отключить" : undefined}
                >
                  {busyId === user.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : null}
                  {user.isActive ? "Отключить" : "Включить"}
                </button>
                <button
                  type="button"
                  className="admin-btn admin-btn--danger-ghost admin-btn--sm"
                  onClick={() => removeUser(user)}
                  disabled={busyId === user.id || user.isCurrent}
                  title={user.isCurrent ? "Текущий аккаунт нельзя удалить" : undefined}
                >
                  <Trash2 size={12} /> Удалить
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing !== undefined && (
        <ModalPortal>
          <div className="admin-modal-overlay" data-admin="true" onClick={closeEditor}>
            <div
              className="admin-modal admin-user-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="admin-modal__head">
                <div>
                  <span className="admin-users-card__eyebrow">
                    {editing === null ? "Новый аккаунт" : `@${editing.username}`}
                  </span>
                  <h3 className="admin-modal__title">
                    {editing === null ? "Добавить пользователя" : "Настроить пользователя"}
                  </h3>
                </div>
                <button
                  type="button"
                  className="admin-modal__close"
                  onClick={closeEditor}
                  aria-label="Закрыть"
                >
                  ×
                </button>
              </div>

              <form
                className="admin-user-form"
                autoComplete="off"
                data-form-type="other"
                data-lpignore="true"
                onSubmit={submit}
              >
                <div className="admin-grid-2">
                  <label className="admin-field">
                    <span className="admin-label">Логин</span>
                    <input
                      className="admin-input"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      required
                      minLength={3}
                      maxLength={64}
                      pattern="[A-Za-z0-9._-]+"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      autoComplete="off"
                      disabled={editing !== null}
                    />
                  </label>
                  <label className="admin-field">
                    <span className="admin-label">Отображаемое имя</span>
                    <input
                      className="admin-input"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      required
                      maxLength={100}
                      autoComplete="off"
                    />
                  </label>
                </div>

                <label className="admin-field">
                  <span className="admin-label">Роль</span>
                  <select
                    className="admin-select"
                    value={role}
                    onChange={(event) => setRole(event.target.value as AdminRole)}
                    disabled={Boolean(editing?.isCurrent)}
                  >
                    {(Object.keys(roleLabels) as AdminRole[]).map((item) => (
                      <option key={item} value={item}>
                        {roleLabels[item]} — {roleDescriptions[item]}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="admin-user-passwords">
                  <label className="admin-field">
                    <span className="admin-label">
                      {editing === null ? "Пароль" : "Новый пароль (необязательно)"}
                    </span>
                    <span className="admin-user-password-control">
                      <input
                        className="admin-input"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        minLength={8}
                        maxLength={200}
                        required={editing === null}
                        autoComplete="off"
                        data-1p-ignore
                        data-lpignore="true"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((value) => !value)}
                        aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                      >
                        {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </span>
                  </label>
                  <label className="admin-field">
                    <span className="admin-label">Повторите пароль</span>
                    <input
                      className="admin-input"
                      type={showPassword ? "text" : "password"}
                      value={passwordConfirm}
                      onChange={(event) => setPasswordConfirm(event.target.value)}
                      minLength={password ? 8 : undefined}
                      maxLength={200}
                      required={editing === null || Boolean(password)}
                      autoComplete="off"
                      data-1p-ignore
                      data-lpignore="true"
                    />
                  </label>
                </div>

                <div className="admin-user-security-note">
                  Пароль передаётся только в защищённом запросе и сразу хэшируется
                  на сервере. Открытый пароль и его хэш не возвращаются в интерфейс,
                  не записываются в localStorage и не попадают в журнал действий.
                </div>

                <label className="admin-check">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(event) => setIsActive(event.target.checked)}
                    disabled={Boolean(editing?.isCurrent)}
                  />
                  Разрешить вход в админ-панель
                </label>

                {error && <div className="admin-error">{error}</div>}

                <div className="admin-modal__actions">
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost"
                    onClick={closeEditor}
                    disabled={saving}
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    className="admin-btn admin-btn--primary"
                    disabled={saving}
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                    {editing === null ? "Создать аккаунт" : "Сохранить"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ModalPortal>
      )}
    </section>
  );
}
