// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 StaffSmith GmbH
//
// StaffSmith LED Engine — Firmware Port Contract (C), SPEC v1 FROZEN (2026-07-05).
//
// This header is the ESP-IDF/ESP32 C counterpart of the frozen JS/TS engine
// contract in ../../engine/SPEC.md (v1 FROZEN 2026-06-27) and
// ../../engine/effects.js. It is a CONTRACT ONLY: type and function-pointer
// declarations, no implementation, no linkable symbols beyond what a port
// provides. See ../SPEC.md for the full narrative spec (rationale, timing/
// memory budget, open items) this header is the compilable half of.
//
// Portability: standalone C11, only <stdint.h>/<stddef.h>/<stdbool.h>. No
// ESP-IDF headers are pulled in on purpose, so the contract itself can be
// syntax-checked with a plain hosted compiler, off-target, without an
// ESP-IDF toolchain installed. The ESP-IDF port's .c files may freely use
// esp_err_t/gpio_num_t/spi_device_handle_t/etc. internally and translate at
// the boundary (e.g. SMITH_OK == 0 == ESP_OK, so a direct cast is safe).
//
// Explicitly OUT OF SCOPE of this header (separate layers, separate specs):
//   - ESP-NOW mesh, group/leader/beacon, time-sync  -> docs/protocol/mesh-sync.md
//   - DMX/GDTF channel mapping                       -> docs/dmx-mapping.md
//   - Web-UI/WS device protocol, preview frames       -> docs/web-ui-protocol.md
//   - UWB positioning, sensor fusion                  -> repos/staffsmith-led-pro (proprietary)
// Those layers sit ON TOP of / BESIDE this contract; none of them may use
// this header as a place to leak proprietary code — this file stays
// Apache-2.0, same open-core boundary as the rest of engine/.

#ifndef STAFFSMITH_SMITH_ENGINE_H
#define STAFFSMITH_SMITH_ENGINE_H

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

#define SMITH_ENGINE_ABI_VERSION 1  /* bump + note the break in ../SPEC.md and LOG.md on any change */

/* =======================================================================
 * 1. Status codes
 * ===================================================================== */
typedef enum {
    SMITH_OK = 0,
    SMITH_ERR_INVALID_ARG,
    SMITH_ERR_NOT_INITIALIZED,
    SMITH_ERR_UNSUPPORTED,
    SMITH_ERR_TIMEOUT,
    SMITH_ERR_NO_MEM,
    SMITH_ERR_BUS_FAULT
} smith_err_t;

/* =======================================================================
 * 2. Color
 * ===================================================================== */
/* 0..1 float per channel, matching the JS effect return `[r,g,b]`.
 * UNCLAMPED by the effect itself — the brightness/thermal ceiling (§10)
 * is applied by the host AFTER smith_render_frame(), never inside an
 * effect body. Mirrors engine/SPEC.md §3's closing sentence verbatim. */
typedef struct {
    float r, g, b;
} smith_rgb_t;

/* =======================================================================
 * 3. Static map format — engine/SPEC.md §2, ported field-for-field.
 * ===================================================================== */
#define SMITH_FACE_NONE     0xFFu  /* no face id (external strip/matrix LEDs) */
#define SMITH_GROUP_ONBOARD 0u     /* engine/SPEC.md §5 additive `group` field */
#define SMITH_GROUP_EXTERNAL 1u

/* One LED of a compiled map. Required fields per engine/SPEC.md §2: i, p
 * (-> x,y,z here). Recommended: face, uv (-> u,v), n (-> nx,ny,nz) — set
 * to SMITH_FACE_NONE / 0.0f when a generator omits them, same as the JS
 * schema treats them as optional-but-recommended, never as "must be
 * absent". `face` is a small per-body-type numeric id (e.g. discus
 * 'a'/'b' -> 0/1); the JSON string id -> numeric id mapping is fixed by
 * whatever codegen turns a frozen map JSON (as produced by the engine/maps
 * generators, e.g. discus.js) into this array — that generator is out of
 * scope of SPEC v1 (see ../SPEC.md open items). */
typedef struct {
    uint16_t i;          /* LED index == hardware chain position */
    uint8_t  face;       /* face id, or SMITH_FACE_NONE */
    uint8_t  group;      /* SMITH_GROUP_ONBOARD / SMITH_GROUP_EXTERNAL */
    float x, y, z;       /* head-fixed position, normalized [-1,1] */
    float u, v;          /* face coords 0..1 */
    float nx, ny, nz;    /* head-fixed unit normal */
} smith_led_t;

