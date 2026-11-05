const DEV = process.env.NODE_ENV === "development";
export const VERSION = "2.7.2"
export const PORT = DEV
	? 5000
	: 3000;

export const API_URL = DEV
  ? "http://192.168.1.13:3000"
  : "https://192.168.1.13:3000";

export const WS_URL = DEV
  ? "ws://192.168.13:3000"
  : "wss://192.168.1.13:3000";