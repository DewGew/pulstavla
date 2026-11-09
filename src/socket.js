import { io } from "socket.io-client";
import { WS_URL } from "./config";

// En enda Socket.IO-klient delas av appens komponenter.
// autoConnect är avstängt så att ingen oautentiserad anslutning startas före login.
export const socket = io(WS_URL, {
  autoConnect: false,
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 10000,
  auth: (callback) => {
    callback({ token: localStorage.getItem("token") });
  },
});

export function connectSocket() {
  if (!localStorage.getItem("token")) return false;
  if (socket.connected || socket.active) return true;

  socket.connect();
  return true;
}

export function disconnectSocket() {
  if (socket.connected || socket.active) {
    socket.disconnect();
  }
}

export function subscribeSocket(eventName, handler) {
  if (typeof eventName !== "string" || typeof handler !== "function") {
    throw new TypeError("subscribeSocket kräver ett händelsenamn och en callback.");
  }

  socket.on(eventName, handler);
  return () => socket.off(eventName, handler);
}
