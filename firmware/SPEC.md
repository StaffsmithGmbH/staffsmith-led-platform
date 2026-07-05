# Firmware-Engine-Port — SPEC v1 FROZEN (ESP-IDF, C-Vertrag)

Dieses Dokument + [`include/smith_engine.h`](include/smith_engine.h) bilden zusammen den
**C-Port-Vertrag** der eingefrorenen JS/TS-Engine ([`../engine/SPEC.md`](../engine/SPEC.md)
v1 FROZEN 2026-06-27, [`../engine/effects.js`](../engine/effects.js)). Nächster Track-A-Schritt
laut [loops/STATE.md](../../../loops/STATE.md) „Nächste Aktionen" / [STATUS.md](../../../STATUS.md).

**Status: FROZEN v1 — eingefroren am 2026-07-05, per User-Entscheid.** Kein Firmware-Code, keine
`.c`-Implementierung — nur Vertrag (Spec + kompilierbarer Header ohne Implementierung), wie im
Ticket gefordert.

## 1. Scope

Diese Spec deckt **nur** ab:
- Map-Datentypen (`../engine/SPEC.md` §2 → C-Structs)
- Effekt-API (`fn(led,t,ctx) -> [r,g,b]` → C-Funktionszeiger-Vertrag)
- Controls/Parameter-Resolution (`../engine/SPEC.md` §6 → feste, positionale Arrays)
- Helligkeits-/Thermo-Ceiling-Safety-Invariante (strukturell, nicht nur dokumentiert)
- LED-Ausgangs-Treiber-Abstraktion (RMT Eindraht + SPI 4-adrig)
- ESP32-spezifische Timing- und Speicher-Constraints

**Explizit NICHT** Teil dieser Spec (eigene Specs/Schichten, außerhalb des Scopes):
- ESP-NOW-Mesh / Gruppen / Leader-Wahl / Beacon-Sync → [`../docs/protocol/mesh-sync.md`](../docs/protocol/mesh-sync.md)
- DMX/GDTF-Kanal-Mapping → [`../../../docs/dmx-mapping.md`](../../../docs/dmx-mapping.md)
- Web-UI/WS-Geräte-Protokoll, Preview-Frames → [`../../../docs/web-ui-protocol.md`](../../../docs/web-ui-protocol.md)
- UWB-Positionierung, Sensorfusion, Basisstation → `repos/staffsmith-led-pro` (proprietär, NIEMALS in diesem öffentlichen Repo)
- Jegliche Firmware-**Implementierung** — dies ist ein Vertrag (Spec + kompilierbarer Header
  mit reinen Deklarationen), kein Code. Keine `.c`-Dateien in diesem Ticket.

## 2. Toolchain & Zielplattform

