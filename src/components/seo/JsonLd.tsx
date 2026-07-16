// =========================================================
// FILE: src/components/seo/JsonLd.tsx
// =========================================================

import { jsonLdScript } from "@/lib/seo";

export function JsonLd({
  data,
  nonce: _nonce, // принимаем для обратной совместимости, но не используем
}: {
  data: unknown | unknown[];
  nonce?: string;
}) {
  const payload = Array.isArray(data) ? data : [data];
  return (
    <>
      {payload.map((item, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(item) }}
        />
      ))}
    </>
  );
}