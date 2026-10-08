// =========================================================
// FILE: src/lib/dimension-profiles-db.ts
// Серверная часть типов размеров: чтение/запись
// product_dimension_profiles. Если миграция не применена —
// возвращаем пустой список, и формы работают по-старому (Д×Ш×В).
// =========================================================

import { unstable_cache, revalidateTag } from "next/cache";
import { getAdminDb } from "./supabase";
import {
  normalizeDimensionFields,
  type DimensionProfile,
} from "./dimension-profiles";

export const DIMENSION_PROFILES_TAG = "dimension-profiles";

function mapRow(row: any): DimensionProfile {
  return {
    id: row.id,
    name: row.name || "",
    slug: row.slug || null,
    fields: normalizeDimensionFields(row.fields),
    sortOrder: Number(row.sort_order || 0),
    isDefault: row.is_default ?? false,
  };
}

async function fetchProfiles(): Promise<DimensionProfile[]> {
  try {
    const db = getAdminDb();
    const { data, error } = await db
      .from("product_dimension_profiles")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) {
      console.warn("[dimension-profiles]", error.message || error);
      return [];
    }
    return (data || []).map(mapRow);
  } catch (error: any) {
    console.warn("[dimension-profiles]", error?.message || error);
    return [];
  }
}

const getCached = unstable_cache(fetchProfiles, ["dimension-profiles-v1"], {
  revalidate: 300,
  tags: [DIMENSION_PROFILES_TAG],
});

export async function getDimensionProfiles(): Promise<DimensionProfile[]> {
  return getCached();
}

function payloadFrom(data: Record<string, any>): Record<string, any> {
  const payload: Record<string, any> = {};
  if (data.name !== undefined) payload.name = String(data.name || "").trim().slice(0, 80);
  if (data.fields !== undefined) payload.fields = normalizeDimensionFields(data.fields);
  if (data.sortOrder !== undefined) payload.sort_order = Number(data.sortOrder) || 0;
  if (data.isDefault !== undefined) payload.is_default = Boolean(data.isDefault);
  return payload;
}

async function clearOtherDefaults(exceptId: string) {
  const db = getAdminDb();
  await db
    .from("product_dimension_profiles")
    .update({ is_default: false })
    .neq("id", exceptId)
    .eq("is_default", true);
}

function invalidate() {
  revalidateTag(DIMENSION_PROFILES_TAG, { expire: 0 });
}

export async function createDimensionProfile(data: Record<string, any>): Promise<DimensionProfile> {
  const payload = payloadFrom(data);
  if (!payload.name) throw new Error("Укажите название типа размеров");
  if (!payload.fields?.length) throw new Error("Добавьте хотя бы одно поле размера");
  const db = getAdminDb();
  const { data: row, error } = await db
    .from("product_dimension_profiles")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw error;
  if (payload.is_default) await clearOtherDefaults(row.id);
  invalidate();
  return mapRow(row);
}

export async function updateDimensionProfile(
  id: string,
  data: Record<string, any>,
): Promise<DimensionProfile> {
  const payload = payloadFrom(data);
  if (payload.name !== undefined && !payload.name) throw new Error("Укажите название типа размеров");
  if (payload.fields !== undefined && !payload.fields.length) {
    throw new Error("Добавьте хотя бы одно поле размера");
  }
  const db = getAdminDb();
  const { data: row, error } = await db
    .from("product_dimension_profiles")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  if (payload.is_default) await clearOtherDefaults(id);
  invalidate();
  return mapRow(row);
}

/** Удаление: категории и товары с этим типом возвращаются к типу по умолчанию. */
export async function deleteDimensionProfile(id: string): Promise<void> {
  const db = getAdminDb();
  await db.from("categories").update({ dimension_profile_id: null }).eq("dimension_profile_id", id);
  await db.from("products").update({ dimension_profile_id: null }).eq("dimension_profile_id", id);
  const { error } = await db.from("product_dimension_profiles").delete().eq("id", id);
  if (error) throw error;
  invalidate();
  revalidateTag("categories", { expire: 0 });
  revalidateTag("products", { expire: 0 });
}
