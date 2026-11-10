import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "../components/SettingsContext";
import { apiFetch } from "../api";
import { useKpis } from "./kpiStore";
import { WIDGET_TYPES, newWidget, uid } from "./registry.jsx";
import { buildDefaultConfig } from "./defaultDashboards";
import "./dashboard.css";

const COLS = 12;

/* En trasig widget ska aldrig ta ned hela tavlan. */
class WidgetBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e) { console.error("Widget kraschade:", e); }
  render() {
    return this.state.failed
      ? <div className="widget kpi-widget"><div className="kpi-empty">Widgeten kunde inte visas</div></div>
      : this.props.children;
  }
}

/* Samma placering som CSS Grid ("row dense") – används för att passa tavlan till skärmhöjden. */
function countRows(widgets) {
  const occ = [];
  const free = (r, c, w, h) => {
    for (let i = r; i < r + h; i++) for (let j = c; j < c + w; j++) if (occ[i]?.[j]) return false;
    return true;
  };
  let rows = 0;
  for (const wd of widgets) {
    const w = Math.min(COLS, wd.w), h = wd.h;
    let placed = false;
    for (let r = 0; !placed; r++) {
      for (let c = 0; c + w <= COLS && !placed; c++) {
        if (free(r, c, w, h)) {
          for (let i = r; i < r + h; i++) { occ[i] ??= []; for (let j = c; j < c + w; j++) occ[i][j] = true; }
          rows = Math.max(rows, r + h);
          placed = true;
        }
      }
    }
  }
  return Math.max(rows, 1);
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export default function DashboardView({ user }) {
  const { settings } = useSettings();
  const canEdit = user?.role === "admin" || user?.role === "suAdmin";
  const stored = settings?.dashboards;
  const config = useMemo(() => (stored?.items?.length ? stored : buildDefaultConfig()), [stored]);

  const forcedId = useMemo(() => new URLSearchParams(window.location.search).get("dash"), []);
  const [activeId, setActiveId] = useState(() => forcedId || localStorage.getItem("activeDashboard") || null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [paused, setPaused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [picker, setPicker] = useState(false);

  const cfg = editing ? draft : config;
  const items = cfg.items;
  const active = items.find((d) => d.id === activeId) || items[0];

  useEffect(() => {
    if (active && !forcedId) localStorage.setItem("activeDashboard", active.id);
  }, [active, forcedId]);

  /* ---------- Rotation mellan dashboards ---------- */
  const rotating = items.filter((d) => d.inRotation !== false);
  useEffect(() => {
    const secs = Number(cfg.rotateSeconds) || 0;
    if (editing || paused || forcedId || secs <= 0 || rotating.length < 2) return;
    const t = setInterval(() => {
      setActiveId((cur) => {
        const i = rotating.findIndex((d) => d.id === cur);
        return rotating[(i + 1) % rotating.length].id;
      });
    }, secs * 1000);
    return () => clearInterval(t);
  }, [cfg.rotateSeconds, editing, paused, forcedId, rotating.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Swipe byter dashboard (touchskärm) ---------- */
  const touch = useRef(null);
  const go = useCallback((dir) => {
    const i = items.findIndex((d) => d.id === active.id);
    const n = items[clamp(i + dir, 0, items.length - 1)];
    if (n) setActiveId(n.id);
  }, [items, active]);
  const onTouchStart = (e) => {
    touch.current = editing || e.target.closest("[data-no-swipe]") ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e) => {
    const s = touch.current; touch.current = null;
    if (!s || forcedId) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
  };

  /* ---------- Redigering ---------- */
  const startEdit = () => { setDraft(structuredClone(config)); setError(""); setSelectedId(null); setEditing(true); };
  const cancelEdit = () => { setEditing(false); setDraft(null); setSelectedId(null); };
  const save = async () => {
    setSaving(true); setError("");
    try {
      const res = await apiFetch("/settings/dashboards", { method: "PUT", body: JSON.stringify({ value: draft }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEditing(false); setDraft(null); setSelectedId(null);
    } catch (e) {
      setError(`Kunde inte spara: ${e.message}`);
    } finally { setSaving(false); }
  };

  const updateActive = (fn) =>
    setDraft((d) => ({ ...d, items: d.items.map((x) => (x.id === active.id ? fn(x) : x)) }));
  const updateWidget = (id, patch) =>
    updateActive((d) => ({ ...d, widgets: d.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)) }));
  const removeWidget = (id) => { updateActive((d) => ({ ...d, widgets: d.widgets.filter((w) => w.id !== id) })); setSelectedId(null); };
  const addWidget = (type) => {
    const w = newWidget(type);
    updateActive((d) => ({ ...d, widgets: [...d.widgets, w] }));
    setSelectedId(w.id); setPicker(false);
  };
  const addDashboard = () => {
    const d = { id: uid(), name: `Dashboard ${draft.items.length + 1}`, inRotation: true, fit: true, widgets: [] };
    setDraft((x) => ({ ...x, items: [...x.items, d] })); setActiveId(d.id);
  };
  const removeDashboard = () => {
    if (draft.items.length < 2 || !window.confirm(`Ta bort "${active.name}"?`)) return;
    const rest = draft.items.filter((d) => d.id !== active.id);
    setDraft((x) => ({ ...x, items: rest })); setActiveId(rest[0].id);
  };
  const moveWidget = (fromId, toId) => {
    if (fromId === toId) return;
    updateActive((d) => {
      const list = [...d.widgets];
      const from = list.findIndex((w) => w.id === fromId);
      const [m] = list.splice(from, 1);
      list.splice(list.findIndex((w) => w.id === toId), 0, m);
      return { ...d, widgets: list };
    });
  };

  const ctx = useMemo(() => ({ user, canEdit, settings, setPause: setPaused }), [user, canEdit, settings]);
  const rows = countRows(active.widgets);
  const fit = active.fit !== false;
  const selected = active.widgets.find((w) => w.id === selectedId);

  return (
    <div className="dash" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* Verktygsrad */}
      {!forcedId && (items.length > 1 || canEdit) && (
        <div className="dash-toolbar">
          <div className="dash-tabs" role="tablist">
            {items.map((d) => (
              <button key={d.id} role="tab" aria-selected={d.id === active.id} className={d.id === active.id ? "active" : ""} onClick={() => setActiveId(d.id)}>
                {d.name}
              </button>
            ))}
            {editing && <button className="dash-add" onClick={addDashboard}>＋ Ny dashboard</button>}
          </div>
          {canEdit && !editing && <button className="dash-btn" onClick={startEdit}>✏️ Redigera dashboard</button>}
          {editing && (
            <div className="dash-actions">
              <button className="dash-btn" onClick={() => setPicker(true)}>＋ Lägg till widget</button>
              <button className="dash-btn primary" onClick={save} disabled={saving}>{saving ? "Sparar…" : "Spara"}</button>
              <button className="dash-btn" onClick={cancelEdit} disabled={saving}>Avbryt</button>
            </div>
          )}
        </div>
      )}
      {error && <div className="dash-error">{error}</div>}

      {/* Dashboard-inställningar */}
      {editing && (
        <div className="dash-settings">
          <label>Namn <input value={active.name} onChange={(e) => updateActive((d) => ({ ...d, name: e.target.value }))} /></label>
          <label className="chk"><input type="checkbox" checked={active.inRotation !== false} onChange={(e) => updateActive((d) => ({ ...d, inRotation: e.target.checked }))} /> Med i automatisk rotation</label>
          <label className="chk"><input type="checkbox" checked={fit} onChange={(e) => updateActive((d) => ({ ...d, fit: e.target.checked }))} /> Anpassa till skärmhöjd</label>
          <label>Byt dashboard var <input type="number" min="0" value={draft.rotateSeconds || 0} onChange={(e) => setDraft((x) => ({ ...x, rotateSeconds: clamp(Number(e.target.value) || 0, 0, 3600) }))} /> sek (0 = av)</label>
          <button className="dash-btn danger" onClick={removeDashboard} disabled={draft.items.length < 2}>Ta bort dashboard</button>
        </div>
      )}

      {/* Rutnät */}
      <Grid
        key={active.id}
        widgets={active.widgets}
        rows={rows}
        fit={fit}
        editing={editing}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onResize={(id, w, h) => updateWidget(id, { w, h })}
        onRemove={removeWidget}
        onMove={moveWidget}
        ctx={ctx}
      />
      {active.widgets.length === 0 && (
        <div className="kpi-empty big">
          {editing ? "Tom dashboard – klicka på ”Lägg till widget”." : "Dashboarden är tom."}
        </div>
      )}

      {editing && selected && (
        <WidgetPanel
          key={selected.id}
          widget={selected}
          onChange={(patch) => updateWidget(selected.id, patch)}
          onRemove={() => removeWidget(selected.id)}
          onClose={() => setSelectedId(null)}
        />
      )}
      {picker && <WidgetPicker onPick={addWidget} onClose={() => setPicker(false)} />}
    </div>
  );
}

/* ================= Rutnät ================= */
function Grid({ widgets, rows, fit, editing, selectedId, onSelect, onResize, onRemove, onMove, ctx }) {
  const ref = useRef(null);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);

  const startResize = (e, wd) => {
    e.preventDefault(); e.stopPropagation();
    const grid = ref.current.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(ref.current).columnGap) || 0;
    const colW = (grid.width + gap) / COLS;
    const rowH = (parseFloat(getComputedStyle(ref.current).gridAutoRows) || 100) + gap;
    const s = { x: e.clientX, y: e.clientY, w: wd.w, h: wd.h };
    const move = (ev) => {
      const w = clamp(s.w + Math.round((ev.clientX - s.x) / colW), 1, COLS);
      const h = clamp(s.h + Math.round((ev.clientY - s.y) / rowH), 1, 12);
      if (w !== wd.w || h !== wd.h) onResize(wd.id, w, h);
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={ref}
      className={`dash-grid${fit ? " fit" : ""}${editing ? " editing" : ""}`}
      style={{ "--rows": rows }}
    >
      {widgets.map((wd) => {
        const type = WIDGET_TYPES[wd.type];
        return (
          <div
            key={wd.id}
            className={`dash-cell${editing ? " edit" : ""}${selectedId === wd.id ? " selected" : ""}${overId === wd.id && dragId !== wd.id ? " over" : ""}`}
            style={{ "--w": Math.min(COLS, wd.w), "--h": wd.h }}
            draggable={editing}
            onClick={editing ? () => onSelect(wd.id) : undefined}
            onDragStart={editing ? (e) => { setDragId(wd.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", wd.id); } : undefined}
            onDragOver={editing ? (e) => { e.preventDefault(); setOverId(wd.id); } : undefined}
            onDrop={editing ? (e) => { e.preventDefault(); onMove(dragId, wd.id); setDragId(null); setOverId(null); } : undefined}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
          >
            <div className="dash-content">
              <WidgetBoundary>
                {type ? type.render(wd.props || {}, ctx) : <div className="widget"><div className="kpi-empty">Okänd widget: {wd.type}</div></div>}
              </WidgetBoundary>
            </div>
            {editing && (
              <>
                <div className="dash-badge">{type?.icon} {type?.label} · {wd.w}×{wd.h}</div>
                <button className="dash-x" title="Ta bort" onClick={(e) => { e.stopPropagation(); onRemove(wd.id); }}>✕</button>
                <div className="dash-resize" title="Dra för att ändra storlek" onPointerDown={(e) => startResize(e, wd)} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ================= Widgetväljare ================= */
function WidgetPicker({ onPick, onClose }) {
  const groups = {};
  Object.entries(WIDGET_TYPES).forEach(([key, t]) => (groups[t.group] ??= []).push([key, t]));
  return (
    <div className="dash-modal" onClick={onClose}>
      <div className="dash-modal-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Lägg till widget">
        <div className="dash-modal-head"><h3>Lägg till widget</h3><button className="dash-x static" onClick={onClose}>✕</button></div>
        {Object.entries(groups).map(([g, list]) => (
          <section key={g}>
            <h4>{g}</h4>
            <div className="dash-picker-grid">
              {list.map(([key, t]) => (
                <button key={key} className="dash-picker-item" onClick={() => onPick(key)}>
                  <span className="ic">{t.icon}</span>
                  <strong>{t.label}</strong>
                  <small>{t.desc}</small>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/* ================= Widgetinställningar ================= */
function WidgetPanel({ widget, onChange, onRemove, onClose }) {
  const type = WIDGET_TYPES[widget.type];
  const { kpis } = useKpis();
  const setProp = (k, v) => onChange({ props: { ...widget.props, [k]: v } });

  return (
    <aside className="dash-panel" aria-label="Widgetinställningar">
      <div className="dash-modal-head"><h3>{type?.icon} {type?.label}</h3><button className="dash-x static" onClick={onClose}>✕</button></div>
      <div className="dash-size">
        <label>Bredd (1–12) <input type="number" min="1" max="12" value={widget.w} onChange={(e) => onChange({ w: clamp(Number(e.target.value) || 1, 1, 12) })} /></label>
        <label>Höjd (rader) <input type="number" min="1" max="12" value={widget.h} onChange={(e) => onChange({ h: clamp(Number(e.target.value) || 1, 1, 12) })} /></label>
      </div>
      {(type?.fields || []).map((f) => {
        const v = widget.props?.[f.key];
        return (
          <label key={f.key} className={f.type === "bool" ? "chk" : ""}>
            {f.type !== "bool" && f.label}
            {f.type === "text" && <input value={v ?? ""} onChange={(e) => setProp(f.key, e.target.value)} />}
            {f.type === "number" && <input type="number" value={v ?? ""} onChange={(e) => setProp(f.key, e.target.value === "" ? undefined : Number(e.target.value))} />}
            {f.type === "bool" && <><input type="checkbox" checked={v ?? f.default ?? false} onChange={(e) => setProp(f.key, e.target.checked)} /> {f.label}</>}
            {f.type === "select" && (
              <select value={v ?? f.default} onChange={(e) => setProp(f.key, e.target.value)}>
                {f.options.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
              </select>
            )}
            {f.type === "kpi" && (
              <select value={v ?? ""} onChange={(e) => setProp(f.key, e.target.value)}>
                <option value="">– välj nyckeltal –</option>
                {kpis.map((k) => <option key={k._id} value={k._id}>{k.name}</option>)}
              </select>
            )}
            {f.type === "kpis" && (
              <div className="dash-checks">
                {kpis.length === 0 && <small>Inga nyckeltal skapade ännu (Mer ▾ → Nyckeltal).</small>}
                {kpis.map((k) => (
                  <label key={k._id} className="chk">
                    <input type="checkbox" checked={(v || []).includes(k._id)} onChange={(e) => setProp(f.key, e.target.checked ? [...(v || []), k._id] : (v || []).filter((x) => x !== k._id))} /> {k.name}
                  </label>
                ))}
              </div>
            )}
          </label>
        );
      })}
      {(!type?.fields || type.fields.length === 0) && <p className="dash-hint">Den här widgeten har inga egna inställningar.</p>}
      <button className="dash-btn danger" onClick={onRemove}>Ta bort widget</button>
    </aside>
  );
}
