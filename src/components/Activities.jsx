import { useEffect, useState, useCallback } from "react";
import { API_URL, WS_URL } from "../config";
import { useSettings, addPDFHeader, addPDFFooter  } from "./SettingsContext";
import { io } from "socket.io-client";
import "./Activities.css";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export default function Activities() {
  const { settings, loading } = useSettings();
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [filter, setFilter] = useState("Alla");
  const [deadlineFilter, setDeadlineFilter] = useState("");
  const [responsibleFilter, setResponsibleFilter] = useState("Alla");
  const [showModal, setShowModal] = useState(false);
  const [hideDone, setHideDone] = useState(true);
  const [imageFile, setImageFile] = useState(null);
  const [imageModal, setImageModal] = useState(null);
  const [imageUrls, setImageUrls] = useState({});

  // FIX: read token/user once with useState so they're stable references,
  // and wrap user parsing in try/catch to handle corrupted localStorage.
  const [token] = useState(() => localStorage.getItem("token"));
  const [user] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}");
    } catch {
      return {};
    }
  });

  const canEdit =
    user.role === "admin" || user.role === "suAdmin" || user.role === "user";
  const isAdmin = user.role === "admin" || user.role === "suAdmin";

  // Ny aktivitet-state
  const [newTask, setNewTask] = useState({
    title: "",
    category: "Övrigt",
    deadline: "",
    responsible: "",
    description: "",
    sticky: false,
  });

  // Redigering
  const [editTask, setEditTask] = useState(null);

  // FIX: inline delete confirm state instead of blocking confirm()
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Error / loading feedback
  const [error, setError] = useState(null);
  const [loadingTasks, setLoadingTasks] = useState(false);

  /* ---------------- LOAD TASKS ---------------- */
  // FIX: wrapped in useCallback so the reference is stable and can be safely
  // listed in useEffect dependency arrays and passed to socket listeners.
  const loadTasks = useCallback(async () => {
    if (!token) return;
    setLoadingTasks(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/activities`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) {
        console.warn("Token ogiltig – loggar ut");
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        // FIX: use React-friendly navigation instead of hard redirect.
        // If you use react-router, replace with: navigate("/login")
        window.location.href = "/login";
        return;
      }

      const rows = await res.json();
      const safeRows = Array.isArray(rows) ? rows : [];
      const nextUrls = {};
      await Promise.all(safeRows.filter((task) => task.image).map(async (task) => {
        try {
          const imageRes = await fetch(`${API_URL}${task.image}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (imageRes.ok) nextUrls[task._id] = URL.createObjectURL(await imageRes.blob());
        } catch (error) {
          console.warn("Kunde inte läsa aktivitetsbild:", error);
        }
      }));
      setImageUrls((previous) => {
        Object.values(previous).forEach((url) => URL.revokeObjectURL(url));
        return nextUrls;
      });
      setTasks(safeRows);
    } catch {
      setError("Kunde inte hämta aktiviteter");
    } finally {
      setLoadingTasks(false);
    }
  }, [token]);

  /* ---------------- LOAD USERS ---------------- */
  // FIX: wrapped in useCallback for the same reason as loadTasks.
  const loadUsers = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/presence/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Fel vid hämtning av användare");
      setUsers(await res.json());
    } catch {
      setError("Kunde inte hämta användare");
    }
  }, [token]);

  /* ---------------- WEBSOCKET ---------------- */
  // FIX: loadTasks is now stable (useCallback), so the socket listener always
  // calls the current version rather than a stale closure.
  useEffect(() => {
    if (!token) return;

    const socket = io(WS_URL, {
      transports: ["websocket"],
      auth: { token },
    });

    socket.on("activitiesUpdated", loadTasks);
    return () => socket.disconnect();
  }, [token, loadTasks]);

  /* ---------------- INITIAL LOAD ---------------- */
  // FIX: both functions added to dependency array now that they're stable.
  useEffect(() => {
    if (!token) {
      window.location.href = "/login";
      return;
    }
    loadTasks();
    loadUsers();
  }, [loadTasks, loadUsers, token]);

  /* ---------------- OPEN EDIT MODAL ---------------- */
  const startEdit = (task) => {
    if (!canEdit) return;
    setEditTask({ ...task });
    setShowModal(true);
  };

  /* ---------------- CREATE TASK ---------------- */
  const addTask = async () => {
    if (!newTask.title.trim()) return;

    let imageUrl = null;

    try {
      if (imageFile) {
        const formData = new FormData();
        formData.append("image", imageFile);

        const uploadRes = await fetch(`${API_URL}/activities/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });

        const data = await uploadRes.json();
        imageUrl = data.url;
      }

      await fetch(`${API_URL}/activities`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...newTask, image: imageUrl }),
      });

      setNewTask({
        title: "",
        category: "Övrigt",
        deadline: "",
        responsible: "",
        description: "",
        sticky: false,
      });
      setImageFile(null);
      loadTasks();
    } catch {
      setError("Kunde inte spara aktiviteten");
    }
  };

  /* ---------------- UPDATE TASK ---------------- */
  const updateTask = async (id, changes) => {
    try {
      await fetch(`${API_URL}/activities/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(changes),
      });
      loadTasks();
    } catch {
      setError("Kunde inte uppdatera uppgiften");
    }
  };

  /* ---------------- DELETE TASK ---------------- */
  // FIX: no longer uses blocking confirm() — uses inline confirmDeleteId state.
  const deleteTask = async (id) => {
    try {
      await fetch(`${API_URL}/activities/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setConfirmDeleteId(null);
      loadTasks();
    } catch {
      setError("Kunde inte radera uppgiften");
    }
  };

  /* ---------------- FILTERING ---------------- */
  const categories = ["Säkerhet", "Problem", "Underhåll", "Förslag", "Övrigt"];

  const filteredTasks = tasks
    .filter((t) => {
      const categoryMatch = filter === "Alla" || t.category === filter;
      const deadlineMatch =
        !deadlineFilter || (t.deadline && t.deadline <= deadlineFilter);
      const doneMatch = hideDone ? !t.done : true;
      const responsibleMatch =
        responsibleFilter === "Alla" || t.responsible === responsibleFilter;
      return categoryMatch && deadlineMatch && doneMatch && responsibleMatch;
    })
    .sort((a, b) => {
      if (a.sticky && !b.sticky) return -1;
      if (!a.sticky && b.sticky) return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

  const isDeadlinePassed = (deadline) => {
    if (!deadline) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const deadlineDate = new Date(deadline);
    deadlineDate.setHours(0, 0, 0, 0);
    return deadlineDate < today;
  };

  /* ---------------- CSV DOWNLOAD ---------------- */
  const downloadActivities = () => {
    if (!filteredTasks.length) {
      setError("Inga aktiviteter att ladda ner");
      return;
    }

    const headers = [
      "Titel", "Beskrivning", "Kategori", "Deadline",
      "Ansvarig", "Klar", "Skapad",
    ];

    const rows = filteredTasks.map((t) => [
      t.title || "",
      t.description || "",
      t.category || "",
      t.deadline || "",
      t.responsible || "",
      t.done ? "Ja" : "Nej",
      t.createdAt ? new Date(t.createdAt).toLocaleDateString() : "",
    ]);

    const csv = [headers, ...rows]
      .map((row) =>
        row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(";")
      )
      .join("\n");

    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aktiviteter_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  /* ---------------- PDF DOWNLOAD ---------------- */
  const downloadActivitiesPDF = () => {
	  if (!filteredTasks.length) {
		setError("Inga aktiviteter att ladda ner");
		return;
	  }

	  const doc = new jsPDF({
		orientation: "landscape",
		unit: "mm",
		format: "A4",
	  });

	  const headers = [
		"Titel",
		"Beskrivning",
		"Kategori",
		"Deadline",
		"Ansvarig",
		"Klar",
		"Skapad",
	  ];

	  const rows = filteredTasks.map((t) => [
		t.title || "",
		t.description || "",
		t.category || "",
		t.deadline || "",
		t.responsible || "",
		t.done ? "Ja" : "Nej",
		t.createdAt
		  ? new Date(t.createdAt).toLocaleDateString("sv-SE")
		  : "",
	  ]);

	  /* ---------------- HEADER ---------------- */

	  addPDFHeader(
		doc,
		"Aktivitetslista",
		settings
	  );

	  /* ---------------- TABLE ---------------- */

	  autoTable(doc, {
		head: [headers],
		body: rows,

		startY: 30,

		theme: "grid",

		styles: {
		  fontSize: 8,
		  cellPadding: 2,
		  valign: "middle",
		},

		headStyles: {
		  fillColor: [158, 6, 6],
		  textColor: 255,
		  fontStyle: "bold",
		  halign: "center",
		},

		didDrawPage: () => {
		  addPDFFooter(doc, settings);
		},
	  });

	  /* ---------------- SAVE ---------------- */

	  doc.save(
		`aktiviteter_${new Date()
		  .toISOString()
		  .slice(0, 10)}.pdf`
	  );
	};
  
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
    <div className="activities-container">
      <h2>Aktiviteter</h2>

      {/* FIX: error banner for async failures instead of silent errors */}
      {error && (
        <div
          className="error-banner"
          style={{
            background: "#fee2e2",
            color: "#b91c1c",
            padding: "8px 12px",
            borderRadius: "6px",
            marginBottom: "10px",
          }}
        >
          {error}
          <button
            style={{ marginLeft: "10px", cursor: "pointer" }}
            onClick={() => setError(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* -------- NY AKTIVITET -------- */}
      <div className="task-form">
        <button
          style={{ marginBottom: "7px" }}
          className="btn-primary"
          disabled={!canEdit}
          onClick={() => {
            if (!canEdit) return;
            setEditTask(null);
            setNewTask({
              title: "",
              category: "Övrigt",
              deadline: "",
              responsible: "",
              description: "",
              sticky: false,
            });
            setShowModal(true);
          }}
        >
          Ny aktivitet
        </button>

        {/* -------- MODAL -------- */}
        {showModal && (
          <div className="modal-overlay" onClick={() => setShowModal(false)}>
            <div
              className="modal-content"
              onClick={(e) => e.stopPropagation()}
            >
              <h3>{editTask ? "Redigera aktivitet" : "Ny aktivitet"}</h3>

              {/* FIX: autoFocus on title, not description */}
              <input
                type="text"
                placeholder="Ange aktivitet.."
                autoFocus
                value={editTask ? editTask.title : newTask.title}
                onChange={(e) =>
                  editTask
                    ? setEditTask({ ...editTask, title: e.target.value })
                    : setNewTask({ ...newTask, title: e.target.value })
                }
              />

              <textarea
                placeholder="Beskrivning av aktiviteten..."
                value={editTask ? editTask.description : newTask.description}
                onChange={(e) =>
                  editTask
                    ? setEditTask({ ...editTask, description: e.target.value })
                    : setNewTask({ ...newTask, description: e.target.value })
                }
                rows={4}
              />

              <input
                type="file"
                accept="image/*"
                onChange={(e) => setImageFile(e.target.files[0])}
              />

              <select
                value={editTask ? editTask.category : newTask.category}
                onChange={(e) =>
                  editTask
                    ? setEditTask({ ...editTask, category: e.target.value })
                    : setNewTask({ ...newTask, category: e.target.value })
                }
              >
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>

              {isAdmin && (
                <label style={{ marginTop: "10px" }}>
                  <input
                    type="checkbox"
                    checked={editTask ? editTask.sticky : newTask.sticky}
                    onChange={(e) =>
                      editTask
                        ? setEditTask({ ...editTask, sticky: e.target.checked })
                        : setNewTask({ ...newTask, sticky: e.target.checked })
                    }
                  />
                  📌 Fäst överst (Sticky)
                </label>
              )}

              <input
                type="date"
                value={editTask ? editTask.deadline : newTask.deadline}
                onChange={(e) =>
                  editTask
                    ? setEditTask({ ...editTask, deadline: e.target.value })
                    : setNewTask({ ...newTask, deadline: e.target.value })
                }
              />

              {isAdmin && (
                <select
                  value={
                    editTask ? editTask.responsible : newTask.responsible
                  }
                  onChange={(e) =>
                    editTask
                      ? setEditTask({
                          ...editTask,
                          responsible: e.target.value,
                        })
                      : setNewTask({ ...newTask, responsible: e.target.value })
                  }
                >
                  <option value="">Ansvarig...</option>
                  {users.map((u) => (
                    <option key={u._id || u.id} value={u.name}>
                      {u.name}
                    </option>
                  ))}
                </select>
              )}

              <div className="modal-buttons">
                <button
                  className="btn-primary"
                  disabled={!canEdit}
                  onClick={async () => {
                    if (!canEdit) return;

                    if (editTask) {
                      let imageUrl = editTask.image;
                      if (imageFile) {
                        const formData = new FormData();
                        formData.append("image", imageFile);
                        const uploadRes = await fetch(
                          `${API_URL}/activities/upload`,
                          {
                            method: "POST",
                            headers: { Authorization: `Bearer ${token}` },
                            body: formData,
                          }
                        );
                        const data = await uploadRes.json();
                        imageUrl = data.url;
                      }
                      await updateTask(editTask._id, {
                        ...editTask,
                        image: imageUrl,
                      });
                    } else {
                      await addTask();
                    }

                    setEditTask(null);
                    setShowModal(false);
                  }}
                >
                  {editTask ? "Spara ändringar" : "Lägg till"}
                </button>

                <button
                  className="btn-danger"
                  onClick={() => setShowModal(false)}
                >
                  Avbryt
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* FIX: imageModal moved outside task-form to root level */}
      {imageModal && (
        <div
          className="modal-overlay"
          onClick={() => setImageModal(null)}
          style={{ cursor: "zoom-out" }}
        >
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "90%", maxHeight: "90%", padding: 0 }}
          >
            <img
              src={imageModal}
              alt="Förstorad bild"
              style={{ width: "100%", height: "auto", display: "block" }}
            />
          </div>
        </div>
      )}

      {/* -------- FILTER -------- */}
      <div className="task-filter">
        <label>Filter:</label>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option>Alla</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>

        <label>Ansvarig:</label>
        <select
          value={responsibleFilter}
          onChange={(e) => setResponsibleFilter(e.target.value)}
        >
          <option>Alla</option>
          {users.map((u) => (
            <option key={u._id || u.id} value={u.name}>
              {u.name}
            </option>
          ))}
        </select>

        <label>Deadline före:</label>
        <input
          type="date"
          value={deadlineFilter}
          onChange={(e) => setDeadlineFilter(e.target.value)}
        />

        <label style={{ marginLeft: "15px" }}>
          <input
            type="checkbox"
            checked={hideDone}
            onChange={(e) => setHideDone(e.target.checked)}
          />
          Dölj klara
        </label>

        {isAdmin && (
          <button
            className="btn-primary"
            style={{ marginLeft: "10px" }}
            onClick={downloadActivities}
          >
            Ladda ner aktiviteter (CSV)
          </button>
        )}
        <button
          className="btn-primary"
          style={{ marginLeft: "10px" }}
          onClick={downloadActivitiesPDF}
        >
          Ladda ner PDF
        </button>
      </div>

      {/* -------- TASK LIST -------- */}
      {loadingTasks ? (
        <p>Laddar aktiviteter…</p>
      ) : (
        <div className="task-list">
          {filteredTasks.map((task) => (
            <div
              key={task._id}
              className={`task-item ${task.done ? "done" : ""} ${
                task.sticky ? "sticky" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={task.done}
                disabled={!canEdit || task.sticky}
                title={
                  task.sticky
                    ? "Sticky-aktiviteter kan inte markeras som klara"
                    : ""
                }
                onChange={(e) =>
                  canEdit && updateTask(task._id, { done: e.target.checked })
                }
              />

              <div className="task-info">
                <strong>
                  {task.sticky && "📌 "}
                  {task.title}
                </strong>

                {task.description && (
                  <p className="task-description">{task.description}</p>
                )}

                {task.image && (
                  <img
                    src={imageUrls[task._id] || ""}
                    alt="Bilaga"
                    className="task-image"
                    style={{ cursor: "pointer" }}
                    onClick={() => setImageModal(imageUrls[task._id] || null)}
                  />
                )}

                <div className="task-meta">
                  <span className={`task-category ${task.category}`}>
                    {task.category}
                  </span>

                  {task.deadline && (
                    <span
                      className={`task-deadline ${
                        isDeadlinePassed(task.deadline)
                          ? "deadline-expired"
                          : "deadline-ok"
                      }`}
                    >
                      Deadline: {task.deadline}
                    </span>
                  )}

                  {task.responsible && (
                    <span className="task-owner">
                      Ansvarig: {task.responsible}
                    </span>
                  )}

                  {task.crossId && task.flag && (
                    <span className="task-flag-wrapper">
                      <span className={`task-flag ${task.flag}`}>⚑ </span>
                      <span className="task-crossId"> {task.crossId}</span>
                    </span>
                  )}

                  {task.createdBy && (
                    <span className="task-created">
                      Skapad av {task.createdBy}
                      {task.createdAt && (
                        <>
                          {" "}
                          {new Date(task.createdAt).toLocaleDateString("sv-SE")}
                        </>
                      )}
                    </span>
                  )}
                </div>
              </div>

              <div className="task-actions">
                <button
                  className="btn-primary"
                  disabled={!canEdit}
                  onClick={() => startEdit(task)}
                >
                  Redigera
                </button>

                {/* FIX: inline confirm instead of blocking confirm() */}
                {confirmDeleteId === task._id ? (
                  <span style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <span style={{ fontSize: "0.85rem" }}>Säker?</span>
                    <button
                      className="btn-danger"
                      onClick={() => deleteTask(task._id)}
                    >
                      Ja
                    </button>
                    <button
                      className="btn-primary"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      Nej
                    </button>
                  </span>
                ) : (
                  <button
                    className="btn-danger"
                    disabled={!isAdmin}
                    onClick={() => setConfirmDeleteId(task._id)}
                  >
                    Ta bort
                  </button>
                )}
              </div>
            </div>
          ))}

          {filteredTasks.length === 0 && (
            <p className="empty">Inga aktiviteter</p>
          )}
        </div>
      )}
    </div>
  );
}
