import Anthropic from '@anthropic-ai/sdk';
import { InferenceRelay } from 'inference-relay';
import type { ProviderType } from '@/lib/analyze';

let directClient: Anthropic | null = null;
let relayPromise: Promise<InferenceRelay> | null = null;

export function classifyRelayError(err: unknown): string {
  const msg = ((err as Error)?.message || '').toLowerCase();
  if (!process.env.IR_LICENSE_KEY && !process.env.ANTHROPIC_API_KEY) {
    return 'inference-relay: no API keys configured';
  }
  if (msg.includes('signature') || msg.includes('invalid') || msg.includes('rejected')) {
    return 'inference-relay: license key invalid';
  }
  if (msg.includes('expired') || msg.includes('token')) {
    return 'inference-relay: license key expired';
  }
  if (msg.includes('cli') || msg.includes('not found') || msg.includes('detect')) {
    return 'inference-relay: gateway not available';
  }
  if (msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('network')) {
    return 'inference-relay: network error reaching the protocol authority';
  }
  return `inference-relay: init failed — ${msg.substring(0, 80) || 'unknown'}`;
}

export function getDirectClient(): Anthropic {
  if (!directClient) {
    directClient = new Anthropic();
  }
  return directClient;
}

export async function getRelayClient(): Promise<InferenceRelay> {
  if (!relayPromise) {
    relayPromise = (async () => {
      // Build provider list from env vars — direct API, no gateway dependency
      const providers: any[] = [];
      if (process.env.ANTHROPIC_API_KEY) {
        providers.push({ type: 'anthropic-api', apiKey: process.env.ANTHROPIC_API_KEY, priority: 1 });
      }
      if (process.env.OPENAI_API_KEY) {
        providers.push({ type: 'openai-api', apiKey: process.env.OPENAI_API_KEY, priority: 2 });
      }

      if (providers.length > 0) {
        return new InferenceRelay({
          licenseKey: process.env.IR_LICENSE_KEY || 'ir_web_direct',
          providers,
          fallback: true,
          telemetry: false,
        });
      }

      // Fallback to autoDetect (gateway mode)
      return InferenceRelay.autoDetect({
        licenseKey: process.env.IR_LICENSE_KEY || '',
      });
    })().catch((err) => {
      relayPromise = null;
      throw err;
    });
  }
  return relayPromise;
}
