import express from "express";
import Datastore from "nedb";
import cors from "cors";
import https from "http";
import { Server } from "socket.io";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import registerKpis from "./server/kpis.js";

// PORT: miljövariabel först, sedan (bakåtkompatibelt) src/config.local.js, annars 3000.
let PORT = Number(process.env.PORT) || 0;
if (!PORT) {
  try {
    ({ PORT } = await import("./src/config.local.js"));
  } catch {
    PORT = 3000;
  }
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET måste anges som en hemlig sträng på minst 32 tecken.");
}
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { load } from "cheerio"; // ESM-kompatibel

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Standardläge behåller projektets nuvarande katalogstruktur. Desktop-versionen
// anger PULSTAVLA_DATA_DIR så att all användardata hamnar utanför programfilerna.
const DATA_DIR = path.resolve(process.env.PULSTAVLA_DATA_DIR || process.cwd());
const DB_DIR = path.join(DATA_DIR, "db");
const uploadDir = path.join(DATA_DIR, "uploads");
const docsDir = path.join(DATA_DIR, "docs");
const distDir = path.join(__dirname, "dist");

for (const directory of [DB_DIR, uploadDir, docsDir]) {
  fs.mkdirSync(directory, { recursive: true });
}

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
// Radera tillfälliga uppladdningar när importens HTTP-svar är färdigt.
// Då hinner Excel-filen användas under hela importen, men blir inte kvar på servern.
function cleanupUploadAfterResponse(req, res, next) {
  const uploadedPath = req.file?.path;
  if (uploadedPath) {
    res.once("finish", () => {
      fs.unlink(uploadedPath, (err) => {
        if (err && err.code !== "ENOENT") {
          console.error("Kunde inte radera tillfällig importfil:", err);
        }
      });
    });
  }
  next();
}

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
      xls: header.subarray(0,8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1])),
      csv: !header.includes(0)
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
const kpiImportFileTypes = { xls:true, xlsx:true, csv:true };

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
  res.sendFile(path.join(__dirname, "docs", "logo.png"), (err) => {
    if (err && !res.headersSent) res.sendStatus(404);
  });
});

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token saknas" });
  }

  try {
    const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET);
    usersDB.findOne({ _id: decoded.id }, (err, user) => {
      if (err) return res.status(500).json({ error: "Kunde inte verifiera inloggningen." });
      if (!user || (decoded.tokenVersion || 0) !== (user.tokenVersion || 0)) {
        return res.status(401).json({ error: "Inloggningen har återkallats. Logga in igen." });
      }
      req.user = { ...decoded, username: user.username, name: user.name, role: user.role };
      next();
    });
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

function requireMeasuringControlAccess(req, res, next) {
  if (["admin", "suAdmin"].includes(req.user.role)) return next();
  settingsDB.findOne({ key: "measuringToolsControlUsers" }, (err, setting) => {
    if (err) return res.status(500).json({ error: "Kunde inte kontrollera behörigheten." });
    const allowedIds = Array.isArray(setting?.value) ? setting.value : [];
    if (!allowedIds.includes(req.user.id)) {
      return res.status(403).json({ error: "Du saknar behörighet att registrera kalibrering och kontroll." });
    }
    next();
  });
}

/* ---------------- HTTP SERVER + WEBSOCKET ---------------- */
const server = https.createServer(
  app
);

const io = new Server(server, {
  cors: { origin: "*" },
});

// Lägg autentiserade sockets i ett användarrum så att alla kan kopplas ned
// utan att hämta och iterera över samtliga sockets.
function disconnectUserSockets(userId) {
  try {
    io.in(`user:${userId}`).disconnectSockets(true);
    return true;
  } catch (err) {
    console.error("Kunde inte koppla ned användarens WebSocket-sessioner:", err);
    return false;
  }
}

// Alla WebSocket-anslutningar måste autentiseras med samma JWT som API:t.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Autentisering krävs"));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    usersDB.findOne({ _id: decoded.id }, (err, user) => {
      if (err || !user || (decoded.tokenVersion || 0) !== (user.tokenVersion || 0)) {
        return next(new Error("Inloggningen har återkallats"));
      }
      socket.user = { ...decoded, username: user.username, role: user.role };
      next();
    });
  } catch {
    next(new Error("Ogiltig token"));
  }
});

/* ---------------- USERS DATABASE ---------------- */
const usersDB = new Datastore({ filename: path.join(DB_DIR, "users.db"), autoload: true });
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
const presenceDB = new Datastore({ filename: path.join(DB_DIR, "presence.db"), autoload: true });
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
  filename: path.join(DB_DIR, "settings.db"),
  autoload: true,
});
settingsDB.persistence.setAutocompactionInterval(5 * 60 * 1000 + 60000);

/* ---------------- NOTIFICATIONS DATABASE ---------------- */
const notificationsDB = new Datastore({ filename: path.join(DB_DIR, "notifications.db"), autoload: true });
notificationsDB.persistence.setAutocompactionInterval(5 * 60 * 1000 + 65000);


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
  filename: path.join(DB_DIR, "orders.db"),
  autoload: true,
});
ordersDB.persistence.setAutocompactionInterval(5 * 60 * 1000 + 90000);

