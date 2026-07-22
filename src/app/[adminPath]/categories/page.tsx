import { redirect } from "next/navigation";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";
export default function AdminCategoriesRedirect() {
  redirect(`/${ADMIN_PATH}/products?tab=categories`);
}
