// =========================================================
// FILE: src/components/admin/ImageUploader.tsx
// =========================================================

"use client";

import { useState, useRef } from "react";
import { Upload, X, Loader2, ImageIcon } from "lucide-react";
import Image from "next/image";

interface ImageUploaderProps {
  images: { url: string; publicId: string }[];
  onChange: (images: { url: string; publicId: string }[]) => void;
}

export function ImageUploader({ images, onChange }: ImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/admin/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Ошибка загрузки");

      const data = await res.json();
      onChange([...images, { url: data.url, publicId: data.publicId }]);
    } catch (err) {
      console.error(err);
      alert("Не удалось загрузить фото");
    }
    setUploading(false);
  }

  async function removeImage(publicId: string) {
    try {
      await fetch("/api/admin/upload", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicId }),
      });
      onChange(images.filter((img) => img.publicId !== publicId));
    } catch (err) {
      console.error(err);
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (file.type.startsWith("image/")) {
        uploadFile(file);
      }
    });
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
            <p className="admin-upload__sub">PNG, JPG, WEBP — до 10 МБ</p>
          </div>
        )}
      </div>

      {images.length > 0 && (
        <div className="admin-upload-grid">
          {images.map((img, i) => (
            <div key={img.publicId} className="admin-upload-item">
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
                  removeImage(img.publicId);
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