import { redirect } from "next/navigation";
import { getCurrentUser } from "@/modules/access/actions";
import { isGrowthRole } from "@/modules/access/capabilities";

/** El inicio de cada quien: Growth a su mesa de trabajo, el resto al Pipeline. */
export default async function HomePage() {
  const user = await getCurrentUser().catch(() => null);
  redirect(isGrowthRole(user?.role_key ?? null) ? "/growth" : "/pipeline");
}
