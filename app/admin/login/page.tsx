import { redirect } from "next/navigation";
import AdminLogin from "@/components/AdminLogin";
import { getAdminSession, getLocalAdminHint } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  const session = await getAdminSession();
  if (session) redirect("/admin");
  return <AdminLogin localHint={getLocalAdminHint()} />;
}
