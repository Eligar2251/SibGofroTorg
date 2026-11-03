// =========================================================
// FILE: src/lib/supabase.ts
// Публичный фасад доступа к базе данных (маршрутизируется в серверное ядро
// через условный экспорт #db-server-engine в package.json, оставаясь
// безопасным для сборки клиентских чанков в Turbopack).
// =========================================================

export {
  createDirectSupabaseClient,
  getActiveDatabaseConnectionInfo,
  getAdminDb,
  getPublicDb,
  getSupabaseAnonKey_pub,
  getSupabaseUrl_pub,
  isRemoteServerFailure,
  probeDatabaseBackend,
} from "#db-server-engine";
