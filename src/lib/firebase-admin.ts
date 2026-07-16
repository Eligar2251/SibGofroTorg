// src/lib/firebase-admin.ts
import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let _db: Firestore | null = null;

function initApp(): App {
  if (getApps().length > 0) return getApps()[0]!;

  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId) {
    throw new Error("FIREBASE_PROJECT_ID / NEXT_PUBLIC_FIREBASE_PROJECT_ID не задан");
  }

  if (clientEmail && privateKey) {
    return initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
      projectId,
    });
  }

  // Локально без ключа — только если gcloud ADC настроен
  return initializeApp({ projectId });
}

/** Firestore с правами Admin (обходит Security Rules) */
export function getAdminDb(): Firestore {
  if (!_db) {
    _db = getFirestore(initApp());
  }
  return _db;
}