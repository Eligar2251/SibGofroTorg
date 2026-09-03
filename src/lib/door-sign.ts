// src/lib/door-sign.ts — настройки и дефолты таблички на дверь (A4 landscape)
//
// Табличка печатается на обычном принтере в чёрно-белом режиме: номер
// телефона — максимально крупно, чтобы клиент видел его сразу, даже
// если никого нет в помещении.
//
// Настройки хранятся в общей таблице site_settings строковым ключём
// door_sign_* (отдельная миграция БД не нужна).

import { SITE_ADDRESS, SITE_HOURS_LABEL, SITE_PHONE } from "@/lib/site-config";
import { SITE_NAME } from "@/lib/seo";

export interface DoorSignConfig {
  company: string;
  phone: string;
  line1: string;
  line2: string;
  address: string;
  hours: string;
  showCompany: boolean;
  showAddress: boolean;
  showHours: boolean;
}

export const DOOR_SIGN_DEFAULTS: DoorSignConfig = {
  company: SITE_NAME,
  phone: SITE_PHONE,
  line1: "Если никого нет —",
  line2: "Позвоните, выдадим товар",
  address: SITE_ADDRESS,
  hours: SITE_HOURS_LABEL,
  showCompany: true,
  showAddress: true,
  showHours: false,
};

function booleanSetting(value: string | undefined, fallback: boolean): boolean {
  return value === undefined
    ? fallback
    : String(value).trim().toLowerCase() !== "false";
}

export function doorSignFromSettings(
  settings: Record<string, string>,
): DoorSignConfig {
  return {
    company: String(settings.door_sign_company || DOOR_SIGN_DEFAULTS.company),
    phone: String(settings.door_sign_phone || DOOR_SIGN_DEFAULTS.phone),
    line1: String(settings.door_sign_line1 || DOOR_SIGN_DEFAULTS.line1),
    line2: String(settings.door_sign_line2 || DOOR_SIGN_DEFAULTS.line2),
    address: String(settings.door_sign_address || DOOR_SIGN_DEFAULTS.address),
    hours: String(settings.door_sign_hours || DOOR_SIGN_DEFAULTS.hours),
    showCompany: booleanSetting(
      settings.door_sign_show_company,
      DOOR_SIGN_DEFAULTS.showCompany,
    ),
    showAddress: booleanSetting(
      settings.door_sign_show_address,
      DOOR_SIGN_DEFAULTS.showAddress,
    ),
    showHours: booleanSetting(
      settings.door_sign_show_hours,
      DOOR_SIGN_DEFAULTS.showHours,
    ),
  };
}

export function doorSignToSettings(
  config: DoorSignConfig,
): Record<string, string> {
  return {
    door_sign_company: config.company.trim(),
    door_sign_phone: config.phone.trim(),
    door_sign_line1: config.line1.trim(),
    door_sign_line2: config.line2.trim(),
    door_sign_address: config.address.trim(),
    door_sign_hours: config.hours.trim(),
    door_sign_show_company: String(config.showCompany),
    door_sign_show_address: String(config.showAddress),
    door_sign_show_hours: String(config.showHours),
  };
}
