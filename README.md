# Meine Aufgaben (Web App)

Eigene Aufgaben App als Ersatz für die Notion „Aufgabenliste Arbeit“. Läuft im Browser, lässt sich am Mac ins Dock und auf dem iPhone auf den Home Bildschirm legen und funktioniert auch offline.

## Funktionen
* Liste mit Filtern, Board mit drei Spalten, Suche, Notizen pro Aufgabe
* Automatisierungen (einzeln schaltbar): Begonnen am, Abgeschlossen am, Wiederöffnen, Archivieren nach X Tagen, Priorität Hoch bei naher Fälligkeit
* Import der 30 Notion Aufgaben per SQL (liegt bewusst nicht in diesem öffentlichen Repository)
* Abgleich zwischen Geräten über Supabase (optional, sonst nur lokal)
* Konto: Passwort ändern (angemeldet) und Passwort vergessen per Mail (Site URL in Supabase muss auf die App Adresse zeigen)

## Dateien
| Datei | Zweck |
|---|---|
| `index.html`, `style.css`, `app.js` | Die App |
| `config.js` | Supabase Adresse und öffentlicher Schlüssel |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installierbar und offline nutzbar |
| `supabase-setup.sql` | Tabellen und Zugriffsrechte für Supabase |

## Einrichtung Supabase
1. Auf https://supabase.com/dashboard/sign-up kostenlos registrieren und ein neues Projekt anlegen (Region Frankfurt).
2. Im Projekt links „SQL Editor“ öffnen, Inhalt von `supabase-setup.sql` einfügen, „Run“.
3. Unter „Project Settings“, „API“ (https://supabase.com/dashboard/project/_/settings/api) die „Project URL“ und den „anon public“ Schlüssel kopieren und in `config.js` eintragen.
4. App öffnen, oben rechts auf den Status tippen, Konto anlegen, E-Mail bestätigen, anmelden.
5. Im SQL Editor die separate Import Datei ausführen (übernimmt die Notion Aufgaben, nicht in diesem Repository).

## Installation
* **Mac (Safari):** App öffnen, Menü „Ablage“, „Zum Dock hinzufügen“.
* **iPhone (Safari):** App öffnen, Teilen Symbol, „Zum Home Bildschirm“.

## Lokal testen
`python3 -m http.server 8765` im Ordner, dann http://localhost:8765 öffnen.