/* ---------------- TILLVERKNINGSORDER DATABASE ---------------- */
const productionOrdersDB = new Datastore({
  filename: path.join(DB_DIR, "productionOrders.db"),
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

/* ---------------- GENERELLA MEDDELANDEN / AVISERINGAR ---------------- */

// Hämta den inloggade användarens inkorg.
app.get("/notifications", requireAuth, (req, res) => {
  notificationsDB.find({ recipientId: req.user.id }).sort({ createdAt: -1 }).exec((err, messages) => {
    if (err) return res.status(500).json({ error: "Kunde inte läsa meddelanden." });
    res.json(messages);
  });
});

// Antal olästa meddelanden till menyindikatorn.
app.get("/notifications/unread-count", requireAuth, (req, res) => {
  notificationsDB.count({ recipientId: req.user.id, readAt: null }, (err, count) => {
    if (err) return res.status(500).json({ error: "Kunde inte läsa aviseringar." });
    res.json({ count });
  });
});

// Administratörer får en begränsad lista över mottagare.
app.get("/notifications/users", requireAuth, requireAdmin, (req, res) => {
  usersDB.find({}, (err, users) => {
    if (err) return res.status(500).json({ error: "Kunde inte läsa användare." });
    res.json(users.map(({ _id, username, name }) => ({ _id, username, name })));
  });
});

// Skicka ett internt meddelande till valda användare eller alla användare.
app.post("/notifications", requireAuth, requireAdmin, (req, res) => {
  const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
  const message = typeof req.body.message === "string" ? req.body.message.trim() : "";
  const priority = ["info", "important", "urgent"].includes(req.body.priority) ? req.body.priority : "info";
  const recipientIds = Array.isArray(req.body.recipientIds) ? [...new Set(req.body.recipientIds.filter((id) => typeof id === "string" && id))] : [];
  const sendToAll = req.body.sendToAll === true;

  if (!title || title.length > 120 || !message || message.length > 4000) {
    return res.status(400).json({ error: "Ange rubrik och meddelande (max 120 respektive 4000 tecken)." });
  }
  if (!sendToAll && recipientIds.length === 0) {
    return res.status(400).json({ error: "Välj minst en mottagare." });
  }

  const findRecipients = (callback) => {
    if (sendToAll) {
      usersDB.find({}, (err, users) => callback(err, users || []));
    } else {
      usersDB.find({ _id: { $in: recipientIds } }, (err, users) => callback(err, users || []));
    }
  };

  findRecipients((err, users) => {
    if (err) return res.status(500).json({ error: "Kunde inte hitta mottagare." });
    if (!users.length) return res.status(400).json({ error: "Inga giltiga mottagare hittades." });
    const createdAt = Date.now();
    const docs = users.map((recipient) => ({
      recipientId: recipient._id,
      title,
      message,
      priority,
      senderId: req.user.id,
      senderName: req.user.name || req.user.username,
      createdAt,
      readAt: null,
    }));
    notificationsDB.insert(docs, (insertErr, inserted) => {
      if (insertErr) return res.status(500).json({ error: "Kunde inte spara meddelandet." });
      res.status(201).json({ success: true, count: inserted.length });
    });
  });
});

// Markera ett meddelande som läst – endast mottagaren kan ändra det.
app.patch("/notifications/:id/read", requireAuth, (req, res) => {
  notificationsDB.update(
    { _id: req.params.id, recipientId: req.user.id, readAt: null },
    { $set: { readAt: Date.now() } },
    {},
    (err, changed) => {
      if (err) return res.status(500).json({ error: "Kunde inte uppdatera meddelandet." });
      if (!changed) return res.status(404).json({ error: "Meddelandet hittades inte eller är redan läst." });
      res.json({ success: true });
    }
  );
});

app.patch("/notifications/read-all", requireAuth, (req, res) => {
  notificationsDB.update(
    { recipientId: req.user.id, readAt: null },
    { $set: { readAt: Date.now() } },
    { multi: true },
    (err, changed) => {
      if (err) return res.status(500).json({ error: "Kunde inte uppdatera meddelandena." });
      res.json({ success: true, count: changed });
    }
  );
});

// Mottagaren kan endast radera sina egna meddelanden som redan är lästa.
app.delete("/notifications/read", requireAuth, (req, res) => {
  notificationsDB.remove(
    { recipientId: req.user.id, readAt: { $ne: null } },
    { multi: true },
    (err, removed) => {
      if (err) return res.status(500).json({ error: "Kunde inte ta bort lästa meddelanden." });
      res.json({ success: true, count: removed });
    }
  );
});

app.delete("/notifications/:id", requireAuth, (req, res) => {
  notificationsDB.remove(
    { _id: req.params.id, recipientId: req.user.id, readAt: { $ne: null } },
    {},
    (err, removed) => {
      if (err) return res.status(500).json({ error: "Kunde inte ta bort meddelandet." });
      if (!removed) return res.status(404).json({ error: "Meddelandet hittades inte eller är inte läst." });
      res.json({ success: true });
    }
  );
});

// Endpoint för att lista dokumenten
app.get("/documents", requireAuth, (req, res) => {
  const dir = docsDir;

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
        url: `/documents/${encodeURIComponent(file.name)}`
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "sv"));

    res.json(documents);
  });
});

