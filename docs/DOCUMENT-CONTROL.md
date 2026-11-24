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

## Föreslagen genomförandeordning

1. Dokumentregister och metadata med läsning/registrering av befintliga filer utan att flytta dem.
2. Revisioner och säker filhantering så att publicerade filer inte kan skrivas över.
3. Granskning och konfigurerbara godkännandeflöden.
4. Valfri läsbekräftelse per revision.
5. Kvalitetsregistrering för mätprotokoll, med koppling till instruktionens revision och central PDF-arkivering.
6. Granskningsintervall, aviseringar och översikter.

Varje steg ska kunna testas separat. Ingen databasmigrering, massimport eller ändring av befintliga mätprotokoll ska göras utan separat verifiering och godkännande.
