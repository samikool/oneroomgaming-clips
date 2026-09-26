import { Dock } from "@/components/dock";
import { SiteHeader } from "@/components/site-header";
import { RealtimeProvider } from "@/lib/realtime/provider";

export function AppShell({
  me,
  name,
  children,
}: {
  me: string;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <RealtimeProvider>
      <SiteHeader me={me} name={name} />
      {/* Room for the fixed dock, so it never covers the last row of the grid. */}
      <div className="pb-24">{children}</div>
      <Dock me={me} />
    </RealtimeProvider>
  );
}
