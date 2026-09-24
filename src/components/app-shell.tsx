import { Dock } from "@/components/dock";
import { RealtimeProvider } from "@/lib/realtime/provider";

export function AppShell({ me, children }: { me: string; children: React.ReactNode }) {
  return (
    <RealtimeProvider>
      {/* Room for the fixed dock, so it never covers the last row of the grid. */}
      <div className="pb-24">{children}</div>
      <Dock me={me} />
    </RealtimeProvider>
  );
}
