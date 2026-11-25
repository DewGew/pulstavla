# Dokumentstyrning i Pulstavlan

## Mål

Införa dokumentstyrning som stödjer arbetet enligt ISO 9001 utan att flytta eller skriva över befintliga dokument. Funktionen ska använda Pulstavlans befintliga dokumentlagring och kunna koppla färdiga mätprotokoll till styrande instruktioner.

Systemstödet hjälper till att hantera dokumenterad information men ersätter inte företagets egna beslut om ansvar, godkännande, åtkomst och lagringstider.

## Dokumenttyper

### Styrda dokument
Exempel: rutiner, arbetsinstruktioner, mallar och blanketter.

Dessa får dokumentnummer, ägare, kategori, revision, status och vid behov gransknings-/godkännandeflöde. En publicerad revision ska inte skrivas över. En ändring skapar en ny revision.

Föreslaget livscykelflöde:

`Utkast → Granskning → Godkännande → Publicerad → Ersatt → Arkiverad`

Godkännande ska kunna konfigureras per dokument:
- En godkännare.
- Flera godkännare, parallellt eller i bestämd ordning.
- Alla obligatoriska godkännanden måste vara klara innan publicering.

Läsbekräftelse ska vara valfri per dokument och kopplas till den specifika revisionen.

### Kvalitetsregistreringar
Exempel: färdigställda mätprotokoll och andra registrerade kontrollresultat.

Dessa är bevis på utfört arbete, inte instruktioner som ska revideras och godkännas på samma sätt. De ska kunna sökas och arkiveras, och ändringar ska ske genom en spårbar rättelse i stället för att originalet skrivs över.

## Befintliga mätprotokoll

Mätprotokollens formulärdata och mätpunkter lagras redan i `db/matprotokoll.db`. PDF skapas i klienten och sparas separat av användaren; den nuvarande funktionen laddar inte upp PDF-filen till serverns dokumentmapp.

Integrationen ska därför:
- Återanvända befintliga protokolldata och inte skapa en parallell kopia av mätvärdena.
- Skilja på utkast (`pdfSaved === false`) och färdigställt/exporterat protokoll (`pdfSaved === true`).
- Registrera färdigställandet som en kvalitetsregistrering med protokoll-ID, ordernummer, artikelnummer, ritningsnummer, datum och upprättad av.
- Kunna länka protokollet till den styrande instruktionens exakta revision.
- Inte göra befintliga protokoll skrivskyddade eller ändra deras beteende förrän en separat, testad övergång införs.
- Utreda och besluta hur PDF-kopian ska arkiveras centralt. Nuvarande klientbaserade PDF-export innebär inte att en serverkopia finns.

## Föreslagen datamodell

Använd en separat NeDB-fil, exempelvis `db/documentControl.db`, för dokumentstyrningens metadata. Befintlig filhantering och `db/matprotokoll.db` lämnas intakta.

Föreslagna poster/typer:

- **Documents:** dokumentidentitet, dokumentnummer, namn, kategori, ägare, aktuell revision, status, läsbekräftelseinställning och nästa granskningsdatum.
- **Revisions:** dokument-ID, revisionsbeteckning, filreferens i befintlig dokumentlagring, ändringsbeskrivning, skapare, tidsstämplar och publiceringstid.
- **Approvals:** revisions-ID, godkännare, beslut, kommentar och tidpunkt.
- **ReadReceipts:** dokument-ID, revisions-ID, användare och bekräftelsetid.
- **QualityRecords:** referens till befintlig mätprotokollpost eller annan kvalitetsregistrering, metadata för sökning och eventuell filreferens.
- **Events/Audit:** spårbara händelser för skapande, ändring, granskning, godkännande, publicering, arkivering och rättelser.

Datamodellen är ett förslag och ska verifieras mot befintliga API:er och behörighetsregler innan implementation.

## Behörighet och skydd

