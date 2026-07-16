// src/components/seo/JsonLd.tsx
import { jsonLdScript } from "@/lib/seo";

export function JsonLd({
  data,
  nonce,
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
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: jsonLdScript(item) }}
        />
      ))}
    </>
  );
}