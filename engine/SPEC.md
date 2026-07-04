# Effekt-Engine — Map-Format & Effekt-API (Loop L1)

Dieses Dokument ist das **Gate-Artefakt von L1**: das einzufrierende Map-Format und die
Effekt-API. Solange beide nicht eingefroren sind, ist L1 nicht „done".

Status: **FROZEN v1 — eingefroren am 2026-06-27 (Gate L1 / M1 Go).** Änderungen am
Map-Format oder an der Effekt-Signatur ab hier nur versioniert (v2) mit Begründung im LOG.

---

## 1. Koordinatensystem

- Normierter Raum, jede Achse `[-1, 1]`, Ursprung im geometrischen Zentrum des Kopfes.
- Form-unabhängig: jede Kopf-Form liefert nur eine andere Map, der Effekt-Code bleibt gleich.
- `head-fixed` Koordinaten = fest am Prop (rotieren mit). `world` Koordinaten = im Raum
  stehend (über die IMU-Orientierung gedreht). Beide stehen jedem Effekt zur Verfügung.

## 2. Map-Format (JSON)

```jsonc
{
  "name":  "cube-v1",            // eindeutiger Map-Name
  "space": "normalized [-1, 1]", // Koordinatenkonvention (informativ)
  "n":      5,                   // Generator-Parameter (hier: Grid je Fläche)
  "count":  125,                 // Anzahl LEDs
  "leds": [
    {
      "i":    0,                 // LED-Index (= Position in der Streifen-/Treiberkette)
      "face": "px",              // Flächen-ID: px,nx,py,ny,pz  (nz = Spearmount-Schacht)
      "p":    [1, -0.6, -0.6],   // head-fixed Position [x,y,z] in [-1,1]
      "uv":   [0.1, 0.1],        // Flächen-Koordinaten [u,v] in 0..1
      "n":    [1, 0, 0]          // head-fixed Flächennormale (Einheitsvektor)
    }
    // ... weitere LEDs
  ]
}
```

**Pflichtfelder pro LED:** `i`, `p`. **Empfohlen:** `face`, `uv`, `n` (für flächen- bzw.
normalenbasierte Effekte, z. B. den IMU-Beam). Reihenfolge des Arrays ist egal; `i`
bestimmt die Hardware-Reihenfolge in der LED-Kette.

Referenz-Generator: [`maps/cube.js`](maps/cube.js) → `SmithMaps.cube(n)`.
Der Simulator kann jede Map als JSON exportieren (Button „Download map JSON").

## 3. Effekt-API

Ein Effekt ist eine **reine Funktion**:

```js
fn(led, t, ctx) -> [r, g, b]   // r,g,b in 0..1
```

`led`:

| Feld | Bedeutung |
|---|---|
| `i`, `face` | Index, Flächen-ID |
| `x,y,z` | head-fixed Position (rotiert mit dem Prop) |
| `u,v` | Flächen-Koordinaten 0..1 |
| `nx,ny,nz` | head-fixed Normale |
| `wx,wy,wz` | **world** Position (steht im Raum, während der Prop rotiert) |
| `wnx,wny,wnz` | **world** Normale |

`t`: Sekunden seit Start. `ctx`: `{ up:[x,y,z] }` (world-up / Gravitationsrichtung; später
erweiterbar um Position, Nachbar-Posen, Audio …).

**Konvention:** Rückgabe `[r,g,b]` in `0..1`, *ohne* Helligkeitslimit — das globale
Helligkeits-/Thermo-Ceiling wird vom Host/der Firmware **danach** angewandt und ist per
Effekt **nicht** aushebelbar (Safety in Hardware, vgl. concept.md §3.7).

Referenz-Effekte: [`effects.js`](effects.js) — `axis-gradient`, `plane-sweep (world/head)`,
`radial-pulse`, `noise-field`, `world-beam (IMU)`.

## 4. Was der Freeze festlegt

1. Koordinatenkonvention `[-1,1]`, Ursprung zentral, head-fixed + world.
2. Map-JSON-Schema aus §2 (Feldnamen `i,face,p,uv,n`).
3. Effekt-Signatur `fn(led,t,ctx) -> [r,g,b] (0..1)` und die `led`-Felder aus §3.
4. Helligkeits-Ceiling liegt außerhalb des Effekts (Host/Firmware).

## 5. Maps (im eingefrorenen Format)

| Generator | Map | px | Body | Notiz |
|---|---|---|---|---|
| `maps/cube.js` | cube-v1 | 125 | Würfel | 5 Flächen, 6. = Schacht |
| `maps/discus.js` | discus-full | 32 | Scheibe | Onboard-Außenring 16/Seite (Face a/b) |
| `maps/discus.js` | discus-annular | 32 | Ring | wie full + zentrale Schacht-Bohrung |
| `maps/strip.js` | strip-N | N | Linie | externer linearer Streifen |
| `maps/matrix.js` | matrix-WxH | W·H | Ebene | externe 2D-Matrix, (u,v)-Raster |

Additives optionales Feld `group` (`onboard` | `external`) — bricht den v1-Vertrag nicht
(Pflicht bleibt `i,p`; empfohlen `face,uv,n`). Discus-Onboard-Maße sind aktuell normierte
Annahmen (Ring r≈0,85, 16/Seite) — reale Zahlen kommen aus dem CAD (cad/mechanical-interface.md).

## 6. Parameter-Set je Effekt (additiv, seit 2026-06-27)

Jeder Effekt deklariert ein `controls`-Array (UI-Vars im Pixelblaze-Stil):

```js
{ id:'speed', label:'Sweep speed', type:'slider', min:0, max:3, step:0.01, def:0.8 }
// type ∈ { 'slider' (min/max/step), 'hue' (0..1), 'toggle' (def 0|1) }
```

- Live-Werte kommen in **`ctx.params`** (key = control-`id`). Die Engine merged sie gegen die
  Defaults (`SmithEffects.resolve(effect, overrides)`) und übergibt das aufgelöste Objekt dem
  Effekt-Body. **Öffentlicher Vertrag bleibt `fn(led,t,ctx)`** — `ctx.params` ist die in §3
  vorgesehene additive ctx-Erweiterung, kein v1-Bruch.
- `controls` ist zugleich die Quelle für die **DMX/GDTF-Kanal-Zuordnung (L9)**: jeder
  slider/hue/toggle = ein 8-bit-Kanal (Mapping-Tabelle → docs/dmx-mapping.md).

## 7. Offen / nach dem Freeze

- Firmware-Port der Engine (ESP-IDF) referenziert dieses SPEC als Vertrag.
- ctx additiv erweitern (Nachbar-Pose aus Mesh, Audio) — ohne Bruch des v1-Vertrags.
