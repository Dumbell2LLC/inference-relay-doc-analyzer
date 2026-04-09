'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { MODEL_GROUPS, estimateCost } from '@/lib/analyze';

type Level = 1 | 2 | 3;
type Mode = 'relay' | 'direct' | 'comparison';

interface TriageResult {
  classification: string;
  model: string;
  latencyMs: number;
  costUsd: number;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  logEvents?: string[];
}

interface ExtractMetadata {
  provider: string;
  costUsd: number;
  userCostUsd?: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
}

interface PanelState {
  triage: TriageResult | null;
  extraction: string;
  extractMeta: ExtractMetadata | null;
  logs: LogEntry[];
  streamChunks: number;
  running: boolean;
  error: string | null;
}

interface LogEntry {
  time: string;
  message: string;
  type: 'info' | 'phase' | 'stream' | 'error' | 'intercept';
}

function timestamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function providerLabel(p: string): string {
  if (p === 'native-gateway') return 'NATIVE_GW';
  if (p === 'api-provider') return 'API_PROVIDER';
  if (p === 'relay') return 'RELAY';
  return p.toUpperCase();
}

const ROUTE_MAP: Record<Level, string> = {
  1: '/api/analyze-autopatch',
  2: '/api/analyze',
  3: '/api/analyze-envvar',
};

const LEVEL_LABELS: Record<Level, { name: string; desc: string; code: string }> = {
  1: {
    name: 'L1 AUTO-PATCH',
    desc: 'One import line. SDK is patched invisibly.',
    code: "import 'inference-relay/auto';",
  },
  2: {
    name: 'L2 EXPLICIT',
    desc: 'Dedicated relay instance. Supports comparison.',
    code: 'const relay = new InferenceRelay();',
  },
  3: {
    name: 'L3 ENV VAR',
    desc: 'Activate via deployment config.',
    code: 'INFERENCE_RELAY_ENABLED=true',
  },
};

function emptyPanel(): PanelState {
  return { triage: null, extraction: '', extractMeta: null, logs: [], streamChunks: 0, running: false, error: null };
}

