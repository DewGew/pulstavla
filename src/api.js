// src/api.js
import { API_URL } from "./config";

export function createApi(logout) {
  return async (url, options = {}) => {
    const token = localStorage.getItem("token");
    const isFormData =
      typeof FormData !== "undefined" && options.body instanceof FormData;

    const headers = {
      ...(!isFormData ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    let res;

    try {
      res = await fetch(`${API_URL}${url}`, {
        ...options,
        headers,
      });
    } catch (err) {
      // Preserve explicit cancellations/timeouts so callers can handle them separately.
      if (err?.name === "AbortError") {
        throw err;
      }

      console.error("API-anrop misslyckades:", url, err);
      throw new Error(
        "Kunde inte nå servern. Kontrollera nätverksanslutningen och försök igen."
      );
    }

    if (res.status === 401) {
      console.warn("Token ogiltig → loggar ut");
      logout();
      throw new Error("Unauthorized");
    }

    return res;
  };
}

// Gemensam API-klient för komponenter utanför App och SettingsContext.
// Vid 401 meddelas App så att session och WebSocket stängs centralt.
export const apiFetch = createApi(() => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("authExpired"));
  }
});
