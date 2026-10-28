import { redirect } from "next/navigation";

/** El inicio de todos es el Pipeline: Growth es un vendedor más (dueña 28-10). */
export default async function HomePage() {
  redirect("/pipeline");
}
