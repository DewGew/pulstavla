# Pulstavla

Pulstavla är en webbaserad produktions- och informationsöversikt byggd med React och Vite. En Node.js/Express-server hanterar API, autentisering, filhantering och realtidsuppdateringar via Socket.IO. Data lagras lokalt med NeDB.

## Funktioner

- Produktionsöversikt, närvaro och aktiviteter
- Maskinchecklistor och dokument
- Kundorder och tillverkningsorder
- Användarhantering och behörighetsroller
- JWT-skyddade API- och Socket.IO-anslutningar

## Systemkrav

- Raspberry Pi eller annan Linux-server
- Node.js **20.19 eller senare i 20.x**, eller **22.12 eller senare i 22.x**
- npm (följer normalt med Node.js)
- Nätverksåtkomst mellan klienterna och servern
- HTTPS via reverse proxy rekommenderas om Pulstavlan ska nås utanför ett skyddat lokalt nätverk

Kontrollera installerade versioner:

```bash
node --version
npm --version
```

## Installation på Raspberry Pi

Exemplen nedan använder katalogen `/home/pi/pulstavla` och grenen `development`. Anpassa sökväg, användare, IP-adress och gren om din installation använder andra värden.

### 1. Hämta koden och installera beroenden

```bash
git clone --branch development https://github.com/DewGew/pulstavla.git
cd pulstavla
npm ci
```

`npm ci` installerar exakt de beroenden som finns i `package-lock.json`. Använd det vid installation och uppdatering i stället för `npm install`.

### 2. Skapa lokal konfiguration

Skapa den lokala konfigurationsfilen från exemplet:

```bash
cp src/config.local.example.js src/config.local.js
nano src/config.local.js
```

Ange serverns adress så att den går att nå från webbläsarna. För en server med IP-adressen `192.168.1.13` och direkt HTTP-åtkomst på port 3000 kan filen exempelvis innehålla:

```js
export const PORT = 3000;
export const API_URL = "http://192.168.1.13:3000";
export const WS_URL = "ws://192.168.1.13:3000";
```

Byt IP-adressen till serverns faktiska adress. Om du använder en HTTPS-reverse proxy ska `API_URL` i stället vara den publika HTTPS-adressen och `WS_URL` motsvarande WSS-adress, exempelvis `https://pulstavla.example.se` respektive `wss://pulstavla.example.se`. Reverse proxyn ska då vidarebefordra både HTTP och WebSocket till serverns interna adress och port.

**Viktigt:** Servern i det här projektet startar vanlig HTTP, inte egen HTTPS. Använd därför inte `https://` eller `wss://` direkt mot Node-serverns port om inte TLS faktiskt avslutas i en proxy framför den.

Filen `src/config.local.js` är lokal och ignoreras av Git. Den ska inte checkas in. Ändra inte `src/config.js`; den läser automatiskt lokala nätverksvärden och hämtar versionsnumret från `package.json`.

### 3. Skapa miljöfil för servern

Servern kräver en hemlig `JWT_SECRET` på minst 32 tecken. Skapa en slumpmässig hemlighet:

```bash
openssl rand -hex 32
```

Skapa en miljöfil utanför projektkatalogen:

```bash
nano ~/pulstavla.env
```

Exempel på innehåll:

```bash
JWT_SECRET=ERSATT_MED_DEN_SLUMPMASSIGA_HEMLIGHETEN
CORS_ORIGINS=http://192.168.1.13:3000

# Används endast om databasen saknar användare och första administratören ska skapas:
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=ERSATT_MED_UNIKT_LOSENORD_MINST_12_TECKEN
INITIAL_ADMIN_NAME=Administratör
INITIAL_ADMIN_EMAIL=admin@example.se
```

Anpassa `CORS_ORIGINS` till exakt den adress som användarna öppnar i webbläsaren, inklusive protokoll men utan avslutande snedstreck. Vid HTTPS via reverse proxy ska det exempelvis vara `https://pulstavla.example.se`. Om flera adresser ska tillåtas separerar du dem med kommatecken.

Skydda miljöfilen:

```bash
chmod 600 ~/pulstavla.env
```

Viktigt om första administratören:

- `INITIAL_ADMIN_USERNAME` och `INITIAL_ADMIN_PASSWORD` används bara när användardatabasen är tom.
- Det första administratörslösenordet måste vara minst 12 tecken.
- När kontot har skapats kan dessa två variabler tas bort ur miljöfilen.
- Lägg aldrig miljöfilen eller hemligheterna i Git.

### 4. Skapa datakataloger och bygg frontend

```bash
mkdir -p db uploads docs
npm run build
```

Bygget skapar frontend-filerna i `dist/`. Servern levererar sedan både frontend och API.

### 5. Starta servern

För ett första test kan du ladda miljövariablerna i terminalen och starta servern:

```bash
set -a
source ~/pulstavla.env
set +a
npm run server
```

Servern lyssnar på porten som anges i `src/config.local.js` (3000 i exemplet). Öppna `http://192.168.1.13:3000` från en dator i samma nätverk, eller använd den adress som du konfigurerat.

Stoppa testservern med `Ctrl+C`.

### 6. Kör automatiskt med systemd (rekommenderat)

För att servern ska starta automatiskt efter omstart kan du använda en systemd-tjänst. Kontrollera först sökvägen till npm:

```bash
command -v npm
```

Skapa tjänstefilen:

