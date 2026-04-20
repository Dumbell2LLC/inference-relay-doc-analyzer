import { NextResponse } from 'next/server';
import { computeCost } from './analyze';

// Map internal provider strings to public-facing labels.
// Never let raw provider names leak to the client.
function sanitizeProvider(p: string | undefined): string {
  if (!p) return 'unknown';
  if (p === 'claude-cli') return 'native-gateway';
  if (p === 'anthropic-api') return 'api-provider';
  return p;
}

interface AnalyzeParams {
  task: 'triage' | 'extract';
  document: string;
  model: string;
  logEvents?: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MessagesClient = any;

export async function handleAnalyze(
  client: MessagesClient,
  params: AnalyzeParams,
  isRelay: boolean,
): Promise<Response> {
  const { task, document, model, logEvents } = params;

  if (!document || typeof document !== 'string') {
    return NextResponse.json({ error: 'Document text required' }, { status: 400 });
  }
  if (document.length > 500_000) {
    return NextResponse.json({ error: 'Document exceeds 500KB limit' }, { status: 400 });
  }

  if (task === 'triage') {
    return handleTriage(client, document, model, isRelay, logEvents);
  }
  return handleExtract(client, document, model, isRelay, logEvents);
}

async function handleTriage(
  client: MessagesClient,
  document: string,
  model: string,
  isRelay: boolean,
  logEvents?: string[],
): Promise<Response> {
  const start = Date.now();
  const result = await client.messages.create({
    model,
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `Classify this document in one sentence. What type of document is it and what is the primary subject?\n\n${document.substring(0, 4000)}`,
    }],
  });

  const latencyMs = Date.now() - start;
  const text = result.content?.[0]?.type === 'text' ? result.content[0].text : '';
  const inputTokens = result.usage?.input_tokens || 0;
  const outputTokens = result.usage?.output_tokens || 0;

  const costUsd = isRelay
    ? (result.costUsd ?? 0)
    : computeCost(model, inputTokens, outputTokens);

  const provider = sanitizeProvider(isRelay ? result.provider ?? 'relay' : 'anthropic-api');

  return NextResponse.json({
    classification: text,
    model: result.model || model,
    latencyMs,
    costUsd,
    provider,
    inputTokens,
    outputTokens,
    logEvents: logEvents || [],
  });
}

async function handleExtract(
  client: MessagesClient,
  document: string,
  model: string,
  isRelay: boolean,
  logEvents?: string[],
): Promise<Response> {
  const start = Date.now();
  const stream = await client.messages.create({
    model,
    max_tokens: 2000,
    stream: true,
    messages: [{
      role: 'user',
      content: `Extract every date, person name, organization, financial figure, and key claim from this document. Provide a structured list grouped by category.\n\n${document}`,
    }],
  });

  let inputTokens = 0;
  let outputTokens = 0;

  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Send any route-injected log events first
      if (logEvents?.length) {
        for (const msg of logEvents) {
          send({ type: 'log', message: msg });
        }
      }

      try {
        for await (const event of stream as AsyncIterable<any>) {
          if (event.type === 'message_start') {
            inputTokens = event.message?.usage?.input_tokens || 0;
            send({ type: 'stream_init', inputTokens });
          } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            send({ type: 'text', text: event.delta.text });
          } else if (event.type === 'message_delta') {
            outputTokens = event.usage?.output_tokens || 0;
          } else if (event.type === 'message_stop') {
            send({ type: 'stream_end' });
          }
        }

        const durationMs = Date.now() - start;

        // Try to get relay-specific metadata
        let provider = isRelay ? 'relay' : 'anthropic-api';
        let costUsd = isRelay ? 0 : computeCost(model, inputTokens, outputTokens);
        let userCostUsd: number | undefined;

        if (isRelay && stream && typeof stream === 'object' && 'finalMessage' in stream) {
          const fm = (stream as { finalMessage?: unknown }).finalMessage;
          if (typeof fm === 'function') {
            try {
              const final = await (fm as () => Promise<any>).call(stream);
              provider = final?.provider || provider;
              costUsd = final?.costUsd ?? costUsd;
              userCostUsd = final?.userCostUsd;
              if (final?.usage) {
                inputTokens = final.usage.input_tokens || inputTokens;
                outputTokens = final.usage.output_tokens || outputTokens;
              }
            } catch { /* best-effort: fall through to observed token counts */ }
          }
        }
        // If finalMessage was unavailable, costUsd stays at its initial value:
        // - For relay: 0 (the relay handles billing on the user subscription)
        // - For direct: pre-computed from token counts × pricing table

        send({
          type: 'metadata',
          provider: sanitizeProvider(provider),
          costUsd,
          ...(userCostUsd !== undefined ? { userCostUsd } : {}),
          durationMs,
          inputTokens,
          outputTokens,
        });

        controller.close();
      } catch (err) {
        send({ type: 'error', message: (err as Error).message });
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
