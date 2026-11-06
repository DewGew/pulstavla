import express from "express";
import Datastore from "nedb";
import cors from "cors";
import https from "http";
import { Server } from "socket.io";
import multer from "multer";
import path from "path";
import fs from "fs";
import { PORT } from "./src/config.js";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET måste anges som en hemlig sträng på minst 32 tecken.");
}
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { load } from "cheerio"; // ESM-kompatibel

const app = express();
const __dirname = path.dirname(
  new URL(import.meta.url).pathname
);

const uploadDir = path.join(__dirname, "uploads");
const distDir = path.join(__dirname, "dist");

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique =
      Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// Kontrollera filsignatur efter uppladdning, inte bara filändelsen.
function validateUploadedFile(allowedExtensions) {
  return (req, res, next) => {
    if (!req.file) return res.status(400).json({ error: "Ingen fil skickades." });
    const ext = path.extname(req.file.originalname || req.file.filename).slice(1).toLowerCase();
    const allowed = allowedExtensions[ext];
    const header = Buffer.alloc(16);
    let fd;
    try {
      fd = fs.openSync(req.file.path, "r");
      fs.readSync(fd, header, 0, header.length, 0);
    } catch {
      return res.status(400).json({ error: "Kunde inte läsa uppladdad fil." });
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    const signatures = {
      png: header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
      jpg: header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff,
      jpeg: header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff,
      webp: header.toString("ascii",0,4) === "RIFF" && header.toString("ascii",8,12) === "WEBP",
      gif: header.toString("ascii",0,3) === "GIF",
      pdf: header.toString("ascii",0,5) === "%PDF-",
      docx: header[0] === 0x50 && header[1] === 0x4b,
      xlsx: header[0] === 0x50 && header[1] === 0x4b,
      doc: header.subarray(0,8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1])),
      xls: header.subarray(0,8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]))
    };
    if (!allowed || !signatures[ext]) {
      fs.unlink(req.file.path, () => {});
      return res.status(415).json({ error: "Filinnehållet stämmer inte med en tillåten filtyp." });
    }
    next();
  };
}
const imageFileTypes = { png:true, jpg:true, jpeg:true, webp:true, gif:true };
const documentFileTypes = { pdf:true, doc:true, docx:true, xls:true, xlsx:true, png:true, jpg:true, jpeg:true };
const spreadsheetFileTypes = { xls:true, xlsx:true };

function cleanText(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+(>|$)/g, "")
    .trim();
}

Date.prototype.getWeek = function () {
  const date = new Date(Date.UTC(this.getFullYear(), this.getMonth(), this.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
};

const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin tillåts inte av CORS"));
  },
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json());

// Den publika logotypen exponeras separat; dokumenten i docs är privata.
app.get("/brand-logo", (req, res) => {
  res.sendFile(path.resolve("docs/logo.png"), (err) => {
    if (err && !res.headersSent) res.sendStatus(404);
  });
});

function requireAuth(req, res, next) {
	const authHeader = req.headers.authorization;
  if (!authHeader)
    return res.status(401).json({ error: "Token saknas" });

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, username, role }
    next();
  } catch {
    res.status(401).json({ error: "Ogiltig token" });
  }
}

function requireAdmin(req, res, next) {
  if (!["admin", "suAdmin"].includes(req.user.role)) {
    return res.sendStatus(403);
  }
  next();
}

function requireEditor(req, res, next) {
  if (!["user", "admin", "suAdmin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Du saknar behörighet att ändra information." });
  }
  next();
}

/* ---------------- HTTP SERVER + WEBSOCKET ---------------- */
const server = https.createServer(
  app
);

const io = new Server(server, {
  cors: { origin: "*" },
});

// Alla WebSocket-anslutningar måste autentiseras med samma JWT som API:t.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Autentisering krävs"));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error("Ogiltig token"));
  }
});

/* ---------------- USERS DATABASE ---------------- */
const usersDB = new Datastore({ filename: "./db/users.db", autoload: true });
usersDB.persistence.setAutocompactionInterval(5 * 60 * 1000);

// Skapa aldrig förutsägbara standardkonton. En tom databas kan bootstrappas
// med INITIAL_ADMIN_USERNAME och INITIAL_ADMIN_PASSWORD i servermiljön.
usersDB.count({}, async (err, count) => {
  if (err) return console.error("Kunde inte kontrollera användardatabasen:", err);
  if (count !== 0) return;

  const username = process.env.INITIAL_ADMIN_USERNAME;
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!username || !password || password.length < 12) {
    console.warn("Inga användare finns. Ange INITIAL_ADMIN_USERNAME och INITIAL_ADMIN_PASSWORD (minst 12 tecken) för första administratören.");
    return;
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  usersDB.insert({
    username,
    password: hashedPassword,
    role: "suAdmin",
    email: process.env.INITIAL_ADMIN_EMAIL || "",
    name: process.env.INITIAL_ADMIN_NAME || username,
  }, (insertErr) => {
    if (insertErr) console.error("Kunde inte skapa första administratören:", insertErr);
    else console.log("Första Super Admin-kontot skapades från miljövariabler.");
  });
});

/* ---------------- PRESENCE DATABASE ---------------- */
const presenceDB = new Datastore({ filename: "./db/presence.db", autoload: true });
presenceDB.persistence.setAutocompactionInterval(5 * 60 * 1000 + 30000);

// Initiera default närvaro om tom
usersDB.find({}, (err, users) => {
  if (err) return;
  users.forEach((u) => {
    presenceDB.findOne({ username: u.username }, (err, doc) => {
      if (!doc) {
        presenceDB.insert({ username: u.username, present: false, online: false });
      }
    });
  });
});

/* ---------------- SETTINGS DATABASE ---------------- */
const settingsDB = new Datastore({
  filename: "./db/settings.db",
  autoload: true,
});
settingsDB.persistence.setAutocompactionInterval(5 * 60 * 1000 + 60000);


// Läs inställningar som objekt för interna funktioner.
// autoLogin filtreras alltid bort eftersom den gamla funktionen är avvecklad.
function getSettingsObject(callback) {
  settingsDB.find({}, (err, docs) => {
    if (err) return callback(err);

    const settings = {};
    docs.forEach((setting) => {
      if (setting.key !== "autoLogin") {
        settings[setting.key] = setting.value;
      }
    });

    callback(null, settings);
  });
}

