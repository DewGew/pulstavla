import { useEffect, useState, useSyncExternalStore } from "react";
import { apiFetch } from "../api";
import { socket } from "../socket";

/* ---------- Delad lista med nyckeltal (en hämtning för alla widgets) ---------- */
let state = { kpis: [], loaded: false };
const subs = new Set();
let inflight = null;

function emit() {
  subs.forEach((fn) => fn());
}

export async function reloadKpis() {
  if (inflight) return inflight;
  inflight = apiFetch("/kpis")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((kpis) => {
      state = { kpis, loaded: true };
      emit();
    })
    .catch((e) => console.warn("Kunde inte hämta nyckeltal:", e.message))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  socket.on("kpiUpdated", reloadKpis);
  socket.on("connect", reloadKpis);
}

export function useKpis() {
  useEffect(() => {
    wire();
    if (!state.loaded) reloadKpis();
  }, []);
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => state
  );
}

export function useKpi(id) {
  const { kpis, loaded } = useKpis();
  return { kpi: kpis.find((k) => k._id === id) || null, loaded };
}

/* ---------- Historik för ett nyckeltal ---------- */
export function useKpiSeries(id, days = 30) {
  const [series, setSeries] = useState([]);
  const { kpis } = useKpis(); // ändras när servern meddelar uppdatering

  useEffect(() => {
    if (!id) return;
    let alive = true;
    apiFetch(`/kpis/${id}/values?days=${days}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => alive && setSeries(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, days, kpis]);

  return id ? series : [];
}

/* ---------- Status & formatering ---------- */
// "good" | "warn" | "bad" | "none"
export function statusOf(kpi, value) {
  if (!kpi || value === null || value === undefined || kpi.target === null || kpi.target === undefined) return "none";
  const t = kpi.target;
  const tol = (kpi.tolerance ?? 10) / 100;
  if (kpi.goodDirection === "lower") {
    if (value <= t) return "good";
    return value <= t * (1 + tol) ? "warn" : "bad";
  }
  if (value >= t) return "good";
  return value >= t * (1 - tol) ? "warn" : "bad";
}

export function fmt(kpi, value) {
  if (value === null || value === undefined) return "–";
  return Number(value).toLocaleString("sv-SE", {
    minimumFractionDigits: kpi?.decimals ?? 0,
    maximumFractionDigits: kpi?.decimals ?? 0,
  });
}
