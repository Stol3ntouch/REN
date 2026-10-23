import { handleFormRequest } from '@/domain/requests/http';

export const dynamic = 'force-dynamic';

/** POST /api/forms/<repair|callback|contact|question|review> — JSON; логика и защита в handleFormRequest. */
export async function POST(req: Request, ctx: { params: Promise<{ kind: string }> }): Promise<Response> {
  const { kind } = await ctx.params;
  return handleFormRequest(kind, req);
}
