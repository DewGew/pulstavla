import { useState, useEffect, useMemo, useCallback } from "react";
import { apiFetch } from "../api";
import "./GreenCross.css";
import { socket } from "../socket";

const STATES = ["default", "green", "yellow", "red"];
const MONTHS = [
  "Januari","Februari","Mars","April","Maj","Juni",
  "Juli","Augusti","September","Oktober","November","December"
];
const LAYOUT = [3,3,7,7,7,3,3];

export default function GreenCross({ crossId, green = "Green", yellow = "Yellow", red = "Red" }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [days, setDays] = useState([]);
  const [cells, setCells] = useState([]);
  const [highlight, setHighlight] = useState({});
  const [activityDays, setActivityDays] = useState({});
  const [loading, setLoading] = useState(false);

  const [token] = useState(() => localStorage.getItem("token"));
  const [currentUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}");
    } catch {
      return {};
    }
  });

  const canEdit = currentUser.role === "admin" || currentUser.role === "suAdmin";

  const authHeaders = useMemo(() => ({
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }), [token]);

  /* ---------------- FETCH GREEN CROSS ---------------- */
  useEffect(() => {
    const totalDays = new Date(year, month + 1, 0).getDate();
    setDays(Array.from({ length: totalDays }, (_, i) => i + 1));
    setLoading(true);

    apiFetch(`/greenCross/${crossId}/${year}/${month}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(res => res.json())
      .then(data => {
        const arr = Array(totalDays).fill("default");
        if (data?.cells) data.cells.slice(0, totalDays).forEach((c, i) => arr[i] = c);
        setCells(arr);
      })
      .catch(() => setCells(Array(totalDays).fill("default")))
      .finally(() => setLoading(false));
  }, [crossId, year, month, token]);

  /* ---------------- FETCH ACTIVITIES (calendar markers only) ---------------- */
  const fetchActivities = useCallback(() => {
    apiFetch("/activities", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(res => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(list => {
        const map = {};
        list.forEach(a => {
          if (a.crossId === crossId && a.deadline && a.flag) {
            map[a.deadline.split("T")[0]] = a.flag;
          }
        });
        setActivityDays(map);
      })
      .catch(() => console.warn("Kunde inte hämta aktiviteter för GreenCross"));
  }, [crossId, token]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  /* ---------------- WEBSOCKET ---------------- */
  useEffect(() => {
    const handler = payload => {
      if (
        payload.crossId === crossId &&
        payload.year === year &&
        payload.month === month
      ) {
        setCells(payload.cells);
      }
    };

    socket.on("greenCrossUpdate", handler);
    return () => socket.off("greenCrossUpdate", handler);
  }, [crossId, year, month]);

  /* ---------------- CLICK CELL ---------------- */
  const toggleCell = useCallback((index) => {
    setCells(prev => {
      const updated = [...prev];
      const next = STATES[(STATES.indexOf(updated[index]) + 1) % STATES.length];
      updated[index] = next;

      setHighlight({ [index]: true });
      setTimeout(() => setHighlight({}), 400);

      apiFetch("/greenCross", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ crossId, year, month, cells: updated }),
      }).catch(() => console.warn("Kunde inte lagra GreenCross"));

      return updated;
    });
  }, [crossId, year, month, authHeaders]);

  /* ---------------- COUNTS ---------------- */
  const counts = useMemo(() => ({
    green: cells.filter(c => c === "green").length,
    yellow: cells.filter(c => c === "yellow").length,
    red: cells.filter(c => c === "red").length,
  }), [cells]);

  /* ---------------- BUILD GRID ROWS ---------------- */
  const gridRows = useMemo(() => {
    let dayCounter = 0;

    return LAYOUT.map((cols, r) => {
      const pad = Math.floor((7 - cols) / 2);
      const row = [];

      for (let i = 0; i < 7; i++) {
        if (i < pad || i >= pad + cols || dayCounter >= days.length) {
          row.push(<div key={i} className="gc-empty" />);
        } else {
          const index = dayCounter;
          const day = days[index];
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const flag = activityDays[dateStr];
          const weekday = new Date(year, month, day).getDay();
          const isWeekend = weekday === 0 || weekday === 6;

          row.push(
            <div
              key={i}
              className={`gc-cell ${cells[index]} ${highlight[index] ? "highlight" : ""} ${!canEdit ? "gc-disabled" : ""}`}
              onClick={canEdit ? () => toggleCell(index) : undefined}
            >
              <span className={`gc-day ${isWeekend ? "gc-weekend" : ""}`}>
                {day}
              </span>
              {flag === "yellow" && <span>📌</span>}
              {flag === "red" && <span>📌</span>}
            </div>
          );
          dayCounter++;
        }
      }

      return <div key={r} className="gc-row">{row}</div>;
    });
  }, [days, year, month, cells, highlight, activityDays, canEdit, toggleCell]);

  return (
    <div className="green-cross-wrapper gc-grid">
      <div className="gc-controls">
        <select value={month} onChange={e => setMonth(+e.target.value)}>
          {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
        </select>
        <input
          type="number"
          value={year}
          onChange={e => setYear(+e.target.value)}
        />
      </div>

      {loading ? <p className="gc-loading">Laddar…</p> : gridRows}

      <div className="gc-legend-row">
        <div className="gc-counts">
          <div><span>🟢</span>= {green} ({counts.green})</div>
          <div><span>🟡</span>= {yellow} ({counts.yellow})</div>
          <div><span>🔴</span>= {red} ({counts.red})</div>
        </div>
      </div>
    </div>
  );
}
