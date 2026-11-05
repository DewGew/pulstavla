// src/api.js
import { API_URL } from "./config";

export function createApi(logout) {
  return async (url, options = {}) => {
    const token = localStorage.getItem("token");

    const res = await fetch(`${API_URL}${url}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (res.status === 401) {
      console.warn("Token ogiltig → loggar ut");
      logout();
      throw new Error("Unauthorized");
    }

    return res;
  };
}

