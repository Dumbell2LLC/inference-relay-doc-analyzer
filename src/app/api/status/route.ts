import { patchState } from '@/lib/patch-state';

export const runtime = 'nodejs';

export async function GET() {
  return Response.json({ autopatchLoaded: patchState.autopatchLoaded });
}