- Behörighet ska alltid kontrolleras på serversidan.
- Dokumentadministration ska kunna tilldelas separat från vanlig användarbehörighet.
- Granskare och godkännare ska vara uttryckligen tilldelade.
- Publicerade revisionsfiler får inte skrivas över eller raderas genom de vanliga dokumentendpoints.
- Historik och kvalitetsregistreringar ska ha spårbara rättelser.
- Inga befintliga filer eller databasinlägg ska massimporteras, ändras eller raderas automatiskt.

## Genomförandestatus

### Steg 1 – dokumentregister och metadata

Påbörjat i grenen `feature/document-control`:
- Separat NeDB-fil `db/documentControl.db` för registermetadata.
- API för att lista registrerade dokument och befintliga dokumentfiler som ännu inte registrerats.
- API för administratörer att registrera metadata för en fil som redan finns i dokumentmappen.
- En ny vy ”Dokumentstyrning” med sökning och registreringsformulär.
- Registrering ändrar inte, flyttar eller kopierar den befintliga filen.
- Nya registerposter får statusen ”Ej granskad” och blir inte automatiskt godkända.

### Automatisk dokumentnumrering

- Nya dokument får automatiskt ett löpnummer per dokumentkategori om dokumentadministratören lämnar dokumentnummerfältet tomt.
- Prefix och format:
  - Kvalitetshandbok: `KHB-001`
  - Policy: `POL-001`
  - Rutin: `RUT-001`
  - Allmän instruktion: `AIN-001`
  - Arbetsinstruktion: `AI-001`
  - Blankett: `BL-001`
  - Mall: `MALL-001`
  - Policy: `POL-001`
  - Övrigt: `OVR-001`
- Räknaren lagras i `documentControl.db` och är separat per kategori.
- Dokumentadministratören kan ange ett eget nummer. Dubbletter av dokumentnummer kontrolleras innan registrering.
- Befintliga dokumentnummer ändras inte retroaktivt. Manuellt angivna nummer ändrar inte den automatiska räknaren.

### Steg 2 – revisionshantering och filskydd

Implementerat i grenen `feature/document-control`:
- Ny revision laddas upp som en separat fil med ett unikt internt filnamn. Befintliga filer skrivs inte över.
- Revisionshistoriken sparar revisionsbeteckning, ändringsbeskrivning, filreferens, tidpunkt och användare.
- Dokumentposten pekar på aktuell fil och aktuell revision; en ny revision återställer status till `needs-review`.
- Ursprunglig filreferens bevaras som registreringens baslinje.
- Vanlig dokumentuppladdning avvisas om filnamnet redan tillhör ett registrerat dokument eller en revisionsfil.
- Vanlig borttagning avvisas för registrerade dokument och revisionsfiler.
- Revisionsfiler visas inte som fristående dokument i den vanliga dokumentlistan.
- Vanliga, oregistrerade dokument fortsätter använda den befintliga uppladdnings- och borttagningshanteringen.

Kvarstår:
- Granskning och godkännande/publicering är inte implementerat. En ny revision får därför inte betraktas som godkänd eller publicerad.
- Läsbekräftelser, granskningsdatum och central PDF-arkivering är inte implementerade.
- Ingen build eller runtime-test av steg 2 är verifierad ännu.
- Befintliga registrerade dokument från steg 1 får sin ursprungliga fil som historikens baslinje.

## Föreslagen genomförandeordning

1. Dokumentregister och metadata med läsning/registrering av befintliga filer utan att flytta dem.
2. Revisioner och säker filhantering så att publicerade filer inte kan skrivas över.
3. Granskning och konfigurerbara godkännandeflöden.
4. Valfri läsbekräftelse per revision.
5. Kvalitetsregistrering för mätprotokoll, med koppling till instruktionens revision och central PDF-arkivering.
6. Granskningsintervall, aviseringar och översikter.

Varje steg ska kunna testas separat. Ingen databasmigrering, massimport eller ändring av befintliga mätprotokoll ska göras utan separat verifiering och godkännande.
