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
    //   --theme-font-* and --theme-base-size — the design-system-level vars
    //     so every component that reads them (html, body, code, .font-mono)
    //     picks up our fonts without needing per-element overrides.
    //   --color-ring — so focus outlines pick up the user's accent.
    //   h1-h6 / code — explicit element selectors with !important so we
    //     win against component-level styles.
    //   .font-courier / .font-expanded / .font-compressed / .font-mondwest /
    //     .font-trim — the Nous Research design-system "@utility" font classes
    //     hardcoded on sidebar items, page titles, card titles, inputs, and
    //     selects. Without these overrides the dashboard chrome stays in
    //     Courier Prime / Rules Expanded regardless of what the user picks.
    //
    // Heading scale is applied to h1-h3 with a geometric ramp; h4-h6 stay
    // close to body size so dense pages don't blow out.
    //
    // We deliberately do NOT override --color-foreground or
    // --color-card-foreground here — those are integral to the design-system
    // color theory and overriding them tints button labels and disabled
    // states. Body color is applied directly to the <body> element instead;
    // it cascades into paragraph/inline text but doesn't fight Tailwind
    // text-* utilities the DS uses for chrome.
    return [
      ":root {",
      "  --theme-font-sans: " + bodyStack + ";",
      "  --theme-font-display: " + displayStack + ";",
      "  --theme-font-mono: " + monoStack + ";",
      "  --theme-base-size: " + baseSize + "px;",
      "  --color-ring: " + s.accentColor + ";",
      "  --hfc-heading-color: " + s.headingColor + ";",
      "  --hfc-body-color: " + s.bodyColor + ";",
      "  --hfc-mono-color: " + s.monoColor + ";",
      "  --hfc-accent-color: " + s.accentColor + ";",
      "}",
      "html, body {",
      "  font-family: " + bodyStack + " !important;",
      "  color: " + s.bodyColor + ";",
      "}",
      "p, li, dd, dt, span:not([class*='font-']) {",
      "  color: " + s.bodyColor + ";",
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
      // Nous DS utility classes — these win over h1/element selectors
      // because the DS components apply them inline. Sidebar nav items,
      // inputs, selects, and toasts use .font-courier; page titles and
      // card titles use .font-expanded.
      ".font-courier, .font-compressed {",
      "  font-family: " + bodyStack + " !important;",
      "  letter-spacing: 0.02em;",
      "}",
      ".font-expanded, .font-mondwest, .font-trim {",
      "  font-family: " + displayStack + " !important;",
      "}",
      // Card titles use .font-expanded with uppercase + tracking-[0.08em].
      // Keep the uppercase styling but in the user's heading font + color.
      "[class*='font-expanded'] {",
      "  color: " + s.headingColor + ";",
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
          // Nous DS Button: `invert` = subtle 15% bg + outline; default = solid
          // cream. We use `invert` while overrides are ON (they're already
          // active, so the button is a de-emphasized "turn it off") and the
          // solid default while OFF (prominent "turn it on" CTA).
          h(C.Button, {
            invert: draft.enabled,
            onClick: onToggle
          }, draft.enabled ? "Disable overrides" : "Enable overrides")
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
          })
        )
      ),

      // Footer actions
      h("div", { className: "hfc-footer" },
        h(C.Button, {
          outlined: true,
          invert: true,
          onClick: onReset
        }, "Reset to defaults"),
        h("div", { className: "hfc-footer-right" },
          dirty
            ? h(C.Button, { ghost: true, onClick: onRevert }, "Revert changes")
            : null,
          h(C.Button, {
            disabled: !dirty || status.kind === "saving",
            onClick: onSave
          }, dirty ? "Save changes" : "Saved")
        )
      )
    );
  }

  window.__HERMES_PLUGINS__.register(PLUGIN_NAME, StylingPage);
})();
