import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import "./MachineChecklist.css";
import { API_URL } from "../config";
import { useSettings, addPDFHeader, addPDFFooter  } from "./SettingsContext";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

/* ---------------- ISO WEEK HELPERS ---------------- */
function getISOWeekAndYear(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

function formatWeekKey(year, week) {
  return `${year}-${String(week).padStart(2, "0")}`;
}

function getSurroundingWeeks(past = 99, future = 5) {
  const weeks = [];
  const today = new Date();
  for (let i = past; i > 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i * 7);
    const { year, week } = getISOWeekAndYear(d);
    weeks.push(formatWeekKey(year, week));
  }
  const { year, week } = getISOWeekAndYear(today);
  weeks.push(formatWeekKey(year, week));
  for (let i = 1; i <= future; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i * 7);
    const { year, week } = getISOWeekAndYear(d);
    weeks.push(formatWeekKey(year, week));
  }
  return weeks;
}

/* ---------------- COMPONENT ---------------- */
export default function MachineChecklist({ currentUser }) {
  const { settings, loading } = useSettings();

  const [token] = useState(() => localStorage.getItem("token"));
  const [user] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}");
    } catch {
      return {};
    }
  });

  const canEdit = user.role === "admin" || user.role === "suAdmin" || user.role === "user";

  const iso = getISOWeekAndYear();
  const defaultWeekKey = formatWeekKey(iso.year, iso.week);

  const [currentMachine, setCurrentMachine] = useState("");
  const [selectedWeek, setSelectedWeek] = useState(defaultWeekKey);
  const [state, setState] = useState({});
  const [comment, setComment] = useState("");
  const [checkedMachines, setCheckedMachines] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState("Alla");
  const [saveError, setSaveError] = useState(null);

  const authHeaders = useMemo(() => ({
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }), [token]);

  const surroundingWeeks = useMemo(() => getSurroundingWeeks(52, 0), []);

  const MACHINES = settings?.machines?.list || [];
  const MACHINE_GROUPS = settings?.machines?.groups || {};
  const CHECKLISTS = settings?.checklists || {};
  const GROUPS = useMemo(() => ["Alla", ...Object.keys(MACHINE_GROUPS)], [MACHINE_GROUPS]);

  const selectedMachineObj = useMemo(
    () => MACHINES.find(m => m.name === currentMachine),
    [MACHINES, currentMachine]
  );

  const activeSections = useMemo(
    () => selectedMachineObj ? CHECKLISTS[selectedMachineObj.group] || {} : {},
    [selectedMachineObj, CHECKLISTS]
  );

  const currentMachineNumber = selectedMachineObj?.number || "";

  const totalTasks = useMemo(
    () => Object.values(activeSections).reduce((a, s) => a + s.tasks.length, 0),
    [activeSections]
  );

  // FIX: memoized so it doesn't recompute on every render
  const doneTasks = useMemo(() => Object.keys(state).length, [state]);
  const percent = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;

  /* ---------------- FETCH CHECKLIST ---------------- */
  useEffect(() => {
    if (!currentMachine) return;
    fetch(`${API_URL}/checklist/${currentMachine}?week=${selectedWeek}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        setState(data.items || {});
        setComment(data.comment || "");
      })
      .catch(() => setSaveError("Kunde inte hämta checklistan"));
  }, [currentMachine, selectedWeek, token]);

  /* ---------------- FETCH TOP LIST ---------------- */
  useEffect(() => {
    if (!selectedWeek) return;
    fetch(`${API_URL}/checklist/top?week=${selectedWeek}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(res => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(data => setCheckedMachines(Array.isArray(data) ? data : []))
      .catch(() => setSaveError("Kunde inte hämta topplistan"));
  }, [selectedWeek, token]);

  /* ---------------- SAVE STATE ---------------- */
  // FIX: comment removed from useCallback deps — it was causing saveState
  // (and toggleTask which depends on it) to get a new reference on every
  // keystroke, causing unnecessary re-renders while the user types.
  // Instead, use a ref to always access the latest comment value.
  const commentRef = useRef(comment);
  useEffect(() => { commentRef.current = comment; }, [comment]);

  const saveState = useCallback((nextState, nextComment) => {
    setState(nextState);
    if (!currentMachine) return;

    setSaveError(null);

    const payload = {
      week: selectedWeek,
      items: nextState,
      comment: nextComment !== undefined ? nextComment : commentRef.current,
      machineNumber: currentMachineNumber,
      user: currentUser?.name || "Operator",
    };

    fetch(`${API_URL}/checklist/${currentMachine}`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(payload),
    }).catch(() => setSaveError("Kunde inte spara checklistan"));
  }, [currentMachine, selectedWeek, currentMachineNumber, currentUser, authHeaders]);

  /* ---------------- DEBOUNCED COMMENT SAVE ---------------- */
  const commentDebounceRef = useRef(null);

  const handleCommentChange = (e) => {
    if (!canEdit) return;
    const value = e.target.value;
    setComment(value);

    if (commentDebounceRef.current) clearTimeout(commentDebounceRef.current);
    commentDebounceRef.current = setTimeout(() => {
      saveState(state, value);
    }, 600);
  };

  useEffect(() => {
    return () => {
      if (commentDebounceRef.current) clearTimeout(commentDebounceRef.current);
    };
  }, []);

  /* ---------------- TOGGLE TASK ---------------- */
  const toggleTask = useCallback((sectionKey, index) => {
    const taskKey = `${sectionKey}-${index}`;
    const today = new Date();
    const nextState = { ...state };

    if (nextState[taskKey]) {
      delete nextState[taskKey];
      saveState(nextState);
      return;
    }

    nextState[taskKey] = {
      user: currentUser?.name || "Operator",
      date: today.toLocaleDateString("sv-SE"),
    };
    saveState(nextState);

    let weeksAhead = 0;
    if (sectionKey === "monthly") weeksAhead = 4;
    else if (sectionKey === "halfyear") weeksAhead = 26;
    else if (sectionKey === "yearly") weeksAhead = 52;

    if (weeksAhead > 0) {
      for (let i = 1; i <= weeksAhead; i++) {
        const futureDate = new Date(today);
        futureDate.setDate(futureDate.getDate() + i * 7);
        const { year, week } = getISOWeekAndYear(futureDate);
        const weekKey = formatWeekKey(year, week);

        fetch(`${API_URL}/checklist/${currentMachine}?week=${weekKey}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
          .then(res => res.ok ? res.json() : Promise.reject())
          .then(data => {
            const newItems = {
              ...(data.items || {}),
              [taskKey]: {
                user: currentUser?.name,
                date: today.toLocaleDateString("sv-SE"),
              },
            };
            return fetch(`${API_URL}/checklist/${currentMachine}`, {
              method: "POST",
              headers: authHeaders,
              body: JSON.stringify({
                week: weekKey,
                items: newItems,
                comment: data.comment || "",
                user: currentUser?.name || "Operator",
              }),
            });
          })
          .catch(() => console.warn(`Kunde inte kopiera vecka ${weekKey}`));
      }
    }
  }, [state, currentMachine, currentUser, token, authHeaders, saveState]);

  /* ---------------- PDF EXPORT ---------------- */
  /* ---------------- PDF EXPORT ---------------- */

	const saveCustomPDF = () => {
	  if (!currentMachine) return;

	  const doc = new jsPDF({
		orientation: "landscape",
		unit: "mm",
		format: "A4",
	  });
	 
	  const pageWidth = doc.internal.pageSize.getWidth();

	  /* ---------------- HEADER ---------------- */

	  addPDFHeader(
		doc,
		`Checklista: ${currentMachine} ${currentMachineNumber}`,
		settings
	  );

	  doc.setFontSize(9);

	  doc.text(
		`Vecka: ${selectedWeek}, ${doneTasks} / ${totalTasks} klara (${percent}%)`,
		15,
		28
	  );
	  doc.text(
		`Dokument: Checklista`,
		pageWidth - 15,
		22,
		{ align: "right" }
	  );

	  doc.text(
		`Rev: 2`,
		pageWidth - 15,
		27,
		{ align: "right" }
	  );

	  /* ---------------- TABLE DATA ---------------- */

	  const tableData = [];

	  Object.entries(activeSections).forEach(
		([sectionKey, section]) => {
		  section.tasks.forEach((task, i) => {
			const taskKey = `${sectionKey}-${i}`;
			const entry = state[taskKey];

			tableData.push([
			  i === 0 ? section.title : "",
			  task,
			  entry ? entry.user : "",
			  entry ? entry.date : "",
			]);
		  });
		}
	  );

	  /* ---------------- TABLE ---------------- */

	  autoTable(doc, {
		head: [[
		  "Sektion",
		  "Uppgift",
		  "Utförd av",
		  "Datum",
		]],

		body: tableData,

		startY: 33,

		theme: "grid",

		styles: {
		  fontSize: 8,
		  cellPadding: 2,
		  valign: "middle",
		  overflow: "linebreak",
		},

		headStyles: {
		  fillColor: [158, 6, 6],
		  textColor: 255,
		  fontStyle: "bold",
		  halign: "center",
		},

		columnStyles: {
		  0: { cellWidth: 35 },
		  1: { cellWidth: 115 },
		  2: { cellWidth: 45 },
		  3: { cellWidth: 25 },
		},

		didDrawPage: () => {
		  addPDFFooter(doc, settings);
		},
	  });

	  /* ---------------- COMMENT ---------------- */

	  if (comment) {
		const finalY =
		  (doc.lastAutoTable?.finalY || 40) + 10;

		doc.setFont("helvetica", "bold");
		doc.setFontSize(9);

		doc.text(
		  "Kommentar:",
		  15,
		  finalY
		);

		doc.setFont("helvetica", "normal");
		doc.setFontSize(8);

		const commentLines =
		  doc.splitTextToSize(comment, 250);

		doc.text(
		  commentLines,
		  15,
		  finalY + 6
		);
	  }

	  /* ---------------- SAVE ---------------- */

	  doc.save(
		`checklista_${selectedWeek}_${currentMachine}.pdf`
	  );
	};

  /* ---------------- EARLY RETURN ---------------- */
  // FIX: show a proper loading indicator instead of returning null silently.
  // Returning null meant the page appeared completely blank on first login
  // while useSettings was still fetching — with no feedback to the user.
  if (loading) return <p style={{ padding: "20px" }}>Laddar inställningar…</p>;
  if (!settings) return (
    <p style={{ padding: "20px", color: "red", display: "flex", alignItems: "center", gap: "10px" }}>
      Kunde inte ladda inställningar. Försök ladda om sidan.
      <button
        type="button"
        className="btn-secondary"
        onClick={() => window.location.reload()}
        title="Ladda om sidan"
      >
        ⟳ Ladda om
      </button>
    </p>
	);

  /* ---------------- RENDER ---------------- */
  return (
    <div className="checklist-page">
      <div className="checklist-wrapper">
        <div className="checklist-container">

          <div className="checklist-actions">
            <button
              onClick={saveCustomPDF}
              disabled={!currentMachine}
              className="btn-primary"
            >
              Spara som PDF
            </button>
          </div>

          {saveError && (
            <div
              style={{
                background: "#fee2e2",
                color: "#b91c1c",
                padding: "8px 12px",
                borderRadius: "6px",
                marginBottom: "10px",
              }}
            >
              {saveError}
              <button
                style={{ marginLeft: "10px", cursor: "pointer" }}
                onClick={() => setSaveError(null)}
              >
                ✕
              </button>
            </div>
          )}

          <header className="checklist-header">
            <h2>Checklista</h2>

            <label>
              Filter:
              <select
                value={selectedGroup}
                onChange={(e) => {
                  setSelectedGroup(e.target.value);
                  setCurrentMachine("");
                }}
              >
                {[...GROUPS]
                  .sort((a, b) => {
                    const nameA = MACHINE_GROUPS[a] || a;
                    const nameB = MACHINE_GROUPS[b] || b;
                    return nameA.localeCompare(nameB, "sv");
                  })
                  .map(group => (
                    <option key={group} value={group}>
                      {MACHINE_GROUPS[group] || group}
                    </option>
                  ))}
              </select>
            </label>

            <label>
              Maskin:
              <select
                value={currentMachine}
                onChange={(e) => setCurrentMachine(e.target.value)}
              >
                <option value="">-- Välj maskin --</option>
                {MACHINES
                  .filter(m => selectedGroup === "Alla" || m.group === selectedGroup)
                  .map(m => (
                    <option key={m.name} value={m.name}>
                      {m.name}{m.number ? ` (${m.number})` : ""}
                    </option>
                  ))}
              </select>
            </label>

            <label>
              Vecka:
              <select
                value={selectedWeek}
                onChange={(e) => setSelectedWeek(e.target.value)}
              >
                {[...surroundingWeeks].reverse().map(weekKey => (
                  <option key={weekKey} value={weekKey}>{weekKey}</option>
                ))}
              </select>
            </label>
          </header>

          <div className="progress-container">
            <div className="progress-bar" style={{ width: percent + "%" }} />
            <span className="progress-text">
              {doneTasks} / {totalTasks} klara ({percent}%)
            </span>
          </div>

          {!currentMachine && <p>Välj maskin för att börja.</p>}

          {currentMachine && Object.entries(activeSections).map(([key, section]) => (
            <div key={key} className="checklist-section">
              <h3>{section.title}</h3>
              <ul>
                {section.tasks.map((task, i) => {
                  const taskKey = `${key}-${i}`;
                  const entry = state[taskKey];
                  return (
                    <li key={taskKey} className={entry ? "done" : ""}>
                      <label>
                        <input
                          type="checkbox"
                          checked={!!entry}
                          onChange={() => toggleTask(key, i)}
                          disabled={!canEdit}
                        />
                        {task}
                      </label>
                      {entry && (
                        <span className="meta">✔ {entry.user} ({entry.date})</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {currentMachine && (
            <textarea
              className="machine-comment"
              placeholder="Kommentar för veckan..."
              value={comment}
              onChange={handleCommentChange}
              readOnly={!canEdit}
            />
          )}
        </div>

        {/* Top list */}
        <div className="checked-machines">
          <h3>Topplista denna vecka</h3>
          {checkedMachines.length === 0 && <p>Inga maskiner har checkat ännu</p>}
          <ul className="toplist">
            {checkedMachines.map((m, index) => {
              const medal =
                index === 0 ? `${index + 1}. 🥇` :
                index === 1 ? `${index + 1}. 🥈` :
                index === 2 ? `${index + 1}. 🥉` :
                `${index + 1}.`;

              return (
                <li key={m.machine}>
                  <strong>{medal}</strong>{" "}
                  {m.machine}: {m.doneTasks}/{m.totalTasks} klara ({m.percent}%)
                  <div
                    style={{
                      marginTop: "4px",
                      width: "100%",
                      backgroundColor: "#e5e7eb",
                      borderRadius: "var(--cell-radius)",
                      height: "10px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${m.percent}%`,
                        height: "100%",
                        backgroundColor: "#6bdc82",
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