- Framework: **ESP-IDF** (laut [`../../../docs/design.md`](../../../docs/design.md) §10, „präzises Timing").
- MCU: **ESP32-S3-MINI-1-N8** ([`../../../docs/pcb-spec-discus-v1.md`](../../../docs/pcb-spec-discus-v1.md)
  §3, U1) — Dual-Core Xtensa LX7, WiFi+BLE, natives USB, RMT- + SPI-Peripherie, 8 MB Flash / 512 KB SRAM.
- Sprache: **C11** (`-std=gnu17`/`-std=c11` oder neuer — der Header nutzt `_Static_assert` und
  `//`-Kommentare, beides ≥C99; ESP-IDFs Standard-Toolchain-Profil zielt bereits auf C11+, es ist
  also keine Projekt-Config-Änderung nötig).
- `include/smith_engine.h` ist bewusst **ESP-IDF-Header-frei** (nur `<stdint.h>`/`<stddef.h>`/
  `<stdbool.h>`), damit der Vertrag selbst mit einem gewöhnlichen Hosted-Compiler abseits des
  Zielsystems syntaktisch geprüft werden kann; die `.c`-Dateien eines echten Ports dürfen intern
  frei `esp_err_t`, `driver/rmt_tx.h`, `driver/spi_master.h` etc. verwenden und an der Grenze
  übersetzen (`SMITH_OK == 0 == ESP_OK`, direkt castbar).

## 3. Mapping-Tabelle: JS/TS-Engine ↔ C-Vertrag

| JS/TS (`engine/SPEC.md`, `engine/effects.js`) | C (`include/smith_engine.h`) | Notiz |
|---|---|---|
| Map-JSON `{name,space,count,leds:[{i,face,p,uv,n,group?}]}` | `smith_map_t{name,count,leds}` / `smith_led_t{i,face,group,x,y,z,u,v,nx,ny,nz}` | `p`→x,y,z; `uv`→u,v; `n`→nx,ny,nz. `face`-String-ID → kleine numerische ID via Codegen (§9, außerhalb des Scopes). |
| `fn(led,t,ctx) -> [r,g,b]` | `smith_effect_fn_t: (const smith_render_led_t*, const smith_ctx_t*) -> smith_rgb_t` | `t` wandert in C in `ctx.t` (Struct billiger erweiterbar als wachsende Arg-Liste); semantisch identisch. |
| `led.{i,face,x,y,z,u,v,nx,ny,nz,wx,wy,wz,wnx,wny,wnz}` | `smith_render_led_t` (gleiche Feldnamen) | 1:1, siehe `engine/effects.js`-Banner-Kommentar. |
| `ctx.up`, `ctx.params` | `smith_ctx_t.up`, `smith_ctx_t.params` (`smith_params_t*`) | 1:1. |
| `controls[]` (`{id,label,type,min,max,step,def}`) | `smith_control_t[]` + `smith_control_type_t`-Enum | 1:1; `type`-String → Enum (`slider`/`hue`/`toggle`). |
| `ctx.params`-Objekt (sparse, string-keyed) | `smith_param_overrides_t` (festes Array + Presence-Bitmaske) | JS-Sparsity via dynamische Objekt-Keys → C-Sparsity via Bitmaske; beides heißt „fehlt → Default". |
| `SmithEffects.resolve(effect, overrides)` | `smith_resolve_params(effect, overrides, out)` | Gleiche Merge-Semantik: Override gewinnt falls vorhanden, sonst `controls[k].def`. |
| `SmithEffects.byId(id)` | `smith_registry_find(reg, id)` | JS fällt bei Miss auf `effects[0]` zurück; C liefert `NULL` bei Miss (sicherer Default für Firmware, s. Header-Kommentar). |
| Host wendet Ceiling NACH dem Effekt an (`webui/protocol.js`) | `smith_render_frame()` liefert vor-Helligkeit zurück; `smith_effective_brightness()` + Treiber-`write()` wenden sie danach an | Gleiche Zwei-Phasen-Pipeline: erst Farbe rendern, dann klemmen+quantisieren+treiben. |
| Keine `setCeiling`-Message (`protocol.js`) | Kein Setter für `smith_brightness_t.ceiling` in diesem Header | Gleiche Invariante, jetzt auch in C strukturell — Grep nach einem Ceiling-schreibenden Wire-Handler als Review-Checkpoint. |
| — (kein JS-Äquivalent nötig) | §4 Pose-Anwendung (`smith_apply_pose`) | Neu im Port: JS-Referenz hat keine IMU, Mock setzt world==head-fixed (`protocol.js` `renderPreviewFrame`); ein echter Kopf braucht diesen Schritt. |
| — | §11 Treiber-Abstraktion (RMT/SPI) | Neu im Port: JS sagt nichts über Wire-Protokolle; hier kommen `design.md` §5/§10 und `loop-plan.md` L3 in den Vertrag. |

## 4. Determinismus-Anforderung (übernommen aus dem Lite-Sync)

[`../docs/protocol/mesh-sync.md`](../docs/protocol/mesh-sync.md)s gesamtes
Free-running-zwischen-Beacons-Modell beruht darauf, dass
`farbe = f(t_sync, programm, params)` eine **reine Funktion** ist. Der C-Vertrag übernimmt das
wörtlich: `smith_effect_fn_t`-Implementierungen DÜRFEN KEINEN statischen/persistenten Zustand
zwischen Aufrufen halten. Zwei Module mit demselben `program` + aufgelösten `params`, gegeben
denselben `ctx->t` (mesh-synchronisierte Uhr), MÜSSEN bitidentische Frames rendern — das ist,
was dem Mesh erlaubt, ganz ohne Live-Pose-/Farb-Datenstrom auszukommen
([`../../../docs/lite-tier-spec.md`](../../../docs/lite-tier-spec.md)). `ctx->t`-Semantik: Sekunden,
monoton, `t_sync` (Leader-Beacon-korrigierte lokale Uhr, s. `mesh-sync.md`s „Zeitmodell") — NICHT
rohes `esp_timer_get_time()`/`millis()`, und NICHT zurückgesetzt bei Pattern-Wechsel.

Zeit-Repräsentation: die Sync-Uhr intern als `uint32_t`-Millisekunden-Zähler halten (passt zu
`mesh-sync.md`s Offset-Modell, vermeidet Float-Akkumulationsfehler über lange Laufzeiten) und
erst einmal pro Frame am Render-Aufrufpunkt umrechnen: `ctx.t = t_sync_ms / 1000.0f`. `float`
(nicht `double`) ist bewusst gewählt — für visuelle LED-Effekte liegt `float`s ~2·10⁻⁴s-Auflösung
bei einer Stunde Laufzeit (`t≈3600`, 24-Bit-Mantisse) weit unter allem Wahrnehmbaren, während
`double` den Speicher pro LED-Kontext ohne sichtbaren Nutzen auf dieser MCU-Klasse verdoppeln würde.

## 5. Helligkeits-/Thermo-Ceiling — Safety-Invariante

Laut [`../../../docs/design.md`](../../../docs/design.md) §6 und `concept.md` §3.7 (referenziert von
`engine/SPEC.md` §3 und `webui/protocol.js`): die Ceiling ist hardware-/firmwareseitig erzwungen
und darf **über kein Wire-Protokoll** angehoben werden (WS-UI `setBrightness`, DMX-Dimmer-Kanal,
ESP-NOW-Gruppenkommando). Der C-Vertrag macht diese Asymmetrie strukturell:
`smith_brightness_t.ceiling` hat in diesem Header keinen entsprechenden,
Message-Handler-beschreibbaren Pfad — nur `.requested` ist setzbar. Ein Port-Review MUSS
verifizieren, dass kein ESP-NOW-/DMX-/WS-Message-Handler jemals `.ceiling` zuweist, außer aus
einer gemessenen/einkompilierten Konstante oder einem geschützten Kalibrierungs-Pfad (z. B. NVS,
nur in einem Werks-Kalibrierungs-Build beschrieben, nie aus einer Laufzeit-Netzwerk-Message).

## 6. LED-Ausgangs-Treiber-Abstraktion (RMT + SPI)

`loop-plan.md`s L3-Gate: *„ESP32-S3 treibt WS2812 (RMT) und APA102/SK9822 (SPI);
Treiber-Abstraktion... Refreshrate/Glätte (APA102 bei schneller Bewegung) ok,
Protokollumschaltung funktioniert → Treiber-Layer fertig."* `smith_led_driver_t` (Header §11) ist
die Abstraktion, an der dieses Gate gemessen wird: eine `init/write/wait_done/deinit`-Vtable,
gewählt über `smith_led_output_config_t.protocol`/`.bus`, sodass die Render-Schicht (Header §9)
protokoll-agnostisch bleibt. Zwei konkrete Backends werden zur Implementierungszeit erwartet
(außerhalb des Scopes dieses Tickets):
- **RMT-Backend** — `SMITH_LED_PROTO_WS2812`/`SMITH_LED_PROTO_SK6812`, ein GPIO, hardware-getimt
  über den RMT-Symbolpuffer (niemals bit-banged).
- **SPI-Backend** — `SMITH_LED_PROTO_APA102`/`SMITH_LED_PROTO_SK9822`/`SMITH_LED_PROTO_HD107S`,
  GPIO-Paar (Clock+Data) über `spi_master`.

Sowohl die beiden Onboard-LED-Seiten (A/B) als auch der externe J2-Ausgang
([`../../../docs/pcb-spec-discus-v1.md`](../../../docs/pcb-spec-discus-v1.md) §2) sind separate
`smith_led_output_config_t`-Instanzen gegen denselben Treiber-Vertrag — der Pegelwandler (U8,
SN74LVC2T45) sitzt in beiden Fällen zwischen ESP32-GPIO und LEDs und ist für diese Abstraktion
transparent.

## 7. Timing-Constraints (ESP32-S3)

- **WS2812/SK6812 (RMT, Eindraht, ~800 kHz):** Bit-Zelle ≈1,25 µs, Datenblatt-Toleranz ≈±150 ns
  → MUSS die RMT-Peripherie-Hardware-Symbolpuffer nutzen, NIEMALS eine bit-gebangte GPIO-Schleife
  mit deaktivierten Interrupts (würde WiFi/ESP-NOW/BLE für den ganzen Frame blockieren). Ein
  `write()`-Aufruf == eine RMT-Transaktion von `led_count * (rgbw ? 32 : 24)` Bits. Mindestens
  ≥280 µs Low-„Reset"-Lücke zwischen Frames (`SMITH_WS2812_RESET_US`).
- **APA102/SK9822/HD107S (SPI):** Taktrate ist verkabelungs-/modulabhängig (konservativ starten —
  einige MHz — empirisch bei L3 verifizieren); kein Bit-Timing-Constraint, daher ist die
  Refreshrate host-getaktet statt protokoll-getaktet. Das ist, warum `design.md` SPI-Streifen
  „für schnelle Props" bevorzugt — das L3-Gate-Kriterium „Refreshrate/Glätte bei schneller
  Bewegung" testet im Kern genau diesen Bus-Spielraum gegenüber RMTs fester 800-kHz-Decke.
- **Frame-Budget:** an der L2-Auslegungs-Ceiling von 100 px (`design.md` §6,
  `SMITH_DESIGN_CEILING_LEDS`), Ziel ≥60 Hz kombiniertes Effekt-Rendern + Treiber-Push
  (`SMITH_TARGET_FRAME_HZ`) — reißt die WS2812-Reset-Lücken-Untergrenze komfortabel und passt zu
  „glatte Darstellung bei Rotation" aus `design.md` §5.

## 8. Speicher-Constraints (ESP32-S3-MINI-1-N8: 8 MB Flash / 512 KB SRAM)

- `smith_map_t.leds` MUSS im Flash liegen (`const`/`.rodata`), zur Build-Zeit aus der
  eingefrorenen Map-JSON (`engine/SPEC.md` §2) generiert — niemals zur Laufzeit aus JSON
  geparst, niemals heap-alloziert.
- Die Frame-Puffer pro Ausgang (Float-Renderpuffer aus Header §9 + quantisierter Treiberpuffer
  aus §11) sind die einzigen nennenswerten Pro-Frame-SRAM-Kosten. Bei `SMITH_DESIGN_CEILING_LEDS`
  (100 px): Renderpuffer `100*3*sizeof(float)` = 1200 B, quantisierter Puffer (RGBW-Worst-Case)
  `100*4` = 400 B — vernachlässigbar gegen 512 KB SRAM, selbst mit beiden Onboard-Seiten + dem
  externen J2-Ausgang gleichzeitig resident (≈4,8 KB gesamt).
- Keine dynamische Allokation (`malloc`/`new`) im Render- oder Treiber-Write-Hot-Path — Puffer
  sind fest dimensioniert (auf `SMITH_DESIGN_CEILING_LEDS`), einmalig bei Init alloziert.
- `smith_effect_registry_t` sowie jede `smith_effect_t`/`smith_control_t`-Tabelle sind
  Flash-resident konstant, analog dazu, dass das JS-`EFFECTS`-Array eine statische
  Modul-Level-Konstante in `engine/effects.js` ist.

## 9. Was diese Spec bewusst offenlässt (nicht blockierend, für später vorgemerkt)

- Das **Codegen-Tool** Map-JSON → `smith_map_t`/`smith_led_t` (analog zu `tools/gen-dmx-map.js`,
  aber für C statt Markdown/GDTF). Nötig, bevor eine echte Map in Firmware läuft; nicht nötig,
  um diesen Vertrag zu reviewen.
- Konkrete RMT- und SPI-Treiber-**Implementierungen** (`.c`-Dateien) — explizit außerhalb des
  Scopes dieses Tickets (nur Spec, laut `loops/STATE.md`).
- Die **Mesh-/ESP-NOW-Brücke**, die eine empfangene `BEACON`/`CMD`
  ([`../docs/protocol/mesh-sync.md`](../docs/protocol/mesh-sync.md)) in einen `smith_ctx_t.t`-Wert
  und ein `(effect, smith_param_overrides_t)`-Paar übersetzt.
- Die **DMX-Kanalblock → `smith_param_overrides_t`**-Brücke
  ([`../../../docs/dmx-mapping.md`](../../../docs/dmx-mapping.md)s Standard-Mode Ch3–6 → positionale Overrides).
- IMU-Quaternion-Erfassung (BNO085-Treiber), die `smith_apply_pose()` speist.

## 10. Freeze-Status

**FROZEN v1 — eingefroren am 2026-07-05, per User-Entscheid.** Ursprünglich sah dieses Dokument
vor, den Vertrag erst einzufrieren, sobald L3s Gate auf echter ESP32-S3-Hardware erfüllt ist
(Refreshrate/Glätte verifiziert, Protokollumschaltung bewiesen). Da weiterhin kein ESP32-S3-Dev-Kit
vorliegt (L2/L4-Teile laut [`../../../STATUS.md`](../../../STATUS.md) noch in Bestellung), ist
dieses L3-Hardware-Gate NICHT erfüllt — der Freeze wurde stattdessen bewusst per expliziter
User-Entscheidung vorgezogen, um darauf aufbauende Track-A-Arbeit (z. B. den Codegen-Baustein aus
§9, Map-JSON → C) auf einem stabilen Vertrag umsetzen zu können, statt auf Hardware zu warten.
L3s Messnachweis bleibt ein offener, nachgelagerter Bestätigungspunkt (kein Blocker mehr für
diesen Vertrag selbst) — sollte er strukturelle Änderungen erzwingen, gilt dafür dieselbe
versionierte Bruch-Regel wie für jede andere Änderung ab jetzt: analog zu `engine/SPEC.md`
braucht jede Änderung nach diesem Freeze einen `SMITH_ENGINE_ABI_VERSION`-Bump + einen
begründeten LOG.md-Eintrag.

## 11. Syntaxprüfung

Kein lokal installierter C-Compiler (kein `gcc`/`clang` in PATH, weder Git-Bash noch nativ
Windows) und keine nutzbare WSL-Linux-Distro (`wsl -l -v` zeigt nur `docker-desktop`, keine
User-Distro). Docker Desktop war jedoch verfügbar und konnte Images von Docker Hub ziehen —
damit wurde eine echte Compiler-Prüfung statt bloßem manuellem Review durchgeführt:

Ein Wegwerf-Container (`alpine:3.20` + `apk add gcc musl-dev g++`, nicht Teil des Repos) hat
[`include/smith_engine.h`](include/smith_engine.h) über eine kleine Testdatei geprüft, die den
Header zweimal inkludiert (Include-Guard-Check) und jeden deklarierten Typ/jede Funktion/jedes
Funktionszeiger-Feld tatsächlich benutzt (Dummy-Effekt-Funktion, Dummy-Treiber-Vtable, Map/
Registry/Params-Instanzen), um auch Signatur-Inkompatibilitäten zu fangen, nicht nur
Klammern-/Strichpunkt-Fehler:

```
gcc -std=c11    -Wall -Wextra           -Werror -fsyntax-only smith_engine_test.c   → C11_OK
gcc -std=gnu17  -Wall -Wextra -Wpedantic -Werror -fsyntax-only smith_engine_test.c  → C_PEDANTIC_OK
g++ -std=c++17  -Wall -Wextra           -Werror -fsyntax-only -x c++ smith_engine_test.c → CPP_OK
```

**Ein Fund + Fix in der ersten Runde:** `-Wcomment` schlug auf ein wörtliches `/*` innerhalb
zweier Kommentare an (`engine/*.` und `engine/maps/*.js` in Prosa-Text) — umformuliert, kein
funktionaler Fehler, aber sauberer. **Zweiter Fund + Fix:** `_Static_assert` ist in C11 ein
Schlüsselwort, in C++ nicht (dort `static_assert`) — der Header kompilierte in C++-Modus (wegen
des `extern "C"`-Blocks für C++-Interop) deshalb nicht; behoben mit
`#if defined(__cplusplus) ... static_assert ... #else ... _Static_assert ... #endif`. Beide Fixes
sind im ausgelieferten Header enthalten; die Testdatei selbst ist Scratch-Material und wird
nicht ins Repo committet.
