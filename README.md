# Pulstavla

Pulstavla är en React/Vite-applikation med en Node.js/Express-server, Socket.IO och NeDB som databas.

## Funktioner

- Produktionsöversikt, närvaro och aktiviteter
- Maskinchecklistor och dokument
- Kundorder och tillverkningsorder
- Användarhantering med rollerna user, admin och suAdmin
- JWT-skyddade API- och Socket.IO-anslutningar

## Krav

- Raspberry Pi eller annan Linux-server
- Node.js **20.19+** eller **22.12+**
- npm
- En reverse proxy med HTTPS rekommenderas för åtkomst utanför det lokala nätverket

## Installation på Raspberry Pi

### 1. Installera Node.js

Installera en aktuell Node.js-version som uppfyller kravet ovan. Kontrollera installationen:

```bash
node --version
npm --version
```

### 2. Hämta projektet

```bash
git clone https://github.com/DewGew/pulstavla.git
cd pulstavla
npm ci
```

Om du redan har klonat projektet uppdaterar du i stället från den branch som används, exempelvis:

```bash
git pull origin development
npm ci
```

### 3. Anpassa lokala nätverksinställningar

Nätverksadresser och serverport ligger i den lokala filen `src/config.local.js`. Den filen ignoreras av Git och skrivs därför inte över vid `git pull`.

Skapa filen första gången genom att kopiera exempelfilen:

```bash
cp src/config.local.example.js src/config.local.js
nano src/config.local.js
```

Anpassa `API_URL`, `WS_URL` och vid behov `PORT` till din installation. Exempel om reverse proxyn publicerar appen på `https://pulstavla.example.se`:

```js
export const API_URL = "https://pulstavla.example.se";
export const WS_URL = "wss://pulstavla.example.se";
```

Behåll normalt port 3000 i produktion. Anpassa även reverse proxyn så att den skickar HTTP- och WebSocket-trafik till rätt server och port.

**Viktigt:** Ändra inte längre nätverksadresser i `src/config.js`. Den filen är programmets gemensamma konfiguration och läser lokala värden från `config.local.js`. Versionsnumret hämtas automatiskt från `package.json`.

### 4. Skapa serverns miljövariabler

Servern startar inte utan en `JWT_SECRET` på minst 32 tecken. Skapa en hemlighet:

```bash
openssl rand -hex 32
```

Skapa en separat miljöfil utanför projektkatalogen, till exempel:

```bash
nano ~/pulstavla.env
```

Lägg in följande och ersätt exempelvärdena:

```bash
JWT_SECRET=ERSATT_MED_EN_LANG_SLUMPMASSIG_HEMLIGHET
CORS_ORIGINS=https://pulstavla.example.se

# Behövs bara när användardatabasen är tom och första admin ska skapas:
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=ERSATT_MED_ETT_UNIKT_LANGT_LOSENORD
# Valfria uppgifter för första administratören:
INITIAL_ADMIN_NAME=Administratör
INITIAL_ADMIN_EMAIL=admin@example.se
```

Skydda filen:

```bash
chmod 600 ~/pulstavla.env
```

Viktigt om konton:
- `INITIAL_ADMIN_PASSWORD` används bara när databasen saknar användare och måste vara minst 12 tecken.
- Vanliga användarlösenord har ett separat minimikrav på 3 tecken.
- Lägg aldrig miljöfilen eller hemligheterna i Git.

Ladda miljövariablerna i terminalen innan servern startas:

```bash
set -a
source ~/pulstavla.env
set +a
```

### 5. Bygg och starta

Bygg frontend:

```bash
npm run build
```

Starta servern:

```bash
npm run server
```

Servern använder port 3000 som standard. Den serverar den byggda frontend-applikationen från `dist/` samt API och WebSocket.

För lokal utveckling kan du i stället använda:

```bash
npm run start
```

Det kommandot startar både servern och Vites utvecklingsserver. Använd normalt `npm run build` följt av `npm run server` för en produktionsinstallation.

### 6. Kontrollera installationen

- Öppna appens adress och logga in med administratörskontot.
- Kontrollera att användarhantering och roller fungerar.
- Kontrollera närvaro, aktiviteter, checklistor och order.
- Prova dokumentuppladdning och att öppna/ladda ner dokument.
- Kontrollera att WebSocket-uppdateringar fungerar.
- Kontrollera att webbplatsen nås via HTTPS och att reverse proxyn även stöder WebSocket.

## Uppdatera en befintlig installation

Ta först en säkerhetskopia av databaser och uppladdade filer. Första gången den nya lokala konfigurationsfilen införs måste de befintliga nätverksinställningarna flyttas över innan du hämtar uppdateringen.

Om du har anpassat den gamla `src/config.js`, kör följande från projektkatalogen **innan första pull**:

```bash
cp src/config.js src/config.local.js
git restore src/config.js
```

Detta sparar den gamla filen som lokal konfiguration och återställer den Git-hanterade filen så att uppdateringen kan hämtas utan konflikt. Kontrollera att `src/config.local.js` finns kvar. Filen är ignorerad av Git.

Hämta sedan uppdateringen:

```bash
git status --short
git pull origin development
npm ci
npm run build
```

Starta sedan om den körande Pulstavla-servern så att den nya versionen laddas.

**Radera eller skriv inte över** katalogerna `db/` och `uploads/` vid uppdatering. De innehåller lokal data. Behåll även `src/config.local.js` och miljöfilen.

## Data och säkerhet

- NeDB-databaser lagras i `db/`.
- Uppladdade filer lagras i `uploads/`.
- Dokument i `docs/` är inte en publik statisk katalog. Dokumentåtkomst går via autentiserade routes.
- `docs/logo.png` exponeras separat som publik logotyp.
- Lägg aldrig hemligheter, säkerhetskopior eller privata dokument i en publik katalog.
- Se till att reverse proxyn använder HTTPS och vidarebefordrar WebSocket korrekt.
- Säkerhetskopiera `db/`, `uploads/`, `src/config.local.js` och relevanta miljöfiler regelbundet.

## Utveckling

```bash
npm ci
npm run start
```

Öppna Vites utvecklingsadress som visas i terminalen. Anpassa vid behov nätverksadresserna i `src/config.local.js` och `vite.config.js`.