settingsDB.count({}, (err, count) => {
  if (count === 0) {
		const defaults = [
			{
				key: "company",
				value: "Företaget AB",
			},
			{
				key: "system",
				value: {
					apiUrl: "http://api.domain.com",
					wsUrl: "ws://ws.domain.com",
					rotationInterval: 10000,
				},
			},{
				key: "machines",
				value: {
					groups: {
						FRAS: "Fräs",
						SVARV: "Svarv",
						TRUCK: "Truck",
						OVRIGA: "Övriga",
					},
					list: [
						{ name: "Minimill (A01)", group: "FRAS" },
						{ name: "VF2-4axl (B01)", group: "FRAS" },
						{ name: "EC1600 (C01)", group: "FRAS" },
						{ name: "SL30 (E01)", group: "SVARV" },
						{ name: "SL20 (E02)", group: "SVARV" },
						{ name: "Planslip Chevalier (F02)", group: "OVRIGA" },
						{ name: "Kalmar Truck", group: "TRUCK" },
					],
				},
			},
			{
				key: "checklists",
				value: {
					FRAS: {
						weekly: {
							title: "Veckokontroll / Weekly check",
							tasks: [
								"Kolla oljenivån / Check oil levels",
							],
						},
						monthly: {
							title: "Månadskontroll / Monthly check",
							tasks: [
								"Kontrollera nödstopp / Check emergency stop",
							],
						},
						halfyear: {
							title: "Halvårs kontroll / Halfyear check",
							tasks: [
								"Inventera och släng onödigt / Take inventory and throw away unnecessary things",
							],
						},
						yearly: {
							title: "Årlig kontroll / Yearly check",
							tasks: [
								"Kolla oljefilter / Check oil filter",
								"Kontrollera luftfilter / Check air filter",
							],
						},
					},
				},
			},
		];

    settingsDB.insert(defaults, () => {
      console.log("Standardinställningar skapade");
    });
  } else {
    // Ta bort äldre autoLogin-poster som kan innehålla lösenord i klartext.
    settingsDB.remove({ key: "autoLogin" }, { multi: true }, (removeErr, removed) => {
      if (removeErr) {
        console.error("Kunde inte rensa gamla autoLogin-uppgifter:", removeErr);
      } else {
        if (removed) console.log("Gamla autoLogin-inställningar rensades.");
        // Skriv om NeDB-filen så att borttagna klartextlösenord inte ligger kvar i gamla data-block.
        settingsDB.persistence.compactDatafile();
      }
    });
  }
});

import xlsx from "xlsx";

/* ---------------- KUNDORDER DATABASE ---------------- */
const ordersDB = new Datastore({
  filename: "./db/orders.db",
  autoload: true,
});
ordersDB.persistence.setAutocompactionInterval(5 * 60 * 1000 + 90000);

/* ---------------- TILLVERKNINGSORDER DATABASE ---------------- */
const productionOrdersDB = new Datastore({
  filename: "./db/productionOrders.db",
  autoload: true,
});
productionOrdersDB.persistence.setAutocompactionInterval(5 * 60 * 1000 + 120000);

app.get("/settings", requireAuth, (req, res) => {
  settingsDB.find({}, (err, docs) => {
    if (err)
      return res.status(500).json({ error: "Kunde inte läsa inställningar" });

    // returnera som objekt istället för array
    const settings = {};
    docs.forEach(s => {
      if (s.key !== "autoLogin") settings[s.key] = s.value;
    });

    res.json(settings);
  });
});

app.get("/settings/:key", requireAuth, requireAdmin, (req, res) => {
  const { key } = req.params;
  if (key === "autoLogin") return res.sendStatus(404);

  settingsDB.findOne({ key }, (err, doc) => {
    if (err)
      return res.status(500).json({ error: "DB-fel" });
    if (!doc)
      return res.status(404).json({ error: "Inställning saknas" });

    res.json(doc.value);
  });
});

app.put("/settings/:key", requireAuth, requireAdmin, (req, res) => {
  const { key } = req.params;
  if (key === "autoLogin") return res.sendStatus(410);
  const { value } = req.body;

  if (value === undefined) {
    return res.status(400).json({ error: "value saknas" });
  }

  settingsDB.update(
    { key },
    { $set: { key, value, updatedAt: Date.now() } },
    { upsert: true },
    (err) => {
      if (err)
        return res.status(500).json({ error: "Kunde inte spara inställning" });

      io.emit("settingsUpdated", { key, value });
      res.json({ success: true, key, value });
    }
  );
});

// Endpoint för att lista dokumenten
app.get("/documents", requireAuth, (req, res) => {
  const dir = path.resolve("docs");

  fs.readdir(dir, { withFileTypes: true }, (err, entries) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const allowedExtensions = [
      "pdf", "doc", "docx", "xls", "xlsx", "png", "jpg", "jpeg"
    ];

    const documents = entries
      .filter(e => e.isFile())
      .filter(e => {
        const ext = path.extname(e.name).slice(1).toLowerCase();
        return allowedExtensions.includes(ext);
      })
      .map((file, index) => ({
        id: index + 1,
        name: file.name,
        url: `/docs/${encodeURIComponent(file.name)}`
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "sv"));

    res.json(documents);
  });
});

app.get("/uploads/:name", requireAuth, (req, res) => {
  const fileName = path.basename(req.params.name);
  if (!fileName || fileName !== req.params.name) return res.sendStatus(400);
  res.sendFile(fileName, { root: path.resolve("uploads"), dotfiles: "deny" }, (err) => {
    if (err && !res.headersSent) res.sendStatus(err.statusCode === 404 ? 404 : 500);
  });
});

app.get("/documents/:name", requireAuth, (req, res) => {
  const fileName = path.basename(req.params.name);
  if (!fileName || fileName !== req.params.name) return res.sendStatus(400);
  res.sendFile(fileName, { root: path.resolve("docs"), dotfiles: "deny" }, (err) => {
    if (err && !res.headersSent) res.sendStatus(err.statusCode === 404 ? 404 : 500);
  });
});

/* Ladda upp dokument till docs med originalnamnet */
app.post("/documents", requireAuth, requireAdmin, (req, res, next) => {
  const docsDir = path.resolve("docs");

  fs.mkdirSync(docsDir, { recursive: true });

  const docsStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, docsDir);
    },
    filename: (req, file, cb) => {
      cb(null, path.basename(file.originalname));
    }
  });

  const docsUpload = multer({
    storage: docsStorage,
    limits: { fileSize: 5 * 1024 * 1024 }
  }).single("file");

  docsUpload(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          error: "Filen får vara högst 5 MB."
        });
      }

      return res.status(400).json({
        error: err.message
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "Ingen fil skickades."
      });
    }

    validateUploadedFile(documentFileTypes)(req, res, (validationErr) => {
      if (validationErr) return next(validationErr);
      res.status(201).json({
        message: "Dokumentet laddades upp.",
        name: req.file.filename,
        url: `/documents/${encodeURIComponent(req.file.filename)}`
      });
    });
  });
});

/* Ta bort dokument från docs */
app.delete("/documents/:name", requireAuth, requireAdmin, (req, res) => {
  const fileName = path.basename(req.params.name);
  const filePath = path.resolve("docs", fileName);
  const docsDir = path.resolve("docs");

  // Säkerställ att filen ligger direkt i docs-mappen
  if (path.dirname(filePath) !== docsDir) {
    return res.status(400).json({
      error: "Ogiltigt filnamn."
    });
  }

  fs.unlink(filePath, (err) => {
    if (err) {
      if (err.code === "ENOENT") {
        return res.status(404).json({
          error: "Dokumentet hittades inte."
        });
      }

      console.error("Fel vid borttagning av dokument:", err);

      return res.status(500).json({
        error: "Kunde inte ta bort dokumentet."
      });
    }

    res.json({
      message: "Dokumentet togs bort.",
      name: fileName
    });
  });
});

