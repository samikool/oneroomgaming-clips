import { ActivityBar } from "@/components/activity-bar";
import { PageSlide, SlideProvider } from "@/components/page-slide";
import { SiteHeader } from "@/components/site-header";
import { RealtimeProvider } from "@/lib/realtime/provider";
import { UploadsProvider } from "@/lib/uploads/provider";

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
      {/* Above the pages, so moving around the site never stops an upload. */}
      <UploadsProvider me={me}>
        <SlideProvider>
          <SiteHeader me={me} name={name} />
          {/* Room for the fixed activity bar, so it never covers the last row of the grid. */}
          <div className="pb-24">
            <PageSlide>{children}</PageSlide>
          </div>
        </SlideProvider>
        <ActivityBar me={me} />
      </UploadsProvider>
    </RealtimeProvider>
  );
}
