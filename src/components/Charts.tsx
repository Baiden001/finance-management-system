export function BarChart({ labels, a, b, nameA, nameB }: { labels: string[]; a: number[]; b: number[]; nameA: string; nameB: string }) {
  const W = 640, H = 260, pad = 36, padL = 62; const max = Math.max(1, ...a, ...b); const bw = (W - padL - pad) / labels.length;
  const compact = (n: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  return (
    <div>
      <div className="legend"><span><i style={{ background: 'var(--brand)' }} />{nameA}</span><span><i style={{ background: 'var(--accent)' }} />{nameB}</span></div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${nameA} versus ${nameB} by month`}>
        {[0, 0.5, 1].map((t) => <g key={t}><line x1={padL} x2={W - pad} y1={y(max * t)} y2={y(max * t)} stroke="#e1e4dc" /><text x={padL - 8} y={y(max * t) + 4} fontSize="10" textAnchor="end" fill="#667069">{compact(max * t)}</text></g>)}
        {labels.map((l, i) => { const x = padL + i * bw; return (
          <g key={l}>
            <rect x={x + bw * 0.12} y={y(a[i])} width={bw * 0.36} height={H - pad - y(a[i])} fill="var(--brand)" rx="2"><title>{`${l} ${nameA}: ${a[i].toLocaleString()}`}</title></rect>
            <rect x={x + bw * 0.52} y={y(b[i])} width={bw * 0.36} height={H - pad - y(b[i])} fill="var(--accent)" rx="2"><title>{`${l} ${nameB}: ${b[i].toLocaleString()}`}</title></rect>
            <text x={x + bw / 2} y={H - 14} fontSize="10" textAnchor="middle" fill="#667069">{l}</text>
          </g>); })}
      </svg>
    </div>
  );
}

const PALETTE = ['var(--brand)', 'var(--accent)', '#7a8f83', '#b9a37a', '#4f6b5c', '#9c6b6b', '#c7cdc3'];
export function Donut({ items, total }: { items: { label: string; value: number }[]; total: string }) {
  const sum = items.reduce((s, i) => s + i.value, 0) || 1; const R = 70, C = 2 * Math.PI * R; let off = 0;
  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <svg viewBox="0 0 200 200" width="170" height="170" role="img" aria-label="Expense breakdown">
        <g transform="rotate(-90 100 100)">
          {items.map((it, i) => { const len = (it.value / sum) * C; const el = <circle key={it.label} cx="100" cy="100" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="28" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off}><title>{`${it.label}: ${it.value.toLocaleString()}`}</title></circle>; off += len; return el; })}
        </g>
        <text x="100" y="96" textAnchor="middle" fontSize="11" fill="#667069">Total</text><text x="100" y="114" textAnchor="middle" fontSize="13" fontWeight="700">{total}</text>
      </svg>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 12, flex: 1, minWidth: 140 }}>
        {items.map((it, i) => <li key={it.label} className="row" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 6 }}><span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: PALETTE[i % PALETTE.length], marginRight: 6 }} />{it.label}</span><b>{Math.round((it.value / sum) * 100)}%</b></li>)}
      </ul>
    </div>
  );
}
