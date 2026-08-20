// =========================================================
// FILE: src/components/admin/ImageUploader.tsx
// Загрузка фото в Cloudinary с двумя режимами:
//  • «заменять» (по умолчанию для карточки товара) — новое фото
//    встаёт вместо старого, вторым экземпляром не добавляется;
//  • «добавлять» — старые фото остаются в галерее.
// Файлы грузятся последовательно и списываются одним onChange —
// раньше параллельные загрузки затирали друг друга (каждая
// считала images из своего замыкания).
// =========================================================

"use client";

import { useState, useRef } from "react";
import { Upload, X, Loader2, ImageIcon } from "lucide-react";
import Image from "next/image";

interface ImageUploaderProps {
  images: { url: string; publicId: string }[];
  onChange: (images: { url: string; publicId: string }[]) => void;
  /** Включить режим «заменять фото» по умолчанию (карточка товара). */
  defaultReplace?: boolean;
  /** Скрыть переключатель режима (когда фото всегда одно). */
  hideReplaceToggle?: boolean;
}

export function ImageUploader({
  images,
  onChange,
  defaultReplace = false,
  hideReplaceToggle = false,
}: ImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [replace, setReplace] = useState(defaultReplace);
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadOne(
    file: File
  ): Promise<{ url: string; publicId: string } | null> {
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/admin/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Ошибка загрузки");

      const data = await res.json();
      return { url: data.url, publicId: data.publicId };
    } catch (err) {
      console.error(err);
      alert("Не удалось загрузить фото");
      return null;
    }
  }

  async function removeImage(target: { url: string; publicId: string }) {
    try {
      // Облачное удаление — только если у фото есть publicId
      // (загрузки из аплоадера). Фото, пришедшее ссылкой (Excel /
      // старые данные), просто убираем из списка локально.
      if (target.publicId) {
        await fetch("/api/admin/upload", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicId: target.publicId }),
        });
        onChange(images.filter((img) => img.publicId !== target.publicId));
      } else {
        onChange(images.filter((img) => img !== target));
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) return;

    setUploading(true);
    const uploaded: { url: string; publicId: string }[] = [];
    for (const file of list) {
      const result = await uploadOne(file);
      if (result) uploaded.push(result);
    }
    setUploading(false);
    if (uploaded.length === 0) return;

    // «Заменить» — новые фото полностью вытесняют старые
    // (главным становится первое из загруженных).
    onChange(replace ? uploaded : [...images, ...uploaded]);
  }

  return (
    <div className="admin-stack">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`admin-upload${dragOver ? " admin-upload--over" : ""}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          style={{ display: "none" }}
          onChange={(e) => handleFiles(e.target.files)}
        />

        {uploading ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <Loader2 size={32} className="animate-spin" style={{ color: "var(--adm-amber)" }} />
            <p className="admin-upload__sub">Загрузка...</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <Upload size={32} className="admin-upload__icon" />
            <p className="admin-upload__title">
              Перетащите фото или нажмите для выбора
            </p>
            <p className="admin-upload__sub">
              {images.length > 0 && replace
                ? "Новое фото заменит текущее"
                : "PNG, JPG, WEBP — до 10 МБ"}
            </p>
          </div>
        )}
      </div>

      {!hideReplaceToggle && (
        <label className="admin-check" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={replace}
            onChange={(e) => setReplace(e.target.checked)}
          />
          <span>
            Заменять фото при загрузке (снимите галочку, чтобы добавить в
            галерею вторым)
          </span>
        </label>
      )}

      {images.some((img) => img?.url) && (
        <div className="admin-upload-grid">
          {images
            .filter((img) => img && img.url)
            .map((img, i) => (
            <div key={img.publicId || img.url} className="admin-upload-item">
              <Image
                src={img.url}
                alt={`Фото ${i + 1}`}
                fill
                style={{ objectFit: "cover" }}
                sizes="120px"
              />
              {i === 0 && <span className="admin-upload-item__main">Главное</span>}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeImage(img);
                }}
                className="admin-upload-item__del"
                aria-label="Удалить"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {images.length === 0 && (
        <div className="admin-row admin-muted">
          <ImageIcon size={14} />
          <span>Фото не добавлены — будет показан стандартный значок</span>
        </div>
      )}
    </div>
  );
}
