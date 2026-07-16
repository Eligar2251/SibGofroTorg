/** Только цифры, РФ: 8… → 7…, 10 цифр → 7… */
export function digitsPhone(raw: string): string {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("8")) d = "7" + d.slice(1);
  if (d.length && !d.startsWith("7")) d = "7" + d;
  return d.slice(0, 11);
}

/** +7 (913) 000-00-00 */
export function formatPhoneMask(raw: string): string {
  const d = digitsPhone(raw);
  if (!d.length) return "";
  let out = "+7";
  const rest = d.startsWith("7") ? d.slice(1) : d;
  if (rest.length === 0) return out;
  out += " (" + rest.slice(0, 3);
  if (rest.length >= 3) out += ")";
  if (rest.length > 3) out += " " + rest.slice(3, 6);
  if (rest.length > 6) out += "-" + rest.slice(6, 8);
  if (rest.length > 8) out += "-" + rest.slice(8, 10);
  return out;
}