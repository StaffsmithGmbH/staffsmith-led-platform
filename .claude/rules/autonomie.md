# Autonomer Betrieb & gebündelte Freigaben (Daueranweisung TP, 2026-10-21)

**Nie auf Merge oder Freigabe warten** – weiterarbeiten, Freigaben sammeln, gebündelt vorlegen. Projektregeln oben gehen vor.

- **Start:** `git fetch`, eigene offene PRs: `gh api repos/{owner}/{repo}/pulls --jq '.[].html_url'` (REST; `gh pr …` nutzt GraphQL und ist in Cloud-Sessions gesperrt). Statusquelle lesen, nächsten Schritt umsetzen.
- **Branches:** Baut die Aufgabe auf einem offenen PR auf → Branch von dessen Kopf, PR mit diesem Branch als Basis (gestapelt, max. ~5). Sonst vom Default-Branch. Default-Stand per Merge holen, kein Rebase/Force-Push.
- **Statusdateien:** nur neue Einträge anhängen statt bestehende umschreiben – so bleiben parallele PRs konfliktfrei.
- **Fehlende Entscheidung/Messwert:** mit markierter, umkehrbarer Annahme weiter (`ANNAHME (TP prüfen): …`). Irreversibel, kostenpflichtig, extern sichtbar, echte Hardware oder Prod-Daten → nur vorbereiten, nicht ausführen, mit anderer Arbeit weitermachen.
- **Fragen nie mitten in der Arbeit**, auch nicht per AskUserQuestion: Jede PR-Beschreibung beginnt mit `## Freigabe` (Basis-PR, ein Satz Inhalt, geprüft/ungeprüft, „lokal nötig“, offene Entscheidungen als Ja/Nein mit gewählter Annahme). Am Session-Ende **ein** Freigabe-Bündel: alle offenen PRs in Merge-Reihenfolge + Ja/Nein-Liste.
- **Nie** selbst in den Default-Branch mergen.
