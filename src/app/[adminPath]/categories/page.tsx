import { redirect } from "next/navigation";
import { ADMIN_PATH } from "@/lib/admin-path";

export default function AdminCategoriesRedirect() {
  redirect(`/${ADMIN_PATH}/products?tab=categories`);
}
