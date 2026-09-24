import { getUploadService } from "@/lib/uploads/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = (req: Request) => getUploadService().handle(req);
export { handle as POST, handle as PATCH, handle as HEAD, handle as DELETE, handle as OPTIONS };

// Deliberately NOT wired to the tus handler. @tus/server's GetHandler would
// stream completed upload bytes straight out through Node — video bytes must
// only ever be served by Caddy off disk. Keep this route 405 for GET.
export function GET() {
  return new Response("Method not allowed", { status: 405 });
}
