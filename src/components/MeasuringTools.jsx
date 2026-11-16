import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import "./MeasuringTools.css";

const emptyTool = {
  toolNumber: "", type: "", description: "", range: "", location: "",
  controlInterval: "365", lastControlDate: "", responsible: "Gemensam",
};

function dateLabel(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("sv-SE");
}

function nextControlDate(tool) {
  if (!tool.lastControlDate || !tool.controlInterval) return null;
  const date = new Date(`${tool.lastControlDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + Number(tool.controlInterval));
  return date;
}

export default function MeasuringTools({ currentUser }) {
  const isAdmin = ["admin", "suAdmin"].includes(currentUser?.role);
  const [tools, setTools] = useState([]);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Alla");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState(emptyTool);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [borrowerId, setBorrowerId] = useState(currentUser?._id || "");
  const [dueDate, setDueDate] = useState("");
  const [history, setHistory] = useState(null);
  const [controlUserIds, setControlUserIds] = useState([]);
  const [showAccess, setShowAccess] = useState(false);
  const [editingToolId, setEditingToolId] = useState(null);
  const [controlTool, setControlTool] = useState(null);
  const [controlForm, setControlForm] = useState({ type: "Kontroll", date: new Date().toLocaleDateString("sv-SE"), result: "Godkänd", comment: "" });

  const load = useCallback(async () => {
    try {
      const headers = { Authorization: `Bearer ${localStorage.getItem("token") || ""}` };
      const requests = [apiFetch("/measuring-tools", { headers })];
      if (isAdmin) {
        requests.push(apiFetch("/measuring-tools/users", { headers }));
        requests.push(apiFetch("/measuring-tools/control-access", { headers }));
      }
      const responses = await Promise.all(requests);
      if (!responses[0].ok) throw new Error("Kunde inte läsa verktygsregistret.");
      setTools(await responses[0].json());
      if (isAdmin && responses[1]?.ok) setUsers(await responses[1].json());
      if (isAdmin && responses[2]?.ok) {
        const access = await responses[2].json();
        setControlUserIds(access.userIds || []);
      }
    } catch (err) {
      setMessage(err.message || "Kunde inte hämta mätverktyg.");
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const refresh = () => load();
    window.addEventListener("measuringToolsUpdated", refresh);
    return () => window.removeEventListener("measuringToolsUpdated", refresh);
  }, [load]);

  const filteredTools = useMemo(() => tools.filter((tool) => {
    const next = nextControlDate(tool);
    const overdue = next && next < new Date(new Date().setHours(0, 0, 0, 0));
    const blocked = tool.controlBlocked || overdue;
    const haystack = [tool.toolNumber, tool.type, tool.description, tool.range, tool.location, tool.activeLoan?.borrowerName]
      .join(" ").toLocaleLowerCase("sv");
    return haystack.includes(search.toLocaleLowerCase("sv")) &&
      (statusFilter === "Alla" || (statusFilter === "Spärrad" ? blocked : statusFilter === "Disponibel" ? tool.status === "Disponibel" && !blocked : tool.status === statusFilter));
  }), [tools, search, statusFilter]);

  const checkout = async (tool) => {
    try {
      const body = {};
      if (isAdmin && borrowerId) body.borrowerId = borrowerId;
      if (dueDate) body.dueDate = dueDate;
      const response = await apiFetch(`/measuring-tools/${tool._id}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Utlåningen misslyckades.");
      setMessage(`${tool.toolNumber} har lånats ut.`);
      await load();
    } catch (err) { setMessage(err.message); }
  };

  const returnTool = async (tool) => {
    const note = window.prompt("Kommentar vid återlämning (valfritt):", "");
    if (note === null) return;
    try {
      const response = await apiFetch(`/measuring-tools/${tool._id}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
        body: JSON.stringify({ note }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Återlämningen misslyckades.");
      setMessage(`${tool.toolNumber} har återlämnats.`);
      await load();
    } catch (err) { setMessage(err.message); }
  };

  const addTool = async (event) => {
    event.preventDefault();
    setMessage("");
    try {
      const response = await apiFetch(editingToolId ? `/measuring-tools/${editingToolId}` : "/measuring-tools", {
        method: editingToolId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kunde inte spara verktyget.");
      setForm(emptyTool);
      setShowAdd(false);
      setEditingToolId(null);
      setMessage(editingToolId ? "Verktyget har uppdaterats." : "Verktyget har registrerats.");
      await load();
    } catch (err) { setMessage(err.message); }
  };

  const editTool = (tool) => {
    setForm({
      toolNumber: tool.toolNumber || "", type: tool.type || "", description: tool.description || "",
      range: tool.range || "", location: tool.location || "",
      controlInterval: String(tool.controlInterval ?? 365), lastControlDate: tool.lastControlDate || "",
      responsible: tool.responsible || "Gemensam",
    });
    setEditingToolId(tool._id);
    setShowAdd(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveControlAccess = async () => {
    try {
      const response = await apiFetch("/measuring-tools/control-access", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
        body: JSON.stringify({ userIds: controlUserIds }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kunde inte spara behörigheterna.");
      setMessage("Behörigheterna för kalibrering och kontroll har sparats.");
      setShowAccess(false);
    } catch (err) { setMessage(err.message); }
  };

  const submitControl = async (event) => {
    event.preventDefault();
    if (!controlTool) return;
    try {
      const response = await apiFetch(`/measuring-tools/${controlTool._id}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
        body: JSON.stringify(controlForm),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kunde inte registrera kontrollen.");
      setMessage(`${controlTool.toolNumber}: ${controlForm.type.toLowerCase()} registrerad.`);
      setControlTool(null);
      await load();
    } catch (err) { setMessage(err.message); }
  };

  const previewImport = async () => {
    if (!selectedFile) return setMessage("Välj en Excel-fil först.");
    setImportBusy(true);
    setMessage("");
    setPreview(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const response = await apiFetch("/measuring-tools/import-preview", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kunde inte läsa Excel-filen.");
      setPreview(data);
    } catch (err) { setMessage(err.message); }
    finally { setImportBusy(false); }
  };

  const commitImport = async () => {
    if (!preview?.items?.length || preview.errors?.length) return;
    setImportBusy(true);
    try {
      const response = await apiFetch("/measuring-tools/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
        body: JSON.stringify({ items: preview.items }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Importen misslyckades.");
      setMessage(`${data.imported} verktyg importerades.`);
      setPreview(null);
      setSelectedFile(null);
      await load();
    } catch (err) { setMessage(err.message); }
    finally { setImportBusy(false); }
  };

  const showHistory = async (tool) => {
    try {
      const response = await apiFetch(`/measuring-tools/${tool._id}/history`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kunde inte läsa historiken.");
      setHistory({ tool, entries: data });
    } catch (err) { setMessage(err.message); }
  };

  if (loading) return <div className="measuring-tools"><p>Laddar mätverktyg…</p></div>;

  return (
    <div className="measuring-tools">
      <div className="measuring-header">
        <div><h2>Mätverktyg</h2><p>Verktygsregister, utlåning och återlämning</p></div>
        {isAdmin && <div className="measuring-header-actions">
          <button className="btn-secondary" onClick={() => setShowAccess((value) => !value)}>Behörighet kontroll</button>
          <button className="btn-primary" onClick={() => { setEditingToolId(null); setForm(emptyTool); setShowAdd((value) => !value); }}>{showAdd && !editingToolId ? "Stäng" : "＋ Registrera verktyg"}</button>
        </div>}
      </div>

      {message && <div className="measuring-message" role="status">{message}<button onClick={() => setMessage("")} aria-label="Stäng">×</button></div>}

      {isAdmin && showAdd && (
        <form className="measuring-form" onSubmit={addTool}>
          <h3>{editingToolId ? "Redigera mätverktyg" : "Nytt mätverktyg"}</h3>
          <div className="measuring-form-grid">
            <label>Verktygsnr<input required value={form.toolNumber} onChange={(e) => setForm({ ...form, toolNumber: e.target.value })} /></label>
            <label>Typ<input required value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} /></label>
            <label>Benämning<input required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <label>Mätområde/Dimensioner<input value={form.range} onChange={(e) => setForm({ ...form, range: e.target.value })} /></label>
            <label>Plats<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
            <label>Kontrollintervall (dagar)<input type="number" min="0" value={form.controlInterval} onChange={(e) => setForm({ ...form, controlInterval: e.target.value })} /></label>
            <label>Senaste kontrolldatum<input type="date" value={form.lastControlDate} onChange={(e) => setForm({ ...form, lastControlDate: e.target.value })} /></label>
            <label>Ansvarig<input value={form.responsible} onChange={(e) => setForm({ ...form, responsible: e.target.value })} /></label>
          </div>
          <button className="btn-primary" type="submit">{editingToolId ? "Spara ändringar" : "Spara verktyg"}</button>
          {editingToolId && <button className="btn-secondary" type="button" onClick={() => { setEditingToolId(null); setForm(emptyTool); setShowAdd(false); }}>Avbryt</button>}
        </form>
      )}

      {isAdmin && showAccess && (
        <section className="measuring-form">
          <h3>Behörighet för kalibrering och kontroll</h3>
          <p>Administratörer har alltid behörighet. Välj vilka övriga användare som får registrera kontroller.</p>
          <div className="measuring-user-list">
            {users.map((item) => <label key={item._id}>
              <input type="checkbox" checked={controlUserIds.includes(item._id)}
                onChange={(event) => setControlUserIds((ids) => event.target.checked ? [...ids, item._id] : ids.filter((id) => id !== item._id))} />
              {item.name || item.username} <small>{item.username}</small>
            </label>)}
          </div>
          <button className="btn-primary" onClick={saveControlAccess}>Spara behörigheter</button>
          <button className="btn-secondary" onClick={() => setShowAccess(false)}>Avbryt</button>
        </section>
      )}

      {isAdmin && (
        <section className="measuring-import">
          <h3>Importera verktyg från Excel</h3>
          <div className="measuring-import-row">
            <input type="file" accept=".xlsx,.xls" onChange={(e) => { setSelectedFile(e.target.files?.[0] || null); setPreview(null); }} />
            <button className="btn-secondary" disabled={!selectedFile || importBusy} onClick={previewImport}>{importBusy ? "Läser…" : "Förhandsgranska"}</button>
          </div>
          <small>Importen läser första kalkylbladet och skriver inte något förrän du godkänner förhandsgranskningen.</small>
          {preview && (
            <div className="measuring-preview">
              <p>{preview.total} rader hittades, {preview.validCount} möjliga att importera.</p>
              {preview.errors?.length > 0 && <ul className="measuring-errors">{preview.errors.map((error, index) => <li key={index}>Rad {error.row}: {error.error}</li>)}</ul>}
              <div className="measuring-table-wrap"><table><thead><tr><th>Verktygsnr</th><th>Typ</th><th>Benämning</th><th>Mätområde</th><th>Plats</th><th>Senaste kontroll</th></tr></thead><tbody>{preview.items.slice(0, 12).map((item) => <tr key={item.toolNumber}><td>{item.toolNumber}</td><td>{item.type}</td><td>{item.description}</td><td>{item.range || "—"}</td><td>{item.location || "—"}</td><td>{dateLabel(item.lastControlDate)}</td></tr>)}</tbody></table></div>
              {preview.items.length > 12 && <small>Visar de första 12 raderna.</small>}
              <button className="btn-primary" disabled={importBusy || preview.validCount !== preview.total || preview.errors?.length > 0} onClick={commitImport}>Godkänn och importera {preview.validCount} verktyg</button>
            </div>
          )}
        </section>
      )}

      <div className="measuring-controls">
        <input aria-label="Sök mätverktyg" placeholder="Sök verktygsnr, typ, benämning…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Filtrera status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option>Alla</option><option>Disponibel</option><option>Utlånad</option><option>Spärrad</option>
        </select>
        {isAdmin && <select aria-label="Välj låntagare" value={borrowerId} onChange={(e) => setBorrowerId(e.target.value)}><option value={currentUser?._id}>Låna själv</option>{users.filter((item) => item._id !== currentUser?._id).map((item) => <option key={item._id} value={item._id}>{item.name || item.username}</option>)}</select>}
        <label className="measuring-due-date">Planerat återlämningsdatum<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
      </div>

      <div className="measuring-summary">
        <span><strong>{tools.length}</strong> totalt</span>
        <span><strong>{tools.filter((tool) => tool.status === "Disponibel" && !tool.controlBlocked).length}</strong> disponibla</span>
        <span><strong>{tools.filter((tool) => tool.controlBlocked).length}</strong> spärrade</span>
        <span><strong>{tools.filter((tool) => tool.status === "Utlånad").length}</strong> utlånade</span>
      </div>

      {filteredTools.length ? (
        <div className="measuring-table-wrap"><table className="measuring-table">
          <thead><tr><th>Verktygsnr</th><th>Typ / Benämning</th><th>Mätområde</th><th>Plats</th><th>Senaste kontroll</th><th>Nästa kontroll</th><th>Status / Låntagare</th><th>Åtgärd</th></tr></thead>
          <tbody>{filteredTools.map((tool) => {
            const next = nextControlDate(tool);
            const overdue = next && next < new Date(new Date().setHours(0, 0, 0, 0));
            const blocked = tool.controlBlocked || overdue;
            const canReturn = tool.activeLoan && (isAdmin || tool.activeLoan.borrowerId === currentUser?._id);
            const canControl = isAdmin || controlUserIds.includes(currentUser?._id);
            return <tr key={tool._id}>
              <td><strong>{tool.toolNumber}</strong></td>
              <td>{tool.type}<small>{tool.description}</small></td>
              <td>{tool.range || "—"}</td><td>{tool.location || "—"}</td>
              <td>{dateLabel(tool.lastControlDate)}</td>
              <td><span className={overdue ? "measuring-overdue" : ""}>{next ? dateLabel(next.toISOString().slice(0, 10)) : "—"}</span></td>
              <td>
                {tool.status === "Utlånad" && (
                  <>
                    <span className="measuring-status borrowed">Utlånad</span>
                    <small>{tool.activeLoan?.borrowerName}</small>
                    {tool.activeLoan?.dueDate && <small>Åter: {dateLabel(tool.activeLoan.dueDate)}</small>}
                  </>
                )}
                {tool.status !== "Utlånad" && blocked && (
                  <span className="measuring-status blocked">Spärrad</span>
                )}
                {tool.status !== "Utlånad" && !blocked && (
                  <span className="measuring-status available">Disponibel</span>
                )}
                {blocked && tool.status === "Utlånad" && (
                  <small className="measuring-overdue">{overdue ? "Spärrat – nästa kontroll har passerat" : "Spärrat efter underkänd kontroll"}</small>
                )}
              </td>
              <td className="measuring-actions">
                {tool.status === "Disponibel" && !blocked && currentUser?.role !== "view" && <button className="btn-primary" onClick={() => checkout(tool)}>Låna</button>}
                {canReturn && <button className="btn-secondary" onClick={() => returnTool(tool)}>Återlämna</button>}
                {canControl && <button className="btn-secondary" onClick={() => { setControlTool(tool); setControlForm({ type: "Kontroll", date: new Date().toLocaleDateString("sv-SE"), result: "Godkänd", comment: "" }); }}>Registrera kontroll</button>}
                {isAdmin && <button className="btn-secondary" onClick={() => editTool(tool)}>Redigera</button>}
                {isAdmin && <button className="btn-secondary" onClick={() => showHistory(tool)}>Historik</button>}
              </td>
            </tr>;
          })}</tbody>
        </table></div>
      ) : <p className="measuring-empty">Inga mätverktyg matchar sökningen.</p>}

      {history && <div className="measuring-modal-backdrop" onClick={() => setHistory(null)}><section className="measuring-history" onClick={(e) => e.stopPropagation()}><button className="measuring-close" onClick={() => setHistory(null)}>×</button><h3>Historik – {history.tool.toolNumber}</h3>{history.entries.length ? <ol>{history.entries.slice().reverse().map((entry, index) => <li key={index}>{entry.action === "control" ? <><strong>{entry.type}</strong> – {entry.result} · {dateLabel(entry.date)}<small>Utförd av {entry.performedByName || "—"}</small>{entry.comment && <small>Kommentar: {entry.comment}</small>}</> : <><strong>{entry.action === "checkout" ? "Utlånad" : "Återlämnad"}</strong> – {entry.borrowerName} · {new Date(entry.action === "checkout" ? entry.checkedOutAt : entry.returnedAt).toLocaleString("sv-SE")}<small>{entry.action === "return" ? `Registrerad av ${entry.returnedByName || "—"}` : `Planerad åter: ${dateLabel(entry.dueDate)}`}</small>{entry.returnNote && <small>Kommentar: {entry.returnNote}</small>}</>}</li>)}</ol> : <p>Ingen historik ännu.</p>}</section></div>}
      {controlTool && <div className="measuring-modal-backdrop" onClick={() => setControlTool(null)}>
        <form className="measuring-history measuring-control-form" onSubmit={submitControl} onClick={(event) => event.stopPropagation()}>
          <button type="button" className="measuring-close" onClick={() => setControlTool(null)}>×</button>
          <h3>Registrera kalibrering / kontroll – {controlTool.toolNumber}</h3>
          <label>Typ<select value={controlForm.type} onChange={(event) => setControlForm({ ...controlForm, type: event.target.value })}><option>Kontroll</option><option>Kalibrering</option></select></label>
          <label>Datum<input type="date" required value={controlForm.date} onChange={(event) => setControlForm({ ...controlForm, date: event.target.value })} /></label>
          <label>Resultat<select value={controlForm.result} onChange={(event) => setControlForm({ ...controlForm, result: event.target.value })}><option>Godkänd</option><option>Underkänd</option><option>Justerad</option></select></label>
          <label>Kommentar<textarea rows="3" value={controlForm.comment} onChange={(event) => setControlForm({ ...controlForm, comment: event.target.value })} /></label>
          <button className="btn-primary" type="submit">Spara kontroll</button>
          <button className="btn-secondary" type="button" onClick={() => setControlTool(null)}>Avbryt</button>
        </form>
      </div>}
    </div>
  );
}