/* A compiled map: name/count + LED array. `leds` MUST live in flash
 * (const/.rodata) — see ../SPEC.md §13 memory constraints. */
typedef struct {
    const char *name;         /* e.g. "discus-full", matches the JSON `name` */
    uint16_t count;
    const smith_led_t *leds;  /* length == count */
} smith_map_t;

/* =======================================================================
 * 4. Pose application — head-fixed -> world, via IMU orientation.
 * design.md §8: "Orientierung (BNO085): per Quaternion welt- statt
 * headfest". Populates the world fields (wx,wy,wz,wnx,wny,wnz) of §5's
 * per-frame LED context by rotating the map's head-fixed p/n through the
 * current orientation quaternion. Declaration only — quaternion math is
 * a port detail; a port with no IMU (bring-up, bench test) MAY implement
 * this as an identity (world == head-fixed), same shortcut the reference
 * MockDevice takes in webui/protocol.js. `quat_wxyz` is [w,x,y,z],
 * unit-length, BNO085 convention. */
typedef struct smith_render_led smith_render_led_t; /* fwd-decl, defined in §5 */

smith_err_t smith_apply_pose(const smith_map_t *map,
                              const float quat_wxyz[4],
                              smith_render_led_t *out_leds,
                              size_t out_len);

/* =======================================================================
 * 5. Per-frame render context — engine/effects.js `led` argument, ported.
 * ===================================================================== */
/* Field names deliberately match engine/effects.js's banner comment
 * 1:1 (i, face, x/y/z, u/v, nx/ny/nz, wx/wy/wz, wnx/wny/wnz) so the JS
 * reference and a C port read side by side without a translation table. */
struct smith_render_led {
    uint16_t i;
    uint8_t  face;
    float x, y, z;        /* head-fixed (rotates WITH the prop) */
    float u, v;
    float nx, ny, nz;     /* head-fixed normal */
    float wx, wy, wz;     /* world (stays fixed in the room, from §4) */
    float wnx, wny, wnz;  /* world normal */
};

/* =======================================================================
 * 6. Controls — engine/SPEC.md §6 (Pixelblaze-style UI vars).
 * ===================================================================== */
typedef enum {
    SMITH_CTRL_SLIDER = 0,  /* value in [min,max], quantized to `step` upstream (UI/DMX) */
    SMITH_CTRL_HUE,         /* value in [0,1], hue-wheel widget; min/max fixed at 0/1 */
    SMITH_CTRL_TOGGLE       /* value in {0,1}; min/max/step unused (leave 0) */
} smith_control_type_t;

/* One entry of an effect's `controls[]`, mirroring one object of the JS
 * `controls` array verbatim (id/label/type/min/max/step/def). */
typedef struct {
    const char *id;     /* stable key — also the DMX/GDTF param-channel source, docs/dmx-mapping.md */
    const char *label;  /* human-readable, UI-facing */
    smith_control_type_t type;
    float min, max, step;  /* unused (0) for SMITH_CTRL_TOGGLE */
    float def;
} smith_control_t;

/* Engine-level ceiling on controls per effect. NOTE: this is NOT the
 * DMX Standard-Mode limit (docs/dmx-mapping.md hard-caps Standard-Mode
 * at 4 param channels / Ch3-6); SMITH_MAX_CONTROLS is the firmware
 * engine's own generous forward-compat cap, independent of any one
 * control-surface's channel budget. */
#define SMITH_MAX_CONTROLS 8u
#if defined(__cplusplus)
static_assert(SMITH_MAX_CONTROLS <= 8u,
              "smith_param_overrides_t.set is a uint8_t bitmask - widen both together");
#else
_Static_assert(SMITH_MAX_CONTROLS <= 8u,
               "smith_param_overrides_t.set is a uint8_t bitmask - widen both together");
#endif

/* =======================================================================
 * 7. Parameter overrides & resolution — engine/SPEC.md §6 `ctx.params`.
 * ===================================================================== */
/* Sparse live overrides from a control surface (Web-UI slider, DMX
 * channel block, ...), positional and index-aligned with the target
 * effect's controls[] (index k <-> controls[k]). This trades the JS
 * object's dynamic string-keyed sparsity for a fixed-size array + a
 * presence bitmask (no heap, no hashing, embedded-friendly). Bit k of
 * `set` == 1 means values[k] is a live override; bit clear means "fall
 * back to controls[k].def", the same semantics as a JS override object
 * simply not having that key. */
