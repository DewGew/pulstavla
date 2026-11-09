import React, { useState, useEffect, useMemo, useCallback } from "react";
import { API_URL } from "../config";
import { socket, connectSocket } from "../socket";
import "./OrderImport.css";

/* ---------------- WEEK RANGE HELPER ---------------- */
// Moved outside component — no component dependencies,
// so no need to recreate on every render.
function getWeekRange(type) {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = (day === 0 ? -6 : 1) - day;

  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  if (type === "next") {
    monday.setDate(monday.getDate() + 7);
    sunday.setDate(sunday.getDate() + 7);
  }

  return { monday, sunday };
}

/* ---------------- COMPONENT ---------------- */
export default function ProductionOrderImport() {
  const [file, setFile] = useState(null);
  const [orders, setOrders] = useState([]);
  const [sortAsc, setSortAsc] = useState(true);
  const [filterOrdernr, setFilterOrdernr] = useState("");
  const [filterArtikel, setFilterArtikel] = useState("");
  const [filterVecka, setFilterVecka] = useState("");
  const [filterBenamning, setFilterBenamning] = useState("");
  const [weekFilter, setWeekFilter] = useState("all");

  // FIX: upload feedback state instead of blocking alert()
  const [uploadMsg, setUploadMsg] = useState(null);
  const [uploading, setUploading] = useState(false);

  // FIX: token and currentUser read once with stable useState initializer.
  // JSON.parse has a fallback and try/catch to handle null or corrupted data.
  const [token] = useState(() => localStorage.getItem("token"));
  const [currentUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}");
    } catch {
      return {};
    }
  });

  // FIX: single isAdmin constant instead of repeating the check inline
  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "suAdmin";

  /* ---------------- FETCH ORDERS ---------------- */
  // FIX: wrapped in useCallback for stable reference — safe to use in the
  // socket listener without capturing a stale closure.
  // FIX: auth header added.
  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/production-orders`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setOrders(await res.json());
    } catch {
      setUploadMsg({ type: "error", text: "Kunde inte hämta tillverkningsordrar" });
    }
  }, [token]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  /* ---------------- WEBSOCKET ---------------- */
  // FIX: fetchOrders is now stable (useCallback), so the socket listener
  // always calls the current version — no stale closure.
  // FIX: fetchOrders added to dependency array.
  useEffect(() => {
    if (!token) return;

    
    socket.on("productionOrdersUpdated", fetchOrders);
  }, [token, fetchOrders]);

  /* ---------------- UPLOAD ---------------- */
  // FIX: try/catch added, alert() replaced with state-based feedback.
  const handleUpload = async () => {
    if (!file) {
      setUploadMsg({ type: "error", text: "Välj en fil först" });
      return;
    }

    setUploading(true);
    setUploadMsg(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${API_URL}/production-orders/import`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await res.json();

      if (data.success) {
        setUploadMsg({ type: "success", text: `Importerade ${data.rowsImported} rader` });
        setFile(null);
        fetchOrders();
      } else {
        setUploadMsg({ type: "error", text: data.error || "Import misslyckades" });
      }
    } catch {
      setUploadMsg({ type: "error", text: "Nätverksfel – kunde inte importera" });
    } finally {
      setUploading(false);
    }
  };

  /* ---------------- LAST IMPORTED AT ---------------- */
  // FIX: computed from full orders array, not filtered — active filters
  // could otherwise hide the most recently imported order.
  const lastImportedAt = useMemo(() => {
    if (!orders.length) return null;
    const max = Math.max(...orders.map(o => new Date(o.importedAt).getTime()));
    return isNaN(max) ? null : new Date(max);
  }, [orders]);

  /* ---------------- FILTER + SORT ---------------- */
  const filteredAndSortedOrders = useMemo(() => {
    let result = [...orders];

    result = result.filter(order => {
      const leveransDatum = order.Leveransdatum
        ? new Date(order.Leveransdatum)
        : null;

      if (filterVecka &&
        !String(order.Vecka || "").toLowerCase().includes(filterVecka.toLowerCase()))
        return false;

      if (filterOrdernr &&
        !String(order.Ordernr || "").toLowerCase().includes(filterOrdernr.toLowerCase()))
        return false;

      if (filterArtikel &&
        !String(order.Artikelnr || "").toLowerCase().includes(filterArtikel.toLowerCase()))
        return false;

      if (filterBenamning &&
        !String(order.Benämning || "").toLowerCase().includes(filterBenamning.toLowerCase()))
        return false;

      if (weekFilter !== "all" && leveransDatum) {
        const { monday, sunday } = getWeekRange(weekFilter);
        if (weekFilter === "this") {
          if (leveransDatum > sunday) return false;
        } else {
          if (leveransDatum < monday || leveransDatum > sunday) return false;
        }
      }

      return true;
    });

    result.sort((a, b) => {
      const dateA = a.Leveransdatum ? new Date(a.Leveransdatum) : new Date(0);
      const dateB = b.Leveransdatum ? new Date(b.Leveransdatum) : new Date(0);
      return sortAsc ? dateA - dateB : dateB - dateA;
    });

    return result;
  }, [orders, sortAsc, filterOrdernr, filterArtikel, filterBenamning, filterVecka, weekFilter]);

  /* ---------------- TABLE HEADERS ---------------- */
  // FIX: headers derived from all orders (not just first row) to handle
  // edge cases where different rows have different keys after re-import.
  const tableHeaders = useMemo(() => {
    const excluded = new Set(["_id", "importedAt", "importedBy"]);
    const keySet = new Set();
    orders.forEach(o => Object.keys(o).forEach(k => { if (!excluded.has(k)) keySet.add(k); }));
    return [...keySet];
  }, [orders]);

  /* ---------------- ROW STATUS ---------------- */
  const getRowStatusClass = (startdatum) => {
    if (!startdatum) return "";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Build date manually to avoid timezone shifting with new Date(string)
    const [year, month, day] = startdatum.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    const diffDays = Math.floor((date - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return "row-red";
    if (diffDays <= 3) return "row-yellow";
    return "row-green";
  };

  /* ---------------- RENDER ---------------- */
  return (
    <div className="orders-box">
      <h2>Tillverkningsordrar</h2>

      <div className="widget-meta">
        Senast uppdaterad{" "}
        {lastImportedAt
          ? lastImportedAt.toLocaleString("sv-SE", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "—"}
      </div>

      {/* FIX: state-based feedback banner instead of alert() */}
      {uploadMsg && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: "6px",
            marginBottom: "10px",
            background: uploadMsg.type === "success" ? "#dcfce7" : "#fee2e2",
            color: uploadMsg.type === "success" ? "#15803d" : "#b91c1c",
          }}
        >
          {uploadMsg.text}
          <button
            style={{ marginLeft: "10px", cursor: "pointer" }}
            onClick={() => setUploadMsg(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* FIX: single isAdmin check */}
      {isAdmin && (
        <>
          <input
            className="orders-input"
            type="file"
            accept=".xlsx,.xls"
            onChange={e => setFile(e.target.files[0])}
          />
          <button
            className="btn-primary"
            onClick={handleUpload}
            disabled={uploading}
          >
            {uploading ? "Importerar…" : "Importera"}
          </button>
          <div className="widget-meta">
            Till exempel: Prodplan -202602261451.XLSX
          </div>
        </>
      )}

      {/* Filter + Sort */}
      <div className="orders-filters">
        <input
          className="orders-input"
          type="text"
          placeholder="Filtrera Ordernr"
          value={filterOrdernr}
          onChange={e => setFilterOrdernr(e.target.value)}
        />
        <input
          className="orders-input"
          type="text"
          placeholder="Filtrera Artikelnr"
          value={filterArtikel}
          onChange={e => setFilterArtikel(e.target.value)}
        />
        <input
          className="orders-input"
          type="text"
          placeholder="Filtrera Benämning"
          value={filterBenamning}
          onChange={e => setFilterBenamning(e.target.value)}
        />
        <input
          className="orders-input"
          type="text"
          placeholder="Filtrera Vecka"
          value={filterVecka}
          onChange={e => setFilterVecka(e.target.value)}
        />

        <button
          className="sortdir"
          onClick={() => setSortAsc(prev => !prev)}
        >
          Sortera klart datum: {sortAsc ? "↑" : "↓"}
        </button>

        <div className="week-buttons">
          <button
            className={`sortdir ${weekFilter === "this" ? "active" : ""}`}
            onClick={() => setWeekFilter("this")}
          >
            Denna vecka
          </button>
          <button
            className={`sortdir ${weekFilter === "next" ? "active" : ""}`}
            onClick={() => setWeekFilter("next")}
          >
            Nästa vecka
          </button>
          <button
            className={`sortdir ${weekFilter === "all" ? "active" : ""}`}
            onClick={() => setWeekFilter("all")}
          >
            Alla
          </button>
        </div>
      </div>

      <div className="orders-section">
        <table className="orders-table">
          <thead>
            <tr>
              {/* FIX: headers from full orders set, not just first row */}
              {tableHeaders.map(key => <th key={key}>{key}</th>)}
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedOrders.map(order => (
              <tr
                key={order._id}
                className={getRowStatusClass(order.Leveransdatum)}
              >
                {/* FIX: duplicate key prop removed */}
                {tableHeaders.map(key => (
                  <td
                    key={key}
                    style={key === "ResTid" ? { fontWeight: "bold" } : {}}
                  >
                    {key === "Leveransdatum" && order[key]
                      ? new Date(order[key]).toLocaleDateString("sv-SE")
                      : order[key] === 0 || order[key] === "0"
                        ? ""
                        : order[key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}