```bash
sudo nano /etc/systemd/system/puls.service
```

Exempel (ändra `User`, `WorkingDirectory` och `ExecStart` så att de stämmer med din installation och resultatet från `command -v npm`):

```ini
[Unit]
Description=Pulstavla
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/pulstavla
EnvironmentFile=/home/pi/pulstavla.env
ExecStart=/usr/bin/npm run server
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Aktivera och starta tjänsten:

```bash
sudo systemctl daemon-reload
sudo systemctl enable puls
sudo systemctl start puls
sudo systemctl status puls
```

Visa loggar vid felsökning:

```bash
sudo journalctl -u puls -f
```

Om du redan har en fungerande `puls.service` ska du behålla dess befintliga sökvägar och inställningar i stället för att ersätta den med exemplet ovan.

### 7. Kontrollera installationen

- Öppna Pulstavlan och logga in med det första administratörskontot.
- Kontrollera att användarhantering och behörigheter fungerar.
- Kontrollera närvaro, aktiviteter, checklistor och order.
- Prova dokumentuppladdning och att öppna/ladda ner dokument.
- Kontrollera att realtidsuppdateringar via Socket.IO fungerar.
- Om HTTPS används: kontrollera att reverse proxyn även stöder WebSocket.

## Uppdatera en befintlig installation

Gör en säkerhetskopia innan uppdatering. Säkerhetskopiera minst `db/`, `uploads/`, `docs/`, `src/config.local.js` och miljöfilen. Kopiera säkerhetskopian till en annan plats än projektkatalogen.

Gå till projektkatalogen och kontrollera först lokala ändringar:

```bash
cd /home/pi/pulstavla
git status --short
```

Kontrollera att du står på rätt gren. För installationen som följer `development`:

```bash
git switch development
git pull --ff-only origin development
npm ci
npm run build
sudo systemctl restart puls
sudo systemctl status puls
```

Om du använder en annan gren byter du ut `development` mot den grenen. Byt inte gren innan du har kontrollerat och säkrat eventuella lokala ändringar.

### Äldre installationer med lokal `src/config.js`

Om installationen ännu inte använder `src/config.local.js`, och du har egna nätverksinställningar i den gamla `src/config.js`, måste de flyttas över **innan** du hämtar den uppdatering som inför den nya konfigurationsfilen.

Ta först en kopia av den gamla filen och skapa den lokala konfigurationen. Exempel:

```bash
cp -n src/config.js ~/config.js.backup
cp src/config.local.example.js src/config.local.js
nano src/config.local.js
```

Överför värdena för `API_URL`, `WS_URL` och `PORT` från säkerhetskopian till `src/config.local.js`. När du har kontrollerat att de är rätt kan den gamla, Git-ignorerade `src/config.js` flyttas undan så att Git kan hämta den nya versionshanterade filen:

```bash
mv -n src/config.js ~/config.js.old
git pull --ff-only origin development
```

Använd inte `git clean`, `git reset --hard` eller kommandon som raderar okända filer för att lösa uppdateringskonflikter. Kontrollera alltid `git status --short` först. Behåll `src/config.local.js` och alla lokala datafiler.

**Radera eller skriv inte över** katalogerna `db/`, `uploads/` eller `docs/` vid en vanlig uppdatering. De innehåller lokal data och dokument.

## Data och säkerhet

- NeDB-databaser lagras i `db/`.
- Uppladdade filer lagras i `uploads/`.
- Dokument lagras i `docs/` och hämtas via autentiserade API-routes. `docs/logo.png` används separat som publik logotyp.
- `src/config.local.js` innehåller maskinens lokala nätverksinställningar.
- Miljöfilen innehåller hemligheter och ska ha begränsade filrättigheter.
- Exponera inte Node-serverns port direkt mot internet. Använd brandvägg och vid extern åtkomst en korrekt konfigurerad HTTPS-reverse proxy.
- Säkerhetskopiera databaser, uppladdningar, dokument och lokal konfiguration regelbundet.

## Versionshantering (SemVer)

Pulstavla följer **Semantic Versioning (SemVer)** med formatet `MAJOR.MINOR.PATCH`. Aktuell version finns i `package.json` och används automatiskt av applikationen via `src/config.js`. Ändra inte versionsnumret på flera ställen.

- **MAJOR** – inkompatibla ändringar, till exempel `2.8.0` → `3.0.0`.
- **MINOR** – nya bakåtkompatibla funktioner, till exempel `2.8.0` → `2.9.0`.
- **PATCH** – bakåtkompatibla buggfixar, till exempel `2.8.0` → `2.8.1`.

Kör ett av följande kommandon på utvecklingsgrenen när ändringen är färdig:

```bash
npm version patch
npm version minor
npm version major
```

Kommandot uppdaterar `package.json` och `package-lock.json`, skapar en versionscommit och en Git-tagg. Granska ändringen och publicera sedan commit och tagg, exempelvis:

```bash
git push origin development
git push origin --tags
```

Höj inte versionsnumret för varje vanlig kodcommit. Välj versionsdel utifrån ändringens omfattning och bakåtkompatibilitet.

## Utveckling

Installera beroenden och starta både API-server och Vites utvecklingsserver:

```bash
npm ci
npm run start
```

Vites utvecklingsserver visas i terminalen (normalt port 5173). API-serverns adress och port styrs av `src/config.local.js`. Anpassa vid behov även `vite.config.js` för lokal nätverksutveckling.
