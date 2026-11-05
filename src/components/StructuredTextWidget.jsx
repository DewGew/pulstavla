import { useState, useEffect } from "react";
import { io } from "socket.io-client";
import { API_URL, WS_URL } from "../config";
import "./EditableTextWidget.css";

const socket = io(WS_URL, { transports: ["websocket"], 
  auth: (cb) => cb({ token: localStorage.getItem("token") }),
});

export default function StructuredTextWidget({
  textwidgetid,
  initialTitle = "Titel",
  initialSections = [],
  canEdit = false,
	onEditingChange,
}) {
  const [title, setTitle] = useState(initialTitle);
  const [sections, setSections] = useState(initialSections);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
	const [updatedBy, setUpdatedBy] = useState("");
	const [updatedAt, setUpdatedAt] = useState(null);


  /* ---------------- FETCH / CREATE ---------------- */
  const loadWidget = () => {
    fetch(`${API_URL}/structured-widgets/${textwidgetid}`)
      .then((res) => {
        if (!res.ok) throw new Error("saknas");
        return res.json();
      })
			.then((data) => {
				setTitle(data.title || initialTitle);
				setSections(data.sections || []);
				setUpdatedBy(data.updatedBy || "");
				setUpdatedAt(data.updatedAt || null);
			})
      .catch(() => {
        fetch(`${API_URL}/structured-widgets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            widgetId: textwidgetid,
            title: initialTitle,
            sections: initialSections,
          }),
        })
          .then((res) => res.json())
          .then((doc) => {
            setTitle(doc.title);
            setSections(doc.sections || []);
          });
      });
  };

  useEffect(loadWidget, [textwidgetid]);
	
	useEffect(() => {
		onEditingChange?.(isEditing);
	}, [isEditing, onEditingChange]);

  /* ---------------- WS UPDATE ---------------- */
  useEffect(() => {
    const handler = (payload) => {
			if (payload.widgetId === textwidgetid) {
				setTitle(payload.title);
				setSections(payload.sections || []);
				setUpdatedBy(payload.updatedBy || "");
				setUpdatedAt(payload.updatedAt || null);
			}
		};
    socket.on("structuredWidgetUpdated", handler);
    return () => socket.off("structuredWidgetUpdated", handler);
  }, [textwidgetid]);

  /* ---------------- ACTIONS ---------------- */
  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError(null);

			const token = localStorage.getItem("token");

			const res = await fetch(
				`${API_URL}/structured-widgets/${textwidgetid}`,
				{
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({ title, sections }),
				}
			);

      if (!res.ok) throw new Error("Kunde inte spara");
      setIsEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    loadWidget();
  };

  const addSection = () =>
    setSections([...sections, { subtitle: "", text: "" }]);

  const updateSection = (i, field, value) => {
    const copy = [...sections];
    copy[i] = { ...copy[i], [field]: value };
    setSections(copy);
  };

  const removeSection = (i) =>
    setSections(sections.filter((_, idx) => idx !== i));
		
	const moveSection = (index, direction) => {
		const newSections = [...sections];
		const targetIndex = index + direction;

		if (targetIndex < 0 || targetIndex >= newSections.length) return;

		// Byt plats
		[newSections[index], newSections[targetIndex]] =
			[newSections[targetIndex], newSections[index]];

		setSections(newSections);
	};

  /* ---------------- RENDER ---------------- */
  return (
    <div className="widget structuredTextWidget">
      {!isEditing ? (
        <>
          <h3>{title}</h3>

          {sections.map((s, i) => (
            <div key={i} style={{ textAlign: "left" }}>
              <strong>{s.subtitle}</strong>
              <p>{s.text}</p>
            </div>
          ))}
					
					{updatedBy && (
						<div className="widget-meta">
							Redigerad av <strong>{updatedBy}</strong>
							{updatedAt && (
								<> {new Date(updatedAt).toLocaleDateString("sv-SE")}</>
							)}
						</div>
					)}

          {canEdit && (
            <button className="edit-btn" onClick={() => setIsEditing(true)} style={{ marginTop: "10px" }}>
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

					{sections.map((s, i) => (
						<div key={i} className="section-edit-box">

							<div className="move-buttons">
								<button
									type="button"
									onClick={() => moveSection(i, -1)}
									disabled={i === 0}
								>
									↑
								</button>

								<button
									type="button"
									onClick={() => moveSection(i, 1)}
									disabled={i === sections.length - 1}
								>
									↓
								</button>
							</div>

							<input
								style={{ marginTop: "7px" }}
								className="title-input"
								placeholder="Undertitel"
								value={s.subtitle}
								onChange={(e) =>
									updateSection(i, "subtitle", e.target.value)
								}
							/>

							<textarea
								style={{ marginTop: "7px" }}
								rows={3}
								value={s.text}
								onChange={(e) =>
									updateSection(i, "text", e.target.value)
								}
							/>

							<button
								onClick={() => removeSection(i)}
								className="btn-danger"
							>
								Ta bort
							</button>
						</div>
					))}

          <button style={{ marginTop: "7px" }} onClick={addSection} className="btn-secondary">+ Lägg till sektion</button>

          {error && <p className="error">{error}</p>}

          <div className="actions">
            <button onClick={handleCancel} className="btn-danger" style={{ marginTop: "7px" }}>Avbryt</button>
            <button onClick={handleSave} disabled={isSaving} className="btn-primary" style={{ marginTop: "7px" }}>
              {isSaving ? "Sparar…" : "Spara"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
