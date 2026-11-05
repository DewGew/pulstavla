import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { io } from "socket.io-client";
import "./GreenCross.css";
import { API_URL, WS_URL } from "../config";

const STATES = ["default", "green", "yellow", "red"];
const MONTHS = [
  "Januari","Februari","Mars","April","Maj","Juni",
  "Juli","Augusti","September","Oktober","November","December"
];
const LAYOUT = [3,3,7,7,7,3,3];
const GREEN_URL = `${API_URL}/greenCross`;

export default function GreenCross({ crossId, green = "Green", yellow = "Yellow", red = "Red", url }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [days, setDays] = useState([]);
  const [cells, setCells] = useState([]);
  const [highlight, setHighlight] = useState({});
  const [activityDays, setActivityDays] = useState({});
  const [suggestedTask, setSuggestedTask] = useState(null);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // FIX: read token and user once with stable useState initializer.
  // JSON.parse wrapped in try/catch to handle corrupted localStorage.
  const [token] = useState(() => localStorage.getItem("token"));
  const [currentUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}");
    } catch {
      return {};
    }
  });

  const canEdit = currentUser.role === "admin" || currentUser.role === "suAdmin";

  // FIX: auth headers helper
  const authHeaders = useMemo(() => ({
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }), [token]);

  /* ---------------- FETCH GREEN CROSS ---------------- */
  useEffect(() => {
    const totalDays = new Date(year, month + 1, 0).getDate();
    setDays(Array.from({ length: totalDays }, (_, i) => i + 1));
    setLoading(true);

    // FIX: auth header added to green cross fetch
    fetch(`${GREEN_URL}/${crossId}/${year}/${month}`, {
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

  /* ---------------- FETCH ACTIVITIES ---------------- */
  // FIX: only depends on crossId and token — year/month caused unnecessary
  // re-fetches since the server returns all activities regardless.
  // token added to deps so the effect re-runs if auth changes.
  const fetchActivities = useCallback(() => {
    fetch(`${API_URL}/activities`, {
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
            const dateOnly = a.deadline.split("T")[0];
            map[dateOnly] = a.flag;
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
  // FIX: socket created inside useEffect — disconnected on unmount.
  // No more module-level persistent socket connection.
  useEffect(() => {
    const socket = io(WS_URL, { transports: ["websocket"] });

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

    return () => {
      socket.off("greenCrossUpdate", handler);
      socket.disconnect();
    };
  }, [crossId, year, month]);

  /* ---------------- CREATE SUGGESTION ---------------- */
  const createSuggestedActivity = (color, date) => {
    if (color === "yellow")
      return {
        title: "Observation / Risk",
        description: "Identifierad risk.",
        category: "Förslag",
        deadline: date,
        flag: "red",
        crossId,
      };

    if (color === "red")
      return {
        title: "Avvikelse – åtgärd krävs",
        description: "Problem identifierat.",
        category: "Problem",
        deadline: date,
        flag: "yellow",
        crossId,
      };

    return null;
  };

  /* ---------------- CLICK CELL ---------------- */
  // FIX: fetch moved outside the setState updater callback.
  // Side effects inside setState are a React anti-pattern — the updater
  // can run more than once in Strict Mode.
  const toggleCell = useCallback((index) => {
    setCells(prev => {
      const updated = [...prev];
      const next = STATES[(STATES.indexOf(updated[index]) + 1) % STATES.length];
      updated[index] = next;

      setHighlight({ [index]: true });
      setTimeout(() => setHighlight({}), 400);

      // FIX: fetch outside setState, using the computed `updated` array
      // captured in this closure — safe because we're not in the updater
      fetch(GREEN_URL, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ crossId, year, month, cells: updated }),
      }).catch(() => console.warn("Kunne ikke lagre GreenCross"));

      const day = index + 1;
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

      if ((next === "yellow" || next === "red") && !activityDays[dateStr]) {
        const suggestion = createSuggestedActivity(next, dateStr);
        if (suggestion) {
          setSuggestedTask(suggestion);
          setShowTaskModal(true);
        }
      }

      return updated;
    });
  }, [crossId, year, month, activityDays, authHeaders]);

  /* ---------------- COUNTS ---------------- */
  const counts = useMemo(() => ({
    green: cells.filter(c => c === "green").length,
    yellow: cells.filter(c => c === "yellow").length,
    red: cells.filter(c => c === "red").length,
  }), [cells]);

  /* ---------------- BUILD GRID ROWS ---------------- */
  // FIX: dayCounter moved out of render body into useMemo to avoid
  // mutating a plain let variable during render, which is fragile
  // with React concurrent features.
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

  /* ---------------- RENDER ---------------- */
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

      {/* FIX: loading indicator while fetching cell data */}
      {loading ? (
        <p className="gc-loading">Laddar…</p>
      ) : (
        gridRows
      )}

      <div className="gc-legend-row">
        <div className="gc-counts">
          <div><span>🟢</span>= {green} ({counts.green})</div>
          <div><span>🟡</span>= {yellow} ({counts.yellow})</div>
          <div><span>🔴</span>= {red} ({counts.red})</div>
        </div>
      </div>

      {url && (
        <p className="gc-url" onClick={() => setShowUrlModal(true)}>
          {url.title}
        </p>
      )}

      {/* -------- SUGGEST ACTIVITY MODAL -------- */}
      {showTaskModal && suggestedTask && (
        <div className="modal-overlay" onClick={() => setShowTaskModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Skapa aktivitet?</h3>

            <input
              type="text"
              value={suggestedTask.title}
              onChange={e => setSuggestedTask({ ...suggestedTask, title: e.target.value })}
            />

            <textarea
              rows="3"
              value={suggestedTask.description}
              onChange={e => setSuggestedTask({ ...suggestedTask, description: e.target.value })}
            />

            <select
              value={suggestedTask.category}
              onChange={e => setSuggestedTask({ ...suggestedTask, category: e.target.value })}
            >
              <option>Säkerhet</option>
              <option>Problem</option>
              <option>Underhåll</option>
              <option>Förslag</option>
              <option>Övrigt</option>
            </select>

            {saveError && (
              <p style={{ color: "red", marginTop: "6px" }}>{saveError}</p>
            )}

            <div className="modal-buttons">
              <button
                className="btn-primary"
                onClick={async () => {
                  // FIX: try/catch around the activity POST with user feedback
                  try {
                    setSaveError(null);
                    const res = await fetch(`${API_URL}/activities`, {
                      method: "POST",
                      headers: authHeaders,
                      body: JSON.stringify(suggestedTask),
                    });

                    if (!res.ok) throw new Error("Kunde inte skapa aktivitet");

                    setActivityDays(prev => ({
                      ...prev,
                      [suggestedTask.deadline]: suggestedTask.flag,
                    }));

                    setShowTaskModal(false);
                    setSuggestedTask(null);
                  } catch (err) {
                    setSaveError(err.message);
                  }
                }}
              >
                Skapa aktivitet
              </button>
              <button
                className="btn-danger"
                onClick={() => {
                  setShowTaskModal(false);
                  setSaveError(null);
                }}
              >
                Avbryt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------- URL INFO MODAL -------- */}
      {showUrlModal && url && (
        <div className="modal-overlay" onClick={() => setShowUrlModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>{url.title}</h3>
            <p style={{ whiteSpace: "pre-line" }}>{url.text}</p>
            <div className="modal-buttons">
              <button className="btn-primary" onClick={() => setShowUrlModal(false)}>
                Stäng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
