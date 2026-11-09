import { useState, useEffect } from "react";
import { API_URL } from "../config";
import { socket, connectSocket } from "../socket";
import "./QualityCostWidget.css";


export default function QualityCostWidget({
  widgetId = "quality-costs",
  initialTitle = "Kvalitetsbristkostnader",
  initialRows = [],
  canEdit = false,
  onEditingChange,
  PREV_YEAR_TOTAL = 0,
  PREV_YEAR_TOTAL_2 = 0,
  YEAR_LABEL = "2024/2025",
}) {
  const [title, setTitle] = useState(initialTitle);
  const [rows, setRows] = useState(initialRows);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [updatedBy, setUpdatedBy] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [error, setError] = useState("");

  /* -------- FETCH -------- */

  const loadWidget = async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      setError("Du behöver logga in för att läsa widgeten.");
      return;
    }

    try {
      const res = await fetch(`${API_URL}/structured-widgets/${widgetId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 404) {
        const createRes = await fetch(`${API_URL}/structured-widgets`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            widgetId,
            title: initialTitle,
            sections: initialRows,
          }),
        });
        if (!createRes.ok) throw new Error("Kunde inte skapa widgeten.");
        const doc = await createRes.json();
        setTitle(doc.title || initialTitle);
        setRows(Array.isArray(doc.sections) ? doc.sections : []);
        return;
      }

      if (!res.ok) throw new Error(`Kunde inte läsa widgeten (HTTP ${res.status}).`);
      const data = await res.json();
      setTitle(data.title || initialTitle);
      setRows(Array.isArray(data.sections) ? data.sections : []);
      setUpdatedBy(data.updatedBy || "");
      setUpdatedAt(data.updatedAt || null);
      setError("");
    } catch (err) {
      setError(err.message || "Ett fel uppstod när widgeten skulle läsas.");
      console.error("Kunde inte läsa kvalitetsbristkostnad:", err);
    }
  };

  useEffect(() => {
    loadWidget();
  }, [widgetId]);

  useEffect(() => {
    onEditingChange?.(isEditing);
  }, [isEditing, onEditingChange]);

  /* -------- WS -------- */

  useEffect(() => {
    const handler = (payload) => {
      if (payload.widgetId === widgetId) {
        setTitle(payload.title);
        setRows(payload.sections || []);
        setUpdatedBy(payload.updatedBy || "");
        setUpdatedAt(payload.updatedAt || null);
      }
    };

    connectSocket();
    socket.on("structuredWidgetUpdated", handler);
    return () => socket.off("structuredWidgetUpdated", handler);
  }, [widgetId]);

  /* -------- ACTIONS -------- */

  const addRow = () =>
    setRows([...rows, { month: "", cost: "" }]);

  const updateRow = (i, field, value) => {
    const copy = [...rows];
    copy[i] = { ...copy[i], [field]: value };
    setRows(copy);
  };

  const removeRow = (i) =>
    setRows(rows.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      setError("Du behöver logga in igen innan du kan spara.");
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      const res = await fetch(`${API_URL}/structured-widgets/${widgetId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title, sections: rows }),
      });

      if (res.status === 401) throw new Error("Din inloggning har gått ut. Logga in igen.");
      if (res.status === 403) throw new Error("Du saknar behörighet att redigera widgeten.");
      if (!res.ok) throw new Error(`Kunde inte spara ändringarna (HTTP ${res.status}).`);

      setIsEditing(false);
    } catch (err) {
      setError(err.message || "Ett fel uppstod när ändringarna skulle sparas.");
      console.error("Kunde inte spara kvalitetsbristkostnad:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const formatCost = (value) => {
    const num = Number(value);
    if (!num) return "0 kr";
    return num.toLocaleString("sv-SE") + " kr";
  };

  const total = rows.reduce((sum, r) => sum + Number(r.cost || 0), 0);
  const maxCost = Math.max(1, ...rows.map((r) => Number(r.cost || 0)));

  const delta =
    PREV_YEAR_TOTAL > 0
      ? ((total - PREV_YEAR_TOTAL) / PREV_YEAR_TOTAL) * 100
      : 0;
  const delta_2 =
    PREV_YEAR_TOTAL_2 > 0
      ? ((total - PREV_YEAR_TOTAL_2) / PREV_YEAR_TOTAL_2) * 100
      : 0;
  const deltaDirection = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const deltaDirection_2 = delta_2 > 0 ? "up" : delta_2 < 0 ? "down" : "flat";

  /* -------- RENDER -------- */

  return (
    <div className="widget qualityCostWidget">

      {!isEditing ? (
        <>
          <h3>Kvalitetsbristkostnad {title}</h3>

          <div className="summary-bar">
            <div className="summary-total">
              <span className="summary-label">Totalt {title}</span>
              <span className="summary-value">{formatCost(total)}</span>
            </div>

            <div className={`delta-badge delta-${deltaDirection}`}>
              <span className="delta-arrow" aria-hidden="true">
                {deltaDirection === "up" ? "▲" : deltaDirection === "down" ? "▼" : "•"}
              </span>
              {Math.abs(delta).toFixed(1)}% vs Föregånde år
            </div>
		    {PREV_YEAR_TOTAL_2 > 0 && (
			<div className={`delta-badge delta-${deltaDirection_2}`}>
              <span className="delta-arrow" aria-hidden="true">
                {deltaDirection_2 === "up" ? "▲" : deltaDirection_2 === "down" ? "▼" : "•"}
              </span>
              {Math.abs(delta_2).toFixed(1)}% vs {YEAR_LABEL}
            </div>
			)}
          </div>

          <table className="cost-table">
            <thead>
              <tr>
                <th>Månad/Kvartal</th>
                <th>Kostnad</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((r, i) => {
                const pct = Math.min(
                  100,
                  (Number(r.cost || 0) / maxCost) * 100
                );
                return (
                  <tr key={i}>
                    <td>{r.month}</td>
                    <td className="cost">
                      <div className="cost-cell">
                        <div
                          className="cost-bar"
                          style={{ width: `${pct}%` }}
                        />
                        <span className="cost-value">
                          {formatCost(r.cost)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>

            <tfoot>
              <tr>
                <td><strong>Totalt</strong></td>
                <td className="cost total">
                  {formatCost(total)}
                </td>
              </tr>
			  <tr>
                <td><i>Föregånde år</i></td>
                <td className="cost prev"><i>
                  {formatCost(PREV_YEAR_TOTAL)}
                </i></td>
              </tr>
			  {PREV_YEAR_TOTAL_2 > 0 && (
			  <tr>
                <td><i>{ YEAR_LABEL }</i></td>
                <td className="cost prev"><i>
                  {formatCost(PREV_YEAR_TOTAL_2)}
                </i></td>
              </tr>
			  )}
            </tfoot>
          </table>

          {updatedBy && (
            <div className="widget-meta">
              Redigerad av <strong>{updatedBy}</strong>{" "}
              {updatedAt &&
                new Date(updatedAt).toLocaleDateString("sv-SE")}
            </div>
          )}

          {canEdit && (
            <button
              className="edit-btn"
              onClick={() => setIsEditing(true)}
            >
              Redigera
            </button>
          )}
        </>
      ) : (
        <>		
          <input
            className="title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
		<div className="section-edit-box">
          {rows.map((r, i) => (
            <div key={i} className="row-edit">

              <input
				className="month-input"
                placeholder="Månad"
                value={r.month}
                onChange={(e) =>
                  updateRow(i, "month", e.target.value)
                }
              />

              <input
				className="month-input"
                type="number"
                placeholder="Kostnad"
                value={r.cost}
                onChange={(e) =>
                  updateRow(i, "cost", e.target.value)
                }
              />

              <button
                className="btn-danger"
                onClick={() => removeRow(i)}
              >
                Ta bort
              </button>

            </div>
          ))}
		  </div>
          <button
            className="btn-secondary"
			style={{ marginTop: "7px" }}
            onClick={addRow}
          >
            + Lägg till månad/kvartal
          </button>

          {error && <p className="error" role="alert">{error}</p>}

          <div className="actions">
            <button
              className="btn-danger"
			  style={{ marginTop: "7px" }}
              onClick={() => { setIsEditing(false); setError(""); loadWidget(); }}
            >
              Avbryt
            </button>

            <button
              className="btn-primary"
			  style={{ marginTop: "7px" }}
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? "Sparar…" : "Spara"}
            </button>
          </div>
        </>
      )}

    </div>
  );
}