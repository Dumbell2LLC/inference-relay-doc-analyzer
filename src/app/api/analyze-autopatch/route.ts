import 'inference-relay/auto';
import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';
import { handleAnalyze } from '@/lib/shared-handler';
import { patchState } from '@/lib/patch-state';

patchState.autopatchLoaded = true;

export const runtime = 'nodejs';

const anthropic = new Anthropic();

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { mode, task, document, model } = body;

  if (mode === 'direct') {
    return Response.json(
      { error: 'Direct mode unavailable with auto-patch (Level 1). The SDK prototype is globally patched — all calls route through the relay. Use Level 2 for comparison mode.' },
      { status: 400 },
    );
  }

  return handleAnalyze(anthropic, { task, document, model, logEvents: [
    'inference-relay auto-patch active — routing through user subscription.',
  ]}, true);
}
