import { useState, useEffect, useCallback, useRef } from "react";
import { io } from "socket.io-client";
import { API_URL, WS_URL } from "../config";
import "./EditableTextWidget.css";

// FIX: read token once at module level — stable, no re-reads on every save
const getToken = () => localStorage.getItem("token");

export default function EditableTextWidget({
  textwidgetid,
  initialTitle = "",
  initialText = "",
  canEdit = false,
  onEditingChange,
}) {
  const [title, setTitle] = useState(initialTitle);
  const [text, setText] = useState(initialText);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [updatedBy, setUpdatedBy] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);

  // FIX: track initial values in a ref so fetchWidget can fall back to them
  // without being listed as useEffect deps (avoids re-fetch on every render)
  const initialTitleRef = useRef(initialTitle);
  const initialTextRef = useRef(initialText);

  /* ---------------- FETCH WIDGET ---------------- */
  // FIX: extracted into useCallback so it's reusable in both mount effect
  // and handleCancel, eliminating the duplicated fetch logic.
  // Only depends on textwidgetid — not on initialTitle/initialText props,
  // so a parent re-render won't trigger a refetch and overwrite unsaved edits.
  const fetchWidget = useCallback(async () => {
    const token = getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    try {
      const res = await fetch(`${API_URL}/widgets/${textwidgetid}`, { headers });

      if (res.ok) {
        const data = await res.json();
        setTitle(data.title || initialTitleRef.current);
        setText(data.text || initialTextRef.current);
        setUpdatedBy(data.updatedBy || "");
        setUpdatedAt(data.updatedAt || null);
        return;
      }

      // Widget not found — auto-create it
      if (res.status === 404) {
        const createRes = await fetch(`${API_URL}/widgets`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: JSON.stringify({
            textwidgetid,
            title: initialTitleRef.current,
            text: initialTextRef.current,
          }),
        });

        // FIX: error handling on the auto-create POST
        if (!createRes.ok) throw new Error("Kunde inte skapa widget");

        const doc = await createRes.json();
        setTitle(doc.title || initialTitleRef.current);
        setText(doc.text || initialTextRef.current);
        return;
      }

      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setError("Kunde inte hämta widgeten");
      console.error("fetchWidget error:", err);
    }
  }, [textwidgetid]); // FIX: only textwidgetid — not initialTitle/initialText

  // FIX: only run on mount (and if textwidgetid changes)
  useEffect(() => {
    fetchWidget();
  }, [fetchWidget]);

  /* ---------------- WEBSOCKET ---------------- */
  // FIX: socket created inside useEffect, disconnected on unmount —
  // no more module-level persistent socket connection.
  useEffect(() => {
    const socket = io(WS_URL, { transports: ["websocket"], 
  auth: (cb) => cb({ token: localStorage.getItem("token") }),
});

    const handler = (payload) => {
      if (payload.textwidgetid === textwidgetid) {
        setTitle(payload.title || "");
        setText(payload.text || "");
        setUpdatedBy(payload.updatedBy || "");
        setUpdatedAt(payload.updatedAt || null);
      }
    };

    socket.on("widgetUpdated", handler);

    return () => {
      socket.off("widgetUpdated", handler);
      socket.disconnect();
    };
  }, [textwidgetid]);

  /* ---------------- EDITING STATE NOTIFY ---------------- */
  useEffect(() => {
    onEditingChange?.(isEditing);
  }, [isEditing, onEditingChange]);

  /* ---------------- SAVE ---------------- */
  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError(null);

      const token = getToken();

      const res = await fetch(`${API_URL}/widgets/${textwidgetid}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title, text }),
      });

      // FIX: handle 401 specifically
      if (res.status === 401) {
        setError("Sessionen har gått ut. Logga in igen.");
        return;
      }

      if (!res.ok) throw new Error("Kunde inte spara widgeten");

      setIsEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  /* ---------------- CANCEL ---------------- */
  // FIX: reuses fetchWidget instead of duplicating the fetch logic
  const handleCancel = async () => {
    setIsEditing(false);
    setError(null);
    await fetchWidget();
  };

  /* ---------------- RENDER ---------------- */
  return (
    <div className="widget EditableTextWidget">
      {!isEditing ? (
        <>
          <h3>{title}</h3>
          <p className={!text?.trim() ? "empty-state" : undefined}>
            {text?.trim() || "Ingen text har lagts till än."}
          </p>

          {updatedBy && (
            <div className="widget-meta">
              Redigerad av <strong>{updatedBy}</strong>
              {updatedAt && (
                <> {new Date(updatedAt).toLocaleDateString("sv-SE")}</>
              )}
            </div>
          )}

          {canEdit && (
            <button
              className="edit-btn"
              onClick={() => setIsEditing(true)}
              style={{ marginTop: "10px" }}
            >
              Redigera
            </button>
          )}
        </>
      ) : (
        <>
          {/* FIX: autoFocus on the title input (first field), not the textarea */}
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="title-input"
            placeholder="Titel"
            autoFocus
          />
          <textarea
            style={{ marginTop: "7px" }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
          />

          {error && <p className="error">{error}</p>}

          <div className="actions">
            <button
              style={{ marginTop: "7px" }}
              onClick={handleCancel}
              disabled={isSaving}
              className="btn-danger"
            >
              Avbryt
            </button>
            <button
              style={{ marginTop: "7px" }}
              onClick={handleSave}
              disabled={isSaving}
              className="btn-primary"
            >
              {isSaving ? "Sparar…" : "Spara"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