app.get("/uploads/:name", requireAuth, (req, res) => {
  const fileName = path.basename(req.params.name);
  if (!fileName || fileName !== req.params.name) return res.sendStatus(400);
  res.sendFile(fileName, { root: uploadDir, dotfiles: "deny" }, (err) => {
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
      // Busboy tolkar multipart-filnamn som Latin-1 som standard.
      // Webbläsare skickar UTF-8-bytes, så avkoda innan filen sparas.
      const originalName = Buffer.from(file.originalname, "latin1").toString("utf8");
      cb(null, path.basename(originalName));
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
  const filePath = path.join(docsDir, fileName);
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
  if (!/^lunch-current\.(webp|jpg|jpeg|png)$/i.test(name)) return res.sendStatus(404);
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
const db = new Datastore({ filename: path.join(DB_DIR, "greenCross.db"), autoload: true });
db.persistence.setAutocompactionInterval(5 * 60 * 1000 + 150000);

/* ---------------- ACTIVITIES DATABASE ---------------- */
const activitiesDB = new Datastore({ filename: path.join(DB_DIR, "activities.db"), autoload: true });
activitiesDB.persistence.setAutocompactionInterval(5 * 60 * 1000 + 180000);

// Skicka en engångsavisering när en ansvarigs aktivitet passerar deadline.
// Ansvarig i aktivitetsmodellen lagras som användarens visningsnamn.
let checkingOverdueActivities = false;
function notifyOverdueActivities() {
  if (checkingOverdueActivities) return;
  checkingOverdueActivities = true;

  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  activitiesDB.find({
    done: { $ne: true },
    deadline: { $exists: true, $ne: "" },
    responsible: { $exists: true, $ne: "" },
  }, (activityErr, activities) => {
    if (activityErr) {
      console.error("Kunde inte kontrollera aktivitetsdeadlines:", activityErr);
      checkingOverdueActivities = false;
      return;
    }

    let pending = activities.length;
    if (!pending) {
      checkingOverdueActivities = false;
      return;
    }

    const finishOne = () => {
      pending -= 1;
      if (pending === 0) checkingOverdueActivities = false;
    };

    activities.forEach((activity) => {
      const deadline = String(activity.deadline || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || deadline >= today) {
        finishOne();
        return;
      }

      usersDB.findOne({ name: activity.responsible }, (userErr, responsibleUser) => {
        if (userErr || !responsibleUser) {
          if (userErr) console.error("Kunde inte hitta ansvarig för aktivitet:", userErr);
          finishOne();
          return;
        }

        const previousNotice = activity.overdueNotification;
        if (
          previousNotice?.deadline === deadline &&
          previousNotice?.recipientId === responsibleUser._id
        ) {
          finishOne();
          return;
        }

        const createdAt = Date.now();
        const dateLabel = new Date(deadline + "T00:00:00").toLocaleDateString("sv-SE", {
          timeZone: "Europe/Stockholm",
        });
        const notification = {
          recipientId: responsibleUser._id,
          title: "Deadline passerad – aktivitet ej klar",
          message: `Aktiviteten "${activity.title}" har passerat sin deadline (${dateLabel}) och är fortfarande inte markerad som klar. Vänligen gå in under Aktiviteter och uppdatera statusen.`,
          priority: "important",
          senderId: null,
          senderName: "Pulstavla",
          createdAt,
          readAt: null,
          source: "activity-deadline",
          activityId: activity._id,
        };

        notificationsDB.insert(notification, (insertErr) => {
          if (insertErr) {
            console.error("Kunde inte skicka deadlineavisering:", insertErr);
            finishOne();
            return;
          }

          activitiesDB.update(
            { _id: activity._id },
            { $set: { overdueNotification: { deadline, recipientId: responsibleUser._id, sentAt: createdAt } } },
            {},
            (updateErr) => {
              if (updateErr) console.error("Kunde inte spara status för deadlineavisering:", updateErr);
              finishOne();
            }
          );
        });
      });
    });
  });
}

// Kontrollera direkt vid serverstart och därefter en gång i timmen.
notifyOverdueActivities();
setInterval(notifyOverdueActivities, 60 * 60 * 1000);

/* ---------------- WIDGETS DATABASE ---------------- */
const widgetsDB = new Datastore({filename: path.join(DB_DIR, "widgets.db"), autoload: true });
widgetsDB.persistence.setAutocompactionInterval(5 * 60 * 1000 + 210000);

/* ---------------- STRUCTURED WIDGETS DATABASE ---------------- */
const structuredWidgetsDB = new Datastore({
  filename: path.join(DB_DIR, "structuredWidgets.db"),
  autoload: true,
});
structuredWidgetsDB.persistence.setAutocompactionInterval(5 * 60 * 1000 + 240000);

/* ---------------- MÄTPROTOKOLL DATABASE ---------------- */
// Sparade mätprotokoll (Matprotokoll.jsx). Nya protokoll får unika ID:n
// så flera protokoll kan finnas för samma order och artikel. Äldre poster
// med order_artikel-ID fortsätter att kunna öppnas och uppdateras.
const matprotokollDB = new Datastore({
  filename: path.join(DB_DIR, "matprotokoll.db"),
  autoload: true,
});
matprotokollDB.persistence.setAutocompactionInterval(5 * 60 * 1000 + 260000);

/* ---------------- MÄTVERKTYG DATABASE ---------------- */
const measuringToolsDB = new Datastore({ filename: path.join(DB_DIR, "measuringTools.db"), autoload: true });
measuringToolsDB.persistence.setAutocompactionInterval(5 * 60 * 1000 + 270000);

/* ---------------- AUTOMATISKA MÄTVERKTYGSAVISERINGAR ---------------- */

// Kalenderdatum i svensk tidszon, oberoende av serverns lokala tidszon.
function measuringToolsToday() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function measuringToolDateDiffDays(fromDate, toDate) {
  const from = String(fromDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const to = String(toDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!from || !to) return null;
  const fromUtc = Date.UTC(Number(from[1]), Number(from[2]) - 1, Number(from[3]));
  const toUtc = Date.UTC(Number(to[1]), Number(to[2]) - 1, Number(to[3]));
  return Math.round((toUtc - fromUtc) / 86400000);
}

function measuringToolNextControlDate(tool) {
  if (!tool?.lastControlDate || !Number(tool.controlInterval)) return "";
  const match = String(tool.lastControlDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(Date.UTC(
    Number(match[1]), Number(match[2]) - 1,
    Number(match[3]) + Number(tool.controlInterval)
  ));
  return date.toISOString().slice(0, 10);
}

function insertMeasuringToolNoticeOnce(recipientId, sourceKey, title, message, priority = "important") {
  if (!recipientId) return;
  notificationsDB.findOne({ sourceKey }, (findErr, existing) => {
    if (findErr) {
      console.error("Kunde inte kontrollera tidigare mätverktygsavisering:", findErr);
      return;
    }
    if (existing) return;
    notificationsDB.insert({
      recipientId, sourceKey, title, message, priority,
      senderId: null, senderName: "Pulstavla",
      createdAt: Date.now(), readAt: null, source: "measuring-tool",
    }, (insertErr) => {
      if (insertErr) console.error("Kunde inte skapa mätverktygsavisering:", insertErr);
    });
  });
}

let checkingMeasuringToolNotices = false;
function notifyMeasuringToolEvents() {
  if (checkingMeasuringToolNotices) return;
  checkingMeasuringToolNotices = true;

  const today = measuringToolsToday();
  settingsDB.findOne({ key: "measuringToolsControlUsers" }, (settingsErr, setting) => {
    if (settingsErr) {
      console.error("Kunde inte läsa kontrollbehörigheter för aviseringar:", settingsErr);
      checkingMeasuringToolNotices = false;
      return;
    }

    const configuredIds = Array.isArray(setting?.value) ? setting.value : [];
    usersDB.find({ role: "suAdmin" }, (suErr, suAdmins) => {
      if (suErr) {
        console.error("Kunde inte läsa suAdmin för mätverktygsaviseringar:", suErr);
        checkingMeasuringToolNotices = false;
        return;
      }
      const controlRecipientIds = [...new Set([
        ...configuredIds,
        ...suAdmins.map((user) => user._id),
      ])];

      measuringToolsDB.find({}, (toolsErr, tools) => {
        if (toolsErr) {
          console.error("Kunde inte läsa mätverktyg för aviseringar:", toolsErr);
          checkingMeasuringToolNotices = false;
          return;
        }

        tools.forEach((tool) => {
          if (["Skrotad", "Saknad"].includes(tool.status)) return;
          const nextControlDate = measuringToolNextControlDate(tool);
          if (nextControlDate) {
            const daysUntilControl = measuringToolDateDiffDays(today, nextControlDate);
            const dateLabel = new Date(nextControlDate + "T12:00:00Z").toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
            const message = `Mätverktyg ${tool.toolNumber} – ${tool.description || tool.type} behöver lämnas till kontrollansvarig. Nästa kontrolldatum: ${dateLabel}.`;

            // Engångsavisering för varje redan förfallet verktyg och mottagare.
            // Nyckeln innehåller kontrolldatum så en ny kontrollperiod kan avisera igen.
            if (daysUntilControl !== null && daysUntilControl < 0) {
              controlRecipientIds.forEach((recipientId) => {
                insertMeasuringToolNoticeOnce(
                  recipientId,
                  `measuring-tool:${tool._id}:control-overdue-initial:${nextControlDate}:${recipientId}`,
                  `Förfallen kontroll: mätverktyg ${tool.toolNumber}`,
                  message
                );
              });
              if (tool.reservation?.userId) {
                insertMeasuringToolNoticeOnce(
                  tool.reservation.userId,
                  `measuring-tool:${tool._id}:control-overdue-initial:${nextControlDate}:reserved:${tool.reservation.userId}`,
                  `Förfallen kontroll: reserverat mätverktyg ${tool.toolNumber}`,
                  message
                );
              }
              if (tool.activeLoan?.borrowerId) {
                insertMeasuringToolNoticeOnce(
                  tool.activeLoan.borrowerId,
                  `measuring-tool:${tool._id}:control-overdue-initial:${nextControlDate}:borrowed:${tool.activeLoan.borrowerId}`,
                  `Förfallen kontroll: lånat mätverktyg ${tool.toolNumber}`,
                  `Mätverktyg ${tool.toolNumber} (${tool.description || tool.type}) som du har lånat behöver lämnas till kontrollansvarig. Nästa kontrolldatum: ${dateLabel}.`
                );
              }
            }

            let eventType = "";
            let eventLabel = "";
            if (daysUntilControl === 7) {
              eventType = "control-upcoming";
              eventLabel = "Kontroll närmar sig";
            } else if (daysUntilControl === 0) {
              eventType = "control-due";
              eventLabel = "Kontroll ska utföras idag";
            } else if (daysUntilControl !== null && daysUntilControl < 0 && Math.abs(daysUntilControl) > 1 && (Math.abs(daysUntilControl) - 1) % 7 === 0) {
              eventType = "control-overdue";
              eventLabel = "Kontroll försenad";
            }

            if (eventType) {
              const dateLabel = new Date(nextControlDate + "T12:00:00Z").toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
              const message = `Mätverktyg ${tool.toolNumber} – ${tool.description || tool.type} behöver lämnas till kontrollansvarig. Nästa kontrolldatum: ${dateLabel}.`;
              controlRecipientIds.forEach((recipientId) => {
                insertMeasuringToolNoticeOnce(
                  recipientId,
                  `measuring-tool:${tool._id}:${eventType}:${nextControlDate}:${recipientId}`,
                  `${eventLabel}: mätverktyg ${tool.toolNumber}`,
                  message
                );
              });
              if (tool.reservation?.userId) {
                insertMeasuringToolNoticeOnce(
                  tool.reservation.userId,
                  `measuring-tool:${tool._id}:${eventType}:${nextControlDate}:reserved:${tool.reservation.userId}`,
                  `${eventLabel}: reserverat mätverktyg ${tool.toolNumber}`,
                  message
                );
              }
              if (tool.activeLoan?.borrowerId) {
                insertMeasuringToolNoticeOnce(
                  tool.activeLoan.borrowerId,
                  `measuring-tool:${tool._id}:${eventType}:${nextControlDate}:borrowed:${tool.activeLoan.borrowerId}`,
                  `${eventLabel}: lånat mätverktyg ${tool.toolNumber}`,
                  `Mätverktyg ${tool.toolNumber} (${tool.description || tool.type}) som du har lånat behöver lämnas till kontrollansvarig. Nästa kontrolldatum: ${dateLabel}.`
                );
              }
            }
          }

          const loan = tool.activeLoan;
          const dueDate = String(loan?.dueDate || "").slice(0, 10);
          if (loan?.borrowerId && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && dueDate < today) {
            const dateLabel = new Date(dueDate + "T12:00:00Z").toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
            insertMeasuringToolNoticeOnce(
              loan.borrowerId,
              `measuring-tool:${tool._id}:loan-overdue:${dueDate}:${loan.borrowerId}`,
              `Försenad återlämning: mätverktyg ${tool.toolNumber}`,
              `Återlämningsdatum för mätverktyg ${tool.toolNumber} (${tool.description || tool.type}) passerade ${dateLabel}. Vänligen lämna tillbaka verktyget.`
            );
          }
        });

        checkingMeasuringToolNotices = false;
      });
    });
  });
}

// Kör vid serverstart och därefter varje timme.
notifyMeasuringToolEvents();
setInterval(notifyMeasuringToolEvents, 60 * 60 * 1000);

/* ---------------- MÄTVERKTYG ENDPOINTS ---------------- */

// Beräkna om nästa kontroll passerat. Datum hanteras som kalenderdatum i UTC.
function isMeasuringToolControlOverdue(tool) {
  if (!tool?.lastControlDate || !Number(tool.controlInterval)) return false;
  const match = String(tool.lastControlDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const nextDate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(tool.controlInterval)));
  const today = new Date();
  const todayDate = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return nextDate.getTime() < todayDate;
}

// Publik utlåning via /lanamatverktyg. Anställningsnummer verifieras mot användarregistret.
const publicLoanAttempts = new Map();
function allowPublicLoanAttempt(key) {
  const now = Date.now();
  const recent = (publicLoanAttempts.get(key) || []).filter((time) => now - time < 10 * 60 * 1000);
  if (recent.length >= 8) return false;
  recent.push(now);
  publicLoanAttempts.set(key, recent);
  return true;
}

app.get("/public/measuring-tools", (req, res) => {
  measuringToolsDB.find({}).sort({ toolNumber: 1 }).exec((err, tools) => {
    if (err) return res.status(500).json({ error: "Kunde inte läsa verktygsregistret." });
    const publicTools = tools
      .filter((tool) => {
        const blocked = Boolean(tool.controlBlocked || isMeasuringToolControlOverdue(tool));
        const borrowed = tool.status === "Utlånad" || Boolean(tool.activeLoan);
        const available = tool.status === "Disponibel" && !tool.activeLoan && !tool.reservation && !blocked;
        return available || borrowed;
      })
      .map((tool) => ({
        _id: tool._id,
        toolNumber: tool.toolNumber,
        type: tool.type,
        description: tool.description,
        manufacturer: tool.manufacturer || "",
        range: tool.range || "",
        location: tool.location || "",
        borrowerName: tool.activeLoan?.borrowerName || "",
        status: tool.activeLoan || tool.status === "Utlånad" ? "Utlånad" : "Disponibel",
      }));
    res.set("Cache-Control", "no-store");
    res.json(publicTools);
  });
});

app.post("/public/measuring-tools/:id/checkout", (req, res) => {
  const employeeNumber = String(req.body?.employeeNumber || "").trim();
  const attemptKey = String(req.ip || "unknown");
  if (!employeeNumber || employeeNumber.length > 40) {
    return res.status(400).json({ error: "Ange ett giltigt anställningsnummer." });
  }
  if (!allowPublicLoanAttempt(attemptKey)) {
    return res.status(429).json({ error: "För många försök. Vänta en stund och försök igen." });
  }
  usersDB.findOne({ employeeNumber }, (userErr, borrower) => {
    if (userErr) return res.status(500).json({ error: "Kunde inte kontrollera anställningsnumret." });
    if (!borrower || borrower.role === "view") {
      return res.status(400).json({ error: "Anställningsnumret kunde inte verifieras." });
    }
    measuringToolsDB.findOne({ _id: req.params.id }, (toolErr, tool) => {
      if (toolErr) return res.status(500).json({ error: "Kunde inte läsa verktyget." });
      if (!tool) return res.status(404).json({ error: "Verktyget hittades inte." });
      if (tool.controlBlocked || isMeasuringToolControlOverdue(tool)) {
        return res.status(409).json({ error: "Verktyget är spärrat och kan inte lånas ut." });
      }
      if (tool.status !== "Disponibel" || tool.activeLoan || tool.reservation) {
        return res.status(409).json({ error: "Verktyget är inte längre ledigt." });
      }
      const checkedOutAt = Date.now();
      const loan = {
        borrowerId: borrower._id,
        borrowerName: borrower.name || borrower.username,
        borrowerUsername: borrower.username,
        checkedOutAt,
        dueDate: "",
        checkedOutBy: "public",
        checkedOutByName: "Publik lånesida",
        note: "",
      };
      measuringToolsDB.update({
        _id: tool._id,
        status: "Disponibel",
        activeLoan: null,
        controlBlocked: { $ne: true },
        $or: [{ reservation: { $exists: false } }, { reservation: null }],
      }, {
        $set: { status: "Utlånad", activeLoan: loan, updatedAt: checkedOutAt },
        $push: { loanHistory: { ...loan, action: "checkout" } },
      }, {}, (updateErr, count) => {
        if (updateErr) return res.status(500).json({ error: "Kunde inte registrera utlåningen." });
        if (!count) return res.status(409).json({ error: "Verktyget hann lånas ut av någon annan." });
        io.emit("measuringToolsUpdated");
        res.json({ success: true });
      });
    });
  });
});

app.post("/public/measuring-tools/:id/return", (req, res) => {
  const employeeNumber = String(req.body?.employeeNumber || "").trim();
  const attemptKey = String(req.ip || "unknown");
  if (!employeeNumber || employeeNumber.length > 40) {
    return res.status(400).json({ error: "Ange ett giltigt anställningsnummer." });
  }
  if (!allowPublicLoanAttempt(attemptKey)) {
    return res.status(429).json({ error: "För många försök. Vänta en stund och försök igen." });
  }
  usersDB.findOne({ employeeNumber }, (userErr, borrower) => {
    if (userErr) return res.status(500).json({ error: "Kunde inte kontrollera anställningsnumret." });
    if (!borrower || borrower.role === "view") {
      return res.status(400).json({ error: "Anställningsnumret kunde inte verifieras." });
    }
    measuringToolsDB.findOne({ _id: req.params.id }, (toolErr, tool) => {
      if (toolErr) return res.status(500).json({ error: "Kunde inte läsa verktyget." });
      if (!tool || !tool.activeLoan) return res.status(404).json({ error: "Ingen aktiv utlåning hittades." });
      if (tool.activeLoan.borrowerId !== borrower._id) {
        return res.status(403).json({ error: "Anställningsnumret stämmer inte med låntagaren." });
      }
      const returnedAt = Date.now();
      const returnEntry = {
        ...tool.activeLoan,
        action: "return",
        returnedAt,
        returnedBy: borrower._id,
        returnedByName: borrower.name || borrower.username,
        returnNote: "",
      };
      measuringToolsDB.update({
        _id: tool._id,
        "activeLoan.borrowerId": borrower._id,
      }, {
        $set: { status: "Disponibel", activeLoan: null, updatedAt: returnedAt },
        $push: { loanHistory: returnEntry },
      }, {}, (updateErr, count) => {
        if (updateErr) return res.status(500).json({ error: "Kunde inte registrera återlämningen." });
        if (!count) return res.status(409).json({ error: "Utlåningen har redan ändrats." });
        io.emit("measuringToolsUpdated");
        res.json({ success: true });
      });
    });
  });
});

// Lista verktyg och aktuell utlåning. Förfallen kontroll ger automatisk spärr.
app.get("/measuring-tools", requireAuth, (req, res) => {
  measuringToolsDB.find({}).sort({ toolNumber: 1 }).exec((err, tools) => {
    if (err) return res.status(500).json({ error: "Kunde inte läsa verktygsregistret." });
    res.json(tools.map(({ loanHistory, controlHistory, ...tool }) => ({
      ...tool,
      controlBlocked: Boolean(tool.controlBlocked || isMeasuringToolControlOverdue(tool)),
      controlBlockReason: isMeasuringToolControlOverdue(tool) ? "Förfallen kontroll" : (tool.controlBlocked ? "Underkänd kontroll" : ""),
    })));
  });
});

// Lista aktiva användarkonton utan känsliga uppgifter för val vid utlåning och reservation.
app.get("/measuring-tools/users", requireAuth, requireMeasuringControlAccess, (req, res) => {
  usersDB.find({}, (err, docs) => {
    if (err) return res.status(500).json({ error: "Kunde inte läsa användare." });
    res.json(docs.filter(({ role }) => role !== "view").map(({ _id, username, name, role }) => ({ _id, username, name, role })));
  });
});

// Returnera den inloggade användarens kontrollbehörighet. Endast admin får se hela listan.
app.get("/measuring-tools/control-access", requireAuth, (req, res) => {
  settingsDB.findOne({ key: "measuringToolsControlUsers" }, (err, setting) => {
    if (err) return res.status(500).json({ error: "Kunde inte läsa behörigheterna." });
    const userIds = Array.isArray(setting?.value) ? setting.value : [];
    const isAdmin = ["admin", "suAdmin"].includes(req.user.role);
    res.json({
      userIds: isAdmin ? userIds : [],
      canRegister: isAdmin || userIds.includes(req.user.id),
    });
  });
});

app.put("/measuring-tools/control-access", requireAuth, requireAdmin, (req, res) => {
  const userIds = Array.isArray(req.body?.userIds)
    ? [...new Set(req.body.userIds.map((id) => String(id)))]
    : null;
  if (!userIds || userIds.length > 500) {
    return res.status(400).json({ error: "Ogiltig användarlista." });
  }
  usersDB.find({ _id: { $in: userIds } }, (findErr, users) => {
    if (findErr) return res.status(500).json({ error: "Kunde inte kontrollera användarna." });
    if (users.length !== userIds.length) {
      return res.status(400).json({ error: "En eller flera valda användare finns inte längre." });
    }
    settingsDB.update(
      { key: "measuringToolsControlUsers" },
      { $set: { key: "measuringToolsControlUsers", value: userIds, updatedAt: Date.now() } },
      { upsert: true },
      (updateErr) => {
        if (updateErr) return res.status(500).json({ error: "Kunde inte spara behörigheterna." });
        res.json({ success: true, userIds });
      }
    );
  });
});

// Lägg till eller uppdatera verktyg manuellt.
app.post("/measuring-tools", requireAuth, requireMeasuringControlAccess, (req, res) => {
  const input = req.body || {};
  const toolNumber = String(input.toolNumber || "").trim();
  const type = String(input.type || "").trim();
  const description = String(input.description || "").trim();
  if (!toolNumber || !type || !description) {
    return res.status(400).json({ error: "Verktygsnr, typ och benämning måste anges." });
  }
  const doc = {
    toolNumber, type, description,
    manufacturer: String(input.manufacturer || "").trim(),
    range: String(input.range || "").trim(),
    location: String(input.location || "").trim(),
    controlInterval: Math.max(0, Number(input.controlInterval) || 0),
    lastControlDate: input.lastControlDate || "",
    status: "Disponibel",
    activeLoan: null,
    loanHistory: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  measuringToolsDB.findOne({ toolNumber }, (findErr, existing) => {
    if (findErr) return res.status(500).json({ error: "Kunde inte kontrollera verktygsnumret." });
    if (existing) return res.status(409).json({ error: "Verktygsnumret finns redan." });
    measuringToolsDB.insert(doc, (insertErr, saved) => {
      if (insertErr) return res.status(500).json({ error: "Kunde inte spara verktyget." });
      io.emit("measuringToolsUpdated");
      res.status(201).json(saved);
    });
  });
});

// Redigera verktygsuppgifter utan att påverka utlånings- eller kontrollhistorik.
app.patch("/measuring-tools/:id", requireAuth, requireMeasuringControlAccess, (req, res) => {
  const input = req.body || {};
  const toolNumber = String(input.toolNumber || "").trim();
  const type = String(input.type || "").trim();
  const description = String(input.description || "").trim();
  if (!toolNumber || !type || !description) {
    return res.status(400).json({ error: "Verktygsnr, typ och benämning måste anges." });
  }
  const fields = {
    toolNumber, type, description,
    manufacturer: String(input.manufacturer || "").trim(),
    range: String(input.range || "").trim(),
    location: String(input.location || "").trim(),
    controlInterval: Math.max(0, Number(input.controlInterval) || 0),
    updatedAt: Date.now(),
  };
  if (input.lastControlDate !== undefined) fields.lastControlDate = String(input.lastControlDate || "");
  measuringToolsDB.findOne({ toolNumber, _id: { $ne: req.params.id } }, (findErr, duplicate) => {
    if (findErr) return res.status(500).json({ error: "Kunde inte kontrollera verktygsnumret." });
    if (duplicate) return res.status(409).json({ error: "Verktygsnumret används redan av ett annat verktyg." });
    measuringToolsDB.update({ _id: req.params.id }, { $set: fields }, {}, (updateErr, count) => {
      if (updateErr) return res.status(500).json({ error: "Kunde inte uppdatera verktyget." });
      if (!count) return res.status(404).json({ error: "Verktyget hittades inte." });
      io.emit("measuringToolsUpdated");
      res.json({ success: true });
    });
  });
});

// Registrera kalibrering eller kontroll. Åtkomst ges till administratörer och särskilt valda användare.
app.post("/measuring-tools/:id/control", requireAuth, requireMeasuringControlAccess, (req, res) => {
  const type = String(req.body?.type || "");
  const date = String(req.body?.date || "");
  const result = String(req.body?.result || "");
  const allowedTypes = ["Kalibrering", "Kontroll"];
  const allowedResults = ["Godkänd", "Underkänd", "Justerad", "Skrotad", "Saknad"];
  if (!allowedTypes.includes(type) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !allowedResults.includes(result)) {
    return res.status(400).json({ error: "Ange typ, giltigt datum och resultat." });
  }
  const entry = {
    action: "control", type, date, result,
    comment: String(req.body?.comment || "").trim(),
    performedBy: req.user.id,
    performedByName: req.user.name || req.user.username,
    recordedAt: Date.now(),
  };
  const terminalStatus = ["Skrotad", "Saknad"].includes(result) ? result : null;
  measuringToolsDB.findOne({ _id: req.params.id }, (findErr, tool) => {
    if (findErr) return res.status(500).json({ error: "Kunde inte läsa verktyget." });
    if (!tool) return res.status(404).json({ error: "Verktyget hittades inte." });
    if (terminalStatus && tool.activeLoan) {
      return res.status(409).json({ error: "Återlämna verktyget innan det kan markeras som skrotat eller saknat." });
    }
    measuringToolsDB.update({ _id: req.params.id }, {
      $set: {
        lastControlDate: date,
        controlBlocked: result !== "Godkänd",
        // En ny kontroll kan återaktivera ett tidigare skrotat eller saknat verktyg.
        // Underkänd kontroll återställer statusen men behåller utlåningsspärren.
        status: terminalStatus || (["Skrotad", "Saknad"].includes(tool.status) ? "Disponibel" : tool.status),
        updatedAt: Date.now(),
      },
      $push: { controlHistory: entry },
    }, {}, (updateErr, count) => {
      if (updateErr) return res.status(500).json({ error: "Kunde inte spara kontrollen." });
      if (!count) return res.status(404).json({ error: "Verktyget hittades inte." });
      io.emit("measuringToolsUpdated");
      res.json({ success: true });
    });
  });
});

// Låntagaren lånar som standard sig själv. Admin kan välja annat befintligt konto.
app.post("/measuring-tools/:id/checkout", requireAuth, requireEditor, (req, res) => {
  const borrowerId = (["admin", "suAdmin"].includes(req.user.role) && req.body?.borrowerId)
    ? String(req.body.borrowerId) : req.user.id;
  usersDB.findOne({ _id: borrowerId }, (userErr, borrower) => {
    if (userErr || !borrower) return res.status(400).json({ error: "Användaren hittades inte." });
    measuringToolsDB.findOne({ _id: req.params.id }, (toolErr, tool) => {
      if (toolErr) return res.status(500).json({ error: "Kunde inte läsa verktyget." });
      if (!tool) return res.status(404).json({ error: "Verktyget hittades inte." });
      if (tool.controlBlocked || isMeasuringToolControlOverdue(tool)) return res.status(409).json({ error: isMeasuringToolControlOverdue(tool) ? "Verktyget är spärrat eftersom datumet för nästa kontroll har passerat." : "Verktyget är spärrat efter underkänd kontroll och kan inte lånas ut." });
      if (tool.status !== "Disponibel" || tool.activeLoan) return res.status(409).json({ error: "Verktyget är inte tillgängligt." });
      if (tool.reservation && tool.reservation.userId !== borrower._id) {
        return res.status(409).json({ error: `Verktyget är reserverat för ${tool.reservation.userName}.` });
      }
      const loan = {
        borrowerId: borrower._id, borrowerName: borrower.name || borrower.username,
        borrowerUsername: borrower.username, checkedOutAt: Date.now(),
        dueDate: req.body?.dueDate || "", checkedOutBy: req.user.id,
        checkedOutByName: req.user.name || req.user.username,
        note: String(req.body?.note || "").trim(),
      };
      measuringToolsDB.update({
        _id: tool._id,
        status: "Disponibel",
        activeLoan: null,
        controlBlocked: { $ne: true },
      }, {
        $set: { status: "Utlånad", activeLoan: loan, updatedAt: Date.now() },
        $push: { loanHistory: { ...loan, action: "checkout" } },
      }, {}, (updateErr, count) => {
        if (updateErr) return res.status(500).json({ error: "Kunde inte registrera utlåningen." });
        if (!count) return res.status(409).json({ error: "Verktyget hann lånas ut av någon annan." });
        io.emit("measuringToolsUpdated");
        res.json({ success: true });
      });
    });
  });
});

// Reservera ett ledigt mätverktyg tills vidare. Alla användare med redigeringsbehörighet kan välja valfritt användarkonto.
app.post("/measuring-tools/:id/reserve", requireAuth, requireMeasuringControlAccess, (req, res) => {
  const userId = req.body?.userId ? String(req.body.userId) : req.user.id;
  usersDB.findOne({ _id: userId }, (userErr, user) => {
    if (userErr || !user) return res.status(400).json({ error: "Användaren hittades inte." });
    if (user.role === "view") return res.status(403).json({ error: "Reservation kan endast göras för en behörig användare." });
    measuringToolsDB.findOne({ _id: req.params.id }, (toolErr, tool) => {
      if (toolErr) return res.status(500).json({ error: "Kunde inte läsa verktyget." });
      if (!tool) return res.status(404).json({ error: "Verktyget hittades inte." });
      if (tool.status !== "Disponibel" || tool.activeLoan) return res.status(409).json({ error: "Endast lediga verktyg kan reserveras." });
      if (tool.controlBlocked || isMeasuringToolControlOverdue(tool)) return res.status(409).json({ error: "Verktyget är spärrat och kan inte reserveras." });
      if (tool.reservation) return res.status(409).json({ error: `Verktyget är redan reserverat för ${tool.reservation.userName}.` });
      const reservation = {
        userId: user._id, userName: user.name || user.username,
        username: user.username, reservedAt: Date.now(),
        reservedBy: req.user.id, reservedByName: req.user.name || req.user.username,
      };
      measuringToolsDB.update({
        _id: tool._id,
        status: "Disponibel",
        $or: [
          { reservation: { $exists: false } },
          { reservation: null },
        ],
      }, {
        $set: { reservation, updatedAt: Date.now() },
        $push: { reservationHistory: { ...reservation, action: "reserve" } },
      }, {}, (updateErr, count) => {
        if (updateErr) return res.status(500).json({ error: "Kunde inte reservera verktyget." });
        if (!count) return res.status(409).json({ error: "Verktyget hann reserveras eller ändras av någon annan." });
        io.emit("measuringToolsUpdated");
        res.json({ success: true, reservation });
      });
    });
  });
});

// Användare med behörighet för mätverktyg kan häva reservationer.
app.delete("/measuring-tools/:id/reserve", requireAuth, requireMeasuringControlAccess, (req, res) => {
  measuringToolsDB.findOne({ _id: req.params.id }, (findErr, tool) => {
    if (findErr) return res.status(500).json({ error: "Kunde inte läsa verktyget." });
    if (!tool?.reservation) return res.status(404).json({ error: "Ingen aktiv reservation hittades." });
    const releasedAt = Date.now();
    const entry = {
      ...tool.reservation, action: "release", releasedAt,
      releasedBy: req.user.id, releasedByName: req.user.name || req.user.username,
    };
    measuringToolsDB.update({ _id: tool._id, "reservation.userId": tool.reservation.userId }, {
      $set: { reservation: null, updatedAt: releasedAt },
      $push: { reservationHistory: entry },
    }, {}, (updateErr, count) => {
      if (updateErr) return res.status(500).json({ error: "Kunde inte häva reservationen." });
      if (!count) return res.status(409).json({ error: "Reservationen har redan ändrats." });
      io.emit("measuringToolsUpdated");
      res.json({ success: true });
    });
  });
});

// Återlämning får registreras av låntagaren eller administratör.
app.post("/measuring-tools/:id/return", requireAuth, requireEditor, (req, res) => {
  measuringToolsDB.findOne({ _id: req.params.id }, (findErr, tool) => {
    if (findErr) return res.status(500).json({ error: "Kunde inte läsa verktyget." });
    if (!tool || !tool.activeLoan) return res.status(404).json({ error: "Ingen aktiv utlåning hittades." });
    const isAdmin = ["admin", "suAdmin"].includes(req.user.role);
    if (!isAdmin && tool.activeLoan.borrowerId !== req.user.id) {
      return res.status(403).json({ error: "Endast låntagaren eller administratör kan registrera återlämning." });
    }
    const returnedAt = Date.now();
    const returnEntry = {
      ...tool.activeLoan, action: "return", returnedAt,
      returnedBy: req.user.id, returnedByName: req.user.name || req.user.username,
      returnNote: String(req.body?.note || "").trim(),
    };
    measuringToolsDB.update({ _id: tool._id, "activeLoan.borrowerId": tool.activeLoan.borrowerId }, {
      $set: { status: "Disponibel", activeLoan: null, updatedAt: returnedAt },
      $push: { loanHistory: returnEntry },
    }, {}, (updateErr, count) => {
      if (updateErr) return res.status(500).json({ error: "Kunde inte registrera återlämningen." });
      if (!count) return res.status(409).json({ error: "Utlåningen har redan ändrats." });
      io.emit("measuringToolsUpdated");
      res.json({ success: true });
    });
  });
});

// Administratörer kan se fullständig utlåningshistorik.
app.get("/measuring-tools/:id/history", requireAuth, requireMeasuringControlAccess, (req, res) => {
  measuringToolsDB.findOne({ _id: req.params.id }, (err, tool) => {
    if (err) return res.status(500).json({ error: "Kunde inte läsa historiken." });
    if (!tool) return res.status(404).json({ error: "Verktyget hittades inte." });
    const entries = [...(tool.loanHistory || []), ...(tool.controlHistory || []), ...(tool.reservationHistory || [])]
      .sort((a, b) => (a.recordedAt || a.checkedOutAt || a.returnedAt || a.reservedAt || a.releasedAt || 0) - (b.recordedAt || b.checkedOutAt || b.returnedAt || b.reservedAt || b.releasedAt || 0));
    res.json(entries);
  });
});

/* ---------------- USERS ENDPOINTS ---------------- */
app.get("/users/me", requireAuth, (req, res) => {
  usersDB.findOne({ _id: req.user.id }, (err, user) => {
    if (err) return res.status(500).json({ error: "Kunde inte läsa profiluppgifter." });
    if (!user) return res.status(404).json({ error: "Användaren hittades inte." });
    const { password, ...safeUser } = user;
    res.json(safeUser);
  });
});

app.get("/users", requireAuth, requireAdmin, (req, res) => {
  usersDB.find({}, (err, docs) => {
    if (err) return res.status(500).json({ error: "Kunde inte läsa användare" });
    res.json(docs.map(({ password, ...user }) => user));
  });
});

app.post("/users/add", requireAuth, requireAdmin, async (req, res) => {
  const { username, password, role, email, name, employeeNumber } = req.body;

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

  const user = { username, password: hashedPassword, role: role || "user", email, name, employeeNumber: String(employeeNumber || "").trim() };

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
      { $set: { role }, $inc: { tokenVersion: 1 } },
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

        const socketsDisconnected = disconnectUserSockets(id);
        res.json({
          success: true,
          socketsDisconnected,
          ...(socketsDisconnected ? {} : { warning: "Inloggningen återkallades, men WebSocket-sessionerna kunde inte kopplas ned." })
        });
      }
    );
  });
});
// Återkalla alla aktiva inloggningar för en användare (admin).
app.post("/users/:id/revoke-sessions", requireAuth, requireAdmin, (req, res) => {
  const id = req.params.id;

  usersDB.findOne({ _id: id }, (findErr, targetUser) => {
    if (findErr) return res.status(500).json({ error: "DB-fel" });
    if (!targetUser) return res.status(404).json({ error: "Användare hittades inte" });
    if (targetUser.role === "suAdmin" && req.user.role !== "suAdmin") {
      return res.status(403).json({ error: "Endast Super Admin får återkalla Super Admin-konton." });
    }

    usersDB.update({ _id: id }, { $inc: { tokenVersion: 1 } }, {}, (err) => {
      if (err) return res.status(500).json({ error: "Kunde inte återkalla inloggningarna." });

      const socketsDisconnected = disconnectUserSockets(id);

      presenceDB.update(
        { username: targetUser.username },
        { $set: { online: false } },
        {},
        () => {
          io.emit("onlineUpdated", { username: targetUser.username, online: false });
          res.json({
            success: true,
            socketsDisconnected,
            message: "Alla användarens inloggningar har återkallats.",
            ...(socketsDisconnected ? {} : { warning: "Token återkallades, men WebSocket-sessionerna kunde inte kopplas ned." })
          });
        }
      );
    });
  });
});

// ---------------- UPDATE USER ----------------
app.put("/users/:id", requireAuth, (req, res) => {
  const id = req.params.id;
  const isSelf = req.user.id === id;
  const isAdmin = ["admin", "suAdmin"].includes(req.user.role);
  if (!isSelf && !isAdmin) {
    return res.status(403).json({ error: "Du får bara uppdatera din egen profil." });
  }

  const { name, username, email, password, role, employeeNumber } = req.body;

  // Skapa ett update-objekt med endast de fält som skickats
  const updateFields = {};
  if (name !== undefined) updateFields.name = name;
  if (username !== undefined) updateFields.username = username;
  if (email !== undefined) updateFields.email = email;
  if (employeeNumber !== undefined && isAdmin) updateFields.employeeNumber = String(employeeNumber || "").trim();
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

    if (updateFields.password) {
      updateFields.tokenVersion = (targetUser.tokenVersion || 0) + 1;
    }

    usersDB.update({ _id: id }, { $set: updateFields }, {}, (err, numUpdated) => {
      if (err) return res.status(500).json({ success: false, error: "Kunde inte uppdatera användare" });
      if (numUpdated === 0) return res.status(404).json({ success: false, error: "Användare hittades inte" });
      const socketsDisconnected = updateFields.password
        ? disconnectUserSockets(id)
        : undefined;
      res.json({
        success: true,
        updated: { ...updateFields, password: undefined },
        ...(socketsDisconnected === undefined ? {} : {
          socketsDisconnected,
          ...(socketsDisconnected ? {} : { warning: "Lösenordet ändrades och gamla token återkallades, men WebSocket-sessionerna kunde inte kopplas ned." })
        })
      });
    });
  });
});

