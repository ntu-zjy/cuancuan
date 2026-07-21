import { redirect } from "next/navigation";
import AdminDashboard from "@/components/AdminDashboard";
import { getAdminSession } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  return <AdminDashboard adminEmail={session.email} />;
}
