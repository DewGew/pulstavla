import packageJson from "../package.json" with { type: "json" };

/*
 * Nätverksinställningar är valfria. Utan src/config.local.js används samma
 * adress som sidan hämtades från (frontend och server delar adress), så ingen
 * filredigering eller ombyggnad behövs vid IP-byte eller reverse proxy.
 * Under utveckling (Vite på 5173) pekar vi på API-servern på port 3000.
 */
const local = Object.values(import.meta.glob("./config.local.js", { eager: true }))[0] || {};

const origin = window.location.origin;
const devServer = import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:3000` : origin;

export const VERSION = packageJson.version;
export const PORT = local.PORT || 3000;
export const API_URL = local.API_URL || devServer;
export const WS_URL = local.WS_URL || devServer.replace(/^http/, "ws");
