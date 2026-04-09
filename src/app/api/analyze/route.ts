import { NextRequest } from 'next/server';
import { getDirectClient, getRelayClient, classifyRelayError } from '@/lib/clients';
import { handleAnalyze } from '@/lib/shared-handler';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { mode, task, document, model } = body;

  if (mode === 'direct') {
    const client = getDirectClient();
    return handleAnalyze(client, { task, document, model }, false);
  }

  try {
    const relay = await getRelayClient();
    return handleAnalyze(relay, { task, document, model }, true);
  } catch (err) {
    return Response.json(
      { error: classifyRelayError(err) },
      { status: 500 },
    );
  }
}
