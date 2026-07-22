import { redirect } from "next/navigation";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";
export default function AdminPopupsRedirect() {
  redirect(`/${ADMIN_PATH}/promotions?tab=popups`);
}
