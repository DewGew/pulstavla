import { useState } from "react";
import { apiFetch } from "../api";
import { useKpis, useKpiSeries, reloadKpis, statusOf, fmt } from "./kpiStore";
import "./dashboard.css";

const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD
const EMPTY = { name: "", unit: "", decimals: 0, target: "", goodDirection: "higher", tolerance: 10, description: "" };

async function call(path, method, body) {
  const res = await apiFetch(path, { method, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function KpiForm({ initial, onSave, onCancel, saveLabel }) {
  const [f, setF] = useState({ ...EMPTY, ...initial, target: initial?.target ?? "" });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <div className="kpi-form">
      <label>Namn<input value={f.name} onChange={set("name")} placeholder="t.ex. Leveranssäkerhet" /></label>
      <label>Enhet<input value={f.unit} onChange={set("unit")} placeholder="%, st, h …" /></label>
      <label>Decimaler<input type="number" min="0" max="4" value={f.decimals} onChange={set("decimals")} /></label>
      <label>Mål<input value={f.target} onChange={set("target")} placeholder="valfritt" /></label>
      <label>Bäst när värdet är
        <select value={f.goodDirection} onChange={set("goodDirection")}>
          <option value="higher">Högt (≥ mål)</option>
          <option value="lower">Lågt (≤ mål)</option>
        </select>
      </label>
      <label>Gul zon (% från mål)<input type="number" min="0" max="100" value={f.tolerance} onChange={set("tolerance")} /></label>
      <label style={{ gridColumn: "1 / -1" }}>Beskrivning<input value={f.description} onChange={set("description")} /></label>
      <div className="kpi-row-actions">
        <button className="dash-btn primary" disabled={!f.name.trim()} onClick={() => onSave(f)}>{saveLabel}</button>
        {onCancel && <button className="dash-btn" onClick={onCancel}>Avbryt</button>}
      </div>
    </div>
  );
}

function Detail({ kpi, isAdmin, setMsg }) {
  const [date, setDate] = useState(today());
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const series = useKpiSeries(kpi._id, 60);

  const run = async (fn, ok) => {
    try { await fn(); await reloadKpis(); setMsg({ ok: ok }); } catch (e) { setMsg({ err: e.message }); }
  };

  return (
    <div className="kpi-detail">
      <div className="kpi-form">
        <label>Datum<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>Värde<input value={value} onChange={(e) => setValue(e.target.value)} placeholder="t.ex. 97,5" onKeyDown={(e) => e.key === "Enter" && document.getElementById(`save-${kpi._id}`).click()} /></label>
        <div>
          <button id={`save-${kpi._id}`} className="dash-btn primary" disabled={!value.trim()}
            onClick={() => run(async () => { await call(`/kpis/${kpi._id}/values/${date}`, "PUT", { value }); setValue(""); }, "Värdet sparades")}>
            Spara värde
          </button>
        </div>
      </div>
      <div className="kpi-values">
        <table><tbody>
          {[...series].reverse().map((v) => (
            <tr key={v.date}>
              <td>{v.date}</td>
              <td><span className={`kpi-dotstatus s-${statusOf(kpi, v.value)}`} /> {fmt(kpi, v.value)} {kpi.unit}</td>
              <td style={{ textAlign: "right" }}>
                <button className="dash-btn" onClick={() => { setDate(v.date); setValue(String(v.value).replace(".", ",")); }}>Ändra</button>{" "}
                <button className="dash-btn danger" onClick={() => run(() => call(`/kpis/${kpi._id}/values/${v.date}`, "DELETE"), "Värdet togs bort")}>✕</button>
              </td>
            </tr>
          ))}
          {series.length === 0 && <tr><td>Inga värden de senaste 60 dagarna.</td></tr>}
        </tbody></table>
      </div>
      {isAdmin && (editing ? (
        <KpiForm initial={kpi} saveLabel="Spara ändringar" onCancel={() => setEditing(false)}
          onSave={(f) => run(async () => { await call(`/kpis/${kpi._id}`, "PUT", f); setEditing(false); }, "Nyckeltalet uppdaterades")} />
      ) : (
        <div className="kpi-row-actions">
          <button className="dash-btn" onClick={() => setEditing(true)}>Redigera nyckeltal</button>
          <button className="dash-btn danger" onClick={() => window.confirm(`Ta bort "${kpi.name}" och alla dess värden?`) && run(() => call(`/kpis/${kpi._id}`, "DELETE"), "Nyckeltalet togs bort")}>Ta bort</button>
        </div>
      ))}
    </div>
  );
}

function Importer({ setMsg }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true); setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiFetch("/kpis/import", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult(data);
      reloadKpis();
    } catch (e) { setMsg({ err: e.message }); }
    finally { setBusy(false); }
  };

  const template = (kind) => {
    const csv = kind === "long"
      ? "Nyckeltal;Datum;Värde\nLeveranssäkerhet;2026-11-09;96,5\nLeveranssäkerhet;2026-11-10;98\nKassation;2026-11-10;1,2\n"
      : "Datum;Leveranssäkerhet;Kassation\n2026-11-09;96,5;1,4\n2026-11-10;98;1,2\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" }));
    a.download = kind === "long" ? "nyckeltal-lang.csv" : "nyckeltal-bred.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section>
      <h3>Importera från Excel / CSV</h3>
      <p>
        Två format fungerar: <strong>lång</strong> (kolumnerna Nyckeltal, Datum, Värde) eller <strong>bred</strong> (första kolumnen Datum, övriga kolumner = ett nyckeltal vardera).
        Nyckeltal som saknas skapas automatiskt och värden för samma dag skrivs över.
      </p>
      <div className="kpi-row-actions" style={{ flexWrap: "wrap" }}>
        <input type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={(e) => { upload(e.target.files[0]); e.target.value = ""; }} />
        <button className="dash-btn" onClick={() => template("long")}>Mall: lång</button>
        <button className="dash-btn" onClick={() => template("wide")}>Mall: bred</button>
      </div>
      {busy && <p>Importerar…</p>}
      {result && (
        <p className="kpi-msg">
          Importerade {result.imported} värden.
          {result.created?.length > 0 && <> Nya nyckeltal: {result.created.join(", ")}.</>}
          {result.skippedRows?.length > 0 && <> Hoppade över rad {result.skippedRows.join(", ")} (ogiltigt datum eller värde).</>}
        </p>
      )}
    </section>
  );
}

