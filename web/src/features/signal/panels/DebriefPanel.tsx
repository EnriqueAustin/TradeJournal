import { useState } from 'react';
import { api } from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import { StatusBadge } from '../terminal';
import type { Debrief } from '../../../types';
import '../terminal/terminal.css';

function renderMarkdown(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    .replace(/\n/g, '<br/>');
}

export default function DebriefPanel({ tradeId }: { tradeId: number }) {
  const { data, loading, error, reload } = useApi<Debrief>(
    () => api.getDebrief(tradeId).catch(() => null as any),
    [tradeId]
  );
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenError(null);
    try {
      await api.generateDebrief(tradeId);
      reload();
    } catch (e: any) {
      setGenError(e?.message || 'Failed to generate debrief');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <div className="sig-muted" style={{ padding: '12px 0' }}>Loading debrief…</div>;

  if (!data || error) {
    return (
      <div style={{ padding: '12px 0' }}>
        <div className="flex items-center gap-3">
          <button
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={generating}
            style={{ background: 'rgba(255,187,0,0.15)', color: '#ffbb00', border: '1px solid rgba(255,187,0,0.3)' }}
          >
            {generating ? 'Generating…' : 'Get AI Debrief'}
          </button>
          {genError && <span className="text-sm text-red-400">{genError}</span>}
        </div>
        <p className="sig-muted" style={{ fontSize: 11, marginTop: 8 }}>
          AI coaching analysis based on your trade details and market context at entry.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 0' }}>
      <div className="flex items-center gap-2 mb-3">
        <StatusBadge kind="warn" label="AI DEBRIEF" />
        <span className="sig-muted" style={{ fontSize: 11 }}>
          {data.model} · {new Date(data.created_at).toLocaleDateString()}
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={handleGenerate}
          disabled={generating}
          style={{ fontSize: 11, color: '#888', cursor: 'pointer', background: 'none', border: 'none' }}
        >
          {generating ? '…' : 'Regenerate'}
        </button>
      </div>
      <div
        className="sig-debrief-content"
        style={{
          fontSize: 12,
          lineHeight: 1.6,
          color: '#ccc',
          whiteSpace: 'pre-wrap',
        }}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(data.content) }}
      />
    </div>
  );
}
