import { useState, useEffect, useRef, useCallback } from "react";
import { API_URL } from "../config";
import { socket } from "../socket";
import "./DrawingWidget.css";

const COLORS = ["#111827", "#dc2626", "#2563eb", "#16a34a", "#f59e0b"];
const BG_COLOR = "#ffffff"; // must match the canvas background for the eraser trick to work

export default function DrawingWidget({
  drawingId = "notes",
  initialTitle = "Anteckningar",
  canEdit = false, // touch panels are usually meant to be freely writable
  onEditingChange,
}) {
  const [title, setTitle] = useState(initialTitle);
  const [strokes, setStrokes] = useState([]);
  const [currentStroke, setCurrentStroke] = useState(null);
  const [color, setColor] = useState(COLORS[0]);
  const [brushSize, setBrushSize] = useState(3);
  const [erasing, setErasing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [updatedBy, setUpdatedBy] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);

  const svgRef = useRef(null);
  const activePointerId = useRef(null);

  /* ---------------- FETCH ---------------- */
  useEffect(() => {
    fetch(`${API_URL}/drawings/${drawingId}`, {
      headers: localStorage.getItem("token")
        ? { Authorization: `Bearer ${localStorage.getItem("token")}` }
        : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error("saknas");
        return res.json();
      })
      .then((data) => {
        setTitle(data.title || initialTitle);
        setStrokes(data.strokes || []);
        setUpdatedBy(data.updatedBy || "");
        setUpdatedAt(data.updatedAt || null);
      })
      .catch(() => {
        fetch(`${API_URL}/drawings`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(localStorage.getItem("token") ? { Authorization: `Bearer ${localStorage.getItem("token")}` } : {}),
          },
          body: JSON.stringify({ drawingId, title: initialTitle, strokes: [] }),
        })
          .then((res) => res.json())
          .then((doc) => {
            setTitle(doc.title);
            setStrokes(doc.strokes || []);
          });
      });
  }, [drawingId, initialTitle]);

  /* ---------------- WS ---------------- */
  useEffect(() => {
    
    const handler = (payload) => {
      if (payload.drawingId === drawingId) {
        setStrokes(payload.strokes || []);
        setUpdatedBy(payload.updatedBy || "");
        setUpdatedAt(payload.updatedAt || null);
        setIsDirty(false);
      }
    };

    socket.on("drawingUpdated", handler);
    return () => {
      socket.off("drawingUpdated", handler);

    };
  }, [drawingId]);

  /* ---------------- POINTER DRAWING ---------------- */
  // Pointer Events cover touch (finger), pen/stylus, and mouse through one API —
  // exactly what a touch panel with a pen needs.
  const getPoint = useCallback((e) => {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: +(((e.clientX - rect.left) / rect.width) * 100).toFixed(2), // stored as % so it scales with the container
      y: +(((e.clientY - rect.top) / rect.height) * 100).toFixed(2),
    };
  }, []);

  const handlePointerDown = (e) => {
    if (!canEdit) return;
    e.target.setPointerCapture(e.pointerId);
    activePointerId.current = e.pointerId;
    onEditingChange?.(true);

    setCurrentStroke({
      color: erasing ? BG_COLOR : color,
      width: erasing ? brushSize * 4 : brushSize, // wider "brush" for the eraser
      points: [getPoint(e)],
    });
  };

  const handlePointerMove = (e) => {
    if (!currentStroke || e.pointerId !== activePointerId.current) return;
    e.preventDefault();
    setCurrentStroke((prev) => ({
      ...prev,
      points: [...prev.points, getPoint(e)],
    }));
  };

  const handlePointerUp = (e) => {
    if (!currentStroke || e.pointerId !== activePointerId.current) return;
    activePointerId.current = null;

    if (currentStroke.points.length > 1) {
      setStrokes((prev) => [...prev, currentStroke]);
      setIsDirty(true);
    }
    setCurrentStroke(null);
  };

  const pointsToPath = (points) =>
    points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
      .join(" ");

  /* ---------------- ACTIONS ---------------- */
  const undo = () => {
    setStrokes((prev) => prev.slice(0, -1));
    setIsDirty(true);
  };

  const clearAll = () => {
    setStrokes([]);
    setIsDirty(true);
  };

  const handleSave = async () => {
    const token = localStorage.getItem("token");
    setIsSaving(true);

    try {
      await fetch(`${API_URL}/drawings/${drawingId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ title, strokes }),
      });
      setIsDirty(false);
    } finally {
      setIsSaving(false);
      onEditingChange?.(false);
    }
  };

  /* ---------------- RENDER ---------------- */
  return (
    <div className="widget drawingWidget" data-no-swipe="true">
      <h3>{title}</h3>

      {canEdit && (
        <div className="drawing-toolbar">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`color-swatch ${!erasing && color === c ? "active" : ""}`}
              style={{ background: c }}
              onClick={() => {
                setColor(c);
                setErasing(false);
              }}
              aria-label={`Färg ${c}`}
            />
          ))}

          <input
            type="range"
            min="1"
            max="12"
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="brush-slider"
          />
					<button
            type="button"
            className={`btn-secondary ${erasing ? "active" : ""}`}
            onClick={() => setErasing((v) => !v)}
          >
            🧽 Sudd
          </button>
					<div className="drawing-actions">
          <button type="button" className="btn-secondary" onClick={undo} disabled={strokes.length === 0}>
            ↩️ Ångra
          </button>

          <button type="button" className="btn-danger" onClick={clearAll} disabled={strokes.length === 0}>
            🗑️ Rensa
          </button>

          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
            disabled={isSaving || !isDirty}
          >
            {isSaving ? "Sparar…" : "💾 Spara"}
          </button>
					</div>
        </div>
      )}

      <svg
        ref={svgRef}
        className="drawing-canvas"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {strokes.map((s, i) => (
          <path
            key={i}
            d={pointsToPath(s.points)}
            stroke={s.color}
            strokeWidth={s.width}
            vectorEffect="non-scaling-stroke"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {currentStroke && (
          <path
            d={pointsToPath(currentStroke.points)}
            stroke={currentStroke.color}
            strokeWidth={currentStroke.width}
            vectorEffect="non-scaling-stroke"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>

      {updatedBy && (
        <div className="widget-meta">
          Senast sparad av <strong>{updatedBy}</strong>{" "}
          {updatedAt && new Date(updatedAt).toLocaleDateString("sv-SE")}
        </div>
      )}
    </div>
  );
}
