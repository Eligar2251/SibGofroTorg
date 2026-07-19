import { NextResponse } from "next/server";
import { getCategories } from "@/lib/firestore-queries";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const categories = await getCategories();
    // Отдаем чистый массив со всеми нужными полями для шапки
    const serialized = categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      icon: cat.icon ?? "box",
    }));
    return NextResponse.json(serialized);
  } catch (error) {
    console.error("API Categories dropdown error:", error);
    return NextResponse.json({ error: "Ошибка базы данных" }, { status: 500 });
  }
}