const loginAttempts = new Map();
function loginRateLimit(req, res, next) {
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const username = String(req.body?.username || "").trim().toLowerCase().slice(0, 100);
  const keys = [
    // IP-gränsen är högre eftersom flera användare kan dela samma nätverk/proxy.
    { key: `ip:${ip}`, limit: 100 },
    { key: `pair:${ip}:${username}`, limit: 10 },
  ];

  // Ta bort utgångna poster så att minnet inte växer obegränsat.
  for (const [key, entry] of loginAttempts) {
    if (now >= entry.resetAt) loginAttempts.delete(key);
  }

  for (const bucket of keys) {
    const entry = loginAttempts.get(bucket.key);
    if (entry && entry.count >= bucket.limit) {
      return res.status(429).json({
        error: "För många inloggningsförsök. Försök igen om 15 minuter.",
      });
    }
  }

  // Registrera bara misslyckade försök, inte normala/successfulla inloggningar.
  req.recordFailedLogin = () => {
    for (const bucket of keys) {
      const entry = loginAttempts.get(bucket.key) || { count: 0, resetAt: now + 15 * 60 * 1000 };
      entry.count += 1;
      loginAttempts.set(bucket.key, entry);
    }
  };
  req.loginAttemptKey = keys[1].key;
  next();
}

