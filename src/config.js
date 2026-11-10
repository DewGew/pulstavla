import packageJson from "../package.json" with { type: "json" };
import { API_URL, WS_URL, PORT } from "./config.local.js";

export const VERSION = packageJson.version;
export { API_URL, WS_URL, PORT };