export default function KpiAdmin({ currentUser }) {
  const { kpis, loaded } = useKpis();
  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "suAdmin";
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState(null);

  const create = async (f) => {
    try { await call("/kpis", "POST", f); await reloadKpis(); setAdding(false); setMsg({ ok: "Nyckeltalet skapades" }); }
    catch (e) { setMsg({ err: e.message }); }
  };

  return (
    <div className="kpi-admin">
      <section>
        <h2>Nyckeltal</h2>
        <p>Här hanteras de nyckeltal som visas på dashboarden. Värden kan matas in för hand eller importeras från Excel/CSV.
          Lägg sedan ut dem som widgets via <strong>Översikt → Redigera dashboard</strong>.</p>
        {msg && <p className={`kpi-msg${msg.err ? " err" : ""}`}>{msg.err || msg.ok}</p>}
        {isAdmin && (adding
          ? <KpiForm initial={EMPTY} saveLabel="Skapa nyckeltal" onSave={create} onCancel={() => setAdding(false)} />
          : <button className="dash-btn primary" onClick={() => setAdding(true)}>＋ Nytt nyckeltal</button>)}
      </section>

      <section>
        <div className="kpi-rowlist">
          {!loaded && <p>Laddar…</p>}
          {loaded && kpis.length === 0 && <p>Inga nyckeltal ännu.{isAdmin ? " Skapa ett ovan eller importera en fil." : ""}</p>}
          {kpis.map((k) => (
            <div key={k._id} className={`kpi-row${open === k._id ? " open" : ""}`}>
              <strong><span className={`kpi-dotstatus s-${statusOf(k, k.latest?.value)}`} /> {k.name}</strong>
              <span>{fmt(k, k.latest?.value)} {k.unit} <small style={{ opacity: .6 }}>{k.latest?.date}</small></span>
              <span style={{ opacity: .7 }}>{k.target !== null && k.target !== undefined ? `Mål ${k.goodDirection === "lower" ? "≤" : "≥"} ${fmt(k, k.target)}` : "Inget mål"}</span>
              <button className="dash-btn" onClick={() => { setMsg(null); setOpen(open === k._id ? null : k._id); }}>{open === k._id ? "Stäng" : "Värden"}</button>
              {open === k._id && <Detail kpi={k} isAdmin={isAdmin} setMsg={setMsg} />}
            </div>
          ))}
        </div>
      </section>

      {isAdmin && <Importer setMsg={setMsg} />}
    </div>
  );
}
