// src/app/catalog/loading.tsx — НОВЫЙ ФАЙЛ (skeleton именно под сетку каталога)
export default function CatalogLoading() {
  return (
    <div>
      <div className="wrap" style={{ paddingBlock: "2rem" }}>
        <div className="skeleton-block" style={{ height: 14, width: 180, marginBottom: "1rem" }} />
        <div className="skeleton-block" style={{ height: 64, width: "50%" }} />
      </div>
      <div className="product-grid">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="product-cell" style={{ gridColumn: "span 3" }}>
            <div className="skeleton-block" style={{ aspectRatio: 1 }} />
            <div className="skeleton-block" style={{ height: 10, width: "60%" }} />
            <div className="skeleton-block" style={{ height: 14, width: "90%" }} />
            <div className="skeleton-block" style={{ height: 24, width: "40%", marginTop: "auto" }} />
          </div>
        ))}
      </div>
    </div>
  );
}