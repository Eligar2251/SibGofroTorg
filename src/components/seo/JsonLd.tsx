// src/components/seo/JsonLd.tsx
import { jsonLdScript } from "@/lib/seo";

type JsonLdProps = {
  data: unknown | unknown[];
};

export function JsonLd({ data }: JsonLdProps) {
  const payload = Array.isArray(data) ? data : [data];

  return (
    <>
      {payload.map((item, index) => (
        <script
          key={`jsonld-${index}`}
          type="application/ld+json"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: jsonLdScript(item) }}
        />
      ))}
    </>
  );
}