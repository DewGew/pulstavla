const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

let serverProcess;
let mainWindow;
let shutdownRequested = false;

function loadOrCreateSecret(dataPath) {
  const secretPath = path.join(dataPath, ".jwt-secret");
  try {
    const existing = fs.readFileSync(secretPath, "utf8").trim();
    if (existing.length >= 32) return existing;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const secret = crypto.randomBytes(48).toString("hex");
  const temporaryPath = `${secretPath}.tmp`;
  fs.writeFileSync(temporaryPath, secret, { mode: 0o600, flag: "wx" });
  try {
    fs.renameSync(temporaryPath, secretPath);
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch {}
    if (error.code !== "EEXIST") throw error;
    return fs.readFileSync(secretPath, "utf8").trim();
  }
  return secret;
}

function createInitialPassword() {
  return crypto.randomBytes(18).toString("base64url");
}

function hasExistingUsers(usersFile) {
  try {
    const lines = fs.readFileSync(usersFile, "utf8").split(/\r?\n/);
    return lines.some((line) => {
      if (!line.trim()) return false;
      try {
        const record = JSON.parse(line);
        return typeof record.username === "string" && Boolean(record.password);
      } catch {
        return false;
      }
    });
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function reserveLocalPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function waitForServer(url, child, timeoutMs = 30000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (child.exitCode !== null) {
        reject(new Error("Pulstavlans lokala server avslutades under uppstart."));
        return;
      }
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode === 200) return resolve();
        retry();
      });
      request.setTimeout(1500, () => request.destroy());
      request.on("error", retry);
      function retry() {
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error("Pulstavlans server svarade inte inom 30 sekunder."));
        } else {
          setTimeout(check, 350);
        }
      }
    };
    check();
  });
}

async function startLocalServer() {
  const appPath = app.getAppPath();
  const dataPath = path.join(app.getPath("userData"), "data");
  const dbPath = path.join(dataPath, "db");
  fs.mkdirSync(dbPath, { recursive: true });

  const firstRun = !hasExistingUsers(path.join(dbPath, "users.db"));
  const jwtSecret = loadOrCreateSecret(dataPath);
  const initialPassword = firstRun ? createInitialPassword() : null;
  const port = await reserveLocalPort();
  const origin = `http://127.0.0.1:${port}`;

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    PULSTAVLA_DATA_DIR: dataPath,
    JWT_SECRET: jwtSecret,
    PORT: String(port),
    HOST: "127.0.0.1",
    CORS_ORIGINS: origin,
  };

  if (firstRun) {
    env.INITIAL_ADMIN_USERNAME = "admin";
    env.INITIAL_ADMIN_PASSWORD = initialPassword;
    env.INITIAL_ADMIN_NAME = "Administratör";
  }

  const serverPath = path.join(appPath, "server.js");
  serverProcess = spawn(process.execPath, [serverPath], {
    cwd: app.getPath("userData"),
    env,
    windowsHide: true,
    stdio: "ignore",
  });

  serverProcess.once("error", (error) => {
    dialog.showErrorBox("Pulstavlan kunde inte starta", error.message);
    app.quit();
  });

  serverProcess.once("exit", (code) => {
    if (!shutdownRequested && code !== 0) {
      dialog.showErrorBox(
        "Pulstavlans server stängdes",
        `Den lokala servern avslutades oväntat (kod ${code}).`
      );
      app.quit();
    }
  });

  await waitForServer(`${origin}/health`, serverProcess);
  return { origin, firstRun, initialPassword };
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    webPreferences: {
      preload: path.join(app.getAppPath(), "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.loadURL(url);
}

app.whenReady().then(async () => {
  try {
    const { origin, firstRun, initialPassword } = await startLocalServer();
    createWindow(origin);

    if (firstRun) {
      await dialog.showMessageBox({
        type: "info",
        title: "Första inloggningen",
        message: "Ett administratörskonto har skapats.",
        detail: `Användarnamn: admin\nLösenord: ${initialPassword}\n\nSpara lösenordet på en säker plats. Det visas inte igen.`,
        buttons: ["Jag har sparat uppgifterna"],
        noLink: true,
      });
    }
  } catch (error) {
    dialog.showErrorBox("Pulstavlan kunde inte starta", error.message);
    app.quit();
  }
});

app.on("before-quit", () => {
  shutdownRequested = true;
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill();
  }
});

app.on("window-all-closed", () => {
  app.quit();
});
