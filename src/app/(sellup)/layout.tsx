import { AppShell } from "@/components/layout/app-shell";

export default function SellUpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
