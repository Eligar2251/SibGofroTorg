import { redirect } from "next/navigation";
import { ADMIN_PATH } from "@/lib/admin-path";

export default function AdminPopupsRedirect() {
  redirect(`/${ADMIN_PATH}/promotions?tab=popups`);
}
