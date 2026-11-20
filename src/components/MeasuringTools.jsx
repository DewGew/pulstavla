import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import "./MeasuringTools.css";

const emptyTool = {
  toolNumber: "", type: "", description: "", manufacturer: "", range: "", location: "",
  controlInterval: "365", lastControlDate: "",
};

function defaultToolImage(type) {
  const value = String(type || "").toLocaleLowerCase("sv");
  if (/skjutm[aå]tt|caliper/.test(value)) return "/tool-images/skjutmatt.svg";
  if (/mikrometer|micrometer/.test(value)) return "/tool-images/mikrometer.svg";
  if (/m[aä]tklocka|indikatorklock|dial/.test(value)) return "/tool-images/matklocka.svg";
  if (/gängtolk|thread/.test(value)) return "/tool-images/gangtolk.svg";
  if (/pinntolk|passpinne|gauge.?pin/.test(value)) return "/tool-images/pinntolk.svg";
  if (/h[oö]jdm[aä]tare|height/.test(value)) return "/tool-images/hojdmatare.svg";
  if (/cmm|3d.?taster|3d.?probe/.test(value)) return "/tool-images/cmm.svg";
  return "/tool-images/standard.svg";
}

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

function isControlOverdue(tool) {
  const next = nextControlDate(tool);
  return Boolean(next && next < new Date(new Date().setHours(0, 0, 0, 0)));
}

function isTerminalTool(tool) {
  return ["Skrotad", "Saknad"].includes(tool.status);
}

function isToolBlocked(tool) {
  return !isTerminalTool(tool) && Boolean(tool.controlBlocked || isControlOverdue(tool));
}