typedef struct {
    float values[SMITH_MAX_CONTROLS];
    uint8_t set;  /* bitmask, bit k -> values[k] valid; sized for SMITH_MAX_CONTROLS <= 8 */
} smith_param_overrides_t;

/* Fully resolved parameters for one effect invocation — every slot
 * 0..effect->control_count-1 populated (default merged with any live
 * override), index-aligned with that effect's controls[]. This is what
 * an effect body reads as ctx->params (§8); mirrors the JS engine's
 * `SmithEffects.resolve()` output. */
typedef struct {
    float values[SMITH_MAX_CONTROLS];
} smith_params_t;

/* =======================================================================
 * 8. Effect API — engine/SPEC.md §3, ported 1:1.
 * ===================================================================== */
/* Per-frame effect context. `up` = world-up/gravity direction
 * (engine/SPEC.md §3's ctx.up). `t` = seconds, monotonic, MESH-SYNCED
 * (t_sync per docs/protocol/mesh-sync.md) — NOT wall-clock-since-boot on
 * its own, and NEVER reset per-effect or per-pattern-switch. `params` =
 * this call's resolved parameters (§7).
 *
 * Additive-only: new fields append at the end, never inserted, so
 * already-compiled effect bodies that only read `up`/`t`/`params` stay
 * valid — the same "ctx additiv erweiterbar" rule engine/SPEC.md §7
 * states for the JS side (future: neighbor pose, audio, ...). */
typedef struct {
    float up[3];
    float t;
    const smith_params_t *params;
} smith_ctx_t;

/* An effect body: pure function of (led, ctx) -> rgb. MUST NOT retain
 * state between calls (no static/persistent locals) — this is a HARD
 * requirement, not a style preference: docs/protocol/mesh-sync.md's
 * whole free-running-between-beacons sync model depends on
 * `color = f(t_sync, program, params)` being a true function with no
 * hidden state, so that two modules on the same program+params render
 * bit-identical output from ctx->t alone. Mirrors engine/SPEC.md §3's
 * "reine Funktion" requirement. */
typedef smith_rgb_t (*smith_effect_fn_t)(const smith_render_led_t *led, const smith_ctx_t *ctx);

/* One registered effect: id/label + declared controls + fn pointer.
 * Mirrors one `fx({...})`-wrapped entry of engine/effects.js's EFFECTS[]. */
typedef struct {
    const char *id;
    const char *label;
    const smith_control_t *controls;  /* length == control_count, flash-resident */
    uint8_t control_count;            /* <= SMITH_MAX_CONTROLS */
    smith_effect_fn_t fn;
} smith_effect_t;

/* Effect registry — a fixed table (flash-resident), analogous to
 * SmithEffects.list/byId. Declaration only — no implementation here. */
typedef struct {
    const smith_effect_t *effects;
    uint8_t count;
} smith_effect_registry_t;

/* Look up an effect by id; returns NULL if not found. engine/SPEC.md's
 * JS SmithEffects.byId() falls back to effects[0] on a miss — a port MAY
 * do the same at its call site, but this contract does not mandate it
 * (returning NULL and letting the caller decide is safer for firmware:
 * silently substituting a different effect than the one requested over
 * DMX/WS is a worse failure mode than an explicit error). */
const smith_effect_t *smith_registry_find(const smith_effect_registry_t *reg, const char *id);

/* Merge live overrides over an effect's declared defaults into a fully
 * populated smith_params_t, mirroring SmithEffects.resolve(). `overrides`
 * may be NULL (defaults only). Declaration only. */
void smith_resolve_params(const smith_effect_t *effect,
                           const smith_param_overrides_t *overrides,
                           smith_params_t *out);

/* =======================================================================
 * 9. Frame render — engine loop contract.
 * ===================================================================== */
/* Renders `led_count` already-posed LEDs (§4/§5) of `effect` at time
 * ctx->t into `out_rgb` (packed r,g,b,r,g,b,... floats 0..1, length >=
 * led_count*3). Brightness/ceiling is deliberately NOT applied here
 * (§10 is a separate pass) so the same render can feed either a
 * brightness-applied driver frame (§11) or a pre-brightness preview
 * stream (docs/web-ui-protocol.md `preview` messages), matching how
 * webui/protocol.js's MockDevice.renderPreviewFrame() applies
 * brightness AFTER calling the effect fn, not before/inside it.
 * Declaration only. */
smith_err_t smith_render_frame(const smith_effect_t *effect,
                                const smith_render_led_t *leds,
                                size_t led_count,
                                const smith_ctx_t *ctx,
                                float *out_rgb,
                                size_t out_rgb_len);

