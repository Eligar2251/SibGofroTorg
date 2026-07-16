// src/app/loading.tsx
export default function Loading() {
  return (
    <div className="container" style={{ paddingBlock: "24px" }}>
      <div style={{ height: 200, background: "#e5e5e5", borderRadius: "var(--radius)", marginBottom: 24, animation: "pulse 1.4s ease infinite" }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 12 }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} style={{ background: "#e5e5e5", height: 280, borderRadius: "var(--radius)", animation: "pulse 1.4s ease infinite", animationDelay: `${i * 0.07}s` }} />
        ))}
      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }`}</style>
    </div>
  );
}