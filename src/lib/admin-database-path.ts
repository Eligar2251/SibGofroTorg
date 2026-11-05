/** Backup warnings belong to this admin's database section only. */
export function isAdminDatabasePath(pathname: string | null, adminPath: string): boolean {
  const root = `/${adminPath}/database`;
  return pathname === root || Boolean(pathname?.startsWith(`${root}/`));
}
