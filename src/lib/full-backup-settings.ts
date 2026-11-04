import fs from "node:fs";
import path from "node:path";
import { getSgtDataDir, type DbBackendMode } from "./db-runtime-config";

export interface FullBackupSettings {
  enabled: boolean;
  intervalSec: number;
  targets: Record<DbBackendMode, boolean>;
}

const defaults: FullBackupSettings = {
  enabled: false,
  intervalSec: 150,
  targets: { primary: false, secondary: false, local: false },
};

export function readFullBackupSettings(): FullBackupSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(getSgtDataDir(), "full-backup-settings.json"), "utf8"));
    const seconds = Math.floor(Number(raw.intervalSec));
    return {
      enabled: raw.enabled === true,
      intervalSec: Number.isFinite(seconds) ? Math.max(60, Math.min(86400, seconds)) : 150,
      targets: { primary: raw.targets?.primary === true, secondary: raw.targets?.secondary === true, local: raw.targets?.local === true },
    };
  } catch { return structuredClone(defaults); }
}

export function saveFullBackupSettings(settings: FullBackupSettings): FullBackupSettings {
  const dir = getSgtDataDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dest = path.join(dir, "full-backup-settings.json");
  const temp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(settings), { mode: 0o600 });
  fs.renameSync(temp, dest);
  return readFullBackupSettings();
}