/* =======================================================================
 * 10. Brightness / thermal ceiling — safety invariant, HARD requirement.
 * ===================================================================== */
/* Mirrors webui/protocol.js: "there is intentionally NO setCeiling
 * message" and docs/design.md §6's "globales Helligkeitslimit ...
 * wahrscheinlichster Flaschenhals". `ceiling` MUST be derived from a
 * measured/compiled-in hardware limit (L2 gate: current/thermal/battery
 * budget) and MUST NOT be settable by ANY wire protocol (WS/DMX/ESP-NOW)
 * — a conforming port exposes NO function that writes `ceiling` from
 * network input, ever. Only `requested` is settable (setBrightness /
 * DMX Dimmer channel, docs/dmx-mapping.md Ch1). */
typedef struct {
    float requested;  /* 0..1, settable via setBrightness / DMX Dimmer */
    float ceiling;    /* 0..1, HW-derived, NOT settable over any wire protocol */
} smith_brightness_t;

static inline float smith_effective_brightness(const smith_brightness_t *b) {
    float r = b->requested < 0.0f ? 0.0f : (b->requested > 1.0f ? 1.0f : b->requested);
    float c = b->ceiling   < 0.0f ? 0.0f : (b->ceiling   > 1.0f ? 1.0f : b->ceiling);
    return r < c ? r : c;
}

/* =======================================================================
 * 11. LED output driver abstraction — RMT (one-wire) + SPI (4-wire).
 * design.md §5/§10, loop-plan.md L3 gate ("Treiber-Layer (RMT+SPI)
 * fertig"). One config type + one vtable cover both bus families so the
 * render layer above (§9) never sees the wire protocol.
 * ===================================================================== */
typedef enum {
    SMITH_LED_PROTO_WS2812 = 0,  /* one-wire, RMT, GRB, ~800 kHz */
    SMITH_LED_PROTO_SK6812,      /* one-wire, RMT, GRB or GRBW */
    SMITH_LED_PROTO_APA102,      /* SPI, BGR + 5-bit global-brightness frame */
    SMITH_LED_PROTO_SK9822,      /* SPI, APA102-compatible framing */
    SMITH_LED_PROTO_HD107S       /* SPI, APA102-compatible framing, higher clock */
} smith_led_protocol_t;

typedef enum {
    SMITH_LED_BUS_RMT = 0,  /* one-wire, timing-critical, see ../SPEC.md §timing */
    SMITH_LED_BUS_SPI  = 1  /* clock+data, host-paced */
} smith_led_bus_t;

typedef struct {
    smith_led_protocol_t protocol;
    smith_led_bus_t bus;
    int gpio_data;          /* required for both buses */
    int gpio_clock;         /* SPI only; -1 for RMT (one-wire has no clock line) */
    uint32_t spi_clock_hz;  /* SPI only; 0 for RMT */
    uint16_t led_count;     /* <= the map's count feeding this output */
    bool rgbw;              /* SK6812 4-channel variant; ignored for SPI protocols */
} smith_led_output_config_t;

typedef struct smith_led_driver smith_led_driver_t;

/* vtable a concrete RMT or SPI backend implements. `impl` is the
 * backend's opaque state (RMT channel handle / SPI device handle, ...);
 * this contract never reaches into it — callers only ever go through
 * the function pointers. Declaration only, no backend implementation
 * ships with this header. */
struct smith_led_driver {
    smith_err_t (*init)(smith_led_driver_t *self, const smith_led_output_config_t *cfg);

    /* Push one full frame. `data` is pre-quantized 8-bit per channel,
     * length == led_count * (rgbw ? 4 : 3), with brightness/ceiling
     * (§10) already applied — the driver layer does wire framing only,
     * never color math. MAY be asynchronous (RMT); the caller must not
     * mutate `data` until wait_done() returns SMITH_OK. */
    smith_err_t (*write)(smith_led_driver_t *self, const uint8_t *data, size_t len);

    /* Block until the last write() has finished driving the wire, or
     * `timeout_ms` elapses (-> SMITH_ERR_TIMEOUT). Synchronous backends
     * (typical SPI use) may return SMITH_OK immediately. */
    smith_err_t (*wait_done)(smith_led_driver_t *self, uint32_t timeout_ms);

    void (*deinit)(smith_led_driver_t *self);

    void *impl;
};

#ifdef __cplusplus
}
#endif

#endif /* STAFFSMITH_SMITH_ENGINE_H */