const SAMPLE_DOCUMENT = `Q4 2025 INFRASTRUCTURE PERFORMANCE REPORT
Helios Cloud Platform Engineering Group

EXECUTIVE SUMMARY

Helios Cloud's platform engineering team closed Q4 2025 with availability at 99.971% against a 99.95% target, total infrastructure spend of $14.82M against a $15.4M budget (3.8% under), and 47 production deployments shipped against a planned 42. The quarter was dominated by three major workstreams: the Atlas v4 storage migration, the Northbridge identity consolidation, and the response to one significant customer-visible incident.

The quarter's most notable achievement was the December 8 completion of the Atlas v4 cutover, which migrated 4.7 petabytes of cold-storage data from the legacy Glacier-class tier to a new erasure-coded backend. The migration ran 11 days ahead of schedule and came in $340,000 under the projected $2.1M ceiling. Annualized storage savings are projected at $1.04M.

The most painful event was the November 14 ingestion pipeline degradation (incident INC-2025-Q4-0118). Root cause was a missing Helm value override on a newly deployed query routing service. Total customer-visible downtime was 2 hours 47 minutes. Four Pro-tier SLAs were breached, resulting in $11,400 in service credits issued in the December billing cycle. A full postmortem was published on November 18 and four corrective actions are tracked, two of which had completed by year end.

KEY METRICS

Reliability: median MTTD 4.2 minutes (down from 6.1m in Q3), median MTTR 38 minutes (down from 51m). Total page volume 287, of which 84% were actionable. 12 declared incidents (1 SEV-2, 4 SEV-3, 7 SEV-4) versus 19 in Q3.

Performance: P50/P95/P99 ingest latency 84ms / 218ms / 412ms — within all SLA targets. Peak ingestion throughput 412,000 events/second on November 26 (Black Friday), absorbed cleanly by the new Atlas v4 backend.

Cost: total $14.82M, broken down as compute $6.41M (43.3%), storage $3.18M (21.5%), network $2.04M (13.8%), database $1.87M (12.6%), observability $0.71M (4.8%), other $0.61M (4.1%). Cost per million ingested events fell from $0.024 in Q3 to $0.018 in Q4 — a 25% quarter-over-quarter improvement and 42% year-over-year.

TEAM ACTIVITY

Headcount grew from 38 to 41 engineers. Three new hires joined in October: Dmitri Volkov (Senior SRE, ex-Stripe), Sarah Whittaker (Staff SWE, ex-Datadog), and Felipe Ortiz (Senior SWE, ex-HashiCorp). One departure: Senior SRE Nadia Petersen left for a competing role at the end of November. Her transition was executed cleanly and her on-call rotations were absorbed without significant load increase. Q1 hiring target is four additional engineers to reach 45.

Top code reviewers by volume this quarter: Marcus Chen (84), Aiko Tanaka (72), Priya Ramanathan (67), Yuki Nakamura (58), Diego Morales (51). Total PRs merged: 287, with median time-to-merge of 6.4 hours.

Q1 2026 ROADMAP HIGHLIGHTS

Six initiatives are scheduled for Q1: the query plan caching layer (lead Sarah Whittaker, target late February), the Tier 4 admin tooling replacement (lead Felipe Ortiz, target mid-March), multi-region preparation for a future EU-West deployment (lead Marcus Chen, target late March), observability data retention policy revision projected to save $40-60K per quarter (lead Dmitri Volkov, target late January), secrets management automation (lead Yuki Nakamura, target late February), and the query planner refactoring scoping study (lead Aiko Tanaka, target mid-March).

The team is committed to closing all six remaining high-severity technical debt items by the end of Q1, which would mark the first quarter in two years with zero high-severity items open.

Document version: 1.0 final. Authors: Marcus Chen, Aiko Tanaka, Priya Ramanathan. Reviewers: VP Engineering, CFO, Head of Customer Success. Distribution: Internal — Helios Cloud leadership and platform engineering.`;