/* ---------------- LUNCH MENU (weekly, cached) ---------------- */
const LUNCH_SOURCE_URL = "https://www.smakrikt.se/";
const LUNCH_META_PATH = path.join(uploadDir, "lunch-meta.json");
// Extension varies week to week (webp, jpg, png have all shown up), so the
// cache filename is built dynamically from whatever the source actually is —
// see refreshLunchCache().
const LUNCH_IMAGE_BASENAME = "lunch-current";

async function refreshLunchCache() {
  const res = await fetch(LUNCH_SOURCE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} vid hämtning av startsidan`);
  const html = await res.text();

  // cheerio is already imported for other parsing — reuse it here too
  const $ = load(html);
  let imageUrl = null;
  $("img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src");
    // Extension is intentionally flexible — Smakrikt doesn't always upload
    // the menu as .webp, some weeks it's .jpg/.jpeg/.png instead.
    if (src && /Smakrikt-lunch-v\d+-\d+\.(webp|jpg|jpeg|png)/i.test(src)) {
      imageUrl = src;
    }
  });
  if (!imageUrl) throw new Error("Kunde inte hitta veckans meny-bild");

  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status} vid hämtning av bild`);
  const buffer = Buffer.from(await imgRes.arrayBuffer());

  // Preserve the real extension rather than always writing .webp, so the
  // saved file's bytes and its name always match.
  const ext = path.extname(new URL(imageUrl).pathname) || ".webp";
  const imageFile = `${LUNCH_IMAGE_BASENAME}${ext}`;
  const imagePath = path.join(uploadDir, imageFile);

  // Clean up a stale cached file from a previous week if it had a
  // different extension (e.g. last week .jpg, this week .webp).
  const existing = await fs.promises.readdir(uploadDir).catch(() => []);
  await Promise.all(
    existing
      .filter((f) => f.startsWith(LUNCH_IMAGE_BASENAME) && f !== imageFile)
      .map((f) => fs.promises.unlink(path.join(uploadDir, f)).catch(() => {}))
  );

  await fs.promises.writeFile(imagePath, buffer);

  const now = new Date();
  const meta = {
    week: now.getWeek(),          // your existing Date.prototype helper
    year: now.getFullYear(),
    imageFile,
    sourceUrl: imageUrl,
    fetchedAt: now.toISOString(),
  };
  await fs.promises.writeFile(LUNCH_META_PATH, JSON.stringify(meta, null, 2));
  return meta;
}

async function readLunchMeta() {
  try {
    return JSON.parse(await fs.promises.readFile(LUNCH_META_PATH, "utf-8"));
  } catch {
    return null;
  }
}

app.get("/lunch-image/:name", (req, res) => {
  const name = req.params.name;
  if (!/^lunch-current\\.(webp|jpg|jpeg|png)$/i.test(name)) return res.sendStatus(404);
  res.sendFile(name, { root: uploadDir }, (err) => {
    if (err && !res.headersSent) res.sendStatus(404);
  });
});

app.get("/lunch", async (req, res) => {
  const now = new Date();
  const currentWeek = now.getWeek();
  const currentYear = now.getFullYear();

  try {
    const meta = await readLunchMeta();
    const isCurrent = meta && meta.week === currentWeek && meta.year === currentYear;

    if (isCurrent) {
      return res.json({ imageUrl: `/lunch-image/${meta.imageFile}`, ...meta });
    }

    const freshMeta = await refreshLunchCache();
    res.json({ imageUrl: `/lunch-image/${freshMeta.imageFile}`, ...freshMeta });
  } catch (err) {
    console.warn("Kunde inte uppdatera lunch-cache:", err.message);
    const meta = await readLunchMeta();
    if (meta) {
      return res.json({ imageUrl: `/lunch-image/${meta.imageFile}`, ...meta, stale: true });
    }
    res.status(502).json({ error: "Kunde inte hämta veckans lunch" });
  }
});

/* ---------------- PRESENCE ENDPOINT ---------------- */
app.get("/presence/users", requireAuth, (req, res) => {
  usersDB.find({}, (err, docs) => {
    if (err) return res.status(500).json({ error: "Kunde inte läsa användare" });
    res.json(docs.map(({ password, ...user }) => ({
      _id: user._id,
      username: user.username,
      name: user.name,
      role: user.role,
    })));
  });
});

app.get("/presence", requireAuth, (req, res) => {
  presenceDB.find({}, (err, docs) => {
    if (err) return res.status(500).json({ error: "Kunde inte läsa närvaro" });

    // Normalisera svar: maskiner och användare
    const presenceObj = {};
    docs.forEach((p) => {
      // Om det är en maskin (status finns) returnera objekt, annars boolean
      if (p.status) {
        presenceObj[p.username] = {
          status: p.status,
          operator: p.operator || ""
        };
      } else {
        presenceObj[p.username] = {
					present: p.present || false,
					online: p.online || false,
				};
      }
    });

    res.json(presenceObj);
  });
});

app.post("/presence", requireAuth, requireEditor, (req, res) => {
  const { username, present, status, operator } = req.body;

  if (typeof username !== "string" || !username.trim()) {
    return res.status(400).json({ error: "Username saknas" });
  }
  if (operator !== undefined && (typeof operator !== "string" || operator.length > 100)) {
    return res.status(400).json({ error: "Ogiltig operatör" });
  }

  const updatePresence = (updateObj) => {
    presenceDB.update(
      { username },
      { $set: updateObj },
      { upsert: true },
      (err) => {
        if (err) return res.status(500).json({ error: "Kunde inte uppdatera närvaro" });
        io.emit("presenceUpdated", { username, ...updateObj });
        res.json({ success: true, username, ...updateObj });
      }
    );
  };

  // Maskinstatus får bara användas för maskiner som finns i inställningarna.
  if (status !== undefined) {
    if (!["green", "yellow", "red"].includes(status)) {
      return res.status(400).json({ error: "Ogiltig maskinstatus" });
    }
    return getSettingsObject((err, settings) => {
      if (err) return res.status(500).json({ error: "Kunde inte läsa maskiner" });
      const machineExists = (settings.machines?.list || []).some((machine) => machine.name === username);
      if (!machineExists) return res.status(404).json({ error: "Maskinen hittades inte" });
      const updateObj = { status };
      if (operator !== undefined) updateObj.operator = operator;
      updatePresence(updateObj);
    });
  }

  if (typeof present !== "boolean") {
    return res.status(400).json({ error: "Närvarostatus måste vara true eller false" });
  }

  usersDB.findOne({ username }, (err, targetUser) => {
    if (err) return res.status(500).json({ error: "Kunde inte läsa användare" });
    if (!targetUser) return res.status(404).json({ error: "Användaren hittades inte" });
    if (req.user.role === "user" && targetUser.role !== "user") {
      return res.status(403).json({ error: "Du får bara ändra närvaro för produktionsanvändare." });
    }
    updatePresence({ present });
  });
});

/* ---------------- GREEN CROSS DATABASE ---------------- */
const db = new Datastore({ filename: "./db/greenCross.db", autoload: true });
db.persistence.setAutocompactionInterval(5 * 60 * 1000 + 150000);