app.post("/login", loginRateLimit, (req, res) => {
  const { username, password } = req.body;
  if (typeof username !== "string" || typeof password !== "string" || !username.trim() || !password) {
    return res.status(400).json({ error: "Användarnamn och lösenord krävs." });
  }

  usersDB.findOne({ username: username.trim() }, async (err, user) => {
    if (err) return res.status(500).json({ error: "Serverfel" });
    if (!user) {
      req.recordFailedLogin?.();
      return res.status(401).json({ error: "Fel användarnamn eller lösenord" });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      req.recordFailedLogin?.();
      return res.status(401).json({ error: "Fel användarnamn eller lösenord" });
    }

    if (req.loginAttemptKey) loginAttempts.delete(req.loginAttemptKey);

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
        tokenVersion: user.tokenVersion || 0,
      },
      JWT_SECRET,
      { expiresIn: "30d" }
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

  // Öka tokenVersion: alla JWT för användaren blir ogiltiga omedelbart.
  usersDB.update(
    { _id: req.user.id },
    { $inc: { tokenVersion: 1 } },
    {},
    (authErr) => {
      if (authErr) return res.status(500).json({ error: "Kunde inte återkalla inloggningen." });

      // Ogiltigförklara JWT och koppla ned användarens öppna sockets.
      const socketsDisconnected = disconnectUserSockets(req.user.id);

      presenceDB.update(
        { username },
        { $set: { online: false } },
        {},
        () => {
          io.emit("onlineUpdated", { username, online: false });
          res.json({
            success: true,
            socketsDisconnected,
            ...(socketsDisconnected ? {} : { warning: "Token återkallades, men WebSocket-sessionerna kunde inte kopplas ned." })
          });
        }
      );
    }
  );
});

io.on("connection", (socket) => {
  socket.join(`user:${socket.user.id}`);
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

// Skapa/uppdatera protokoll (upsert på unikt matprotokollId)
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
const checklistDB = new Datastore({ filename: path.join(DB_DIR, "checklist.db"), autoload: true });
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

app.post("/orders/import", requireAuth, requireAdmin, upload.single("file"), validateUploadedFile(spreadsheetFileTypes), cleanupUploadAfterResponse, (req, res) => {
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
  cleanupUploadAfterResponse,
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

/* ---------------- NYCKELTAL (KPI) ---------------- */
registerKpis({
  app, io, Datastore, xlsx, fs, dbDir: DB_DIR,
  requireAuth, requireAdmin, requireEditor,
  upload, validateUploadedFile, kpiImportFileTypes,
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