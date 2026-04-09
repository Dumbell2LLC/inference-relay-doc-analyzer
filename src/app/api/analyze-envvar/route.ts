import { InferenceRelay } from 'inference-relay';
import { NextRequest } from 'next/server';
import { handleAnalyze } from '@/lib/shared-handler';
import { classifyRelayError } from '@/lib/clients';

export const runtime = 'nodejs';

let relayPromise: Promise<InferenceRelay> | null = null;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { mode, task, document, model } = body;

  if (mode === 'direct') {
    return Response.json(
      { error: 'Direct mode unavailable with env-var integration (Level 3). The relay is activated via INFERENCE_RELAY_ENABLED. Use Level 2 for comparison mode.' },
      { status: 400 },
    );
  }

  if (process.env.INFERENCE_RELAY_ENABLED !== 'true') {
    return Response.json(
      { error: 'INFERENCE_RELAY_ENABLED is not set to "true" in .env.local. Level 3 requires this environment variable to activate the relay. Set it and restart the dev server.' },
      { status: 400 },
    );
  }

  if (!relayPromise) {
    relayPromise = InferenceRelay.autoDetect({
      licenseKey: process.env.IR_LICENSE_KEY || '',
    });
  }
  try {
    const relay = await relayPromise;
    return handleAnalyze(relay, { task, document, model }, true);
  } catch (err) {
    relayPromise = null;
    return Response.json(
      { error: classifyRelayError(err) },
      { status: 500 },
    );
  }
}