/* ---------------- ACTIVITIES DATABASE ---------------- */
const activitiesDB = new Datastore({ filename: "./db/activities.db", autoload: true });
activitiesDB.persistence.setAutocompactionInterval(5 * 60 * 1000 + 180000);

/* ---------------- WIDGETS DATABASE ---------------- */
const widgetsDB = new Datastore({filename: "./db/widgets.db", autoload: true });
widgetsDB.persistence.setAutocompactionInterval(5 * 60 * 1000 + 210000);

/* ---------------- STRUCTURED WIDGETS DATABASE ---------------- */
const structuredWidgetsDB = new Datastore({
  filename: "./db/structuredWidgets.db",
  autoload: true,
});
structuredWidgetsDB.persistence.setAutocompactionInterval(5 * 60 * 1000 + 240000);

/* ---------------- DRAWING WIDGETS DATABASE ---------------- */
// Handstil/anteckningar från touchpanelen (DrawingWidget) — sparas som
// vektorstrokes (punktlistor), inte som bitmap, så de förblir skarpa
// oavsett skärmstorlek/upplösning.
const drawingsDB = new Datastore({
  filename: "./db/drawings.db",
  autoload: true,
});
drawingsDB.persistence.setAutocompactionInterval(5 * 60 * 1000 + 255000);

/* ---------------- MÄTPROTOKOLL DATABASE ---------------- */
// Sparade mätprotokoll (Matprotokoll.jsx) — id byggs som
// "<ordernr>_<artikelnummer>", samma nyckel som PDF-filnamnet redan
// använder, så en post här alltid går att koppla till rätt PDF.
const matprotokollDB = new Datastore({
  filename: "./db/matprotokoll.db",
  autoload: true,
});
matprotokollDB.persistence.setAutocompactionInterval(5 * 60 * 1000 + 260000);

/* ---------------- USERS ENDPOINTS ---------------- */
app.get("/users", requireAuth, requireAdmin, (req, res) => {
  usersDB.find({}, (err, docs) => {
    if (err) return res.status(500).json({ error: "Kunde inte läsa användare" });
    res.json(docs.map(({ password, ...user }) => user));
  });
});

app.post("/users/add", requireAuth, requireAdmin, async (req, res) => {
  const { username, password, role, email, name } = req.body;

  if (!username || !password || !email || !name) {
    return res.status(400).json({ error: "username, password, email och name krävs" });
  }
  if (typeof password !== "string" || password.length < 3) {
    return res.status(400).json({ error: "Lösenord måste vara minst 3 tecken." });
  }
  if (role && !["view", "user", "admin"].includes(role)) {
    return res.status(400).json({ error: "Ogiltig roll. Endast view, user eller admin kan skapas här." });
  }
  const hashedPassword = await bcrypt.hash(password, 12);

  const user = { username, password: hashedPassword, role: role || "user", email, name };

  usersDB.insert(user, (err, newUser) => {
    if (err) return res.status(500).json({ error: "Kunde inte spara användare" });

    const { password: _password, ...safeUser } = newUser;
    res.json({ success: true, user: safeUser });
  });
});

app.delete("/users/:id", requireAuth, requireAdmin, (req, res) => {
  const id = req.params.id;

  usersDB.findOne({ _id: id }, (findErr, targetUser) => {
    if (findErr) return res.status(500).json({ error: "DB-fel" });
    if (!targetUser) return res.status(404).json({ error: "Användare hittades inte" });
    if (targetUser.role === "suAdmin" && req.user.role !== "suAdmin") {
      return res.status(403).json({ error: "Endast Super Admin får radera Super Admin-konton." });
    }

    usersDB.remove({ _id: id }, {}, (err, numRemoved) => {
      if (err) return res.status(500).json({ error: "Kunde inte radera användare" });
      if (numRemoved === 0) return res.status(404).json({ error: "Användare hittades inte" });
      res.json({ success: true, removed: numRemoved });
    });
  });
});

/* ---------------- UPDATE USER ROLE ---------------- */
app.put("/users/:id/role", requireAuth, requireAdmin, (req, res) => {
  const id = req.params.id;
  const { role } = req.body;

  if (!["view", "user", "admin", "suAdmin"].includes(role)) return res.status(400).json({ error: "Ogiltig roll" });

  usersDB.findOne({ _id: id }, (err, targetUser) => {
    if (err)
      return res.status(500).json({ error: "DB-fel" });

    if (!targetUser)
      return res.status(404).json({ error: "Användaren hittades inte" });

    // Endast suAdmin får hantera suAdmin-konton eller tilldela suAdmin-roll.
    if ((targetUser.role === "suAdmin" || role === "suAdmin") && req.user.role !== "suAdmin") {
      return res.status(403).json({
        error: "Endast Super Admin får ändra Super Admin.",
      });
    }

    usersDB.update(
      { _id: id },
      { $set: { role } },
      {},
      (err, numUpdated) => {
        if (err)
          return res.status(500).json({
            error: "Kunde inte uppdatera roll",
          });

        if (numUpdated === 0)
          return res.status(404).json({
            error: "Användaren hittades inte",
          });

        res.json({ success: true });
      }
    );
  });
});
// ---------------- UPDATE USER ----------------
app.put("/users/:id", requireAuth, requireAdmin, (req, res) => {
  const id = req.params.id;
  const { name, username, email, password, role } = req.body;

  // Skapa ett update-objekt med endast de fält som skickats
  const updateFields = {};
  if (name !== undefined) updateFields.name = name;
  if (username !== undefined) updateFields.username = username;
  if (email !== undefined) updateFields.email = email;
  if (role !== undefined) return res.status(400).json({ error: "Ändra roll via /users/:id/role." });
  if (password !== undefined && password !== "") {
    if (password.length < 3) return res.status(400).json({ error: "Lösenord måste vara minst 3 tecken." });
    updateFields.password = bcrypt.hashSync(password, 12);
  }

  usersDB.findOne({ _id: id }, (findErr, targetUser) => {
    if (findErr) return res.status(500).json({ success: false, error: "DB-fel" });
    if (!targetUser) return res.status(404).json({ success: false, error: "Användare hittades inte" });
    if (targetUser.role === "suAdmin" && req.user.role !== "suAdmin") {
      return res.status(403).json({ error: "Endast Super Admin får ändra Super Admin-konton." });
    }

    usersDB.update({ _id: id }, { $set: updateFields }, {}, (err, numUpdated) => {
      if (err) return res.status(500).json({ success: false, error: "Kunde inte uppdatera användare" });
      if (numUpdated === 0) return res.status(404).json({ success: false, error: "Användare hittades inte" });
      res.json({ success: true, updated: { ...updateFields, password: undefined } });
    });
  });
});

const loginAttempts = new Map();
function loginRateLimit(req, res, next) {
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const username = String(req.body?.username || "").trim().toLowerCase();
  const key = `${ip}:${username}`;
  const entry = loginAttempts.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + 15 * 60 * 1000;
  }
  if (entry.count >= 10) {
    return res.status(429).json({ error: "För många inloggningsförsök. Försök igen om 15 minuter." });
  }
  entry.count += 1;
  loginAttempts.set(key, entry);
  next();
}

