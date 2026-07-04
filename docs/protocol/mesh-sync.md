# Mesh- & Sync-Protokoll (Lite-Basis, von Pro geteilt)

Leichtgewichtiges Peer-Sync für Flow-Props (flowtoys-/Pyroterra-Klasse, siehe
docs/lite-tier-spec.md). Ziel: Module synchronisieren **untereinander**, laufen zwischen
Beacons **frei weiter**, teilen nur **Takt + Programm** — kein Live-Pose-Streaming.

## Prinzip
- Effekte sind deterministisch: `farbe = f(t_sync, programm, params)`. Bleiben zwei Props im
  Takt und auf demselben Programm, laufen sie identisch — ganz ohne Datenstrom.
- Transport: **ESP-NOW Broadcast** innerhalb einer Gruppe. Kein Router, keine Basisstation.

## Gruppen & Pairing (wie flowtoys Quick-Group)
- **Group-ID** (16 bit). Nur Pakete der eigenen Gruppe werden verarbeitet.
- Pairing: Taster lang halten → Modul wird **Leader** und öffnet die Gruppe; weitere Module
  joinen per Tastendruck. Group-ID persistent gespeichert.

## Rollen
- **Leader** (genau 1): Takt-/Programm-Quelle. Erstwahl per Pairing; **Failover** bei Ausfall
  (deterministisch, z. B. höchste MAC in der Gruppe übernimmt nach Timeout).
- **Follower**: synct auf Leader-Beacon, läuft dazwischen frei.
- **Remote (optional, Pro/Zubehör)**: liefert Timecode/Programm wie ein FT-Remote.

## Nachrichten (klein, selten)
| Typ | Inhalt | Rate |
|---|---|---|
| `BEACON` | group, t_leader, program_id, params_hash, brightness, seq | alle `T_beacon` (Default 1 s) |
| `CMD` | group, type (program/brightness/mode/sleep), value, seq | bei Bedarf, idempotent über seq |
| `PAIR` | group, mac | nur beim Gruppieren |

Kein hochratiges Pose-/Daten-Paket in Lite (das ist Pro + Basisstation).

## Zeitmodell
- Jeder Knoten: lokaler monotoner Takt; `t_sync = local + offset`.
- Bei `BEACON`: `offset ← t_leader + tx_latency_est − local`, geglättet (EMA) gegen Jitter.
- Zwischen Beacons free-running. Fehler ≈ **relativer Takt-Drift × Beacon-Intervall**
  (+ Timestamping-Jitter). Quantifiziert in `engine/sync/clock-model.js`.

## Drift-Budget (Modell-Ergebnis)
Aus `engine/sync/clock-model.js` (6 Props, Quarz ±40 ppm, ESP-NOW-Jitter ±0,2 ms),
Worst-Case Pairwise-Sync-Fehler:

| Beacon-Intervall | nur Drift | mit Jitter | sub-ms? |
|---|---|---|---|
| 1 s | 80 µs | ~450 µs | ✅ |
| 5 s | 400 µs | ~680 µs | ✅ |
| 10 s | 800 µs | ~1080 µs | grenzwertig |
| 30 s | 2400 µs | ~2510 µs | ❌ |

**Schlussfolgerung:** `T_beacon = 1 s` hält den Sync mit dickem Polster sub-ms; bis ~5 s
bleibt es sub-ms. Der **Quarz-Drift ist NICHT der Engpass** — der **Timestamping-Jitter
dominiert**. Engineering-Hebel: Beacon im **RX-Callback** zeitstempeln (Latenz kompensieren),
nicht im App-Layer. Damit ist die „free-running zwischen Beacons"-Strategie (wie Pyroterra)
für synchrone Shows belegt. Messtechnische Bestätigung an LED-Flanken → L5.

## Pro-Erweiterung (kompatibel)
- Basisstation übernimmt die Leader-/Timecode-Rolle (Master) und ergänzt **hochratiges
  Pose-Sharing** + Egress (DMX/OSC) — additiv, gleicher Beacon-Kern.

## Offen / zu validieren (L5)
- Latenz-Kompensation: Timestamping im RX-Callback (nicht im App-Layer).
- Failover-Timing (Leader-Verlust → Neuwahl) ohne Show-Aussetzer.
- Sicherheit: optionaler Group-Key gegen Fremd-Beacons.
