import { useEffect, useMemo, useState } from 'react';
import { Download, FileText, Info } from 'lucide-react';
import { RecordedEcg } from '../../components/ecg/RecordedEcg';
import { Badge, Button, EmptyState, Panel, PanelHeader, Stat } from '../../components/ui/primitives';
import { Select } from '../../components/ui/controls';
import { analyzeSamples, concatChunks } from '../../services/analyze';
import { buildCsv, downloadText, sessionFilename } from '../../services/csv';
import { buildPdf, downloadPdf } from '../../services/pdf';
import { getSessionChunks, listSessions, type SessionMeta, type StoredChunk } from '../../storage/db';
import { useAppStore } from '../../state/store';
import { formatBpm, formatDateTime, formatDuration, formatNumber } from '../../utils/format';

export function ReportsPage() {
  const pushToast = useAppStore((state) => state.pushToast);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [chunkState, setChunkState] = useState<{ sessionId: string; chunks: StoredChunk[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const rows = await listSessions();
        setSessions(rows);
        setSelectedId(rows[0]?.id ?? '');
      } catch (cause) {
        pushToast({ tone: 'danger', title: 'Could not list sessions', message: String(cause) });
      } finally {
        setLoading(false);
      }
    })();
  }, [pushToast]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    void (async () => {
      try {
        const stored = await getSessionChunks(selectedId);
        if (!cancelled) setChunkState({ sessionId: selectedId, chunks: stored });
      } catch (cause) {
        if (!cancelled) {
          pushToast({ tone: 'danger', title: 'Could not read session samples', message: String(cause) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, pushToast]);

  const selected = sessions.find((session) => session.id === selectedId) ?? null;
  const chunks = useMemo(
    () => (chunkState && chunkState.sessionId === selectedId ? chunkState.chunks : []),
    [chunkState, selectedId],
  );

  const prepared = useMemo(() => {
    if (!selected || chunks.length === 0) return null;
    const concatenated = concatChunks(chunks);
    const analysis = analyzeSamples(concatenated.samples, selected.sampleRateHz || 500);
    return { concatenated, analysis };
  }, [selected, chunks]);

  const exportCsv = () => {
    if (!selected) return;
    setWorking(true);
    try {
      const csv = buildCsv({ chunks, meta: selected });
      downloadText(sessionFilename(selected, 'csv'), csv);
      pushToast({
        tone: 'success',
        title: 'CSV exported',
        message: `${selected.sampleCount.toLocaleString()} rows including every stored sample.`,
      });
    } finally {
      setWorking(false);
    }
  };

  const exportPdf = () => {
    if (!selected) return;
    setWorking(true);
    try {
      const doc = buildPdf({
        meta: selected,
        chunks,
        quality: {
          score: selected.meanQuality === null ? null : Math.round(selected.meanQuality),
          category:
            selected.meanQuality === null ? 'n/a' : selected.meanQuality >= 75 ? 'good' : selected.meanQuality >= 50 ? 'fair' : 'poor',
        },
        electrode: null,
      });
      downloadPdf(doc, sessionFilename(selected, 'pdf'));
      pushToast({ tone: 'success', title: 'PDF report generated', message: 'Includes waveform, metrics and disclaimer.' });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-[30px]">Reports</h1>
        <p className="mt-1.5 max-w-2xl text-[12px] text-text-muted">
          Generate a printable PDF summary or a full-resolution CSV of any stored session. Neither export leaves your
          machine.
        </p>
      </div>

      {loading ? (
        <Panel className="p-8 text-center text-[12px] text-text-dim">Reading local database…</Panel>
      ) : sessions.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<FileText size={20} aria-hidden />}
            title="No sessions to report"
            description="Record a session from the Overview page first — reports are generated from stored recordings only."
          />
        </Panel>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-6">
            <Panel>
              <PanelHeader
                title="Session selection"
                subtitle="Pick the recording to report on"
                actions={
                  <Select
                    value={selectedId}
                    onChange={(event) => setSelectedId(event.target.value)}
                    aria-label="Select session"
                    className="h-8 w-auto"
                  >
                    {sessions.map((session) => (
                      <option key={session.id} value={session.id}>
                        {formatDateTime(session.startedAt)} · {session.source} · {session.sampleCount.toLocaleString()} samples
                      </option>
                    ))}
                  </Select>
                }
              />
              {selected && prepared ? (
                <div className="p-2">
                  <RecordedEcg
                    filtered={prepared.analysis.filtered}
                    leadOff={prepared.concatenated.leadOff}
                    sampleRateHz={selected.sampleRateHz || 500}
                    windowSeconds={Math.min(10, Math.max(1, selected.sampleCount / (selected.sampleRateHz || 500)))}
                    offsetSeconds={0}
                    height={210}
                    label="Waveform preview that will appear in the PDF report"
                  />
                </div>
              ) : (
                <p className="px-3 py-8 text-center text-[12px] text-text-dim">
                  {chunks.length === 0 ? 'No stored samples for this session.' : 'Preparing preview…'}
                </p>
              )}
            </Panel>

            <Panel>
              <PanelHeader title="Report contents" icon={<Info size={14} aria-hidden />} />
              <ul className="grid gap-1.5 px-3 py-3 text-[11.5px] text-text-muted sm:grid-cols-2">
                {[
                  'CARDIOPULSE identity and session id',
                  'Recording date, duration, source and device',
                  'Sampling frequency and stored sample count',
                  'Average, minimum and maximum heart rate',
                  'RR summary, SDNN and RMSSD when valid',
                  'Filtered ECG waveform with R-peak ticks',
                  'Signal-quality and electrode summary',
                  'Educational-use disclaimer',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-1.5">
                    <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent/70" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <div className="space-y-6">
            <Panel>
              <PanelHeader title="Selected session" />
              {selected ? (
                <div className="grid grid-cols-2 gap-x-3 gap-y-4 p-3">
                  <Stat label="Started" value={formatDateTime(selected.startedAt).split(',')[0] ?? '—'} size="sm" />
                  <Stat label="Duration" value={formatDuration(selected.durationMs)} size="sm" />
                  <Stat label="Avg BPM" value={formatBpm(selected.avgBpm)} size="sm" tone="accent" />
                  <Stat label="Samples" value={selected.sampleCount.toLocaleString()} size="sm" />
                  <Stat label="SDNN" value={selected.sdnnMs === null ? '—' : formatNumber(selected.sdnnMs, 1)} unit="ms" size="sm" />
                  <Stat label="RMSSD" value={selected.rmssdMs === null ? '—' : formatNumber(selected.rmssdMs, 1)} unit="ms" size="sm" />
                  <Stat label="Mean quality" value={selected.meanQuality === null ? '—' : Math.round(selected.meanQuality)} unit="/100" size="sm" />
                  <div>
                    <div className="text-[10px] label-mono text-text-dim">Source</div>
                    <div className="mt-1">
                      <Badge tone={selected.source === 'simulation' ? 'idle' : 'accent'}>{selected.source}</Badge>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="px-3 py-6 text-[12px] text-text-dim">Select a session.</p>
              )}
            </Panel>

            <Panel>
              <PanelHeader title="Export" />
              <div className="flex flex-col gap-2 p-3">
                <Button
                  variant="primary"
                  icon={<FileText size={13} aria-hidden />}
                  onClick={exportPdf}
                  disabled={!selected || chunks.length === 0 || working}
                >
                  Download PDF report
                </Button>
                <Button
                  icon={<Download size={13} aria-hidden />}
                  onClick={exportCsv}
                  disabled={!selected || chunks.length === 0 || working}
                >
                  Download full CSV
                </Button>
                <p className="text-[10.5px] leading-relaxed text-text-dim">
                  CSV keeps every sample (index, time, raw ADC, filtered value, beat marker, RR interval, lead-off state).
                  Nothing is downsampled.
                </p>
              </div>
            </Panel>

            <Panel className="border-warn/30 p-3">
              <p className="text-[11px] leading-relaxed text-text-muted">
                Reports describe a technical recording. They are not a diagnosis and must not be presented as one.
              </p>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
