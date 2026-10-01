export default function AccessSuspendedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="page-atmosphere flex min-h-screen items-center justify-center bg-background px-4 py-10 sm:px-6">
      {children}
    </div>
  );
}
