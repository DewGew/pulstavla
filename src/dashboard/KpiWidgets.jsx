import { useKpi, useKpis, useKpiSeries, statusOf, fmt } from "./kpiStore";

function Empty({ text }) {
  return <div className="kpi-empty">{text}</div>;
}

function Missing({ loaded }) {
  return <Empty text={loaded ? "Välj ett nyckeltal i widgetens inställningar" : "Laddar…"} />;
}

/* ---------- Mini-diagram (sparkline) ---------- */
function Spark({ data }) {
  if (data.length < 2) return null;
  const w = 100, h = 28;
  const vals = data.map((d) => d.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - 3 - ((v - min) / span) * (h - 6)}`).join(" ");
  return (
    <svg className="kpi-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Trend({ kpi, latest, previous }) {
  if (!latest || !previous) return null;
  const diff = latest.value - previous.value;
  if (diff === 0) return <span className="kpi-trend">▬ oförändrat</span>;
  const better = kpi.goodDirection === "lower" ? diff < 0 : diff > 0;
  return (
    <span className={`kpi-trend ${better ? "up-good" : "up-bad"}`}>
      {diff > 0 ? "▲" : "▼"} {fmt({ decimals: kpi.decimals }, Math.abs(diff))}
    </span>
  );
}

/* ---------- Stort nyckeltal ---------- */
export function KpiCard({ kpiId, title, showSpark = true }) {
  const { kpi, loaded } = useKpi(kpiId);
  const series = useKpiSeries(showSpark ? kpiId : null, 30);
  if (!kpi) return <div className="widget kpi-widget"><Missing loaded={loaded} /></div>;
  const status = statusOf(kpi, kpi.latest?.value);
  return (
    <div className={`widget kpi-widget status-${status}`}>
      <h3>{title || kpi.name}</h3>
      <div className="kpi-main">
        <span className="kpi-value">{fmt(kpi, kpi.latest?.value)}</span>
        {kpi.unit && <span className="kpi-unit">{kpi.unit}</span>}
      </div>
      <div className="kpi-sub">
        <Trend kpi={kpi} latest={kpi.latest} previous={kpi.previous} />
        {kpi.target !== null && kpi.target !== undefined && (
          <span className="kpi-target">Mål {kpi.goodDirection === "lower" ? "≤" : "≥"} {fmt(kpi, kpi.target)}{kpi.unit ? ` ${kpi.unit}` : ""}</span>
        )}
      </div>
      {showSpark && <Spark data={series} />}
      <div className="kpi-date">{kpi.latest ? `Uppdaterad ${kpi.latest.date}` : "Inga värden ännu"}</div>
    </div>
  );
}

/* ---------- Linje-/stapeldiagram ---------- */
export function KpiChart({ kpiId, title, days = 30, style = "line" }) {
  const { kpi, loaded } = useKpi(kpiId);
  const data = useKpiSeries(kpiId, Number(days) || 30);
  if (!kpi) return <div className="widget kpi-widget"><Missing loaded={loaded} /></div>;

  const W = 400, H = 180, padL = 34, padR = 8, padT = 10, padB = 22;
  const vals = data.map((d) => d.value);
  const hasTarget = kpi.target !== null && kpi.target !== undefined;
  const all = hasTarget ? [...vals, kpi.target] : vals;
  const lo = Math.min(0, ...all);
  const hi = Math.max(...all, 1);
  const span = hi - lo || 1;
  const x = (i) => padL + (data.length === 1 ? (W - padL - padR) / 2 : (i / (data.length - 1)) * (W - padL - padR));
  const y = (v) => padT + (1 - (v - lo) / span) * (H - padT - padB);
  const ticks = [lo, lo + span / 2, hi];
  const barW = Math.max(2, ((W - padL - padR) / Math.max(data.length, 1)) * 0.7);

  return (
    <div className="widget kpi-widget">
      <h3>{title || kpi.name}{kpi.unit ? ` (${kpi.unit})` : ""}</h3>
      {data.length === 0 ? (
        <Empty text="Inga värden i perioden" />
      ) : (
        <svg className="kpi-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={kpi.name}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="kpi-grid" />
              <text x={padL - 4} y={y(t) + 4} textAnchor="end" className="kpi-axis">{fmt({ decimals: span < 10 ? 1 : 0 }, t)}</text>
            </g>
          ))}
          {hasTarget && <line x1={padL} x2={W - padR} y1={y(kpi.target)} y2={y(kpi.target)} className="kpi-targetline" />}
          {style === "bar" ? (
            data.map((d, i) => (
              <rect key={d.date} x={x(i) - barW / 2} width={barW} y={Math.min(y(d.value), y(0))} height={Math.abs(y(d.value) - y(0))} className={`kpi-bar s-${statusOf(kpi, d.value)}`} />
            ))
          ) : (
            <>
              <polyline fill="none" className="kpi-line" points={data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ")} vectorEffect="non-scaling-stroke" />
              {data.length <= 40 && data.map((d, i) => <circle key={d.date} cx={x(i)} cy={y(d.value)} r="3" className={`kpi-dot s-${statusOf(kpi, d.value)}`} />)}
            </>
          )}
          <text x={padL} y={H - 4} className="kpi-axis">{data[0].date.slice(5)}</text>
          <text x={W - padR} y={H - 4} textAnchor="end" className="kpi-axis">{data[data.length - 1].date.slice(5)}</text>
        </svg>
      )}
    </div>
  );
}

/* ---------- Mätare (halvcirkel) ---------- */
export function KpiGauge({ kpiId, title, min = 0, max }) {
  const { kpi, loaded } = useKpi(kpiId);
  if (!kpi) return <div className="widget kpi-widget"><Missing loaded={loaded} /></div>;
  const v = kpi.latest?.value;
  const lo = Number(min) || 0;
  const hi = Number(max) || (kpi.target ? kpi.target * 1.25 : 100);
  const frac = v === null || v === undefined ? 0 : Math.min(1, Math.max(0, (v - lo) / (hi - lo || 1)));
  const R = 80, cx = 100, cy = 95;
  const pt = (f) => [cx - R * Math.cos(Math.PI * f), cy - R * Math.sin(Math.PI * f)];
  const [sx, sy] = pt(0), [ex, ey] = pt(1), [vx, vy] = pt(frac);
  const status = statusOf(kpi, v);
  const tf = kpi.target !== null && kpi.target !== undefined ? Math.min(1, Math.max(0, (kpi.target - lo) / (hi - lo || 1))) : null;
  const tp = tf === null ? null : [pt(tf), [cx - (R - 14) * Math.cos(Math.PI * tf), cy - (R - 14) * Math.sin(Math.PI * tf)]];
  return (
    <div className={`widget kpi-widget status-${status}`}>
      <h3>{title || kpi.name}</h3>
      <svg className="kpi-gauge" viewBox="0 0 200 115" aria-label={kpi.name}>
        <path d={`M ${sx} ${sy} A ${R} ${R} 0 0 1 ${ex} ${ey}`} className="gauge-bg" fill="none" strokeWidth="16" strokeLinecap="round" />
        {frac > 0 && <path d={`M ${sx} ${sy} A ${R} ${R} 0 0 1 ${vx} ${vy}`} className="gauge-fg" fill="none" strokeWidth="16" strokeLinecap="round" />}
        {tp && <line x1={tp[0][0]} y1={tp[0][1]} x2={tp[1][0]} y2={tp[1][1]} className="gauge-target" strokeWidth="3" />}
        <text x={cx} y={cy - 8} textAnchor="middle" className="gauge-value">{fmt(kpi, v)}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="kpi-axis">{kpi.unit}</text>
      </svg>
    </div>
  );
}

/* ---------- Lista med flera nyckeltal ---------- */
export function KpiList({ kpiIds = [], title }) {
  const { kpis, loaded } = useKpis();
  const rows = (kpiIds.length ? kpiIds.map((id) => kpis.find((k) => k._id === id)) : kpis).filter(Boolean);
  return (
    <div className="widget kpi-widget kpi-list-widget">
      <h3>{title || "Nyckeltal"}</h3>
      {rows.length === 0 ? (
        <Missing loaded={loaded} />
      ) : (
        <table className="kpi-table">
          <tbody>
            {rows.map((k) => (
              <tr key={k._id}>
                <td><span className={`kpi-dotstatus s-${statusOf(k, k.latest?.value)}`} /> {k.name}</td>
                <td className="num">{fmt(k, k.latest?.value)} <small>{k.unit}</small></td>
                <td className="num tgt">{k.target !== null && k.target !== undefined ? `Mål ${fmt(k, k.target)}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
