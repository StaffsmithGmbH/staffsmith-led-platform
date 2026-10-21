# Autonomer Betrieb & gebündelte Freigaben (Daueranweisung TP, 2026-10-21)

**Nie auf Merge oder Freigabe warten** – weiterarbeiten, wo erlaubt selbst mergen, Rest gebündelt vorlegen. Projektregeln oben gehen vor.

- **Start:** `git fetch`, eigene offene PRs: `gh api repos/{owner}/{repo}/pulls --jq '.[].html_url'` (REST; `gh pr …` nutzt GraphQL und ist in Cloud-Sessions gesperrt). Statusquelle lesen, nächsten Schritt umsetzen.
- **Branches:** Baut die Aufgabe auf einem offenen PR auf → Branch von dessen Kopf, PR mit diesem Branch als Basis (gestapelt, max. ~5). Sonst vom Default-Branch. Default-Stand per Merge holen, kein Rebase/Force-Push.
- **Statusdateien:** nur neue Einträge anhängen statt bestehende umschreiben – so bleiben parallele PRs konfliktfrei.
- **Fehlende Entscheidung/Messwert:** mit markierter, umkehrbarer Annahme weiter (`ANNAHME (TP prüfen): …`). Irreversibel, kostenpflichtig, extern sichtbar, echte Hardware oder Prod-Daten → nur vorbereiten, nicht ausführen, mit anderer Arbeit weitermachen.
- **Fragen nie mitten in der Arbeit**, auch nicht per AskUserQuestion: Jede PR-Beschreibung beginnt mit `## Freigabe` (Basis-PR, ein Satz Inhalt, geprüft/ungeprüft, „lokal nötig“, offene Entscheidungen als Ja/Nein mit gewählter Annahme).
- **Selbst mergen** (Daueranweisung TP, 2026-10-21) – eigene PRs, wenn **alle** zutreffen: Checks in dieser Session grün (bzw. CI grün, wo vorhanden), nichts „ungeprüft“/„lokal nötig“, keine offene Ja/Nein-Entscheidung im PR, Projektregeln oben erfüllt, Merge löst nichts Externes aus (Deploy, Release, Veröffentlichung). Sonst bleibt der PR offen fürs Bündel.
  - Merge per REST: `gh api -X PUT repos/{owner}/{repo}/pulls/{n}/merge -f merge_method=merge` (`gh pr merge` nutzt GraphQL, in Cloud-Sessions gesperrt). Stapel von unten mergen; danach gestapelte PRs per `gh api -X PATCH repos/{owner}/{repo}/pulls/{n} -f base=<default>` auf den Default-Branch umhängen. Branches nicht löschen.
  - Schlägt der Merge fehl (Branch Protection, Konflikt): nicht umgehen, PR offen lassen, ins Bündel.
- **Session-Ende:** ein Bericht – gemergte PRs (Link + ein Satz) und offene PRs mit Grund, darunter offene Entscheidungen als Ja/Nein-Liste.
