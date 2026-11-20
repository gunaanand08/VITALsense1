import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileText, History, Search, Trash2 } from 'lucide-react';
import { Badge, Button, EmptyState, IconButton, Panel, PanelHeader } from '../../components/ui/primitives';
import { Select, TextInput } from '../../components/ui/controls';
import { ConfirmDialog } from '../../components/ui/overlays';
import { buildCsv, downloadText, sessionFilename } from '../../services/csv';
import { buildPdf, downloadPdf } from '../../services/pdf';
import { deleteSession, getSessionChunks, listSessions, type SessionMeta } from '../../storage/db';
import { useAppStore } from '../../state/store';
import { formatBpm, formatDateTime, formatDuration, formatNumber } from '../../utils/format';

type SortKey = 'newest' | 'oldest' | 'longest' | 'bpm';

export function SessionsPage() {
  const pushToast = useAppStore((state) => state.pushToast);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [pendingDelete, setPendingDelete] = useState<SessionMeta | null>(null);

  const fetchRows = useCallback(async () => {
    const rows = await listSessions();
    setSessions(rows);
    setError(null);
  }, []);

  // Initial read: state updates happen only after the await, never synchronously
  // inside the effect body.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listSessions();
        if (cancelled) return;
        setSessions(rows);
        setError(null);
      } catch (cause) {
        if (!cancelled) setError(`Could not read stored sessions: ${String(cause)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      await fetchRows();
    } catch (cause) {
      setError(`Could not read stored sessions: ${String(cause)}`);
    } finally {
      setLoading(false);
    }
  }, [fetchRows]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = sessions.filter((session) => {
      if (!term) return true;
      return (
        session.id.toLowerCase().includes(term) ||
        session.source.includes(term) ||
        (session.deviceId ?? '').toLowerCase().includes(term) ||
        session.notes.toLowerCase().includes(term) ||
        new Date(session.startedAt).toLocaleString().toLowerCase().includes(term)
      );
    });
    return filtered.sort((a, b) => {
      if (sort === 'oldest') return a.startedAt - b.startedAt;
      if (sort === 'longest') return b.durationMs - a.durationMs;
      if (sort === 'bpm') return (b.avgBpm ?? 0) - (a.avgBpm ?? 0);
      return b.startedAt - a.startedAt;
    });
  }, [sessions, query, sort]);

  const exportCsv = async (session: SessionMeta) => {
    try {
      const chunks = await getSessionChunks(session.id);
      const csv = buildCsv({ chunks, meta: session });
      downloadText(sessionFilename(session, 'csv'), csv);
      pushToast({ tone: 'success', title: 'CSV exported', message: `${session.sampleCount.toLocaleString()} samples written.` });
    } catch (cause) {
      pushToast({ tone: 'danger', title: 'CSV export failed', message: String(cause) });
    }
  };

  const exportPdf = async (session: SessionMeta) => {
    try {
      const chunks = await getSessionChunks(session.id);
      const doc = buildPdf({
        meta: session,
        chunks,
        quality: { score: session.meanQuality === null ? null : Math.round(session.meanQuality), category: '' },
        electrode: null,
      });
      downloadPdf(doc, sessionFilename(session, 'pdf'));
      pushToast({ tone: 'success', title: 'PDF report ready', message: 'Saved to your downloads.' });
    } catch (cause) {
      pushToast({ tone: 'danger', title: 'PDF export failed', message: String(cause) });
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteSession(pendingDelete.id);
      pushToast({ tone: 'success', title: 'Session deleted', message: pendingDelete.id.slice(0, 8) });
      setPendingDelete(null);
      await reload();
    } catch (cause) {
      pushToast({ tone: 'danger', title: 'Delete failed', message: String(cause) });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="display text-[30px]">Session History</h1>
          <p className="mt-1.5 max-w-2xl text-[12px] text-text-muted">
            Recordings stored in this browser only (IndexedDB). Nothing leaves the machine.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-dim" aria-hidden />
            <TextInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search sessions"
              aria-label="Search sessions"
              className="pl-7"
            />
          </div>
          <Select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label="Sort sessions" className="w-auto">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="longest">Longest duration</option>
            <option value="bpm">Highest average BPM</option>
          </Select>
        </div>
      </div>

      <Panel>
        <PanelHeader
          title="Recorded sessions"
          subtitle={`${visible.length} of ${sessions.length} shown`}
          icon={<History size={14} aria-hidden />}
          actions={
            <Button size="sm" variant="ghost" onClick={() => void reload()}>
              Refresh
            </Button>
          }
        />

        {loading ? (
          <p className="px-3 py-8 text-center text-[12px] text-text-dim">Reading local database…</p>
        ) : error ? (
          <p role="alert" className="px-3 py-8 text-center text-[12px] text-danger">
            {error}
          </p>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<History size={20} aria-hidden />}
            title={sessions.length === 0 ? 'No sessions recorded yet' : 'No sessions match that search'}
            description={
              sessions.length === 0
                ? 'Start a session from the Overview page. Samples are stored locally and survive a page reload.'
                : 'Try a different device id, source or date.'
            }
            action={
              sessions.length === 0 ? (
                <Link to="/">
                  <Button variant="primary" size="sm">
                    Go to Overview
                  </Button>
                </Link>
              ) : (
                <Button size="sm" onClick={() => setQuery('')}>
                  Clear search
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border-strong">
                  <th className="label-mono px-4 py-4 font-normal">Started</th>
                  <th className="label-mono px-4 py-4 font-normal">Source</th>
                  <th className="label-mono px-4 py-4 font-normal">Duration</th>
                  <th className="label-mono px-4 py-4 font-normal">Samples</th>
                  <th className="label-mono px-4 py-4 font-normal">Avg / min / max</th>
                  <th className="label-mono px-4 py-4 font-normal">SDNN / RMSSD</th>
                  <th className="label-mono px-4 py-4 font-normal">Quality</th>
                  <th className="label-mono px-4 py-4 text-right font-normal">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((session) => (
                  <tr key={session.id} className="border-b border-border last:border-0 hover:bg-surface-2/50">
                    <td className="px-4 py-4">
                      <Link to={`/sessions/${session.id}`} className="font-serif text-[13.5px] text-text hover:text-accent-soft">
                        {formatDateTime(session.startedAt)}
                      </Link>
                      <div className="font-mono text-[10px] text-text-dim">{session.id.slice(0, 8)}</div>
                    </td>
                    <td className="px-4 py-4">
                      <Badge tone={session.source === 'simulation' ? 'idle' : 'accent'}>{session.source}</Badge>
                    </td>
                    <td className="px-4 py-4 font-mono text-[11.5px] tnum text-text-muted">{formatDuration(session.durationMs)}</td>
                    <td className="px-4 py-4 font-mono text-[11.5px] tnum text-text-muted">{session.sampleCount.toLocaleString()}</td>
                    <td className="px-4 py-4 font-mono text-[11.5px] tnum text-text">
                      {formatBpm(session.avgBpm)} / {formatBpm(session.minBpm)} / {formatBpm(session.maxBpm)}
                    </td>
                    <td className="px-4 py-4 font-mono text-[11.5px] tnum text-text-muted">
                      {session.sdnnMs === null ? '—' : formatNumber(session.sdnnMs, 1)} /{' '}
                      {session.rmssdMs === null ? '—' : formatNumber(session.rmssdMs, 1)}
                    </td>
                    <td className="px-4 py-4 font-mono text-[11.5px] tnum text-text-muted">
                      {session.meanQuality === null ? '—' : `${Math.round(session.meanQuality)}`}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-1">
                        <IconButton label={`Export ${session.id.slice(0, 8)} as CSV`} onClick={() => void exportCsv(session)}>
                          <Download size={13} aria-hidden />
                        </IconButton>
                        <IconButton label={`Export ${session.id.slice(0, 8)} as PDF`} onClick={() => void exportPdf(session)}>
                          <FileText size={13} aria-hidden />
                        </IconButton>
                        <IconButton
                          label={`Delete session ${session.id.slice(0, 8)}`}
                          variant="danger"
                          onClick={() => setPendingDelete(session)}
                        >
                          <Trash2 size={13} aria-hidden />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this session?"
        description={
          pendingDelete
            ? `${formatDateTime(pendingDelete.startedAt)} · ${pendingDelete.sampleCount.toLocaleString()} samples will be permanently removed from this browser.`
            : ''
        }
        confirmLabel="Delete permanently"
        destructive
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