app.post("/login", loginRateLimit, (req, res) => {
  const { username, password } = req.body;
  if (typeof username !== "string" || typeof password !== "string" || !username.trim() || !password) {
    return res.status(400).json({ error: "Användarnamn och lösenord krävs." });
  }

  usersDB.findOne({ username: username.trim() }, async (err, user) => {
    if (err) return res.status(500).json({ error: "Serverfel" });
    if (!user) return res.status(401).json({ error: "Fel användarnamn" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: "Fel lösenord" });

    const loginKey = `${req.ip || req.socket.remoteAddress || "unknown"}:${String(username).trim().toLowerCase()}`;
    loginAttempts.delete(loginKey);

    // Save last login time
    usersDB.update(
      { _id: user._id },
      { $set: { lastLogin: Date.now() } },
      {}
    );

    const token = jwt.sign(
      {
        id: user._id,
        username: user.username,
        name: user.name,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    // FIX: update presence BEFORE sending response,
    // so the client never receives success before the DB is updated.
    presenceDB.update(
      { username: user.username },
      { $set: { online: true } },
      { upsert: true },
      () => {
        io.emit("onlineUpdated", { username: user.username, online: true });

        res.json({
          success: true,
          token,
          user: {
            _id: user._id,
            username: user.username,
            role: user.role,
            name: user.name,
            email: user.email,
          },
        });
      }
    );
  });
});

app.post("/logout", requireAuth, (req, res) => {
  const username = req.user.username;

  // Emit the WS event only after the DB write has completed.
  presenceDB.update(
    { username },
    { $set: { online: false } },
    {},
    () => {
      io.emit("onlineUpdated", { username, online: false });
      res.json({ success: true });
    }
  );
});

io.on("connection", (socket) => {
  console.log("WS client connected:", socket.id);

  socket.on("registerUser", () => {
    const username = socket.user.username;
    if (!username) return;
    socket.username = username;

    presenceDB.update(
      { username },
      { $set: { online: true } },
      { upsert: true }
    );

    io.emit("onlineUpdated", { username, online: true });
  });

  socket.on("disconnect", () => {
    if (socket.username) {
      presenceDB.update(
        { username: socket.username },
        { $set: { online: false } },
        {},
        () => {
          io.emit("onlineUpdated", {
            username: socket.username,
            online: false,
          });
        }
      );
    }

    console.log("WS client disconnected:", socket.id);
  });
});

/* ---------------- GREEN CROSS ENDPOINTS ---------------- */
app.get("/greenCross/:crossId/:year/:month", requireAuth, (req, res) => {
  const crossId = req.params.crossId;
  const year = Number(req.params.year);
  const month = Number(req.params.month);

  db.findOne({ crossId, year, month }, (err, doc) => {
    if (err) return res.status(500).send(err);
    res.json(doc || { crossId, year, month, cells: [] });
  });
});

app.post("/greenCross", requireAuth, requireEditor, (req, res) => {
  const { crossId, year, month, cells } = req.body;

  db.update(
    { crossId, year, month },
    { $set: { cells } },
    { upsert: true },
    (err, numReplaced, upsert) => {
      if (err) return res.status(500).send(err);

      io.emit("greenCrossUpdate", { crossId, year, month, cells });

      res.json({
        ok: true,
        updated: numReplaced,
        createdNew: upsert ? true : false,
      });
    }
  );
});

/* ---------------- ACTIVITIES ENDPOINTS ---------------- */

// Hämta alla aktiviteter
app.get("/activities", requireAuth, (req, res) => {
  activitiesDB.find({})
    .sort({ sticky: -1, createdAt: -1 })
    .exec((err, docs) => {
      if (err) return res.status(500).json({ error: "Kunde inte läsa aktiviteter" });
      res.json(docs);
    });
});

// Skapa aktivitet (nu med responsible)
app.post("/activities", requireAuth, requireEditor, (req, res) => {
	const { title, category, deadline, responsible, description, image, flag, crossId, sticky } = req.body;

	if (!title) return res.status(400).json({ error: "Titel krävs" });

	const newTask = {
		title,
		category,
		deadline,
		responsible,
		description: description || "",
		image: image || null,
		flag,
		crossId,
		 sticky: sticky || false,
		createdAt: Date.now(),
		createdBy: req.user.name,
	};

	activitiesDB.insert(newTask, (err, doc) => {
	  if (err) return res.status(500).json({ error: "Kunde inte spara" });

	  io.emit("activitiesUpdated");
	  res.json(doc);
    });
});

// Uppdatera aktivitet (inkl responsible)
app.put("/activities/:id", requireAuth, requireEditor, (req, res) => {
  const id = req.params.id;

  activitiesDB.findOne({ _id: id }, (err, task) => {
		if (err || !task)
			return res.status(404).json({ error: "Aktivitet hittades inte" });

		// 🔒 Stoppa att sticky markeras som klar
		if (task.sticky && req.body.done === true) {
			return res.status(400).json({
				error: "Sticky-aktiviteter kan inte markeras som klara",
			});
		}

		activitiesDB.update(
			{ _id: id },
			{ $set: req.body },
			{},
			(err) => {
				if (err)
					return res.status(500).json({ error: "Kunde inte uppdatera" });

				io.emit("activitiesUpdated");
				res.json({ success: true });
			}
		);
	});
});

// Ta bort aktivitet
app.delete("/activities/:id", requireAuth, requireEditor, (req, res) => {
  const id = req.params.id;

  activitiesDB.remove({ _id: id }, {}, (err) => {
    if (err) return res.status(500).json({ error: "Kunde inte radera" });

    io.emit("activitiesUpdated");

    res.json({ success: true });
  });
});

/* ---------------- WIDGETS ENDPOINTS ---------------- */
// Hämta alla widgets
app.get("/widgets", requireAuth, (req, res) => {
  widgetsDB.find({}, (err, docs) => {
    if (err) return res.status(500).json({ error: "Fel vid hämtning av widgets" });
    res.json(docs);
  });
});

// Hämta widget med textwidgetid
app.get("/widgets/:textwidgetid", requireAuth, (req, res) => {
  const id = req.params.textwidgetid;
  widgetsDB.findOne({ textwidgetid: id }, (err, doc) => {
    if (err) return res.status(500).json({ error: "Fel vid hämtning" });
    if (!doc) return res.status(404).json({ error: "Widget hittades inte" });
    res.json(doc);
  });
});

// Skapa widget (om den inte finns)
app.post("/widgets", requireAuth, requireEditor, (req, res) => {
  const { textwidgetid, title = "", text = "" } = req.body;
  if (!textwidgetid) return res.status(400).json({ error: "textwidgetid krävs" });

  const widget = { textwidgetid, title, text, createdAt: Date.now() };

  widgetsDB.insert(widget, (err, doc) => {
    if (err) return res.status(500).json({ error: "Kunde inte skapa widget" });
    io.emit("widgetCreated", doc);
    res.json(doc);
  });
});

// Uppdatera widget
app.put("/widgets/:textwidgetid", requireAuth, requireEditor, (req, res) => {
  const id = req.params.textwidgetid;
  const { title, text } = req.body;

  const updatedBy = req.user.name

  widgetsDB.update(
    { textwidgetid: id },
    {
      $set: {
        title,
        text,
        updatedBy,
        updatedAt: Date.now(),
      },
    },
    { upsert: true },
    (err) => {
      if (err)
        return res.status(500).json({ error: "Kunde inte spara" });

      io.emit("widgetUpdated", {
        textwidgetid: id,
        title,
        text,
        updatedBy,
        updatedAt: Date.now(),
      });

      res.json({ success: true });
    }
  );
});


app.get("/structured-widgets/:widgetId", requireAuth, (req, res) => {
  const { widgetId } = req.params;

  structuredWidgetsDB.findOne({ widgetId }, (err, doc) => {
    if (err) return res.status(500).json({ error: "DB-fel" });
    if (!doc) return res.status(404).json({ error: "Widget saknas" });
    res.json(doc);
  });
});

app.post("/structured-widgets", requireAuth, requireEditor, (req, res) => {
  const { widgetId, title = "", sections = [] } = req.body;

  if (!widgetId)
    return res.status(400).json({ error: "widgetId krävs" });

  const widget = {
    widgetId,
    title,
    sections,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  structuredWidgetsDB.insert(widget, (err, doc) => {
    if (err)
      return res.status(500).json({ error: "Kunde inte skapa widget" });

    io.emit("structuredWidgetCreated", doc);
    res.json(doc);
  });
});

app.put("/structured-widgets/:widgetId", requireAuth, requireEditor, (req, res) => {
  const { widgetId } = req.params;
  const { title, sections } = req.body;

  const updatedBy = req.user.name;

  structuredWidgetsDB.update(
    { widgetId },
    {
      $set: {
        title,
        sections,
        updatedBy,
        updatedAt: Date.now(),
      },
    },
    { upsert: true },
    (err) => {
      if (err)
        return res.status(500).json({ error: "Kunde inte spara widget" });

      io.emit("structuredWidgetUpdated", {
        widgetId,
        title,
        sections,
        updatedBy,
        updatedAt: Date.now(),
      });

      res.json({ success: true });
    }
  );
});

app.delete("/structured-widgets/:widgetId", requireAuth, requireEditor, (req, res) => {
  structuredWidgetsDB.remove(
    { widgetId: req.params.widgetId },
    {},
    (err, numRemoved) => {
      if (err)
        return res.status(500).json({ error: "Kunde inte ta bort" });
      res.json({ success: true, removed: numRemoved });
    }
  );
});

/* ---------------- MÄTPROTOKOLL ENDPOINTS ---------------- */
// Lista sparade protokoll (bara det som behövs för en väljarlista —
// inte hela mätpunkts-arrayen, så listan förblir snabb att hämta)
app.get("/matprotokoll", requireAuth, (req, res) => {
  // FIX: exkludera bara measurements (kan vara stor) istället för att lita
  // på nästlad dot-notation-projektion ("form.ordernr": 1), som inte är
  // garanterat pålitlig i alla NeDB-versioner.
  matprotokollDB
    .find({}, { measurements: 0 })
    .sort({ updatedAt: -1 })
    .exec((err, docs) => {
      if (err)
        return res.status(500).json({ error: "Kunde inte lista mätprotokoll" });
      const visibleDocs = ["admin", "suAdmin"].includes(req.user.role)
        ? docs
        : docs.filter((doc) =>
            doc.form?.upprattadAv === req.user.name && doc.pdfSaved === false
          );
      res.json(visibleDocs);
    });
});

// Hämta ett specifikt protokoll (hela form + measurements)
app.get("/matprotokoll/:matprotokollId", requireAuth, (req, res) => {
  const { matprotokollId } = req.params;

  matprotokollDB.findOne({ matprotokollId }, (err, doc) => {
    if (err) return res.status(500).json({ error: "DB-fel" });
    if (!doc) return res.status(404).json({ error: "Mätprotokoll saknas" });
    const isAdmin = ["admin", "suAdmin"].includes(req.user.role);
    const isOwnDraft =
      doc.form?.upprattadAv === req.user.name && doc.pdfSaved === false;
    if (!isAdmin && !isOwnDraft) {
      return res.status(404).json({ error: "Mätprotokoll saknas" });
    }
    res.json(doc);
  });
});

// Skapa/uppdatera protokoll (upsert på matprotokollId)
app.put("/matprotokoll/:matprotokollId", requireAuth, requireEditor, (req, res) => {
  const { matprotokollId } = req.params;
  const { form, measurements, pdfSaved } = req.body;

  if (!form || !measurements) {
    return res.status(400).json({ error: "form och measurements krävs" });
  }

  const updatedBy = req.user.name;

  // FIX: NeDB (paketet "nedb") stödjer inte $setOnInsert — det gav en
  // okänd-modifierare-krasch (500) på varje sparning. Slår istället upp
  // ev. befintlig post själv för att bevara createdAt, och använder bara
  // $set i uppdateringen.
  matprotokollDB.findOne({ matprotokollId }, (err, existing) => {
    if (err) return res.status(500).json({ error: "DB-fel" });

    const doc = {
      matprotokollId,
      form,
      measurements,
      updatedBy,
      updatedAt: Date.now(),
      createdAt: existing?.createdAt || Date.now(),
      // Om "pdfSaved" inte skickas med (t.ex. äldre frontend) bevaras det
      // befintliga värdet istället för att tyst nollställas.
      pdfSaved: pdfSaved !== undefined ? !!pdfSaved : !!existing?.pdfSaved,
    };

    matprotokollDB.update(
      { matprotokollId },
      { $set: doc },
      { upsert: true },
      (err) => {
        if (err)
          return res.status(500).json({ error: "Kunde inte spara mätprotokoll" });

        res.json({ success: true, matprotokollId });
      }
    );
  });
});

// Ta bort protokoll
app.delete("/matprotokoll/:matprotokollId", requireAuth, requireEditor, (req, res) => {
  matprotokollDB.remove(
    { matprotokollId: req.params.matprotokollId },
    {},
    (err, numRemoved) => {
      if (err) return res.status(500).json({ error: "Kunde inte ta bort" });
      res.json({ success: true, removed: numRemoved });
    }
  );
});

/* ---------------- DRAWING WIDGET ENDPOINTS ---------------- */
app.get("/drawings/:drawingId", requireAuth, (req, res) => {
  const { drawingId } = req.params;

  drawingsDB.findOne({ drawingId }, (err, doc) => {
    if (err) return res.status(500).json({ error: "DB-fel" });
    if (!doc) return res.status(404).json({ error: "Ritning saknas" });
    res.json(doc);
  });
});

app.post("/drawings", requireAuth, requireEditor, (req, res) => {
  const { drawingId, title = "", strokes = [] } = req.body;

  if (!drawingId)
    return res.status(400).json({ error: "drawingId krävs" });

  const drawing = {
    drawingId,
    title,
    strokes,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  drawingsDB.insert(drawing, (err, doc) => {
    if (err)
      return res.status(500).json({ error: "Kunde inte skapa ritning" });

    io.emit("drawingCreated", doc);
    res.json(doc);
  });
});

// FIX: no requireAuth here on purpose — touch panels drawing notes are often
// logged in as a shared kiosk user.
// updatedBy falls back to "Okänd" instead of relying on req.user.
app.put("/drawings/:drawingId", requireAuth, requireEditor, (req, res) => {
  const { drawingId } = req.params;
  const { title, strokes } = req.body;

  let updatedBy = "Okänd";
  const authHeader = req.headers.authorization;
  if (authHeader) {
    try {
      const decoded = jwt.verify(authHeader.split(" ")[1], JWT_SECRET);
      updatedBy = decoded.name || decoded.username || updatedBy;
    } catch {
      // ogiltig/saknad token — spara ändå, bara utan namn
    }
  }

  drawingsDB.update(
    { drawingId },
    {
      $set: {
        title,
        strokes,
        updatedBy,
        updatedAt: Date.now(),
      },
    },
    { upsert: true },
    (err) => {
      if (err)
        return res.status(500).json({ error: "Kunde inte spara ritning" });

      io.emit("drawingUpdated", {
        drawingId,
        title,
        strokes,
        updatedBy,
        updatedAt: Date.now(),
      });

      res.json({ success: true });
    }
  );
});

app.delete("/drawings/:drawingId", requireAuth, requireAdmin, (req, res) => {
  drawingsDB.remove({ drawingId: req.params.drawingId }, {}, (err, numRemoved) => {
    if (err) return res.status(500).json({ error: "Kunde inte ta bort" });
    res.json({ success: true, removed: numRemoved });
  });
});

app.post("/activities/upload", requireAuth, requireEditor, upload.single("image"), validateUploadedFile(imageFileTypes), (req, res) => {
  console.log("Upload file:", req.file);
  if (!req.file) {
    return res.status(400).json({ error: "Ingen bild vald" });
  }

  res.json({
    filename: req.file.filename,
    url: `/uploads/${req.file.filename}`,
  });
});

/* ---------------- CHECKLIST DATABASE ---------------- */
const checklistDB = new Datastore({ filename: "./db/checklist.db", autoload: true });
checklistDB.persistence.setAutocompactionInterval(5 * 60 * 1000 + 270000);

/* ---------------- CHECKLIST ENDPOINTS ---------------- */
// Hämta topp-lista med maskiner som checkat för en viss vecka
app.get("/checklist/top", requireAuth, (req, res) => {
  const { week } = req.query;
  if (!week) return res.status(400).json({ error: "Vecka saknas" });

  checklistDB.find({ week }, (err, docs) => {
    if (err)
      return res.status(500).json({ error: "Kunde inte läsa checklistorna" });

    getSettingsObject((err, settings) => {
      if (err)
        return res.status(500).json({ error: "Settings-fel" });

      const machines = settings.machines?.list || [];
      const checklists = settings.checklists || {};

      const topList = docs.map(doc => {
        const doneTasks = Object.values(doc.items || {}).filter(
          item => item && item.user
        ).length;

        const machineObj = machines.find(m => m.name === doc.machine);
        const sections = machineObj
          ? checklists[machineObj.group] || {}
          : {};

        const totalTasks = Object.values(sections)
          .reduce((sum, s) => sum + (s.tasks?.length || 0), 0);

        const percent = totalTasks
          ? Math.round((doneTasks / totalTasks) * 100)
          : 0;

        return {
          machine: doc.machine,
          doneTasks,
          totalTasks,
          percent
        };
      });

      topList.sort((a, b) => b.percent - a.percent);

      res.json(topList);
    });
  });
});

// Hämta checklista för en maskin + vecka
app.get("/checklist/:machine", requireAuth, (req, res) => {
  const { machine } = req.params;
  const { week } = req.query;

  if (!week) return res.status(400).json({ error: "Vecka saknas" });

  checklistDB.findOne({ machine, week }, (err, doc) => {
    if (err) return res.status(500).json({ error: "Kunde inte läsa checklistan" });
    res.json(doc || { machine, week, items: {}, comment: "" });
  });
});

// Skapa eller uppdatera checklistan för en maskin + vecka
app.post("/checklist/:machine", requireAuth, requireEditor, (req, res) => {
  const { machine } = req.params;
  const { week, items = {}, comment = "", machineNumber = "" } = req.body;

  if (!req.user) {
    return res.status(401).json({ error: "Inloggad användare saknas" });
  }

  if (!week) {
    return res.status(400).json({ error: "Vecka saknas" });
  }

  const updatedBy = req.user.name || req.user.username;

  const checklist = {
    machine,
		machineNumber,
    week,
    items,
    comment,
    updatedBy,
    updatedAt: Date.now(),
  };

  checklistDB.update(
    { machine, week },
    { $set: checklist },
    { upsert: true },
    (err, numUpdated, upsert) => {
      if (err) {
        return res.status(500).json({ error: "Kunde inte spara checklistan" });
      }

      io.emit("checklistUpdated", checklist);

      res.json({
        success: true,
        checklist,
        createdNew: !!upsert,
      });
    }
  );
});


// Radera checklistan för en maskin + vecka
app.delete("/checklist/:machine", requireAuth, requireAdmin, (req, res) => {
  const { machine } = req.params;
  const { week } = req.query;

  if (!week) return res.status(400).json({ error: "Vecka saknas" });

  checklistDB.remove({ machine, week }, {}, (err, numRemoved) => {
    if (err) return res.status(500).json({ error: "Kunde inte ta bort checklistan" });
    res.json({ success: true, removed: numRemoved });
  });
});

app.post("/orders/import", requireAuth, requireAdmin, upload.single("file"), validateUploadedFile(spreadsheetFileTypes), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Ingen fil uppladdad" });
  }

  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

		const rawData = xlsx.utils.sheet_to_json(sheet, {
			range: 7,
			header: [
				"A",
				"SKPL",
				"C",
				"Artikelnr",
				"E",
				"Benämning",
				"G",
				"H",
				"Ordernr",
				"J",
				"Kundnr",
				"Kundnamn",
				"Kundref",
				"N",
				"0",
				"Leveransdatum",
				"Q",
				"Lovad",
				"S",
				"T",
				"KundOrder",
				"V",
				"W",
				"Antal",				
			],
			defval: "",
			raw: false,          // 🔥 Viktig!
			cellDates: true,     // 🔥 Gör Excel-datum till Date
		});

		// 1️⃣ Ta bort helt tomma rader
		let filteredRows = rawData.filter(row =>
			Object.values(row).some(value => value !== "")
		);
		
		const allowedColumns = [
			"Artikelnr",
			"Benämning",
			"Ordernr",
			"Kundnamn",
			"Leveransdatum",
			"Antal"
		];

		filteredRows = filteredRows.map(row => {
			const newRow = {};
			allowedColumns.forEach(col => {
				newRow[col] = row[col];
			});
			return newRow;
		});

		// 2️⃣ Ta bort kolumner som är tomma i ALLA rader
		const keys = Object.keys(filteredRows[0] || {});
		const nonEmptyKeys = keys.filter(key =>
			filteredRows.some(row => row[key] !== "")
		);

		// 3️⃣ Bygg nya objekt utan tomma kolumner
		const cleanedData = filteredRows.map(row => {
			const newRow = {};
			nonEmptyKeys.forEach(key => {
				newRow[key] = row[key];
			});
			return newRow;
		});
		
		function excelDateToJSDate(serial) {
			const excelEpoch = new Date(Date.UTC(1899, 11, 30));
			return new Date(excelEpoch.getTime() + serial * 86400000);
		}

		cleanedData.forEach(row => {
			if (typeof row.Leveransdatum === "number") {
				row.Leveransdatum = excelDateToJSDate(row.Leveransdatum);
			}

			if (row.Leveransdatum instanceof Date) {
				row.Leveransdatum = new Date(row.Leveransdatum);
			}

			if (!row.Leveransdatum) {
				row.Leveransdatum = null;
			}
		});

    // Rensa gamla poster (valfritt)
		ordersDB.remove({}, { multi: true }, () => {
			ordersDB.insert(
				cleanedData.map(row => ({
					...row,
					importedAt: Date.now(),
					importedBy: req.user.name,
				})),
				(err) => {
					if (err) {
						return res.status(500).json({ error: "Kunde inte spara data" });
					}

					io.emit("ordersUpdated");

					res.json({
						success: true,
						rowsImported: cleanedData.length,
					});
				}
			);
		});

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fel vid läsning av Excel" });
  }
});

app.get("/orders", requireAuth, (req, res) => {
  ordersDB.find({ Leveransdatum: { $ne: null } })
    .sort({ Leveransdatum: 1 }) // 1 = stigande (äldst först)
    .exec((err, docs) => {
      if (err)
        return res.status(500).json({ error: "Kunde inte läsa ordrar" });

      res.json(docs);
    });
});

app.post(
  "/production-orders/import",
  requireAuth,
  requireAdmin,
  upload.single("file"),
  validateUploadedFile(spreadsheetFileTypes),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Ingen fil uppladdad" });
    }

    try {
      const workbook = xlsx.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      const rawData = xlsx.utils.sheet_to_json(sheet, {
        defval: "",
        raw: false,
        cellDates: true
      });

      // 🔹 Ta bort helt tomma rader
      let filteredRows = rawData.filter(row =>
        Object.values(row).some(value => value !== "")
      );

      function excelDateToJSDate(serial) {
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
        return new Date(excelEpoch.getTime() + serial * 86400000);
      }

      // FIX: hämta kundordrar (ordersDB) FÖRST, så vi kan slå upp rätt
      // kundnamn per Ordernr innan tillverkningsorder-raderna sparas.
      // Om kundordern inte importerats än (eller Ordernr saknar match)
      // faller vi tillbaka på Excel-filens eget "Kund namn"-fält.
      ordersDB.find({}, (err, customerOrders) => {
        if (err) {
          return res.status(500).json({ error: "Kunde inte läsa kundordrar" });
        }

        const kundByOrdernr = new Map();
        customerOrders.forEach((o) => {
          const key = String(o.Ordernr || "").trim();
          if (key && !kundByOrdernr.has(key)) {
            kundByOrdernr.set(key, o.Kundnamn || o.Kund || "");
          }
        });

        // 🔹 Normalisera data
        filteredRows = filteredRows.map(row => {
          let levDatum = row["Lev. datum"];

          if (typeof levDatum === "number") {
            levDatum = excelDateToJSDate(levDatum);
          }

          if (levDatum instanceof Date) {
            levDatum.setHours(0, 0, 0, 0);
          } else {
            levDatum = null;
          }

          const ordernr = row["TO nr"];
          const matchedKund = kundByOrdernr.get(String(ordernr || "").trim());

          return {
            Ordernr: ordernr,
            // FIX: kundnamn från ordersDB (kundordrar) prioriteras;
            // Excel-filens "Kund namn" används bara som fallback.
            Kundnamn: matchedKund || "",
            Artikelnr: row["Artikel"],
            Benämning: row["Benämning"],
            Antal: Number(row["Ord kv"]) || 0,
            Vecka: row["Vecka"],
            Leveransdatum: row["Lev. datum"],
            Fras3axl: Number(row["3&4a"]) || 0,
            Fras5axl: Number(row["5ax"]) || 0,
            FrasStor: Number(row["Stor"] ?? row["stor"]) || 0,
            Svarv: Number(row["Svar"] ?? row["svar"]) || 0,
            Man: Number(row["Man"] ?? row["man"]) || 0,
            Div: Number(row["Div."] ?? row["div"]) || 0,
            ResTid: Number(row["Res.tid"]) || 0,
            importedAt: Date.now(),
            importedBy: req.user.name
          };
        });

        // 🔥 Ta bort rader med ogiltigt datum
        filteredRows = filteredRows.filter(row => {
          if (!row.Leveransdatum) return false;
          return !isNaN(new Date(row.Leveransdatum).getTime());
        });

        // 🔥 Töm och ersätt
        productionOrdersDB.remove({}, { multi: true }, () => {
          productionOrdersDB.insert(filteredRows, err => {
            if (err)
              return res.status(500).json({ error: "Kunde inte spara" });

            io.emit("productionOrdersUpdated");

            res.json({
              success: true,
              rowsImported: filteredRows.length
            });
          });
        });
      });

    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Fel vid läsning av Excel" });
    }
  }
);

