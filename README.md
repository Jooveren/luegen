# Lügen online stellen – geht auch komplett am Tablet

Dieses Paket enthält das fertige Spiel: online mit Freunden (mit Chat), gegen den Computer und ein TikTok-Fenster.
Alle Dateien liegen ohne Unterordner – so lassen sie sich direkt im Browser hochladen.

Dateien: `index.html`, `server.js`, `package.json`, `render.yaml`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png`, `favicon.svg`, `README.md`

## 1. ZIP entpacken

- **iPad:** ZIP in der „Dateien“-App antippen → wird automatisch entpackt.
- **Android:** In „Dateien“/„Eigene Dateien“ die ZIP antippen → „Entpacken“.

## 2. Auf GitHub hochladen (kostenlos)

1. **github.com** öffnen → „Sign up“ → Konto anlegen.
2. Oben rechts **„+“ → „New repository“**.
   Name: `luegen` · „Public“ lassen · **„Create repository“**.
3. Auf der nächsten Seite den Link **„uploading an existing file“** antippen.
4. **„choose your files“** → in den entpackten Ordner gehen → **alle Dateien** auswählen (mehrere antippen) → hochladen.
5. Ganz unten **„Commit changes“**.

## 3. Bei Render online stellen (kostenlos)

1. **render.com** öffnen → **„Get Started“ → „GitHub“** → mit dem GitHub-Konto anmelden und Zugriff erlauben.
2. Im Dashboard **„New +“ → „Blueprint“**.
3. Falls dein Repository nicht in der Liste steht: „Configure account“ → bei GitHub `luegen` freigeben → zurück.
4. `luegen` auswählen → Render liest die Einstellungen aus `render.yaml` → **„Apply“** (bzw. „Deploy Blueprint“).
5. 2–3 Minuten warten, bis der Dienst **„Live“** zeigt. Oben steht dein Link, z. B. `https://luegen-xxxx.onrender.com`.

## 4. Spielen

- Link öffnen → **„Mit Freunden“** → Name → **„Spiel erstellen“** → Raumcode oder Einladungslink an Freunde schicken.
- Freunde öffnen den Link, geben den Code ein – fertig. Funktioniert in jedem WLAN (auch Schule), über Hotspot und mobile Daten.
- **Als App auf den Startbildschirm:**
  iPad/iPhone (Safari): Teilen-Symbol → „Zum Home-Bildschirm“.
  Android (Chrome): ⋮ → „App installieren“ / „Zum Startbildschirm hinzufügen“.

## 5. Echte TikTok-Anmeldung einrichten (optional, einmalig)

Ohne diesen Schritt kann man im TikTok-Fenster seinen TikTok-**Namen** verknüpfen und Video-Links abspielen.
Mit diesem Schritt gibt es den Knopf **„Mit TikTok anmelden“** – danach erscheinen dein Profil und deine eigenen Videos.

1. **developers.tiktok.com** öffnen → mit deinem TikTok-Konto anmelden → falls gefragt, Entwicklerkonto anlegen.
2. **„Manage apps“ → „Connect an app“** (bzw. „Create app“). Angaben:
   - Name: `Lügen`, Icon: `icon-512.png` aus diesem Paket, Kategorie: Games/Entertainment, kurze Beschreibung
   - Terms of Service URL: `https://DEIN-LINK/nutzungsbedingungen`
   - Privacy Policy URL: `https://DEIN-LINK/datenschutz`
   - Plattform: **Web**, Website: `https://DEIN-LINK`
   (`DEIN-LINK` = deine Render-Adresse, z. B. `luegen-xxxx.onrender.com` – die beiden Seiten gibt es dort schon.)
3. **„Add products“ → „Login Kit“** → bei **Redirect URI** eintragen: `https://DEIN-LINK/auth/tiktok/callback`
4. Zusätzlich **„Display API“** hinzufügen. Berechtigungen (Scopes): `user.info.basic` und `video.list`.
5. **Sandbox** einschalten (Schalter/Reiter „Sandbox“ → „Create sandbox“) und unter **„Target users“** dein TikTok-Konto
   (und die deiner Freunde) hinzufügen. So funktioniert die Anmeldung sofort, ohne dass TikTok die App erst prüfen muss.
   Für alle anderen Nutzer: später „Submit for review“.
6. **Client key** und **Client secret** kopieren → bei Render deinen Dienst `luegen` öffnen → **„Environment“** →
   „Add Environment Variable“:
   - `TIKTOK_CLIENT_KEY` = dein Client key
   - `TIKTOK_CLIENT_SECRET` = dein Client secret

   → **„Save changes“**. Render startet die App neu (1–2 Minuten).
7. In der App: TikTok-Symbol → **„Mit TikTok anmelden“**.

Hinweis: Die Anmeldung wird im Server-Speicher gehalten. Wenn der kostenlose Server eingeschlafen ist, einfach erneut anmelden.
Falls TikTok verlangt, die Domain zu bestätigen (Datei oder Code), sag Bescheid – das baue ich dann ein.

## Gut zu wissen

- Der kostenlose Server **schläft nach 15 Minuten** ohne Nutzung ein. Der erste Aufruf danach dauert ca. 1 Minute – danach läuft es normal.
- **Updates:** Neue Dateien bei GitHub im Repository `luegen` hochladen („Add file“ → „Upload files“, alte werden ersetzt) → Render aktualisiert die App automatisch.
- **Verbindung weg:** Das Spiel pausiert für alle 10 Sekunden. Wer nicht zurückkommt, fliegt aus der Runde; seine Karten werden zufällig verteilt. Kommt er später zurück, schaut er zu und ist in der nächsten Runde wieder dabei.
- **TikTok-Fenster:** oben auf das TikTok-Symbol tippen. Fenster an der Titelleiste verschieben, an den Ecken unten größer/kleiner ziehen (oder − / +), mit ▾ zu einem kleinen Symbol einklappen.
  Den „Für dich“-Feed gibt TikTok für andere Apps nicht frei. Private Konten kann TikTok nicht einbetten.