export default function DocAnalyzer() {
  const [document, setDocument] = useState('');
  const [level, setLevel] = useState<Level>(2);
  const [mode, setMode] = useState<Mode>('relay');
  const [phase1Model, setPhase1Model] = useState('claude-haiku-4-5');
  const [phase2Model, setPhase2Model] = useState('claude-sonnet-4-6');
  const [autopatchActive, setAutopatchActive] = useState(false);

  // Panels: single mode uses panelA, comparison uses both
  const [panelA, setPanelA] = useState<PanelState>(emptyPanel());
  const [panelB, setPanelB] = useState<PanelState>(emptyPanel());

  const [elapsedMs, setElapsedMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const logRefA = useRef<HTMLDivElement>(null);
  const logRefB = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const running = panelA.running || panelB.running;

  // Check autopatch status on mount (server flag + localStorage fallback for HMR)
  useEffect(() => {
    const local = typeof window !== 'undefined' && window.localStorage.getItem('autopatchLoaded') === 'true';
    if (local) setAutopatchActive(true);
    fetch('/api/status').then(r => r.json()).then(d => {
      if (d.autopatchLoaded) setAutopatchActive(true);
    }).catch(() => {});
  }, []);

  // Effective mode based on level
  const effectiveMode = (level === 1 || level === 3) ? 'relay' : mode;
  const isComparison = effectiveMode === 'comparison';

  const addLog = useCallback((panel: 'a' | 'b', message: string, type: LogEntry['type'] = 'info') => {
    const entry: LogEntry = { time: timestamp(), message, type };
    if (panel === 'a') {
      setPanelA(prev => ({ ...prev, logs: [...prev.logs, entry] }));
      setTimeout(() => logRefA.current?.scrollTo(0, logRefA.current.scrollHeight), 10);
    } else {
      setPanelB(prev => ({ ...prev, logs: [...prev.logs, entry] }));
      setTimeout(() => logRefB.current?.scrollTo(0, logRefB.current.scrollHeight), 10);
    }
  }, []);

  const reset = useCallback(() => {
    setPanelA(emptyPanel());
    setPanelB(emptyPanel());
    setElapsedMs(0);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const runPanel = useCallback(async (
    panel: 'a' | 'b',
    setPanel: React.Dispatch<React.SetStateAction<PanelState>>,
    panelMode: 'direct' | 'relay',
    route: string,
  ) => {
    setPanel(prev => ({ ...prev, running: true }));
    const modeLabel = panelMode === 'direct' ? 'DIRECT' : 'RELAY';
    addLog(panel, `SESSION INITIATED (${modeLabel})`, 'info');

    // Phase 1: Triage
    addLog(panel, `PHASE_1 → ${phase1Model} (${panelMode === 'direct' ? 'APP_KEY' : modeLabel})`, 'phase');
    try {
      const triageRes = await fetch(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: panelMode, task: 'triage', document, model: phase1Model }),
      });
      if (!triageRes.ok) {
        const err = await triageRes.json();
        addLog(panel, `PHASE_1 ERROR: ${err.error}`, 'error');
        setPanel(prev => ({ ...prev, running: false, error: err.error }));
        return;
      }
      const triageData: TriageResult = await triageRes.json();
      setPanel(prev => ({ ...prev, triage: triageData }));

      // Show any injected log events (e.g., SDK_INTERCEPT_SUCCESS)
      if (triageData.logEvents?.length) {
        for (const msg of triageData.logEvents) {
          addLog(panel, msg, 'intercept');
        }
      }

      addLog(panel, `PHASE_1 COMPLETE: ${providerLabel(triageData.provider)} ${triageData.latencyMs}ms $${triageData.costUsd.toFixed(4)}`, 'phase');
    } catch (err) {
      addLog(panel, `PHASE_1 FAILED: ${(err as Error).message}`, 'error');
      setPanel(prev => ({ ...prev, running: false, error: (err as Error).message }));
      return;
    }

    // Phase 2: Extract (streaming)
    addLog(panel, `PHASE_2 → ${phase2Model} (${modeLabel})`, 'phase');
    try {
      const extractRes = await fetch(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: panelMode, task: 'extract', document, model: phase2Model }),
      });
      if (!extractRes.ok) {
        const err = await extractRes.json();
        addLog(panel, `PHASE_2 ERROR: ${err.error}`, 'error');
        setPanel(prev => ({ ...prev, running: false, error: err.error }));
        return;
      }

      const reader = extractRes.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let chunks = 0;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.type === 'text') {
                setPanel(prev => ({ ...prev, extraction: prev.extraction + parsed.text }));
                chunks++;
                setPanel(prev => ({ ...prev, streamChunks: chunks }));
                if (chunks % 5 === 0) addLog(panel, `chunk ${chunks}`, 'stream');
              } else if (parsed.type === 'metadata') {
                setPanel(prev => ({ ...prev, extractMeta: parsed }));
                addLog(panel, `PHASE_2 COMPLETE: ${providerLabel(parsed.provider)} ${parsed.durationMs}ms $${parsed.costUsd.toFixed(4)}`, 'phase');
              } else if (parsed.type === 'stream_init') {
                addLog(panel, `stream_init (input_tokens: ${parsed.inputTokens})`, 'stream');
              } else if (parsed.type === 'stream_end') {
                addLog(panel, 'stream_end', 'stream');
              } else if (parsed.type === 'log') {
                addLog(panel, parsed.message, 'intercept');
              } else if (parsed.type === 'error') {
                addLog(panel, `ERROR: ${parsed.message}`, 'error');
              }
            } catch { /* skip malformed */ }
          }
        }
      }
    } catch (err) {
      addLog(panel, `PHASE_2 FAILED: ${(err as Error).message}`, 'error');
    }

    addLog(panel, 'SESSION COMPLETE — TELEMETRY DISPATCHED', 'info');
    setPanel(prev => ({ ...prev, running: false }));
  }, [document, phase1Model, phase2Model, addLog]);

  const analyze = useCallback(async () => {
    if (!document.trim() || running) return;

    // Cost warning for comparison mode
    if (isComparison) {
      const est = estimateCost(phase2Model, document.length);
      if (!confirm(`Comparison mode will make a direct Anthropic API call.\nEstimated cost: ~$${est.toFixed(4)}\nProceed?`)) return;
    }

    reset();
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => setElapsedMs(Date.now() - startTimeRef.current), 100);

    const route = ROUTE_MAP[level];

    if (isComparison) {
      // Fire both in parallel
      await Promise.all([
        runPanel('a', setPanelA, 'direct', ROUTE_MAP[2]),
        runPanel('b', setPanelB, 'relay', ROUTE_MAP[2]),
      ]);
    } else {
      await runPanel('a', setPanelA, effectiveMode as 'direct' | 'relay', route);
    }

    if (timerRef.current) clearInterval(timerRef.current);
    setElapsedMs(Date.now() - startTimeRef.current);

    // Check if autopatch was just loaded
    if (level === 1) {
      setAutopatchActive(true);
      if (typeof window !== 'undefined') window.localStorage.setItem('autopatchLoaded', 'true');
    }
  }, [document, running, level, effectiveMode, isComparison, phase2Model, reset, runPanel]);

  const [parsing, setParsing] = useState(false);

  const handleFileUpload = useCallback(async (file: File) => {
    if (!file.name.match(/\.(txt|md|pdf)$/i)) {
      alert('Supported formats: .txt, .md, .pdf');
      return;
    }
    if (file.name.match(/\.pdf$/i)) {
      try {
        setParsing(true);
        const { extractPdfText } = await import('@/lib/pdf-extract');
        const text = await extractPdfText(file);
        setDocument(text);
      } catch (err) {
        alert(`PDF extraction failed: ${(err as Error).message}`);
      } finally {
        setParsing(false);
      }
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => setDocument(e.target?.result as string || '');
    reader.readAsText(file);
  }, []);


  // Cost computation for comparison
  const panelACost = (panelA.triage?.costUsd || 0) + (panelA.extractMeta?.costUsd || 0);
  const panelBCost = (panelB.triage?.costUsd || 0) + (panelB.extractMeta?.costUsd || 0);

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid #27272A', paddingBottom: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>DOC ANALYZER</h1>
          <span style={{ fontSize: 11, color: '#71717A' }}>inference-relay DEMO v0.1</span>
        </div>
        <div style={{ fontSize: 10, color: '#52525B', maxWidth: 400, textAlign: 'right' }}>
          Privacy: Dumb Pipe Architecture — document content isolated within local execution context
        </div>
      </div>

      {/* Autopatch Warning Banner — visible whenever auto-patch was loaded */}
      {autopatchActive && (
        <div style={{ background: '#422006', border: '1px solid #92400E', borderRadius: 4, padding: '8px 12px', marginBottom: 12, fontSize: 11 }}>
          <span style={{ color: '#FCD34D' }}>
            AUTO-PATCH ACTIVE — SDK prototype is globally patched. To test clean L2 comparison mode, stop the dev server (<code style={{ background: '#1c1108', padding: '1px 4px', borderRadius: 2 }}>Ctrl+C</code>) and restart with <code style={{ background: '#1c1108', padding: '1px 4px', borderRadius: 2 }}>pnpm dev</code>.
          </span>
        </div>
      )}

      {/* Controls Row */}
      <div style={{ display: 'flex', gap: 24, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {/* Integration Level */}
        <div>
          <div style={{ fontSize: 10, color: '#71717A', marginBottom: 4, fontWeight: 600 }}>INTEGRATION LEVEL</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {([1, 2, 3] as Level[]).map(l => (
              <button key={l} onClick={() => { setLevel(l); if (l !== 2) setMode('relay'); }}
                style={{
                  padding: '6px 12px', fontSize: 10, fontFamily: 'inherit', border: '1px solid',
                  borderColor: level === l ? '#10b981' : '#27272A', borderRadius: 3, cursor: 'pointer',
                  background: level === l ? '#064E3B' : 'transparent', color: level === l ? '#10b981' : '#A1A1AA',
                  fontWeight: level === l ? 600 : 400,
                }}>
                {LEVEL_LABELS[l].name}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 9, color: '#52525B', marginTop: 2 }}>{LEVEL_LABELS[level].desc}</div>
          <code style={{ fontSize: 9, color: '#10b981', display: 'block', marginTop: 2 }}>{LEVEL_LABELS[level].code}</code>
        </div>

        {/* Mode Toggle */}
        <div>
          <div style={{ fontSize: 10, color: '#71717A', marginBottom: 4, fontWeight: 600 }}>MODE</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['relay', 'direct', 'comparison'] as Mode[]).map(m => {
              const disabled = (m !== 'relay' && level !== 2);
              return (
                <button key={m} onClick={() => !disabled && setMode(m)}
                  style={{
                    padding: '6px 12px', fontSize: 10, fontFamily: 'inherit', border: '1px solid',
                    borderColor: effectiveMode === m ? '#3b82f6' : '#27272A', borderRadius: 3,
                    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.3 : 1,
                    background: effectiveMode === m ? '#1E3A5F' : 'transparent',
                    color: effectiveMode === m ? '#60A5FA' : '#A1A1AA',
                  }}>
                  {m === 'relay' ? 'RELAY ONLY' : m === 'direct' ? 'DIRECT ONLY' : 'COMPARISON'}
                </button>
              );
            })}
          </div>
          {level !== 2 && <div style={{ fontSize: 9, color: '#52525B', marginTop: 2 }}>Comparison requires Level 2</div>}
        </div>

        {/* Model Selectors */}
        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ fontSize: 10, color: '#A1A1AA' }}>
            P1 MODEL
            <select value={phase1Model} onChange={e => setPhase1Model(e.target.value)}
              style={{ display: 'block', background: '#18181B', color: '#fafafa', border: '1px solid #27272A', padding: '4px 8px', fontFamily: 'inherit', fontSize: 10, marginTop: 2 }}>
              {MODEL_GROUPS.map(g => (
                <optgroup key={g.provider} label={g.label}>
                  {g.models.map(m => <option key={m} value={m}>{m}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 10, color: '#A1A1AA' }}>
            P2 MODEL
            <select value={phase2Model} onChange={e => setPhase2Model(e.target.value)}
              style={{ display: 'block', background: '#18181B', color: '#fafafa', border: '1px solid #27272A', padding: '4px 8px', fontFamily: 'inherit', fontSize: 10, marginTop: 2 }}>
              {MODEL_GROUPS.map(g => (
                <optgroup key={g.provider} label={g.label}>
                  {g.models.map(m => <option key={m} value={m}>{m}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Document Input */}
      {!panelA.triage && !running && (
        <div style={{ border: '1px solid #27272A', borderRadius: 4, marginBottom: 16 }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #27272A', fontSize: 11, color: '#A1A1AA', fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
            <span>DOCUMENT INPUT</span>
            <span style={{ color: parsing ? '#FCD34D' : '#52525B' }}>{parsing ? 'EXTRACTING PDF...' : (document.length > 0 ? `${(document.length / 1024).toFixed(1)} KB` : '')}</span>
          </div>
          <textarea value={document} onChange={e => setDocument(e.target.value)}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileUpload(f); }}
            onDragOver={e => e.preventDefault()}
            placeholder="Paste document text or drop a .txt/.md/.pdf file..."
            style={{ width: '100%', minHeight: 200, padding: 12, background: 'transparent', color: '#fafafa', border: 'none', fontFamily: 'inherit', fontSize: 12, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
          />
          <input ref={fileInputRef} type="file" accept=".txt,.md,.pdf" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }} />
        </div>
      )}

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={analyze} disabled={!document.trim() || running}
          style={{ padding: '8px 20px', background: running ? '#27272A' : '#10b981', color: running ? '#71717A' : '#09090B', border: 'none', borderRadius: 4, fontFamily: 'inherit', fontSize: 11, fontWeight: 600, cursor: running ? 'not-allowed' : 'pointer' }}>
          {running ? 'ANALYZING...' : 'ANALYZE'}
        </button>
        {!panelA.triage && !running && (
          <>
            <button onClick={() => setDocument(SAMPLE_DOCUMENT)} style={{ padding: '8px 16px', background: 'transparent', color: '#A1A1AA', border: '1px solid #27272A', borderRadius: 4, fontFamily: 'inherit', fontSize: 11, cursor: 'pointer' }}>LOAD SAMPLE</button>
            <button onClick={() => fileInputRef.current?.click()} style={{ padding: '8px 16px', background: 'transparent', color: '#A1A1AA', border: '1px solid #27272A', borderRadius: 4, fontFamily: 'inherit', fontSize: 11, cursor: 'pointer' }}>UPLOAD FILE</button>
          </>
        )}
        {panelA.triage && !running && (
          <>
            <button onClick={() => { reset(); setDocument(''); }} style={{ padding: '8px 16px', background: 'transparent', color: '#A1A1AA', border: '1px solid #27272A', borderRadius: 4, fontFamily: 'inherit', fontSize: 11, cursor: 'pointer' }}>RESET</button>
            <a href="https://inference-relay.com/dashboard/usage" target="_blank" rel="noopener noreferrer" style={{ padding: '8px 16px', background: 'transparent', color: '#3b82f6', border: '1px solid #27272A', borderRadius: 4, fontFamily: 'inherit', fontSize: 11, textDecoration: 'none', display: 'flex', alignItems: 'center' }}>DASHBOARD ↗</a>
          </>
        )}
        {(running || panelA.triage) && (
          <span style={{ fontSize: 10, color: '#71717A', alignSelf: 'center', marginLeft: 8 }}>
            {(elapsedMs / 1000).toFixed(1)}s elapsed
          </span>
        )}
      </div>

      {/* Results Area */}
      {(panelA.triage || panelA.running || panelA.logs.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: isComparison ? '1fr 1fr' : '1fr 320px', gap: 16 }}>
          {/* Panel A */}
          <ResultPanel panel={panelA} label={isComparison ? 'DIRECT API' : (effectiveMode === 'direct' ? 'DIRECT API' : 'WITH RELAY')} logRef={logRefA} accentColor={isComparison ? '#ef4444' : '#10b981'} showInlineLog={isComparison} />

          {/* Panel B (comparison) or Gateway Log (single mode) */}
          {isComparison ? (
            <ResultPanel panel={panelB} label="WITH RELAY" logRef={logRefB} accentColor="#10b981" showInlineLog={isComparison} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <LogPanel logs={panelA.logs} logRef={logRefA} />
              <ResourceMonitor panel={panelA} elapsedMs={elapsedMs} />
              <BillingBoundary />
            </div>
          )}
        </div>
      )}

      {/* Cost Comparison (comparison mode, both complete) */}
      {isComparison && panelA.extractMeta && panelB.extractMeta && (
        <CostComparisonTable
          directCost={panelACost}
          relayCost={panelBCost}
          directTriage={panelA.triage!.costUsd}
          relayTriage={panelB.triage!.costUsd}
          directExtract={panelA.extractMeta.costUsd}
          relayExtract={panelB.extractMeta.costUsd}
        />
      )}
    </div>
  );
}

function ResultPanel({ panel, label, logRef, accentColor, showInlineLog }: { panel: PanelState; label: string; logRef: React.RefObject<HTMLDivElement | null>; accentColor: string; showInlineLog: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: accentColor, letterSpacing: 1 }}>{label}</div>

      {panel.triage && (
        <div style={{ border: '1px solid #27272A', borderRadius: 4 }}>
          <div style={{ padding: '6px 10px', borderBottom: '1px solid #27272A', fontSize: 10, color: '#10b981', fontWeight: 600 }}>TRIAGE</div>
          <div style={{ padding: 10, fontSize: 11 }}>
            <div style={{ marginBottom: 6 }}>{panel.triage.classification}</div>
            <div style={{ display: 'flex', gap: 12, fontSize: 10, color: '#71717A', flexWrap: 'wrap' }}>
              <span>{panel.triage.latencyMs}ms</span>
              <span>${panel.triage.costUsd.toFixed(4)}</span>
              <span>{providerLabel(panel.triage.provider)}</span>
              <span>{panel.triage.inputTokens}in/{panel.triage.outputTokens}out</span>
            </div>
          </div>
        </div>
      )}

      {(panel.extraction || panel.running) && (
        <div style={{ border: '1px solid #27272A', borderRadius: 4 }}>
          <div style={{ padding: '6px 10px', borderBottom: '1px solid #27272A', fontSize: 10, fontWeight: 600, color: panel.extractMeta ? '#10b981' : '#3b82f6' }}>
            {panel.extractMeta ? 'EXTRACTION (COMPLETE)' : 'EXTRACTION (STREAMING)'}
          </div>
          <div style={{ padding: 10, fontSize: 11, whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto', lineHeight: 1.5 }}>
            {panel.extraction || <span style={{ color: '#52525B' }}>Awaiting stream...</span>}
            {!panel.extractMeta && panel.extraction && <span style={{ color: '#10b981' }}>▮</span>}
          </div>
          {panel.extractMeta && (
            <div style={{ padding: '6px 10px', borderTop: '1px solid #27272A', fontSize: 10, color: '#71717A', display: 'flex', gap: 12 }}>
              <span>{panel.extractMeta.durationMs}ms</span>
              <span>${panel.extractMeta.costUsd.toFixed(4)}</span>
              <span>{providerLabel(panel.extractMeta.provider)}</span>
              <span>{panel.extractMeta.inputTokens}in/{panel.extractMeta.outputTokens}out</span>
            </div>
          )}
        </div>
      )}

      {/* Inline log only in comparison mode (single mode has its own log in the right column) */}
      {showInlineLog && panel.logs.length > 0 && (
        <LogPanel logs={panel.logs} logRef={logRef} compact />
      )}
    </div>
  );
}

function LogPanel({ logs, logRef, compact }: { logs: LogEntry[]; logRef: React.RefObject<HTMLDivElement | null>; compact?: boolean }) {
  return (
    <div style={{ border: '1px solid #27272A', borderRadius: 4 }}>
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #27272A', fontSize: 10, color: '#A1A1AA', fontWeight: 600 }}>GATEWAY LOG</div>
      <div ref={logRef} style={{ padding: 6, fontSize: 9, maxHeight: compact ? 150 : 280, overflowY: 'auto', lineHeight: 1.5 }}>
        {logs.length === 0 && <div style={{ color: '#52525B' }}>[--:--:--] IDLE</div>}
        {logs.map((log, i) => (
          <div key={i} style={{
            color: log.type === 'error' ? '#ef4444'
              : log.type === 'phase' ? '#10b981'
              : log.type === 'stream' ? '#3b82f6'
              : log.type === 'intercept' ? '#FCD34D'
              : '#71717A'
          }}>
            [{log.time}] {log.message}
          </div>
        ))}
      </div>
    </div>
  );
}

function ResourceMonitor({ panel, elapsedMs }: { panel: PanelState; elapsedMs: number }) {
  if (!panel.triage && !panel.running) return null;
  return (
    <div style={{ border: '1px solid #27272A', borderRadius: 4 }}>
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #27272A', fontSize: 10, color: '#A1A1AA', fontWeight: 600 }}>RESOURCE MONITOR</div>
      <div style={{ padding: 10, fontSize: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, color: '#71717A' }}>
        <span>INPUT_TOKENS</span><span style={{ textAlign: 'right', color: '#fafafa' }}>{(panel.triage?.inputTokens || 0) + (panel.extractMeta?.inputTokens || 0)}</span>
        <span>OUTPUT_TOKENS</span><span style={{ textAlign: 'right', color: '#fafafa' }}>{(panel.triage?.outputTokens || 0) + (panel.extractMeta?.outputTokens || 0)}</span>
        <span>STREAM_CHUNKS</span><span style={{ textAlign: 'right', color: '#fafafa' }}>{panel.streamChunks}</span>
        <span>ELAPSED</span><span style={{ textAlign: 'right', color: '#fafafa' }}>{(elapsedMs / 1000).toFixed(1)}s</span>
        {panel.triage && <><span>P1_PROVIDER</span><span style={{ textAlign: 'right', color: '#3b82f6' }}>{providerLabel(panel.triage.provider)}</span></>}
        {panel.extractMeta && <><span>P2_PROVIDER</span><span style={{ textAlign: 'right', color: '#10b981' }}>{providerLabel(panel.extractMeta.provider)}</span></>}
      </div>
    </div>
  );
}

function BillingBoundary() {
  return (
    <div style={{ border: '1px solid #27272A', borderRadius: 4 }}>
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #27272A', fontSize: 10, color: '#A1A1AA', fontWeight: 600 }}>BILLING BOUNDARY</div>
      <div style={{ padding: 10, fontSize: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <div style={{ width: 6, height: 6, borderRadius: 2, background: '#3b82f6' }} />
          <span style={{ color: '#A1A1AA' }}>P1 ORCHESTRATION</span>
          <span style={{ marginLeft: 'auto', color: '#52525B' }}>APP_KEY</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: 2, background: '#10b981' }} />
          <span style={{ color: '#A1A1AA' }}>P2 EXECUTION</span>
          <span style={{ marginLeft: 'auto', color: '#52525B' }}>USER_SUB</span>
        </div>
      </div>
    </div>
  );
}

function CostComparisonTable({ directCost, relayCost, directTriage, relayTriage, directExtract, relayExtract }: {
  directCost: number; relayCost: number; directTriage: number; relayTriage: number; directExtract: number; relayExtract: number;
}) {
  const savings = directCost > 0 ? ((directCost - relayCost) / directCost * 100) : 0;
  return (
    <div style={{ border: '1px solid #27272A', borderRadius: 4, marginTop: 16 }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #27272A', fontSize: 11, color: '#A1A1AA', fontWeight: 600 }}>COST COMPARISON</div>
      <div style={{ padding: 12, fontSize: 11 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr', gap: 4, color: '#A1A1AA' }}>
          <span></span><span style={{ fontWeight: 600 }}>DIRECT</span><span style={{ fontWeight: 600 }}>RELAY</span><span style={{ fontWeight: 600 }}>SAVED</span>
          <span>PHASE 1</span><span>${directTriage.toFixed(4)}</span><span>${relayTriage.toFixed(4)}</span><span>—</span>
          <span>PHASE 2</span><span>${directExtract.toFixed(4)}</span><span style={{ color: '#10b981' }}>${relayExtract.toFixed(4)}</span><span style={{ color: '#10b981' }}>${(directExtract - relayExtract).toFixed(4)}</span>
          <span style={{ borderTop: '1px solid #27272A', paddingTop: 4, fontWeight: 600 }}>TOTAL</span>
          <span style={{ borderTop: '1px solid #27272A', paddingTop: 4 }}>${directCost.toFixed(4)}</span>
          <span style={{ borderTop: '1px solid #27272A', paddingTop: 4, color: '#10b981', fontWeight: 600 }}>${relayCost.toFixed(4)}</span>
          <span style={{ borderTop: '1px solid #27272A', paddingTop: 4, color: '#10b981', fontWeight: 600 }}>${(directCost - relayCost).toFixed(4)}</span>
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={{ height: 6, background: '#27272A', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(savings, 100)}%`, background: '#10b981', borderRadius: 3 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10 }}>
            <span style={{ color: '#10b981', fontWeight: 600 }}>SAVINGS: {savings.toFixed(1)}%</span>
            <span style={{ color: '#71717A' }}>${(directCost - relayCost).toFixed(4)} saved this call</span>
          </div>
        </div>
      </div>
    </div>
  );
}
