// Тестовый двойник @/lib/auth: всегда «залогинен» владельцем.
export const STUB_SESSION = {
  id: "admin-1",
  login: "owner",
  displayName: "Владелец",
  role: "owner",
};

export async function requireAdminApi(): Promise<unknown> {
  return STUB_SESSION;
}

export function hasPermission(): boolean {
  return true;
}
