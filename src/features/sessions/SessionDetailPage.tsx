import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, FileText, Save } from 'lucide-react';
import { RecordedEcg } from '../../components/ecg/RecordedEcg';
import { Badge, Button, Panel, PanelHeader, Stat } from '../../components/ui/primitives';
import { Select, Slider, TextInput } from '../../components/ui/controls';
import { analyzeSamples, concatChunks } from '../../services/analyze';
import { buildCsv, downloadText, sessionFilename } from '../../services/csv';
import { buildPdf, downloadPdf } from '../../services/pdf';
import { getSession, getSessionChunks, updateSessionNotes, type SessionMeta, type StoredChunk } from '../../storage/db';
import { useAppStore } from '../../state/store';
import { formatBpm, formatDateTime, formatDuration, formatNumber } from '../../utils/format';

export function SessionDetailPage() {
  const { sessionId = '' } = useParams();
  const pushToast = useAppStore((state) => state.pushToast);

  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [chunks, setChunks] = useState<StoredChunk[]>([]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowSeconds, setWindowSeconds] = useState(5);
  const [offsetSeconds, setOffsetSeconds] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const record = await getSession(sessionId);
        if (!record) {
          if (!cancelled) setError('Session not found in this browser.');
          return;
        }
        const stored = await getSessionChunks(sessionId);
        if (cancelled) return;
        setMeta(record);
        setNotes(record.notes);
        setChunks(stored);
        setError(null);
      } catch (cause) {
        if (!cancelled) setError(`Could not open session: ${String(cause)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const concatenated = useMemo(() => concatChunks(chunks), [chunks]);
  const analysis = useMemo(() => {
    if (!meta || concatenated.samples.length === 0) return null;
    return analyzeSamples(concatenated.samples, meta.sampleRateHz || 500);
  }, [meta, concatenated]);

  const totalSeconds = meta ? meta.sampleCount / (meta.sampleRateHz || 500) : 0;

  if (loading) {
    return <p className="px-3 py-10 text-center text-[12px] text-text-dim">Loading session…</p>;
  }

  if (error || !meta) {
    return (
      <Panel className="mx-auto mt-8 max-w-lg p-6 text-center">
        <p role="alert" className="text-[12px] text-danger">
          {error ?? 'Session not found.'}
        </p>
        <Link to="/sessions" className="mt-3 inline-block">
          <Button size="sm">Back to history</Button>
        </Link>
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link to="/sessions" className="inline-flex items-center gap-1 text-[11px] text-text-dim hover:text-accent">
            <ArrowLeft size={12} aria-hidden /> Session history
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="display text-[26px]">
              {formatDateTime(meta.startedAt)}
            </h1>
            <Badge tone={meta.source === 'simulation' ? 'idle' : 'accent'}>{meta.source}</Badge>
          </div>
          <p className="mt-1.5 font-mono text-[11px] text-text-dim">
            {meta.id} · {meta.deviceId ?? 'no device id'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            icon={<Download size={13} aria-hidden />}
            onClick={() => {
              const csv = buildCsv({ chunks, meta });
              downloadText(sessionFilename(meta, 'csv'), csv);
              pushToast({ tone: 'success', title: 'CSV exported', message: `${meta.sampleCount.toLocaleString()} rows.` });
            }}
            disabled={chunks.length === 0}
          >
            Export CSV
          </Button>
          <Button
            size="sm"
            icon={<FileText size={13} aria-hidden />}
            onClick={() => {
              const doc = buildPdf({
                meta,
                chunks,
                quality: {
                  score: meta.meanQuality === null ? null : Math.round(meta.meanQuality),
                  category: meta.meanQuality === null ? 'n/a' : meta.meanQuality >= 75 ? 'good' : meta.meanQuality >= 50 ? 'fair' : 'poor',
                },
                electrode: null,
              });
              downloadPdf(doc, sessionFilename(meta, 'pdf'));
              pushToast({ tone: 'success', title: 'PDF report ready' });
            }}
            disabled={chunks.length === 0}
          >
            Export PDF
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_312px]">
        <div className="min-w-0 space-y-6">
          <Panel>
            <PanelHeader
              title="Recorded ECG"
              subtitle={`${formatNumber(totalSeconds, 1)} s stored · ${meta.sampleRateHz} Hz · filtered 0.5–40 Hz`}
              actions={
                <div className="flex items-center gap-2">
                  <label htmlFor="window" className="text-[10px] uppercase tracking-[0.08em] text-text-dim">
                    Window
                  </label>
                  <Select
                    id="window"
                    value={String(windowSeconds)}
                    onChange={(event) => setWindowSeconds(Number(event.target.value))}
                    className="h-8 w-auto"
                  >
                    {[2, 5, 10, 20].map((seconds) => (
                      <option key={seconds} value={seconds}>
                        {seconds}s
                      </option>
                    ))}
                  </Select>
                </div>
              }
            />
            <div className="p-2">
              {analysis ? (
                <RecordedEcg
                  filtered={analysis.filtered}
                  leadOff={concatenated.leadOff}
                  sampleRateHz={meta.sampleRateHz || 500}
                  windowSeconds={Math.min(windowSeconds, Math.max(1, totalSeconds))}
                  offsetSeconds={Math.min(offsetSeconds, Math.max(0, totalSeconds - windowSeconds))}
                  height={230}
                  label={`Recorded ECG from ${formatDateTime(meta.startedAt)}`}
                />
              ) : (
                <p className="px-2 py-8 text-center text-[12px] text-text-dim">No samples stored for this session.</p>
              )}
            </div>
            <div className="border-t border-border px-3 py-2">
              <Slider
                label="Scroll through recording"
                min={0}
                max={Math.max(0, Math.round(totalSeconds - 1))}
                step={0.5}
                value={Math.min(offsetSeconds, Math.max(0, Math.round(totalSeconds - 1)))}
                onChange={setOffsetSeconds}
                format={(value) => `${value.toFixed(1)} s`}
                disabled={totalSeconds <= windowSeconds}
              />
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Operator notes" subtitle="Stored with the session and included in reports" />
            <div className="flex flex-col gap-2 p-3 sm:flex-row">
              <TextInput
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="e.g. resting, seated, electrodes on wrists"
                aria-label="Session notes"
              />
              <Button
                size="md"
                variant="secondary"
                icon={<Save size={13} aria-hidden />}
                onClick={() => {
                  void updateSessionNotes(meta.id, notes).then(() => {
                    setMeta({ ...meta, notes });
                    pushToast({ tone: 'success', title: 'Notes saved' });
                  });
                }}
              >
                Save
              </Button>
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Session summary" />
            <div className="grid grid-cols-2 gap-x-3 gap-y-4 p-3">
              <Stat label="Duration" value={formatDuration(meta.durationMs)} size="sm" />
              <Stat label="Samples" value={meta.sampleCount.toLocaleString()} size="sm" />
              <Stat label="Avg BPM" value={formatBpm(meta.avgBpm)} size="sm" tone="accent" />
              <Stat label="Min / max" value={`${formatBpm(meta.minBpm)} / ${formatBpm(meta.maxBpm)}`} size="sm" />
              <Stat label="SDNN" value={meta.sdnnMs === null ? '—' : formatNumber(meta.sdnnMs, 1)} unit="ms" size="sm" />
              <Stat label="RMSSD" value={meta.rmssdMs === null ? '—' : formatNumber(meta.rmssdMs, 1)} unit="ms" size="sm" />
              <Stat label="Valid intervals" value={meta.nnCount} size="sm" />
              <Stat label="Beats (re-derived)" value={analysis?.beats.length ?? 0} size="sm" />
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Storage" />
            <div className="space-y-2 p-3 text-[11px]">
              <div className="flex justify-between">
                <span className="text-text-dim">Chunks</span>
                <span className="font-mono tnum text-text">{meta.chunkCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-dim">Sample rate</span>
                <span className="font-mono tnum text-text">{meta.sampleRateHz} Hz</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-dim">Mean quality</span>
                <span className="font-mono tnum text-text">
                  {meta.meanQuality === null ? '—' : `${Math.round(meta.meanQuality)}/100`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-dim">Source</span>
                <span className="text-text">{meta.source}</span>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
