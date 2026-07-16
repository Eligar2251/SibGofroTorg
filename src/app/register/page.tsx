// =========================================================
// FILE: src/app/register/page.tsx
// =========================================================

import { Suspense } from "react";
import { RegisterClient } from "@/components/auth/RegisterClient";

export const metadata = {
  title: "Регистрация — СибГофроТорг",
};

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: "50vh", display: "grid", placeItems: "center" }}>
          Загрузка...
        </div>
      }
    >
      <RegisterClient />
    </Suspense>
  );
}