app.get("/production-orders", requireAuth, (req, res) => {
  productionOrdersDB.find({ Leveransdatum: { $ne: null } })
    .sort({ Leveransdatum: 1 })
    .exec((err, docs) => {
      if (err)
        return res.status(500).json({ error: "Kunde inte läsa ordrar" });

      res.json(docs);
    });
});

/* ---------------- SERVE VITE BUILD ---------------- */
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));

	app.get(/^(?!\/api|\/uploads|\/docs|\/socket.io).*/, (req, res) => {
		res.sendFile(path.join(distDir, "index.html"));
	});
} else {
  console.warn("⚠️ dist/ saknas – kör `npm run build`");
}

/* ---------------- GRACEFUL SHUTDOWN ---------------- */

function shutdown(signal) {
  console.log(`\n${signal} mottagen. Stänger server...`);

  // FIX: set all users offline in DB before closing,
  // so presence is correct after a restart.
  presenceDB.update(
    {},
    { $set: { online: false } },
    { multi: true },
    (err) => {
      if (err) {
        console.error("Kunde inte nollställa online-status:", err);
      } else {
        console.log("Alla användare satta till offline.");
      }

      // Close HTTP server first (stop accepting new connections)
      server.close(() => {
        console.log("HTTP-server stängd");

        // Then close WebSocket server
        io.close(() => {
          console.log("WebSocket-server stängd");
          process.exit(0);
        });
      });
    }
  );

  // Force exit after 10s if something hangs
  setTimeout(() => {
    console.error("Tvingar process exit...");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

/* ---------------- START SERVER ---------------- */
server.listen(PORT, () =>
  console.log("Server (HTTP + WebSocket) körs på port", PORT)
);