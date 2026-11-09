import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "../api";
import { API_URL } from "../config";
import "./LunchWidget.css";

const SOURCE_LINK = "https://www.smakrikt.se/#lunch";
// Menu changes weekly and the backend caches per ISO week, so there's no
// need to poll often — just refresh occasionally in case the tab is left
// open across the changeover.
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export default function LunchWidget({footerOrder, price}) {
  const [imageUrl, setImageUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /* ---------------- LOAD CURRENT LUNCH IMAGE ---------------- */
  // Backend handles fetching/caching the source image weekly, so this is
  // just a normal same-origin API call — no CORS proxy needed here.
  const loadMenu = useCallback(async () => {
    setError(null);
    try {
      const res = await apiFetch(`/lunch`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setImageUrl(`${API_URL}${data.imageUrl}?v=${data.week}-${data.year}`);
    } catch {
      setError("Kunde inte hämta veckans lunch");
    } finally {
      setLoading(false);
    }
  }, []);

  /* ---------------- INITIAL LOAD + PERIODIC REFRESH ---------------- */
  useEffect(() => {
    loadMenu();
    const interval = setInterval(loadMenu, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadMenu]);

  /* ---------------- RENDER ---------------- */
  return (
    <div className="widget lunch-widget">
      {loading ? (
        <p className="widget-loading">Laddar…</p>
      ) : error || !imageUrl ? (
        <div className="widget-error">
          <p>{error || "Ingen meny hittades"}</p>
          <a href={SOURCE_LINK} target="_blank" rel="noopener noreferrer">
            Se veckans lunch på Smakrikt →
          </a>
        </div>
      ) : (
        <a href={SOURCE_LINK} target="_blank" rel="noopener noreferrer">
          <img
            className="lunch-image"
            src={imageUrl}
            alt="Veckans lunch – Smakrikt"
          />
        </a>
      )}
		<div className="widget-meta">
		  Beställ hos <strong>{footerOrder}</strong> innan kl. 11.00 samma dag. Pris <strong>{price}:-</strong>
		</div>
    </div>
  );
}
