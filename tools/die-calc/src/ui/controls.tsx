/**
 * controls.tsx — примитивы формы. Никаких UI-библиотек: только React + классы
 * из ui.css, чтобы компонент можно было вставить в любой проект.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Num({
  label,
  value,
  onCommit,
  min,
  max,
  step = 1,
  hint,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}): ReactNode {
  const fmt = (n: number): string => (Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : '');
  const [txt, setTxt] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current && parseFloat(txt.replace(',', '.')) !== value) setTxt(fmt(value));
  }, [value, txt]);
  const commit = (raw: string, blur: boolean): void => {
    setTxt(raw);
    const n = parseFloat(raw.replace(',', '.'));
    if (Number.isNaN(n)) {
      if (blur) setTxt(fmt(value));
      return;
    }
    let v = n;
    if (min !== undefined && v < min) v = min;
    if (max !== undefined && v > max) v = max;
    onCommit(v);
    if (blur && Math.round(v * 1000) / 1000 !== n) setTxt(fmt(v));
  };
  return (
    <label className="dgc-field" title={hint}>
      <label>{label}</label>
      <input
        type="number"
        step={step}
        value={txt}
        onFocus={() => (focused.current = true)}
        onBlur={(e) => {
          focused.current = false;
          commit(e.target.value, true);
        }}
        onChange={(e) => commit(e.target.value, false)}
      />
    </label>
  );
}

export function Sel({
  label,
  value,
  onCommit,
  options,
  hint,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  options: Array<{ id: string; name: string }>;
  hint?: string;
}): ReactNode {
  return (
    <label className="dgc-field" title={hint}>
      <label>{label}</label>
      <select value={value} onChange={(e) => onCommit(e.target.value)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Chk({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}): ReactNode {
  return (
    <label className="dgc-check" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
  format?: (n: number) => string;
}): ReactNode {
  return (
    <label className="dgc-field">
      <label>
        {label}: <b>{format ? format(value) : value}</b>
      </label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Card({ title, right, children }: { title?: string; right?: ReactNode; children: ReactNode }): ReactNode {
  return (
    <section className="dgc-card">
      {(title || right) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: title ? 10 : 0 }}>
          {title && <h3 style={{ margin: 0 }}>{title}</h3>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function fmtMm(n: number): string {
  return Math.abs(n - Math.round(n)) < 0.01 ? `${Math.round(n)}` : n.toFixed(1);
}

export function fmtRub(n: number): string {
  return `${Math.round(n).toLocaleString('ru-RU')} ₽`;
}

export function fmt2(n: number): string {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
