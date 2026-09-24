import { RealtimeProvider } from "@/lib/realtime/provider";

/**
 * Everything that needs the shared socket lives inside here. The dock joins it
 * in a later task; for now the shell exists so that wiring lands in one commit
 * rather than being threaded through the layout twice.
 */
export function AppShell({ children }: { me: string; children: React.ReactNode }) {
  return <RealtimeProvider>{children}</RealtimeProvider>;
}
