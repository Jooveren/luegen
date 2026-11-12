# Lügen online stellen – geht auch komplett am Tablet

Dieses Paket enthält das fertige Spiel: Lügen und Schafkopf, online mit Freunden (mit Chat), gegen den Computer und ein Fenster mit YouTube Shorts.
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

## 5. YouTube Shorts einrichten (optional, einmalig, ca. 5 Minuten)

Ohne diesen Schritt kann man im Videos-Fenster unter „Shorts“ einzelne Shorts per Link abspielen.
Mit diesem Schritt gibt es zusätzlich den **Trends-Feed** (beliebte Shorts in Deutschland zum Durchwischen) und **Lieblingskanäle**.

1. **console.cloud.google.com** öffnen → mit einem Google-Konto anmelden → oben **„Projekt auswählen“ → „Neues Projekt“** → Name `Luegen` → „Erstellen“.
2. Links **„APIs & Dienste“ → „Bibliothek“** → nach **„YouTube Data API v3“** suchen → **„Aktivieren“**.
3. **„APIs & Dienste“ → „Anmeldedaten“ → „Anmeldedaten erstellen“ → „API-Schlüssel“** → Schlüssel kopieren.
   (Empfohlen: „Schlüssel bearbeiten“ → unter „API-Einschränkungen“ nur „YouTube Data API v3“ erlauben → Speichern.)
4. Render → Dienst `luegen` → **„Environment“** → „Add Environment Variable“: `YOUTUBE_API_KEY` = dein Schlüssel → **„Save changes“**.

Kostenlos: Das tägliche Gratis-Kontingent reicht locker, weil der Server Ergebnisse 30 Minuten zwischenspeichert.

## Gut zu wissen

- Der kostenlose Server **schläft nach 15 Minuten** ohne Nutzung ein. Der erste Aufruf danach dauert ca. 1 Minute – danach läuft es normal.
- **Updates:** Neue Dateien bei GitHub im Repository `luegen` hochladen („Add file“ → „Upload files“, alte werden ersetzt) → Render aktualisiert die App automatisch.
- **Verbindung weg:** Das Spiel pausiert für alle 10 Sekunden. Wer nicht zurückkommt, fliegt aus der Runde; seine Karten werden zufällig verteilt. Kommt er später zurück, schaut er zu und ist in der nächsten Runde wieder dabei.
- **Videos-Fenster (YouTube Shorts):** oben auf „Videos“ tippen. Fenster an der Titelleiste verschieben, an den Ecken unten größer/kleiner ziehen (oder − / +), mit ▾ zu einem kleinen Symbol einklappen.
