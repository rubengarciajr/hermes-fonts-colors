/* Hermes Fonts + Colors — dashboard plugin bundle.
 *
 * This file is hand-rolled (no build step) so anyone forking the GitHub
 * repo can edit it with a plain text editor. Pattern matches
 * hermes-achievements: a single IIFE that grabs the SDK exposed at
 * window.__HERMES_PLUGIN_SDK__ and registers a React component via
 * window.__HERMES_PLUGINS__.register(...).
 *
 * Two responsibilities:
 *   1. Globally apply the user's saved fonts/colors on script load,
 *      BEFORE the Styling tab is ever opened, by injecting a single
 *      <style id="hermes-fonts-colors-overrides"> tag and a Google
 *      Fonts <link> with every curated font. Re-applies on changes
 *      via a CustomEvent.
 *   2. Register the StylingPage React component for the /styling
 *      tab so the user can edit the settings.
 */
(function () {
  "use strict";

  var SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK || !window.__HERMES_PLUGINS__) return;

  var React = SDK.React;
  var hooks = SDK.hooks;
  var C = SDK.components;
  var cn = SDK.utils.cn;

  var PLUGIN_NAME = "hermes-fonts-colors";
  var API_BASE = "/api/plugins/" + PLUGIN_NAME;
  var STYLE_ID = "hermes-fonts-colors-overrides";
  var FONT_LINK_ID = "hermes-fonts-colors-fontlink";
  var EVENT_NAME = "hermes-fonts-colors:changed";

  // -------------------------------------------------------------------------
  // Curated fonts. Stacks include sensible system fallbacks so the dashboard
  // stays readable while Google Fonts is loading or if the network is down.
  // -------------------------------------------------------------------------

  var SYSTEM_SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
  var SYSTEM_MONO = "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace";

  var FONT_STACKS = {
    "DM Sans":              "'DM Sans', " + SYSTEM_SANS,
    "Inter":                "'Inter', " + SYSTEM_SANS,
    "IBM Plex Sans":        "'IBM Plex Sans', " + SYSTEM_SANS,
    "Atkinson Hyperlegible":"'Atkinson Hyperlegible', " + SYSTEM_SANS,
    "System UI":            SYSTEM_SANS,
    "DM Serif Display":     "'DM Serif Display', Georgia, 'Times New Roman', serif",
    "Space Grotesk":        "'Space Grotesk', " + SYSTEM_SANS,
    "JetBrains Mono":       "'JetBrains Mono', " + SYSTEM_MONO,
    "Fira Code":            "'Fira Code', " + SYSTEM_MONO,
    "IBM Plex Mono":        "'IBM Plex Mono', " + SYSTEM_MONO,
    "System Mono":          SYSTEM_MONO
  };

  var SANS_OPTIONS    = ["DM Sans", "Inter", "IBM Plex Sans", "Atkinson Hyperlegible", "System UI"];
  var MONO_OPTIONS    = ["JetBrains Mono", "Fira Code", "IBM Plex Mono", "System Mono"];
  var DISPLAY_OPTIONS = ["DM Sans", "DM Serif Display", "Space Grotesk", "Inter", "IBM Plex Sans"];

  // Single Google Fonts request loads every curated font that isn't a
  // system stack. Encoded by hand so we don't pull in URLSearchParams quirks.
  var GOOGLE_FONTS_URL =
    "https://fonts.googleapis.com/css2" +
    "?family=DM+Sans:wght@400;500;700" +
    "&family=DM+Serif+Display" +
    "&family=Inter:wght@400;500;700" +
    "&family=IBM+Plex+Sans:wght@400;500;700" +
    "&family=Atkinson+Hyperlegible:wght@400;700" +
    "&family=Space+Grotesk:wght@400;500;700" +
    "&family=JetBrains+Mono:wght@400;500;700" +
    "&family=Fira+Code:wght@400;500;700" +
    "&family=IBM+Plex+Mono:wght@400;500;700" +
    "&display=swap";

  var DEFAULTS = {
    version: 1,
    headingFont: "DM Sans",
    bodyFont: "DM Sans",
    monoFont: "JetBrains Mono",
    baseSizePx: 15,
    headingScale: 1.25,
    headingColor: "#ffe6cb",
    bodyColor: "#ffe6cb",
    monoColor: "#a7c5ff",
    accentColor: "#ffbd38",
    // Default matches the Nous DS `text-background-base` so out-of-the-box
    // button rendering doesn't change. Users can pick any contrast color.
    buttonTextColor: "#041c1c",
    enabled: true
  };

  // -------------------------------------------------------------------------
  // Global injection — runs immediately on script load AND on save.
  // -------------------------------------------------------------------------

  function ensureFontLink() {
    if (document.getElementById(FONT_LINK_ID)) return;
    var existing = document.querySelector('link[href="' + GOOGLE_FONTS_URL + '"]');
    if (existing) {
      existing.id = FONT_LINK_ID;
      return;
    }
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = GOOGLE_FONTS_URL;
    link.id = FONT_LINK_ID;
    link.setAttribute("data-hermes-plugin", PLUGIN_NAME);
    document.head.appendChild(link);
  }

  function buildOverrideCSS(s) {
    var bodyStack    = FONT_STACKS[s.bodyFont]    || SYSTEM_SANS;
    var displayStack = FONT_STACKS[s.headingFont] || bodyStack;
    var monoStack    = FONT_STACKS[s.monoFont]    || SYSTEM_MONO;
    var headingScale = Number(s.headingScale) || 1.25;
    var baseSize     = Math.max(10, Math.min(28, Number(s.baseSizePx) || 15));

    // We override:
    //   --theme-font-* and --theme-base-size — design-system font vars.
    //   --color-foreground — the Tailwind `text-foreground` utility most
    //     body prose uses. Overriding here is safe because solid buttons
    //     use `text-background-base` (unchanged) and ghost/outlined buttons
    //     use `text-current` which inherits from html (also unchanged).
    //   --color-ring — focus outline accent.
    //   h1-h6 / code — explicit element selectors with !important.
    //   .font-courier / .font-expanded / .font-compressed / .font-mondwest /
    //     .font-trim — Nous DS @utility font classes hardcoded on sidebar
    //     items, page titles, card titles, inputs, and selects.
    //
    // We deliberately do NOT use a `body { color: ... }` rule. That cascades
    // into Nous DS Buttons that use `text-current` (ghost/outlined variants
    // across the whole dashboard, e.g. /plugins page's "Refresh" button),
    // which would make them adopt the user's bodyColor — a bad outcome when
    // the bodyColor is something like pure white that doesn't read against
    // cream-tinted button backgrounds. Targeting `--color-foreground` instead
    // affects body prose without leaking into button chrome.
    return [
      ":root {",
      "  --theme-font-sans: " + bodyStack + ";",
      "  --theme-font-display: " + displayStack + ";",
      "  --theme-font-mono: " + monoStack + ";",
      "  --theme-base-size: " + baseSize + "px;",
      "  --color-foreground: " + s.bodyColor + ";",
      "  --color-ring: " + s.accentColor + ";",
      "  --hfc-heading-color: " + s.headingColor + ";",
      "  --hfc-body-color: " + s.bodyColor + ";",
      "  --hfc-mono-color: " + s.monoColor + ";",
      "  --hfc-accent-color: " + s.accentColor + ";",
      "  --hfc-button-text-color: " + (s.buttonTextColor || "#041c1c") + ";",
      "}",
      "html, body {",
      "  font-family: " + bodyStack + " !important;",
      "}",
      "h1, h2, h3, h4, h5, h6 {",
      "  font-family: " + displayStack + " !important;",
      "  color: " + s.headingColor + " !important;",
      "  letter-spacing: -0.01em;",
      "}",
      "h1 { font-size: " + (baseSize * Math.pow(headingScale, 3)).toFixed(2) + "px; }",
      "h2 { font-size: " + (baseSize * Math.pow(headingScale, 2)).toFixed(2) + "px; }",
      "h3 { font-size: " + (baseSize * headingScale).toFixed(2) + "px; }",
      "code, kbd, pre, samp, .font-mono, .font-mono-ui {",
      "  font-family: " + monoStack + " !important;",
      "  color: " + s.monoColor + ";",
      "}",
      // Nous DS utility font classes (sidebar, inputs, selects, page titles,
      // card titles). These win over the h1/body selectors because DS
      // components apply them inline.
      ".font-courier, .font-compressed {",
      "  font-family: " + bodyStack + " !important;",
      "  letter-spacing: 0.02em;",
      "}",
      ".font-expanded, .font-mondwest, .font-trim {",
      "  font-family: " + displayStack + " !important;",
      "}",
      // Card / page titles use .font-expanded with uppercase + tracking.
      // Apply heading color here so "FONTS", "SIZES", "COLORS" titles match.
      "[class*='font-expanded'] {",
      "  color: " + s.headingColor + ";",
      "}",
      // Button text color override. Targets active <button> elements
      // dashboard-wide. Skips disabled buttons so the DS-defined
      // disabled state (`disabled:text-midground`) keeps working as a
      // visual cue. Uses !important because the Nous DS button variants
      // ship with explicit `text-background-base` / `text-midground`
      // utility classes that would otherwise win.
      "button:not([disabled]) {",
      "  color: " + (s.buttonTextColor || "#041c1c") + " !important;",
      "}"
    ].join("\n");
  }

  function applyGlobalStyles(settings) {
    if (!settings || settings.enabled === false) {
      var existing = document.getElementById(STYLE_ID);
      if (existing) existing.parentNode.removeChild(existing);
      return;
    }
    ensureFontLink();
    var el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      el.setAttribute("data-hermes-plugin", PLUGIN_NAME);
      document.head.appendChild(el);
    }
    el.textContent = buildOverrideCSS(settings);
  }

  // Cached settings. Refreshed by initial fetch + save events; the
  // StylingPage reads from here for first-render so it doesn't refetch.
  var _cached = null;

  async function fetchSettings() {
    try {
      var res = await fetch(API_BASE + "/settings");
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();
      _cached = data;
      return data;
    } catch (err) {
      console.warn("[hermes-fonts-colors] fetch failed, using defaults:", err);
      _cached = Object.assign({}, DEFAULTS);
      return _cached;
    }
  }

  async function saveSettings(payload) {
    var res = await fetch(API_BASE + "/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    var text = await res.text();
    if (!res.ok) throw new Error(text || ("HTTP " + res.status));
    var data = text ? JSON.parse(text) : payload;
    _cached = data;
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: data }));
    return data;
  }

  async function resetSettings() {
    var res = await fetch(API_BASE + "/reset", { method: "POST" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    var data = await res.json();
    _cached = data;
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: data }));
    return data;
  }

  // Update-check helpers. Backend caches 5 min; we still wrap so a network
  // error surfaces as a typed result instead of a thrown exception (the page
  // shouldn't blow up just because GitHub is unreachable).
  async function fetchVersionInfo() {
    try {
      var res = await fetch(API_BASE + "/version");
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (err) {
      return {
        local: null, remote: null, update_available: false,
        error: String(err.message || err)
      };
    }
  }

  async function runUpdate() {
    var res = await fetch(API_BASE + "/update", { method: "POST" });
    var text = await res.text();
    var body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) { /* ignore */ }
    if (!res.ok) {
      var detail = (body && body.detail) ? body.detail : (text || ("HTTP " + res.status));
      throw new Error(detail);
    }
    return body;
  }

  // Listen for save events from the page so the global style updates
  // even when the page component re-renders multiple times.
  window.addEventListener(EVENT_NAME, function (e) {
    if (e && e.detail) applyGlobalStyles(e.detail);
  });

  // Kick off initial fetch + apply. The Google Fonts <link> goes in
  // immediately so DM Sans / JetBrains Mono start downloading even
  // if the API is slow.
  ensureFontLink();
  fetchSettings().then(applyGlobalStyles);

  // -------------------------------------------------------------------------
  // StylingPage — React component for the /styling tab.
  // -------------------------------------------------------------------------

  var h = React.createElement;

  function FontSelect(props) {
    return h(C.Select, {
      value: props.value,
      onValueChange: props.onChange
    }, props.options.map(function (name) {
      return h(C.SelectOption, {
        key: name,
        value: name,
        style: { fontFamily: FONT_STACKS[name] }
      }, name);
    }));
  }

  function ColorRow(props) {
    return h("div", { className: "hfc-color-row" },
      h(C.Label, { htmlFor: "hfc-" + props.id, className: "hfc-color-label" }, props.label),
      h("div", { className: "hfc-color-input-wrap" },
        h("input", {
          id: "hfc-" + props.id,
          type: "color",
          value: props.value,
          onChange: function (e) { props.onChange(e.target.value); },
          className: "hfc-color-swatch",
          "aria-label": props.label
        }),
        h("code", { className: "hfc-color-hex" }, props.value)
      )
    );
  }

  function PreviewPanel(props) {
    var s = props.settings;
    var bodyStack    = FONT_STACKS[s.bodyFont]    || SYSTEM_SANS;
    var displayStack = FONT_STACKS[s.headingFont] || bodyStack;
    var monoStack    = FONT_STACKS[s.monoFont]    || SYSTEM_MONO;
    var scale        = Number(s.headingScale) || 1.25;
    var size         = Number(s.baseSizePx) || 15;

    return h("div", {
      className: "hfc-preview",
      style: {
        fontFamily: bodyStack,
        fontSize: size + "px",
        color: s.bodyColor
      }
    },
      h("div", {
        className: "hfc-preview-h1",
        style: {
          fontFamily: displayStack,
          color: s.headingColor,
          fontSize: (size * Math.pow(scale, 3)).toFixed(0) + "px"
        }
      }, "The quick brown fox"),
      h("div", {
        className: "hfc-preview-h2",
        style: {
          fontFamily: displayStack,
          color: s.headingColor,
          fontSize: (size * Math.pow(scale, 2)).toFixed(0) + "px"
        }
      }, "jumps over the lazy dog"),
      h("p", { className: "hfc-preview-body" },
        "Hermes runs locally and gives you a live dashboard for sessions, " +
        "tools, costs, and skills. Tweak fonts, sizes, and colors so the " +
        "interface stays comfortable on any monitor."
      ),
      h("p", { className: "hfc-preview-mono", style: { fontFamily: monoStack, color: s.monoColor } },
        "$ hermes dashboard --port 9119"
      ),
      h("p", { className: "hfc-preview-accent", style: { color: s.accentColor } },
        "Accent text & focus rings use this color."
      )
    );
  }

  // Banner shown above page header when a newer release is on GitHub.
  // Renders nothing when versions match or the check failed (offline, etc.).
  function UpdateBanner(props) {
    var info = props.info;
    var phase = props.phase;
    if (!info) return null;

    // We use the default solid Button variant (no invert/outlined/ghost
    // props) so every action here gets `bg-midground text-background-base`
    // — cream background + explicit dark text — regardless of what the user
    // has set --color-foreground to. Critical: outlined/ghost variants
    // inherit text color from the cascade, so a white --color-foreground
    // would render the button text white-on-cream.
    if (phase === "updated") {
      return h("div", { className: "hfc-update-banner hfc-update-success" },
        h("span", null, "Updated to v" + (info.local || "?") + ". Reload the dashboard to apply."),
        h(C.Button, { onClick: function () { window.location.reload(); } }, "Reload dashboard")
      );
    }
    if (phase === "updating") {
      return h("div", { className: "hfc-update-banner" },
        h("span", null, "Updating from v" + info.local + " to v" + info.remote + "…")
      );
    }
    if (phase === "error" && props.errorMessage) {
      return h("div", { className: "hfc-update-banner hfc-update-error" },
        h("span", null, "Update failed: " + props.errorMessage),
        h(C.Button, { onClick: props.onDismiss }, "Dismiss")
      );
    }
    if (info.update_available) {
      return h("div", { className: "hfc-update-banner" },
        h("span", { className: "hfc-update-msg" },
          "Update available: ",
          h("code", null, "v" + info.local), " → ",
          h("code", null, "v" + info.remote)
        ),
        h(C.Button, { onClick: props.onUpdate }, "Update now")
      );
    }
    return null;
  }

  function StylingPage() {
    var useState = hooks.useState;
    var useEffect = hooks.useEffect;
    var useCallback = hooks.useCallback;

    var initial = _cached || DEFAULTS;
    var draftState = useState(initial);
    var draft = draftState[0];
    var setDraft = draftState[1];

    var savedState = useState(initial);
    var saved = savedState[0];
    var setSaved = savedState[1];

    var statusState = useState({ kind: "idle", message: "" });
    var status = statusState[0];
    var setStatus = statusState[1];

    var loadingState = useState(_cached === null);
    var loading = loadingState[0];
    var setLoading = loadingState[1];

    // Update-check state. `versionInfo` holds {local, remote, update_available}
    // from the backend; `updatePhase` walks idle → updating → updated|error.
    var versionInfoState = useState(null);
    var versionInfo = versionInfoState[0];
    var setVersionInfo = versionInfoState[1];

    var updatePhaseState = useState("idle");
    var updatePhase = updatePhaseState[0];
    var setUpdatePhase = updatePhaseState[1];

    var updateErrorState = useState("");
    var updateError = updateErrorState[0];
    var setUpdateError = updateErrorState[1];

    // First-mount fetch (in case the page is opened before the IIFE's
    // initial fetch resolved, or after a long-idle session).
    useEffect(function () {
      var cancelled = false;
      fetchSettings().then(function (data) {
        if (cancelled) return;
        setDraft(data);
        setSaved(data);
        setLoading(false);
        applyGlobalStyles(data);
      });
      return function () { cancelled = true; };
    }, []);

    // Update check on page mount. Backend caches 5 min so this is cheap.
    // Errors silently no-op (banner stays hidden) — we don't want to nag a
    // user who's offline or behind a corporate proxy.
    useEffect(function () {
      var cancelled = false;
      fetchVersionInfo().then(function (info) {
        if (cancelled) return;
        setVersionInfo(info);
      });
      return function () { cancelled = true; };
    }, []);

    var onUpdate = useCallback(async function () {
      setUpdatePhase("updating");
      setUpdateError("");
      try {
        var info = await runUpdate();
        setVersionInfo(info);
        setUpdatePhase("updated");
      } catch (err) {
        setUpdatePhase("error");
        setUpdateError(String(err.message || err));
      }
    }, []);

    var onDismissUpdateError = useCallback(function () {
      setUpdatePhase("idle");
      setUpdateError("");
    }, []);

    var dirty = JSON.stringify(draft) !== JSON.stringify(saved);

    var update = useCallback(function (patch) {
      setDraft(function (prev) { return Object.assign({}, prev, patch); });
    }, []);

    // Live preview: every time `draft` changes, re-apply globally so the
    // entire dashboard reflects the in-progress edits. On a fresh mount,
    // `draft` equals `saved` so this is a no-op.
    useEffect(function () {
      applyGlobalStyles(draft);
    }, [draft]);

    var onSave = useCallback(async function () {
      setStatus({ kind: "saving", message: "Saving…" });
      try {
        var data = await saveSettings(draft);
        setSaved(data);
        setDraft(data);
        setStatus({ kind: "ok", message: "Saved." });
        setTimeout(function () { setStatus({ kind: "idle", message: "" }); }, 1800);
      } catch (err) {
        setStatus({ kind: "error", message: String(err.message || err) });
      }
    }, [draft]);

    var onReset = useCallback(async function () {
      setStatus({ kind: "saving", message: "Resetting…" });
      try {
        var data = await resetSettings();
        setSaved(data);
        setDraft(data);
        setStatus({ kind: "ok", message: "Reset to defaults." });
        setTimeout(function () { setStatus({ kind: "idle", message: "" }); }, 1800);
      } catch (err) {
        setStatus({ kind: "error", message: String(err.message || err) });
      }
    }, []);

    var onRevert = useCallback(function () {
      setDraft(saved);
      setStatus({ kind: "idle", message: "" });
    }, [saved]);

    var onToggle = useCallback(async function () {
      var next = Object.assign({}, draft, { enabled: !draft.enabled });
      setDraft(next);
      try {
        var data = await saveSettings(next);
        setSaved(data);
        setDraft(data);
        setStatus({
          kind: "ok",
          message: data.enabled ? "Enabled." : "Disabled — using theme defaults."
        });
        setTimeout(function () { setStatus({ kind: "idle", message: "" }); }, 1800);
      } catch (err) {
        setStatus({ kind: "error", message: String(err.message || err) });
      }
    }, [draft]);

    if (loading) {
      return h("div", { className: "hfc-loading" }, "Loading styling settings…");
    }

    var statusBadge = null;
    if (status.kind === "saving") {
      statusBadge = h(C.Badge, { tone: "secondary" }, status.message);
    } else if (status.kind === "ok") {
      statusBadge = h(C.Badge, { tone: "success" }, status.message);
    } else if (status.kind === "error") {
      statusBadge = h(C.Badge, { tone: "destructive" }, status.message);
    }

    return h("div", { "data-plugin": PLUGIN_NAME, className: "hfc-page" },
      // Update banner (renders nothing when no update is available)
      h(UpdateBanner, {
        info: versionInfo,
        phase: updatePhase,
        errorMessage: updateError,
        onUpdate: onUpdate,
        onDismiss: onDismissUpdateError
      }),
      // Header
      h("div", { className: "hfc-header" },
        h("div", null,
          h("h1", { className: "hfc-title" }, "Styling"),
          h("p", { className: "hfc-subtitle" },
            "Customize fonts, sizes, and colors. These overrides layer on top of your active theme."
          )
        ),
        h("div", { className: "hfc-header-actions" },
          statusBadge,
          // All action buttons use the default solid Nous Button variant
          // (cream bg + explicit dark text via `text-background-base`). We
          // don't use invert/outlined/ghost props anywhere because those
          // variants inherit text color from the cascade — and a user with
          // a light --color-foreground would get unreadable button text.
          h(C.Button, { onClick: onToggle },
            draft.enabled ? "Disable overrides" : "Enable overrides")
        )
      ),

      // Live preview
      h(C.Card, { className: "hfc-preview-card" },
        h(C.CardHeader, null, h(C.CardTitle, null, "Live preview")),
        h(C.CardContent, null, h(PreviewPanel, { settings: draft }))
      ),

      // Fonts
      h(C.Card, null,
        h(C.CardHeader, null, h(C.CardTitle, null, "Fonts")),
        h(C.CardContent, { className: "hfc-grid" },
          h("div", { className: "hfc-field" },
            h(C.Label, null, "Heading font"),
            h(FontSelect, {
              value: draft.headingFont,
              options: DISPLAY_OPTIONS,
              onChange: function (v) { update({ headingFont: v }); }
            })
          ),
          h("div", { className: "hfc-field" },
            h(C.Label, null, "Body font"),
            h(FontSelect, {
              value: draft.bodyFont,
              options: SANS_OPTIONS,
              onChange: function (v) { update({ bodyFont: v }); }
            })
          ),
          h("div", { className: "hfc-field" },
            h(C.Label, null, "Code / monospace"),
            h(FontSelect, {
              value: draft.monoFont,
              options: MONO_OPTIONS,
              onChange: function (v) { update({ monoFont: v }); }
            })
          )
        )
      ),

      // Sizes
      h(C.Card, null,
        h(C.CardHeader, null, h(C.CardTitle, null, "Sizes")),
        h(C.CardContent, { className: "hfc-grid" },
          h("div", { className: "hfc-field" },
            h(C.Label, { htmlFor: "hfc-base-size" },
              "Base size: ", h("span", { className: "hfc-numeric" }, draft.baseSizePx + "px")
            ),
            h("input", {
              id: "hfc-base-size",
              type: "range",
              min: 10, max: 28, step: 1,
              value: draft.baseSizePx,
              onChange: function (e) { update({ baseSizePx: Number(e.target.value) }); },
              className: "hfc-slider"
            })
          ),
          h("div", { className: "hfc-field" },
            h(C.Label, { htmlFor: "hfc-heading-scale" },
              "Heading scale: ", h("span", { className: "hfc-numeric" }, Number(draft.headingScale).toFixed(2))
            ),
            h("input", {
              id: "hfc-heading-scale",
              type: "range",
              min: 1.0, max: 2.0, step: 0.05,
              value: draft.headingScale,
              onChange: function (e) { update({ headingScale: Number(e.target.value) }); },
              className: "hfc-slider"
            })
          )
        )
      ),

      // Colors
      h(C.Card, null,
        h(C.CardHeader, null, h(C.CardTitle, null, "Colors")),
        h(C.CardContent, { className: "hfc-colors" },
          h(ColorRow, {
            id: "heading-color", label: "Heading color",
            value: draft.headingColor,
            onChange: function (v) { update({ headingColor: v }); }
          }),
          h(ColorRow, {
            id: "body-color", label: "Body color",
            value: draft.bodyColor,
            onChange: function (v) { update({ bodyColor: v }); }
          }),
          h(ColorRow, {
            id: "mono-color", label: "Code color",
            value: draft.monoColor,
            onChange: function (v) { update({ monoColor: v }); }
          }),
          h(ColorRow, {
            id: "accent-color", label: "Accent (focus rings)",
            value: draft.accentColor,
            onChange: function (v) { update({ accentColor: v }); }
          }),
          h(ColorRow, {
            id: "button-text-color", label: "Button text",
            value: draft.buttonTextColor || "#041c1c",
            onChange: function (v) { update({ buttonTextColor: v }); }
          })
        )
      ),

      // Footer actions — all default solid so text is guaranteed dark.
      h("div", { className: "hfc-footer" },
        h(C.Button, { onClick: onReset }, "Reset to defaults"),
        h("div", { className: "hfc-footer-right" },
          dirty
            ? h(C.Button, { onClick: onRevert }, "Revert changes")
            : null,
          h(C.Button, {
            disabled: !dirty || status.kind === "saving",
            onClick: onSave
          }, dirty ? "Save changes" : "Saved")
        )
      ),

      // Version footer — always visible so the user knows what they're on
      // and can see the GitHub origin even when no update is available.
      h("div", { className: "hfc-version" },
        h("span", null,
          "v" + (versionInfo && versionInfo.local ? versionInfo.local : "?"),
          versionInfo && versionInfo.remote && versionInfo.remote === versionInfo.local
            ? " — up to date"
            : null
        ),
        h("a", {
          href: "https://github.com/rubengarciajr/hermes-fonts-colors",
          target: "_blank",
          rel: "noopener noreferrer",
          className: "hfc-version-link"
        }, "github.com/rubengarciajr/hermes-fonts-colors")
      )
    );
  }

  window.__HERMES_PLUGINS__.register(PLUGIN_NAME, StylingPage);
})();
