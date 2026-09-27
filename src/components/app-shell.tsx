import { ActivityBar } from "@/components/activity-bar";
import { PageSlide, SlideProvider } from "@/components/page-slide";
import { ProfilesProvider } from "@/components/profiles-provider";
import { SiteHeader } from "@/components/site-header";
import type { Profile } from "@/lib/profiles/types";
import { RealtimeProvider } from "@/lib/realtime/provider";
import { UploadsProvider } from "@/lib/uploads/provider";

export function AppShell({
  me,
  isAdmin,
  showSignOut,
  profiles,
  children,
}: {
  me: string;
  isAdmin: boolean;
  showSignOut: boolean;
  profiles: Profile[];
  children: React.ReactNode;
}) {
  return (
    <RealtimeProvider>
      {/* Inside realtime, which keeps it live; above everything that shows a person. */}
      <ProfilesProvider initial={profiles}>
        {/* Above the pages, so moving around the site never stops an upload. */}
        <UploadsProvider me={me}>
          <SlideProvider>
            <SiteHeader me={me} isAdmin={isAdmin} showSignOut={showSignOut} />
            {/* Room for the fixed activity bar, so it never covers the last row of the grid. */}
            <div className="pb-24">
              <PageSlide>{children}</PageSlide>
            </div>
          </SlideProvider>
          <ActivityBar me={me} />
        </UploadsProvider>
      </ProfilesProvider>
    </RealtimeProvider>
  );
}
