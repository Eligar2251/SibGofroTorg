// =========================================================
// FILE: src/app/login/page.tsx
// =========================================================

import { Suspense } from "react";
import { LoginClient } from "@/components/auth/LoginClient";

export const metadata = {
  title: "Вход — СибГофроТорг",
};

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: "50vh", display: "grid", placeItems: "center" }}>
          Загрузка...
        </div>
      }
    >
      <LoginClient />
    </Suspense>
  );
}