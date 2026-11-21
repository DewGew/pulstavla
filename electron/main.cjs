const { app, BrowserWindow, clipboard, dialog, Menu } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const tar = require("tar");

let serverProcess;
let mainWindow;
let shutdownRequested = false;
let appDataPath;

const DATABASE_FILES = [
  "users.db",
  "presence.db",
  "settings.db",
  "notifications.db",
  "orders.db",
  "productionOrders.db",
  "greenCross.db",
  "activities.db",
  "widgets.db",
  "structuredWidgets.db",
  "drawings.db",
  "matprotokoll.db",
  "measuringTools.db",
  "checklist.db",
  "kpis.db",
  "kpiValues.db",
];

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
  appDataPath = dataPath;
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


function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

async function inspectBackupArchive(archivePath) {
  const stat = fs.statSync(archivePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > 200 * 1024 * 1024) {
    throw new Error("Backupfilen är tom eller större än tillåtna 200 MB.");
  }

  const checksumPath = `${archivePath}.sha256`;
  if (fs.existsSync(checksumPath)) {
    const checksumText = fs.readFileSync(checksumPath, "utf8");
    const expected = checksumText.match(/^([a-f0-9]{64})\b/i)?.[1]?.toLowerCase();
    if (!expected) throw new Error("Kontrollfilen .sha256 har fel format.");
    const actual = sha256File(archivePath);
    if (actual !== expected) throw new Error("Backupens SHA-256-kontroll misslyckades. Filen kan vara skadad.");
  }

  const seen = new Set();
  let totalSize = 0;
  await tar.t({
    file: archivePath,
    strict: true,
    onentry(entry) {
      const entryPath = String(entry.path || "").replace(/\\/g, "/").replace(/^\.\//, "");
      if (entryPath === "db" || entryPath === "db/") {
        if (entry.type !== "Directory") throw new Error("Ogiltig katalogpost i backupen.");
        return;
      }
      const match = entryPath.match(/^db\/([^/]+)$/);
      if (!match || !DATABASE_FILES.includes(match[1])) {
        throw new Error(`Backupen innehåller en otillåten sökväg: ${entryPath}`);
      }
      if (entry.type !== "File" && entry.type !== "OldFile") {
        throw new Error(`Otillåten filtyp i backupen: ${entryPath}`);
      }
      if (seen.has(match[1])) throw new Error(`Databasfilen förekommer flera gånger: ${match[1]}`);
      seen.add(match[1]);
      totalSize += Number(entry.size || 0);
      if (totalSize > 200 * 1024 * 1024) throw new Error("Backupens uppackade innehåll är större än 200 MB.");
    },
  });

  const missing = DATABASE_FILES.filter((name) => !seen.has(name));
  if (missing.length) {
    throw new Error(`Backupen saknar databasfiler: ${missing.join(", ")}`);
  }
}

function validateDatabaseFiles(dbPath) {
  for (const name of DATABASE_FILES) {
    const filePath = path.join(dbPath, name);
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Databasfilen är inte en vanlig fil: ${name}`);
    }
    if (stat.size > 200 * 1024 * 1024) {
      throw new Error(`Databasfilen är större än tillåtna 200 MB: ${name}`);
    }
    const content = fs.readFileSync(filePath, "utf8");
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        throw new Error(`Databasfilen ${name} innehåller ogiltig data på rad ${index + 1}.`);
      }
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        throw new Error(`Databasfilen ${name} innehåller en ogiltig post på rad ${index + 1}.`);
      }
    }
  }
}

async function stopLocalServer() {
  const child = serverProcess;
  if (!child || child.exitCode !== null) {
    serverProcess = null;
    return;
  }
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      reject(new Error("Den lokala servern stängdes inte i tid. Databaserna har inte ändrats."));
    }, 15000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    try {
      child.kill();
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
  serverProcess = null;
}

async function createVerifiedDatabaseBackup(dbPath, backupDir, stamp) {
  fs.mkdirSync(backupDir, { recursive: true });
  const archivePath = path.join(backupDir, `pulstavla-before-import-${stamp}.tar.gz`);
  await tar.c({ gzip: true, file: archivePath, cwd: appDataPath }, ["db"]);
  await tar.t({ file: archivePath, strict: true });
  const checksum = sha256File(archivePath);
  fs.writeFileSync(`${archivePath}.sha256`, `${checksum}  ${path.basename(archivePath)}\n`, { flag: "wx" });
  return archivePath;
}

async function importDatabaseBackup() {
  const selected = await dialog.showOpenDialog(mainWindow, {
    title: "Välj Pulstavla-backup",
    properties: ["openFile"],
    filters: [{ name: "Pulstavla backup", extensions: ["gz", "tgz"] }],
  });
  if (selected.canceled || !selected.filePaths.length) return;

  const archivePath = selected.filePaths[0];
  if (!archivePath.toLowerCase().endsWith(".tar.gz") && !archivePath.toLowerCase().endsWith(".tgz")) {
    throw new Error("Välj en backupfil med ändelsen .tar.gz eller .tgz.");
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const stagePath = path.join(appDataPath, `.import-stage-${stamp}`);
  const stagedDbPath = path.join(stagePath, "db");
  const liveDbPath = path.join(appDataPath, "db");
  const backupDir = path.join(appDataPath, "backups");
  const previousDbPath = path.join(backupDir, `db-before-import-${stamp}`);
  let serverStopped = false;
  let previousMoved = false;

  try {
    const inspectedArchiveHash = sha256File(archivePath);
    await inspectBackupArchive(archivePath);
    fs.mkdirSync(stagePath, { recursive: true });
    await tar.x({
      file: archivePath,
      cwd: stagePath,
      strict: true,
      filter(entryPath, entry) {
        const normalized = String(entryPath).replace(/\\/g, "/").replace(/^\.\//, "");
        if (normalized === "db" || normalized === "db/") return entry?.type === "Directory";
        return /^db\/[^/]+$/.test(normalized) && (entry?.type === "File" || entry?.type === "OldFile");
      },
    });
    if (sha256File(archivePath) !== inspectedArchiveHash) {
      throw new Error("Backupfilen ändrades under importkontrollen. Ingen databas har ersatts.");
    }
    validateDatabaseFiles(stagedDbPath);

    const confirm = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "Ersätt Windows-databasen?",
      message: "Alla befintliga databasuppgifter i den här Windows-installationen kommer att ersättas.",
      detail: "En säkerhetskopia av nuvarande databas skapas automatiskt före bytet. Importen omfattar endast databaserna (db/), inte dokument eller uppladdade filer. Åtgärden kan inte ångras utan säkerhetskopian.",
      buttons: ["Avbryt", "Säkerhetskopiera och ersätt"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (confirm.response !== 1) return;

    await stopLocalServer();
    serverStopped = true;

    const savedArchive = await createVerifiedDatabaseBackup(liveDbPath, backupDir, stamp);
    fs.mkdirSync(backupDir, { recursive: true });
    fs.renameSync(liveDbPath, previousDbPath);
    previousMoved = true;

    try {
      fs.renameSync(stagedDbPath, liveDbPath);
      const { origin } = await startLocalServer();
      if (mainWindow && !mainWindow.isDestroyed()) {
        await mainWindow.loadURL(origin);
      } else {
        createWindow(origin);
      }
      serverStopped = false;
      await dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Backupimport klar",
        message: "Databaserna har ersatts och Pulstavlan har startats om.",
        detail: `Säkerhetskopia av tidigare Windows-data:\n${savedArchive}\n\nDen importerade backupen: ${path.basename(archivePath)}`,
        buttons: ["OK"],
        noLink: true,
      });
    } catch (restartError) {
      await stopLocalServer();
      const failedPath = path.join(backupDir, `db-import-failed-${stamp}`);
      if (fs.existsSync(liveDbPath)) fs.renameSync(liveDbPath, failedPath);
      if (previousMoved && fs.existsSync(previousDbPath)) {
        fs.renameSync(previousDbPath, liveDbPath);
        previousMoved = false;
      }
      const { origin: restoredOrigin } = await startLocalServer();
      if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(restoredOrigin);
      serverStopped = false;
      throw new Error(`Den importerade databasen kunde inte startas. Den tidigare databasen har återställts. Orsak: ${restartError.message}`);
    }
  } finally {
    if (serverStopped) {
      try { await startLocalServer(); } catch (error) {
        dialog.showErrorBox("Pulstavlan kunde inte starta igen", error.message);
      }
    }
    try { fs.rmSync(stagePath, { recursive: true, force: true }); } catch {}
  }
}

function installApplicationMenu() {
  const template = [
    {
      label: "Arkiv",
      submenu: [
        {
          label: "Importera backup…",
          click: () => importDatabaseBackup().catch((error) => {
            dialog.showErrorBox("Backupimporten misslyckades", error.message);
          }),
        },
        { type: "separator" },
        { role: "quit", label: "Avsluta" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
  installApplicationMenu();
  try {
    const { origin, firstRun, initialPassword } = await startLocalServer();
    createWindow(origin);

    if (firstRun) {
      const result = await dialog.showMessageBox({
        type: "info",
        title: "Första inloggningen",
        message: "Ett administratörskonto har skapats.",
        detail: `Användarnamn: admin\nLösenord: ${initialPassword}\n\nKlicka på ”Kopiera lösenord” för att kopiera det till urklipp. Spara det på en säker plats. Det visas inte igen.`,
        buttons: ["Kopiera lösenord", "Stäng"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });

      if (result.response === 0) {
        try {
          clipboard.writeText(initialPassword);
          await dialog.showMessageBox({
            type: "info",
            title: "Lösenord kopierat",
            message: "Administratörens lösenord har kopierats.",
            detail: "Klistra in det i inloggningen och spara det på en säker plats.",
            buttons: ["OK"],
            noLink: true,
          });
        } catch (error) {
          dialog.showErrorBox("Kunde inte kopiera lösenordet", error.message);
        }
      }
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
