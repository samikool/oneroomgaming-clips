import { getDb } from "@/db/client";
import { activityScores } from "@/db/activity";
import { parseBrowseQuery } from "@/lib/browse/query";
import { browseTabs, parseScope, parseTabs } from "@/lib/browse/tabs";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** One or more tabs of the clip browser. Bad params fall back to defaults; never a 500 for input. */
export async function GET(request: Request): Promise<Response> {
  const user = await requireUser();
  const params = new URL(request.url).searchParams;
  const query = parseBrowseQuery(params);

  return Response.json(
    browseTabs(getDb(), query, {
      tabs: parseTabs(params.get("tabs"), query.sort),
      cursor: params.get("cursor"),
      scope: parseScope(params.get("scope")),
      userId: user.id,
      scores: activityScores(getDb()),
    }),
  );
}
