# StaffSmith LED Platform — Loop-Engineering-Agent

Offene LED-Plattform für räumlich vernetzte Flow-Props: Effekt-Engine (JS), Firmware-Vertrag (ESP-IDF/C), Simulator, Web-UI, Mesh-Sync-Protokoll. Lizenz **Apache-2.0**, Repo ist **öffentlich**.

## Sprache
- Mit TP auf Deutsch. Code, Kommentare, Commits, Dateinamen auf Englisch; bestehende Specs (`engine/SPEC.md`, `firmware/SPEC.md`) bleiben in ihrer Sprache.

## Kontext — zuerst lesen
- `engine/SPEC.md` — Map-Format + Effekt-API, **FROZEN v1** (2026-06-27). Änderungen nur versioniert (v2) mit Begründung.
- `firmware/SPEC.md` + `firmware/include/smith_engine.h` — C-Port-Vertrag, **FROZEN v1** (2026-07-05).
- `docs/protocol/mesh-sync.md` — Sync-Protokoll; `engine/sync/clock-model.js`.
- Statusquelle (Loop, Gate, nächste Aktion): `loops/STATE.md` + `loops/LOG.md` in der lokalen Mission Control (außerhalb des Repos, vgl. Verweise in `firmware/SPEC.md`). Liegt **nicht** im Repo — in Cloud-Sessions fehlt sie: dann aus Specs + Git-Log ableiten und den Stand im PR beschreiben.

## Loop-Engineering
- Jeder Schritt gehört zu einem Loop (Build → Measure → Learn) mit messbarem Exit-Gate. De-Risk first; Software-Track läuft parallel zur Hardware und wartet nicht auf sie.
- Ein Loop ist erst „done“ mit Gate-Nachweis (Messung/Test). Gate-Entscheidungen (Go/No-Go) trifft TP — vorschlagen, nicht selbst setzen.

## Befehle
- Kein Build-System/Package-Manager im Repo; Node-Skripte direkt: `node tools/gen-firmware-map.js discus full`, `node tools/gen-dmx-map.js …`.
- Prüfung: `node --check <datei>`; generierte C-Dateien bei Bedarf mit `cc -fsyntax-only -Ifirmware/include firmware/generated/<map>_map.c` (ungeprüft in der Cloud).
- `firmware/generated/` nur über `tools/gen-firmware-map.js` erzeugen, nie von Hand editieren.
- Nur lokal (im PR als „lokal nötig“ vermerken): ESP-IDF-Builds/Flash, Messungen am Prototyp, Browser-Abnahme von `simulator/` und `webui/`.

## Arbeitsregeln
- **Open-Core-Grenze hart:** Positionierungs-Fusion und Basisstation/Show-Software sind proprietär und gehören nicht in dieses Repo oder seine Historie. Im Zweifel nicht committen, sondern als Freigabefrage aufnehmen.
- SPDX-Header in jede Quelldatei (`Apache-2.0`; Beispiel-Effekte ggf. `MIT`).
- Sicherheits-Limits (Helligkeits-/Thermo-Ceiling) sind strukturelle Invarianten aus `firmware/SPEC.md` — nicht aufweichen, nie „nur in Software“ lösen.
- Öffentlich sichtbar: keine internen Notizen, Messrohdaten, Personen- oder Geschäftsinfos. Keine Secrets.
- Commits konventionell (`feat(engine): …`), mit Sign-off (`-s`).
- Keine binären CAD-/Gerber-Dateien erfinden.

## Autonomer Betrieb & gebündelte Freigaben (Daueranweisung TP, 2026-10-21)

Das Projekt entwickelt sich laufend weiter – **nie auf einen Merge oder eine Freigabe warten**. Freigaben werden gesammelt und TP gebündelt vorgelegt.

**Weiterarbeiten trotz offener PRs**
- Sessionstart: `git fetch`, offene eigene `claude/…`-PRs/Branches feststellen, Statusquelle (siehe oben) lesen, nächsten Schritt wählen und direkt umsetzen.
- Baut die nächste Aufgabe auf einem offenen PR auf → neuen Branch vom Kopf dieses PR-Branches abzweigen und den PR **gestapelt** öffnen (Basis = vorheriger Branch, nicht der Default-Branch).
- Ist sie unabhängig → vom aktuellen Default-Branch abzweigen. Unabhängige Arbeit hat Vorrang vor immer tieferen Stapeln (Faustregel: max. ~5 PRs übereinander).
- Neuer Stand des Default-Branches wird per **Merge** in den Stapel geholt, nicht per Rebase (kein Force-Push).
- Statusdateien (STATUS/STATE/Protokoll) im selben PR wie die Arbeit pflegen.

**Offene TP-Entscheidungen blockieren nicht**
- Fehlt eine Entscheidung oder ein Messwert: mit einer klar markierten, leicht umkehrbaren Annahme weiterarbeiten (Kennzeichnung `ANNAHME (TP prüfen): …` im Code/Doc) und die Frage in die Freigabeliste aufnehmen.
- Ist der Schritt irreversibel, sicherheitsrelevant, kostenpflichtig oder extern sichtbar (Deploy, Veröffentlichung, Bestellung, echte Hardware/Maschine, Prod-Daten): **nicht ausführen**, nur vorbereiten, in die Freigabeliste eintragen und mit anderer Arbeit weitermachen.

**Freigabeliste statt Einzelfragen**
- Jede PR-Beschreibung beginnt mit einem Block `## Freigabe`: Merge-Reihenfolge/Basis-PR, Inhalt in einem Satz, geprüft vs. ungeprüft, „lokal nötig“, offene Entscheidungen als Ja/Nein-Frage mit der gewählten Annahme.
- Keine Rückfragen mitten in der Arbeit. Am Ende jeder Session (bzw. sobald ≥5 Freigaben offen sind) **ein** gebündeltes „Freigabe-Bündel“ ausgeben: alle offenen `claude/…`-PRs dieses Repos in Merge-Reihenfolge (Link + ein Satz), darunter alle offenen Entscheidungen als Ja/Nein-Liste.

**Grenzen bleiben**
- Nie selbst in den Default-Branch mergen, kein Force-Push, nichts löschen, keine Secrets. Alle projektspezifischen Regeln oben (Gates, 🩷-Punkte, Sicherheitsgrenzen, „nur lokal“) gelten unverändert und gehen dieser Autonomie-Regel vor.
