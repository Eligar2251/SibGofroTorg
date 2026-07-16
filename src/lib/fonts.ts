// src/lib/fonts.ts — НОВЫЙ ФАЙЛ
import { Fraunces, IBM_Plex_Mono, Unbounded } from "next/font/google";

// next/font сам инлайнит @font-face, предзагружает woff2,
// убирает layout shift через size-adjust — вместо блокирующего @import
export const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
  preload: true,
});

export const plexMono = IBM_Plex_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "600"],
  variable: "--font-plex-mono",
  display: "swap",
  preload: true,
});

export const unbounded = Unbounded({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "700", "900"],
  variable: "--font-unbounded",
  display: "swap",
  preload: true,
});