export default function MeasuringTools({ currentUser }) {
  const isAdmin = ["admin", "suAdmin"].includes(currentUser?.role);
  const [tools, setTools] = useState([]);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Alla");
  const [viewMode, setViewMode] = useState("cards");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState(emptyTool);
  const [imageFile, setImageFile] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [borrowerId, setBorrowerId] = useState(currentUser?._id || "");
  const [reservationUserId, setReservationUserId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [actionModal, setActionModal] = useState(null);
  const [history, setHistory] = useState(null);
  const [controlUserIds, setControlUserIds] = useState([]);
  const [canRegisterControl, setCanRegisterControl] = useState(false);
  const canReserve = isAdmin || canRegisterControl;
  const [showAccess, setShowAccess] = useState(false);
  const [editingToolId, setEditingToolId] = useState(null);
  const [controlTool, setControlTool] = useState(null);
  const [controlForm, setControlForm] = useState({ type: "Kontroll", date: new Date().toLocaleDateString("sv-SE"), result: "Godkänd", comment: "" });

  const load = useCallback(async () => {
    try {
      const headers = { Authorization: `Bearer ${localStorage.getItem("token") || ""}` };
      const [toolsResponse, accessResponse] = await Promise.all([
        apiFetch("/measuring-tools", { headers }),
        apiFetch("/measuring-tools/control-access", { headers }),
      ]);
      if (!toolsResponse.ok) throw new Error("Kunde inte läsa verktygsregistret.");
      setTools(await toolsResponse.json());
      let hasReservationAccess = isAdmin;
      if (accessResponse.ok) {
        const access = await accessResponse.json();
        hasReservationAccess = Boolean(access.canRegister);
        setCanRegisterControl(hasReservationAccess);
        if (isAdmin) setControlUserIds(access.userIds || []);
      }
      if (hasReservationAccess) {
        const usersResponse = await apiFetch("/measuring-tools/users", { headers });
        if (usersResponse.ok) setUsers(await usersResponse.json());
      } else {
        setUsers([]);
        setReservationUserId("");
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

  const nextSuggestedToolNumber = useMemo(() => {
    const usedNumbers = new Set(
      tools.map((tool) => {
        const match = String(tool.toolNumber || "").trim().match(/^1115-(\d{1,3})$/);
        return match ? Number(match[1]) : null;
      }).filter((number) => number !== null)
    );
    for (let number = 100; number <= 999; number += 1) {
      if (!usedNumbers.has(number)) return `1115-${number}`;
    }
    return "";
  }, [tools]);
  const statusCounts = useMemo(() => ({
    Alla: tools.length,
    Lediga: tools.filter((tool) => tool.status === "Disponibel" && !tool.activeLoan && !tool.reservation && !isToolBlocked(tool)).length,
    Reserverade: tools.filter((tool) => Boolean(tool.reservation)).length,
    Utlånade: tools.filter((tool) => tool.status === "Utlånad" || Boolean(tool.activeLoan)).length,
    Spärrade: tools.filter((tool) => isToolBlocked(tool)).length,
    Skrotade: tools.filter((tool) => tool.status === "Skrotad").length,
    Saknas: tools.filter((tool) => tool.status === "Saknad").length,
    "Kontroll förfallen": tools.filter((tool) => isControlOverdue(tool)).length,
  }), [tools]);

  const filteredTools = useMemo(() => tools.filter((tool) => {
    const haystack = [tool.toolNumber, tool.type, tool.description, tool.manufacturer, tool.range, tool.location, tool.activeLoan?.borrowerName, tool.reservation?.userName]
      .join(" ").toLocaleLowerCase("sv");
    const matchesStatus = statusFilter === "Alla" ||
      (statusFilter === "Lediga" && tool.status === "Disponibel" && !tool.activeLoan && !tool.reservation && !isToolBlocked(tool)) ||
      (statusFilter === "Reserverade" && Boolean(tool.reservation)) ||
      (statusFilter === "Utlånade" && (tool.status === "Utlånad" || Boolean(tool.activeLoan))) ||
      (statusFilter === "Spärrade" && isToolBlocked(tool)) ||
      (statusFilter === "Skrotade" && tool.status === "Skrotad") ||
      (statusFilter === "Saknas" && tool.status === "Saknad") ||
      (statusFilter === "Kontroll förfallen" && isControlOverdue(tool));
    return haystack.includes(search.toLocaleLowerCase("sv")) && matchesStatus;
  }), [tools, search, statusFilter]);

  const exportFilteredCsv = () => {
    const headers = ["Verktygsnr", "Typ", "Benämning", "Tillverkare", "Mätområde/Dimensioner", "Plats", "Kontrollintervall (dagar)", "Senaste kontroll", "Nästa kontroll", "Status", "Låntagare / Reservation"];
    const rows = filteredTools.map((tool) => {
      const next = nextControlDate(tool);
      const status = (tool.status === "Utlånad" || tool.activeLoan) ? "Utlånad" : isTerminalTool(tool) ? (tool.status === "Saknad" ? "Saknas" : tool.status) : isToolBlocked(tool) ? "Spärrad" : tool.reservation ? "Reserverad" : "Ledig";
      return [
        tool.toolNumber, tool.type, tool.description, tool.manufacturer, tool.range, tool.location,
        tool.controlInterval, dateLabel(tool.lastControlDate), next ? dateLabel(next.toISOString().slice(0, 10)) : "",
        status, tool.activeLoan?.borrowerName || (tool.reservation ? `Reserverad för ${tool.reservation.userName}` : ""),
      ];
    });
    const csv = [headers, ...rows].map((row) => row.map((value) => {
      const cell = String(value ?? "").replace(/"/g, '""');
      return /[;"\\r\\n]/.test(cell) ? `"${cell}"` : cell;
    }).join(";")).join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `matverktyg-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const openActionModal = (tool, mode) => {
    setBorrowerId(currentUser?._id || users[0]?._id || "");
    setReservationUserId("");
    const defaultDueDate = new Date();
    defaultDueDate.setDate(defaultDueDate.getDate() + 1);
    const defaultDueDateValue = [
      defaultDueDate.getFullYear(),
      String(defaultDueDate.getMonth() + 1).padStart(2, "0"),
      String(defaultDueDate.getDate()).padStart(2, "0"),
    ].join("-");
    setDueDate(mode === "checkout" ? defaultDueDateValue : "");
    setActionModal({ tool, mode });
  };

  const submitAction = (event) => {
    event.preventDefault();
    if (!actionModal) return;
    if (actionModal.mode === "checkout") checkout(actionModal.tool);
    else reserveTool(actionModal.tool);
    setActionModal(null);
  };

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

  const reserveTool = async (tool) => {
    if (!reservationUserId) {
      setMessage("Välj en användare som reservationen ska tilldelas.");
      return;
    }
    try {
      const body = { userId: reservationUserId };
      const response = await apiFetch(`/measuring-tools/${tool._id}/reserve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Reservationen misslyckades.");
      setMessage(`${tool.toolNumber} är reserverat för ${data.reservation?.userName || "användaren"} tills vidare.`);
      await load();
    } catch (err) { setMessage(err.message); }
  };

  const releaseReservation = async (tool) => {
    if (!window.confirm(`Häva reservationen för ${tool.toolNumber}?`)) return;
    try {
      const response = await apiFetch(`/measuring-tools/${tool._id}/reserve`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kunde inte häva reservationen.");
      setMessage(`Reservationen för ${tool.toolNumber} har hävts.`);
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
      const savedToolId = editingToolId || data._id;
      if (imageFile && savedToolId) {
        const imageData = new FormData();
        imageData.append("image", imageFile);
        const imageResponse = await apiFetch(`/measuring-tools/${savedToolId}/image`, {
          method: "POST",
          headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
          body: imageData,
        });
        const imageResult = await imageResponse.json();
        if (!imageResponse.ok) throw new Error(imageResult.error || "Verktyget sparades men bilden kunde inte laddas upp.");
      }
      setImageFile(null);
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
      manufacturer: tool.manufacturer || "", range: tool.range || "", location: tool.location || "",
      controlInterval: String(tool.controlInterval ?? 365), lastControlDate: tool.lastControlDate || "",
      imageUrl: tool.imageUrl || "",
    });
    setImageFile(null);
    setEditingToolId(tool._id);
    setShowAdd(true);
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
        {(isAdmin || canRegisterControl) && <div className="measuring-header-actions">
          <button className="btn-secondary" onClick={() => setShowAccess((value) => !value)}>Behörighet kontroll</button>
          <button className="btn-secondary" type="button" onClick={exportFilteredCsv} disabled={!filteredTools.length}>Exportera filtrerad lista till CSV</button>
          <button className="btn-primary" onClick={() => { setEditingToolId(null); setForm({ ...emptyTool, toolNumber: nextSuggestedToolNumber }); setImageFile(null); setShowAdd(true); }}>＋ Registrera verktyg</button>
        </div>}
      </div>

      {message && <div className="measuring-message" role="status">{message}<button onClick={() => setMessage("")} aria-label="Stäng">×</button></div>}



      {isAdmin && showAccess && (
        <section className="measuring-form">
          <h3>Behörighet för kalibrering och kontroll</h3>
          <p>Administratörer har alltid behörighet. Valda användare får registrera kalibrering och kontroll samt lägga till och redigera mätverktyg.</p>
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


      <div className="measuring-list-toolbar">
        <div className="measuring-search-row">
          <input aria-label="Sök mätverktyg" placeholder="Sök verktygsnr, typ, benämning, plats eller låntagare…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="measuring-view-toggle" role="group" aria-label="Visningsläge">
            <button type="button" className={viewMode === "cards" ? "active" : ""} onClick={() => setViewMode("cards")} aria-pressed={viewMode === "cards"}>▦ Kort</button>
            <button type="button" className={viewMode === "table" ? "active" : ""} onClick={() => setViewMode("table")} aria-pressed={viewMode === "table"}>☷ Tabell</button>
          </div>
        </div>
        <div className="measuring-filter-chips" role="group" aria-label="Filtrera mätverktyg">
          {["Alla", "Lediga", "Reserverade", "Utlånade", "Spärrade", "Skrotade", "Saknas", "Kontroll förfallen"].map((filter) => (
            <button type="button" key={filter} className={statusFilter === filter ? "active" : ""} onClick={() => setStatusFilter(filter)} aria-pressed={statusFilter === filter}>
              {filter}<span>{statusCounts[filter]}</span>
            </button>
          ))}
        </div>
        <div className="measuring-extra-controls">
          <span className="measuring-result-count">Visar {filteredTools.length} av {tools.length} verktyg</span>
        </div>
      </div>

      <section className="measuring-summary" aria-label="Översikt över mätverktyg">
        <div className="measuring-summary-card total">
          <strong>{tools.length}</strong><span>Totalt antal verktyg</span>
        </div>
        <div className="measuring-summary-card available">
          <strong>{tools.filter((tool) => tool.status === "Disponibel" && !tool.controlBlocked && !tool.reservation).length}</strong><span>Lediga – ej reserverade</span>
        </div>
        <div className="measuring-summary-card blocked">
          <strong>{tools.filter((tool) => tool.controlBlocked).length}</strong><span>Spärrade – får inte lånas</span>
        </div>
        <div className="measuring-summary-card borrowed">
          <strong>{tools.filter((tool) => tool.status === "Utlånad").length}</strong><span>Utlånade – hos användare</span>
        </div>
      </section>

      {filteredTools.length ? (
        viewMode === "cards" ? (
          <div className="measuring-card-grid">
            {filteredTools.map((tool) => {
              const next = nextControlDate(tool);
              const overdue = isControlOverdue(tool);
              const isLoaned = tool.status === "Utlånad" || Boolean(tool.activeLoan);
              const blocked = isToolBlocked(tool);
              const terminalStatus = isTerminalTool(tool);
              const canReturn = tool.activeLoan && (isAdmin || tool.activeLoan.borrowerId === currentUser?._id);
              const canControl = canRegisterControl;
              const canCheckout = tool.status === "Disponibel" && !tool.activeLoan && !tool.reservation && !blocked && currentUser?.role !== "view";
              return (
                <article className={`measuring-tool-card ${blocked || terminalStatus ? "is-blocked" : tool.status === "Utlånad" ? "is-borrowed" : tool.reservation ? "is-reserved" : "is-available"}`} key={tool._id}>
                  <div className="measuring-card-top">
                    <span className="measuring-tool-number">{tool.toolNumber}</span>
                    <span className={`measuring-status ${isLoaned ? "borrowed" : blocked || terminalStatus ? "blocked" : tool.reservation ? "reserved" : "available"}`}>
                      {isLoaned ? "Utlånad" : terminalStatus ? tool.status : blocked ? "Spärrad" : tool.reservation ? "Reserverad" : "Ledig"}
                    </span>
                  </div>
                  <div className="measuring-card-image-wrap">
                    <img className="measuring-card-image" src={tool.imageUrl || defaultToolImage(tool.type)} alt={tool.type || "Mätverktyg"} loading="lazy" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = "/tool-images/standard.svg"; }} />
                  </div>
                  <div className="measuring-card-heading">
                    <h3>{tool.description || tool.type}</h3>
                    <p>{[tool.description ? tool.type : "", tool.manufacturer].filter(Boolean).join(" · ") || "Mätverktyg"}</p>
                  </div>
                  <div className="measuring-card-facts">
                    <div><span>Mätområde</span><strong>{tool.range || "Ej angivet"}</strong></div>
                    <div><span>Placering</span><strong>{tool.location || "Ej angiven"}</strong></div>
                  </div>
                  {tool.reservation && (
                    <div className="measuring-card-reservation">
                      <span>Reserverat tills vidare för</span>
                      <strong>{tool.reservation.userName}</strong>
                    </div>
                  )}
                  <div className="measuring-card-control">
                    <div><span>Senaste kontroll</span><strong>{dateLabel(tool.lastControlDate)}</strong></div>
                    <div><span>Nästa kontroll</span><strong className={overdue ? "measuring-overdue" : ""}>{next ? dateLabel(next.toISOString().slice(0, 10)) : "Ej registrerad"}</strong></div>
                    {blocked && <p className="measuring-card-warning">{overdue ? "Kontrolldatumet har passerat – verktyget får inte användas." : "Verktyget är spärrat efter underkänd kontroll."}</p>}
                  </div>
                  {isLoaned && (
                    <div className="measuring-card-loan">
                      <span>Låntagare</span><strong>{tool.activeLoan?.borrowerName || "Okänd"}</strong>
                      {tool.activeLoan?.dueDate && <small>Återlämnas {dateLabel(tool.activeLoan.dueDate)}</small>}
                      {blocked && <small className="measuring-overdue">{overdue ? "Kontroll förfallen" : "Spärrat efter kontroll"}</small>}
                    </div>
                  )}
                  <div className="measuring-card-actions">
                    {canCheckout && <button className="btn-primary" onClick={() => openActionModal(tool, "checkout")}>Låna verktyg</button>}
                    {!tool.reservation && tool.status === "Disponibel" && !tool.activeLoan && !blocked && canReserve && <button className="btn-secondary" onClick={() => openActionModal(tool, "reserve")}>Reservera tills vidare</button>}
                    {tool.reservation && canReserve && <button className="btn-secondary" onClick={() => releaseReservation(tool)}>Häv reservation</button>}
                    {canReturn && <button className="btn-primary" onClick={() => returnTool(tool)}>Återlämna</button>}
                    {(canControl || isAdmin) && <details className="measuring-more-actions">
                      <summary>Fler åtgärder</summary>
                      <div className="measuring-more-menu">
                        {canControl && <button onClick={() => { setControlTool(tool); setControlForm({ type: "Kontroll", date: new Date().toLocaleDateString("sv-SE"), result: "Godkänd", comment: "" }); }}>Registrera kontroll</button>}
                        {canRegisterControl && <button onClick={() => editTool(tool)}>Redigera verktyg</button>}
                        {(isAdmin || canRegisterControl) && <button onClick={() => showHistory(tool)}>Visa historik</button>}
                      </div>
                    </details>}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="measuring-table-wrap"><table className="measuring-table">
            <thead><tr><th>Verktygsnr</th><th>Typ / Benämning</th><th>Tillverkare</th><th>Mätområde</th><th>Plats</th><th>Senaste kontroll</th><th>Nästa kontroll</th><th>Status / Låntagare</th><th>Åtgärd</th></tr></thead>
            <tbody>{filteredTools.map((tool) => {
              const next = nextControlDate(tool);
              const overdue = isControlOverdue(tool);
              const isLoaned = tool.status === "Utlånad" || Boolean(tool.activeLoan);
              const blocked = isToolBlocked(tool);
              const terminalStatus = isTerminalTool(tool);
              const canReturn = tool.activeLoan && (isAdmin || tool.activeLoan.borrowerId === currentUser?._id);
              const canControl = canRegisterControl;
              const statusLabel = isLoaned
                ? "Utlånad"
                : terminalStatus
                  ? tool.status
                  : blocked
                    ? "Spärrad"
                    : tool.reservation
                      ? "Reserverad"
                      : "Ledig";
              const statusClass = isLoaned
                ? "borrowed"
                : (terminalStatus || blocked)
                  ? "blocked"
                  : tool.reservation
                    ? "reserved"
                    : "available";
              return <tr key={tool._id}>
                <td><strong>{tool.toolNumber}</strong></td>
                <td>{tool.type}<small>{tool.description}</small></td>
                <td>{tool.manufacturer || "—"}</td>
                <td>{tool.range || "—"}</td><td>{tool.location || "—"}</td>
                <td>{dateLabel(tool.lastControlDate)}</td>
                <td><span className={overdue ? "measuring-overdue" : ""}>{next ? dateLabel(next.toISOString().slice(0, 10)) : "—"}</span></td>
                <td>
                  <span className={`measuring-status ${statusClass}`}>{statusLabel}</span>
                  {isLoaned && <small>{tool.activeLoan?.borrowerName}</small>}
                  {tool.reservation && <small className="measuring-reservation-note">Reserverat för {tool.reservation.userName}</small>}
                  {isLoaned && tool.activeLoan?.dueDate && <small>Åter: {dateLabel(tool.activeLoan.dueDate)}</small>}
                  {blocked && isLoaned && <small className="measuring-overdue">{overdue ? "Kontroll förfallen" : "Spärrat efter kontroll"}</small>}
                </td>
                <td className="measuring-actions">
                  {tool.status === "Disponibel" && !tool.activeLoan && !tool.reservation && !blocked && currentUser?.role !== "view" && <button className="btn-primary" onClick={() => openActionModal(tool, "checkout")}>Låna</button>}
                  {!tool.reservation && tool.status === "Disponibel" && !blocked && canReserve && <button className="btn-secondary" onClick={() => openActionModal(tool, "reserve")}>Reservera</button>}
                  {tool.reservation && canReserve && <button className="btn-secondary" onClick={() => releaseReservation(tool)}>Häv reservation</button>}
                  {canReturn && <button className="btn-secondary" onClick={() => returnTool(tool)}>Återlämna</button>}
                  {(canControl || isAdmin) && <details className="measuring-table-more"><summary>•••</summary><div className="measuring-more-menu">
                    {canControl && <button onClick={() => { setControlTool(tool); setControlForm({ type: "Kontroll", date: new Date().toLocaleDateString("sv-SE"), result: "Godkänd", comment: "" }); }}>Registrera kontroll</button>}
                    {canRegisterControl && <button onClick={() => editTool(tool)}>Redigera</button>}
                    {(isAdmin || canRegisterControl) && <button onClick={() => showHistory(tool)}>Historik</button>}
                  </div></details>}
                </td>
              </tr>;
            })}</tbody>
          </table></div>
        )
      ) : <div className="measuring-empty-state"><strong>Inga verktyg hittades</strong><span>Prova att ändra sökningen eller välj ett annat filter.</span><button className="btn-secondary" onClick={() => { setSearch(""); setStatusFilter("Alla"); }}>Rensa sökning och filter</button></div>}



      {(isAdmin || canRegisterControl) && showAdd && (
        <div className="measuring-modal-backdrop" onClick={() => { setShowAdd(false); setEditingToolId(null); }}>
          <form className="measuring-history measuring-tool-form-modal" onSubmit={addTool} onClick={(event) => event.stopPropagation()}>
            <button type="button" className="measuring-close" onClick={() => { setShowAdd(false); setEditingToolId(null); }} aria-label="Stäng">×</button>
            <h3>{editingToolId ? "Redigera mätverktyg" : "Registrera nytt mätverktyg"}</h3>
            <div className="measuring-form-grid">
              <label>Verktygsnr<input required value={form.toolNumber} onChange={(e) => setForm({ ...form, toolNumber: e.target.value })} />{!editingToolId && <small>{nextSuggestedToolNumber ? `Nästa lediga nummer: ${nextSuggestedToolNumber}` : "Inga lediga nummer kvar i serien 1115-100–1115-999."}</small>}</label>
              <label>Typ<input required value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} /></label>
              <label>Benämning<input required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
              <label>Tillverkare<input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} /></label>
              <label>Mätområde/Dimensioner<input value={form.range} onChange={(e) => setForm({ ...form, range: e.target.value })} /></label>
              <label>Plats<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
              <label>Kontrollintervall (dagar)<input type="number" min="0" value={form.controlInterval} onChange={(e) => setForm({ ...form, controlInterval: e.target.value })} /></label>
              <label>Senaste kontrolldatum<input type="date" value={form.lastControlDate} onChange={(e) => setForm({ ...form, lastControlDate: e.target.value })} /></label>
              <label className="measuring-image-upload">Egen verktygsbild<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => setImageFile(e.target.files?.[0] || null)} /><small>Valfritt. PNG, JPG, WEBP eller GIF, max 5 MB. Om ingen egen bild väljs används en standardbild baserad på verktygstyp.</small>{form.imageUrl && !imageFile && <img src={form.imageUrl} alt="Nuvarande verktygsbild" />}{imageFile && <small>Vald bild: {imageFile.name}</small>}</label>
            </div>
            <div className="measuring-tool-form-actions">
              <button className="btn-primary" type="submit">{editingToolId ? "Spara ändringar" : "Registrera verktyg"}</button>
              <button className="btn-secondary" type="button" onClick={() => { setShowAdd(false); setEditingToolId(null); }}>Avbryt</button>
            </div>
          </form>
        </div>
      )}

      {actionModal && <div className="measuring-modal-backdrop" onClick={() => setActionModal(null)}>
        <form className="measuring-history measuring-action-form" onSubmit={submitAction} onClick={(event) => event.stopPropagation()}>
          <button type="button" className="measuring-close" onClick={() => setActionModal(null)}>×</button>
          <h3>{actionModal.mode === "checkout" ? "Låna mätverktyg" : "Reservera mätverktyg"} – {actionModal.tool.toolNumber}</h3>
          <p>{actionModal.tool.description || actionModal.tool.type}{actionModal.tool.manufacturer ? ` · ${actionModal.tool.manufacturer}` : ""}</p>
          {actionModal.mode === "checkout" ? <>
            <label>Utlåning till
              {isAdmin ? <select required value={borrowerId} onChange={(event) => setBorrowerId(event.target.value)}>
                <option value="">Välj användare…</option>{users.map((item) => <option key={item._id} value={item._id}>{item.name || item.username}</option>)}
              </select> : <input readOnly value={currentUser?.name || currentUser?.username || "Inloggad användare"} />}
            </label>
            <label>Planerat återlämningsdatum<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          </> : <label>Reservera till
            <select required value={reservationUserId} onChange={(event) => setReservationUserId(event.target.value)}>
              <option value="">Välj användare…</option>{users.map((item) => <option key={item._id} value={item._id}>{item.name || item.username}</option>)}
            </select>
          </label>}
          <button className="btn-primary" type="submit" disabled={actionModal.mode === "reserve" ? !reservationUserId : isAdmin && !borrowerId}>{actionModal.mode === "checkout" ? "Bekräfta utlåning" : "Bekräfta reservation"}</button>
          <button className="btn-secondary" type="button" onClick={() => setActionModal(null)}>Avbryt</button>
        </form>
      </div>}

      {history && <div className="measuring-modal-backdrop" onClick={() => setHistory(null)}><section className="measuring-history" onClick={(e) => e.stopPropagation()}><button className="measuring-close" onClick={() => setHistory(null)}>×</button><h3>Historik – {history.tool.toolNumber}</h3>{history.entries.length ? <ol>{history.entries.slice().reverse().map((entry, index) => <li key={index}>{entry.action === "control" ? <><strong>{entry.type}</strong> – {entry.result} · {dateLabel(entry.date)}<small>Utförd av {entry.performedByName || "—"}</small>{entry.comment && <small>Kommentar: {entry.comment}</small>}</> : <><strong>{entry.action === "checkout" ? "Utlånad" : entry.action === "return" ? "Återlämnad" : entry.action === "reserve" ? "Reserverad" : "Reservation hävd"}</strong> – {entry.borrowerName || entry.userName} · {new Date(entry.checkedOutAt || entry.returnedAt || entry.reservedAt || entry.releasedAt).toLocaleString("sv-SE")}<small>{entry.action === "return" ? `Registrerad av ${entry.returnedByName || "—"}` : entry.action === "reserve" || entry.action === "release" ? `Hanterad av ${entry.reservedByName || entry.releasedByName || "—"}` : `Planerad åter: ${dateLabel(entry.dueDate)}`}</small>{entry.returnNote && <small>Kommentar: {entry.returnNote}</small>}</>}</li>)}</ol> : <p>Ingen historik ännu.</p>}</section></div>}
      {controlTool && <div className="measuring-modal-backdrop" onClick={() => setControlTool(null)}>
        <form className="measuring-history measuring-control-form" onSubmit={submitControl} onClick={(event) => event.stopPropagation()}>
          <button type="button" className="measuring-close" onClick={() => setControlTool(null)}>×</button>
          <h3>Registrera kalibrering / kontroll – {controlTool.toolNumber}</h3>
          <label>Typ<select value={controlForm.type} onChange={(event) => setControlForm({ ...controlForm, type: event.target.value })}><option>Kontroll</option><option>Kalibrering</option></select></label>
          <label>Datum<input type="date" required value={controlForm.date} onChange={(event) => setControlForm({ ...controlForm, date: event.target.value })} /></label>
          <label>Resultat<select value={controlForm.result} onChange={(event) => setControlForm({ ...controlForm, result: event.target.value })}><option>Godkänd</option><option>Underkänd</option><option>Justerad</option><option>Skrotad</option><option value="Saknad">Saknas</option></select></label>
          <label>Kommentar<textarea rows="3" value={controlForm.comment} onChange={(event) => setControlForm({ ...controlForm, comment: event.target.value })} /></label>
          <button className="btn-primary" type="submit">Spara kontroll</button>
          <button className="btn-secondary" type="button" onClick={() => setControlTool(null)}>Avbryt</button>
        </form>
      </div>}
    </div>
  );
}
