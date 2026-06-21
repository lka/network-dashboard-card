/**
 * Network Dashboard Card
 * Custom Lovelace Card für Home Assistant
 *
 * Zeigt eine Netzwerktopologie (SVG), Geräte-Karten mit Reboot-Funktion,
 * und optional VoIP-Rufnummern-Registrierungsstatus.
 *
 * Beispiel-Konfiguration siehe README.md
 *
 * Hinweis: Editor-Code (network-dashboard-card-editor) ist absichtlich
 * direkt unten in dieser Datei enthalten statt per import eingebunden,
 * damit HACS/Lovelace nur eine einzige JS-Datei laden muss (robuster
 * gegen Pfadprobleme bei relativen Imports über /hacsfiles/).
 */

const LitElement = customElements.get("home-assistant-main")
  ? Object.getPrototypeOf(customElements.get("home-assistant-main"))
  : Object.getPrototypeOf(customElements.get("hui-view"));
const html = LitElement.prototype.html;
const css = LitElement.prototype.css;
const svg = LitElement.prototype.svg || html;

const LINK_COLORS = {
  online: { stroke: "#22C55E", marker: "url(#arr-ok)", opacity: "0.85", width: "1.8" },
  offline: { stroke: "#EF4444", marker: "url(#arr-err)", opacity: "0.95", width: "2.2" },
  unknown: { stroke: "#64748B", marker: "url(#arr-unk)", opacity: "0.55", width: "1.5" },
};

const STATUS_LABELS = { online: "Online", offline: "Offline", unknown: "–" };
const VOIP_LABELS = {
  registered: "Registriert",
  unregistered: "Nicht registriert",
  error: "Fehler",
  unknown: "Unbekannt",
};

const ICONS = {
  router: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 2a10 10 0 0 1 0 20"/><path d="M12 2a10 10 0 0 0 0 20"/><path d="M2 12h20"/></svg>`,
  firewall: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  switch: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="7" width="20" height="10" rx="2"/><line x1="6" y1="12" x2="18" y2="12"/><circle cx="6" cy="12" r="1.5" fill="currentColor"/><circle cx="10" cy="12" r="1.5" fill="currentColor"/><circle cx="18" cy="12" r="1.5" fill="currentColor"/></svg>`,
  ap: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/></svg>`,
  dect: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.8 19.8 0 0 1 3.12 4.18 2 2 0 0 1 5.09 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L9.91 9a16 16 0 0 0 6.09 6.09l.38-.38a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
};
const REBOOT_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;

// ═══════════════════════════════════════════════════════════
// AUTO-LAYOUT: baut aus device.parent-Angaben einen Baum
// und berechnet x/y-Koordinaten für SVG-Nodes + Links.
// ═══════════════════════════════════════════════════════════
const ROW_HEIGHT = 130;
const NODE_W = 88;
const NODE_H = 48;
const COL_GAP = 30;
const TOP_MARGIN = 56;
const SIDE_MARGIN = 20;

function buildTopologyLayout(devices, internetEntity) {
  const nodeWidth = {};
  devices.forEach((d) => (nodeWidth[d.id] = d.node_width || NODE_W));

  // Virtuelle Root-Node "internet", falls internet_entity gesetzt ist
  const roots = devices.filter((d) => !d.parent || d.parent === "internet");
  const childrenOf = {};
  devices.forEach((d) => {
    if (d.parent && d.parent !== "internet") {
      childrenOf[d.parent] = childrenOf[d.parent] || [];
      childrenOf[d.parent].push(d.id);
    }
  });
  const byId = {};
  devices.forEach((d) => (byId[d.id] = d));

  // Tiefe (Reihe) je Node ermitteln
  const depth = {};
  function assignDepth(id, d) {
    depth[id] = d;
    (childrenOf[id] || []).forEach((cid) => assignDepth(cid, d + 1));
  }
  roots.forEach((r) => assignDepth(r.id, internetEntity ? 1 : 0));
  if (internetEntity) depth["__internet__"] = 0;

  // Subtree-Breite (Anzahl "Blatt-Spalten" je Node), damit Eltern über Kindern zentriert werden
  const leafSpan = {};
  function computeSpan(id) {
    const kids = childrenOf[id] || [];
    if (kids.length === 0) {
      leafSpan[id] = 1;
      return 1;
    }
    const total = kids.reduce((sum, cid) => sum + computeSpan(cid), 0);
    leafSpan[id] = total;
    return total;
  }
  roots.forEach((r) => computeSpan(r.id));

  // x-Position je Node per Spalten-Slot vergeben (rekursiv, links nach rechts)
  const colWidth = NODE_W + COL_GAP;
  const x = {};
  let cursor = 0;
  function assignX(id) {
    const kids = childrenOf[id] || [];
    if (kids.length === 0) {
      x[id] = cursor * colWidth;
      cursor += 1;
      return x[id];
    }
    const startCursor = cursor;
    kids.forEach((cid) => assignX(cid));
    const endCursor = cursor;
    // Eltern zentriert über Kindspanne
    x[id] = ((startCursor + endCursor - 1) / 2) * colWidth;
    return x[id];
  }
  roots.forEach((r) => assignX(r.id));

  // Internet-Node ganz links auf Höhe der ersten Reihe, falls vorhanden
  const nodes = [];
  const totalWidth = cursor * colWidth;
  const xOffset = SIDE_MARGIN + (internetEntity ? colWidth : 0);

  if (internetEntity) {
    nodes.push({
      id: "__internet__",
      isInternet: true,
      x: SIDE_MARGIN,
      y: TOP_MARGIN + 0 * ROW_HEIGHT,
      w: 64,
      h: NODE_H,
    });
  }

  devices.forEach((d) => {
    nodes.push({
      id: d.id,
      device: d,
      x: xOffset + x[d.id],
      y: TOP_MARGIN + depth[d.id] * ROW_HEIGHT,
      w: nodeWidth[d.id],
      h: NODE_H,
    });
  });

  // Links: internet → roots, sowie parent → child
  const links = [];
  if (internetEntity) {
    roots.forEach((r) => {
      links.push({ id: `link-internet-${r.id}`, from: "__internet__", to: r.id, controlledBy: r.id });
    });
  }
  devices.forEach((d) => {
    (childrenOf[d.id] || []).forEach((cid) => {
      links.push({ id: `link-${d.id}-${cid}`, from: d.id, to: cid, controlledBy: cid });
    });
  });

  const width = xOffset + totalWidth + SIDE_MARGIN;
  const maxDepth = Math.max(0, ...Object.values(depth));
  const height = TOP_MARGIN + maxDepth * ROW_HEIGHT + NODE_H + 30;

  return { nodes, links, width, height };
}

class NetworkDashboardCard extends LitElement {
  static get styles() {
    return css`
      :host {
        --nd-bg: #0b1220;
        --nd-surface: #111927;
        --nd-panel: #16202e;
        --nd-border: #1e2d40;
        --nd-cyan: #00d4ff;
        --nd-cyan-dim: rgba(0, 212, 255, 0.12);
        --nd-green: #22c55e;
        --nd-yellow: #f59e0b;
        --nd-red: #ef4444;
        --nd-text: #e2e8f0;
        --nd-muted: #64748b;
        --nd-mono: "JetBrains Mono", monospace;
        --nd-sans: "Inter", sans-serif;
      }
      ha-card {
        background: var(--nd-bg);
        color: var(--nd-text);
        font-family: var(--nd-sans);
        padding: 0;
        overflow: hidden;
      }
      .dashboard { padding: 24px; }

      .header { display: flex; align-items: center; gap: 14px; margin-bottom: 28px; }
      .header-icon {
        width: 42px; height: 42px; background: var(--nd-cyan-dim);
        border: 1px solid var(--nd-cyan); border-radius: 10px;
        display: grid; place-items: center; flex-shrink: 0;
      }
      .header-icon svg { color: var(--nd-cyan); }
      .header h1 { font-size: 1.25rem; font-weight: 600; letter-spacing: -0.02em; margin: 0; }
      .header p { font-size: 0.78rem; color: var(--nd-muted); font-family: var(--nd-mono); margin: 2px 0 0; }
      .header-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
      .live-badge {
        display: flex; align-items: center; gap: 6px;
        font-family: var(--nd-mono); font-size: 0.72rem; color: var(--nd-green);
        background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3);
        border-radius: 20px; padding: 4px 12px;
      }
      .pulse { width: 7px; height: 7px; border-radius: 50%; background: var(--nd-green); animation: nd-pulse 2s infinite; }
      @keyframes nd-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.85); } }

      .topology-wrap {
        background: var(--nd-surface); border: 1px solid var(--nd-border);
        border-radius: 14px; padding: 20px; margin-bottom: 16px; overflow-x: auto;
      }
      .topology-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
      .topology-title { font-size: 0.72rem; font-family: var(--nd-mono); color: var(--nd-muted); text-transform: uppercase; letter-spacing: 0.12em; }
      .legend { display: flex; gap: 14px; align-items: center; }
      .legend-item { display: flex; align-items: center; gap: 5px; font-family: var(--nd-mono); font-size: 0.65rem; color: var(--nd-muted); }
      .legend-line { width: 22px; height: 2px; border-radius: 1px; }
      #topo-svg { display: block; margin: 0 auto; max-width: 100%; }
      .topo-link { transition: stroke 0.6s ease, opacity 0.6s ease; }

      .status-bar { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 28px; }
      .status-chip {
        display: flex; align-items: center; gap: 6px; background: var(--nd-panel);
        border: 1px solid var(--nd-border); border-radius: 8px; padding: 5px 12px;
        font-size: 0.72rem; font-family: var(--nd-mono); transition: border-color 0.4s;
      }
      .status-chip .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--nd-muted); transition: background 0.4s, box-shadow 0.4s; flex-shrink: 0; }
      .status-chip.online { border-color: rgba(34, 197, 94, 0.3); }
      .status-chip.online .dot { background: var(--nd-green); box-shadow: 0 0 5px var(--nd-green); }
      .status-chip.offline { border-color: rgba(239, 68, 68, 0.4); }
      .status-chip.offline .dot { background: var(--nd-red); box-shadow: 0 0 5px var(--nd-red); }
      .status-chip.unknown { border-color: var(--nd-border); }
      .status-chip.unknown .dot { background: var(--nd-muted); }

      .section-label { font-size: 0.72rem; font-family: var(--nd-mono); color: var(--nd-muted); text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 14px; }
      .device-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; margin-bottom: 28px; }

      .voip-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 28px; }
      .voip-card { background: var(--nd-panel); border: 1px solid var(--nd-border); border-radius: 12px; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; transition: border-color 0.3s; }
      .voip-card.registered { border-color: rgba(34, 197, 94, 0.3); }
      .voip-card.unregistered { border-color: rgba(239, 68, 68, 0.4); }
      .voip-card-info { display: flex; flex-direction: column; gap: 3px; }
      .voip-card-label { font-size: 0.85rem; font-weight: 600; }
      .voip-card-entity { font-family: var(--nd-mono); font-size: 0.62rem; color: var(--nd-muted); }
      .voip-card-status { display: flex; align-items: center; gap: 6px; font-family: var(--nd-mono); font-size: 0.72rem; padding: 4px 10px; border-radius: 20px; white-space: nowrap; }
      .voip-card-status .dot { width: 7px; height: 7px; border-radius: 50%; }
      .voip-card-status.registered { background: rgba(34, 197, 94, 0.1); color: var(--nd-green); }
      .voip-card-status.registered .dot { background: var(--nd-green); box-shadow: 0 0 5px var(--nd-green); }
      .voip-card-status.unregistered { background: rgba(239, 68, 68, 0.1); color: var(--nd-red); }
      .voip-card-status.unregistered .dot { background: var(--nd-red); box-shadow: 0 0 5px var(--nd-red); }
      .voip-card-status.error, .voip-card-status.unknown { background: rgba(100, 116, 139, 0.1); color: var(--nd-muted); }
      .voip-card-status.error .dot, .voip-card-status.unknown .dot { background: var(--nd-muted); }

      .card { background: var(--nd-panel); border: 1px solid var(--nd-border); border-radius: 12px; padding: 16px 18px; transition: border-color 0.3s; position: relative; }
      .card::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 2px; border-radius: 12px 12px 0 0; background: var(--nd-cyan); opacity: 0; transition: opacity 0.2s; }
      .card:hover { border-color: rgba(0, 212, 255, 0.35); }
      .card:hover::before { opacity: 1; }
      .card.offline-card { border-color: rgba(239, 68, 68, 0.3); }
      .card.offline-card::before { background: var(--nd-red); opacity: 1; }

      .card-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 12px; }
      .card-icon { width: 36px; height: 36px; background: var(--nd-cyan-dim); border-radius: 9px; display: grid; place-items: center; flex-shrink: 0; }
      .card-icon svg { color: var(--nd-cyan); }
      .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--nd-muted); margin-top: 4px; transition: background 0.4s, box-shadow 0.4s; }
      .status-dot.online { background: var(--nd-green); box-shadow: 0 0 6px var(--nd-green); }
      .status-dot.offline { background: var(--nd-red); box-shadow: 0 0 6px var(--nd-red); }
      .status-dot.rebooting { background: var(--nd-red); box-shadow: 0 0 6px var(--nd-red); animation: nd-blink 0.8s infinite; }
      .card-name { font-size: 0.92rem; font-weight: 600; margin-bottom: 2px; }
      .card-model { font-size: 0.75rem; color: var(--nd-muted); font-family: var(--nd-mono); }
      .card-meta { margin-bottom: 14px; }
      .meta-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.04); }
      .meta-row:last-child { border-bottom: none; }

      .voip-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0 2px 0; }
      .voip-key { font-size: 0.72rem; color: var(--nd-muted); }
      .voip-dots { display: flex; gap: 6px; }
      .voip-dot-wrap { position: relative; display: inline-block; }
      .voip-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--nd-muted); cursor: default; transition: background 0.4s, box-shadow 0.4s; }
      .voip-dot.registered { background: var(--nd-green); box-shadow: 0 0 5px var(--nd-green); }
      .voip-dot.unregistered { background: var(--nd-red); box-shadow: 0 0 5px var(--nd-red); }
      .voip-dot.error, .voip-dot.unknown { background: var(--nd-muted); }
      .voip-tooltip {
        position: absolute; bottom: 140%; right: 0; background: var(--nd-bg);
        border: 1px solid var(--nd-border); border-radius: 6px; padding: 5px 9px;
        font-family: var(--nd-mono); font-size: 0.65rem; white-space: nowrap;
        opacity: 0; pointer-events: none; transition: opacity 0.15s; z-index: 10;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      }
      .voip-tooltip::after { content: ""; position: absolute; top: 100%; right: 6px; border: 4px solid transparent; border-top-color: var(--nd-border); }
      .voip-dot-wrap:hover .voip-tooltip { opacity: 1; }
      .voip-tooltip .tt-label { color: var(--nd-muted); margin-right: 4px; }
      .voip-tooltip .tt-status.registered { color: var(--nd-green); }
      .voip-tooltip .tt-status.unregistered { color: var(--nd-red); }
      .voip-tooltip .tt-status.error, .voip-tooltip .tt-status.unknown { color: var(--nd-muted); }
      .meta-key { font-size: 0.72rem; color: var(--nd-muted); }
      .meta-val { font-family: var(--nd-mono); font-size: 0.72rem; color: var(--nd-text); }
      .meta-val.ok { color: var(--nd-green); }
      .meta-val.fail { color: var(--nd-red); }
      .meta-val.gray { color: var(--nd-muted); }

      .btn-reboot {
        width: 100%; padding: 8px 0; background: transparent; border: 1px solid var(--nd-border);
        border-radius: 8px; color: var(--nd-muted); font-family: var(--nd-sans); font-size: 0.78rem;
        font-weight: 500; cursor: pointer; display: flex; align-items: center; justify-content: center;
        gap: 6px; transition: all 0.2s; letter-spacing: 0.02em;
      }
      .btn-reboot:hover { border-color: var(--nd-yellow); color: var(--nd-yellow); background: rgba(245, 158, 11, 0.07); }
      .btn-reboot.rebooting { border-color: var(--nd-red); color: var(--nd-red); background: rgba(239, 68, 68, 0.07); cursor: not-allowed; animation: nd-blink 0.8s infinite; }
      @keyframes nd-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
      .btn-reboot svg { transition: transform 0.3s; }
      .btn-reboot:hover:not(.rebooting) svg { transform: rotate(180deg); }

      .overlay { display: none; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.7); z-index: 100; place-items: center; }
      .overlay.show { display: grid; }
      .confirm-box { background: var(--nd-panel); border: 1px solid var(--nd-border); border-radius: 16px; padding: 28px 32px; max-width: 360px; width: 90%; text-align: center; }
      .confirm-box h3 { font-size: 1rem; margin: 0 0 8px; }
      .confirm-box p { font-size: 0.82rem; color: var(--nd-muted); margin: 0 0 22px; line-height: 1.5; }
      .confirm-actions { display: flex; gap: 10px; }
      .btn-cancel, .btn-confirm { flex: 1; padding: 9px; border-radius: 9px; font-family: var(--nd-sans); font-size: 0.82rem; font-weight: 500; cursor: pointer; border: none; transition: opacity 0.15s; }
      .btn-cancel { background: var(--nd-border); color: var(--nd-text); }
      .btn-confirm { background: var(--nd-red); color: #fff; }
      .btn-cancel:hover, .btn-confirm:hover { opacity: 0.85; }

      .toast-wrap { position: fixed; bottom: 24px; right: 24px; display: flex; flex-direction: column; gap: 8px; z-index: 200; }
      .toast { background: var(--nd-panel); border: 1px solid var(--nd-border); border-left: 3px solid var(--nd-yellow); border-radius: 10px; padding: 12px 18px; font-size: 0.8rem; animation: nd-slide-in 0.3s ease; max-width: 300px; }
      .toast.success { border-left-color: var(--nd-green); }
      .toast.error { border-left-color: var(--nd-red); }
      @keyframes nd-slide-in { from { transform: translateX(110%); opacity: 0; } to { transform: none; opacity: 1; } }

      @media (max-width: 600px) {
        .dashboard { padding: 14px; }
        .header h1 { font-size: 1.05rem; }
        .legend { display: none; }
      }
    `;
  }

  static get properties() {
    return {
      hass: {},
      config: {},
      _rebooting: { state: true },
      _pendingDevice: { state: true },
      _toasts: { state: true },
    };
  }

  setConfig(config) {
    if (!config.devices || !Array.isArray(config.devices) || config.devices.length === 0) {
      throw new Error("network-dashboard-card: 'devices' muss eine nicht-leere Liste sein.");
    }
    config.devices.forEach((d, i) => {
      if (!d.id) throw new Error(`network-dashboard-card: devices[${i}] benötigt 'id'.`);
      if (!d.name) throw new Error(`network-dashboard-card: devices[${i}] benötigt 'name'.`);
      if (!d.ha_ping_entity) throw new Error(`network-dashboard-card: devices[${i}] benötigt 'ha_ping_entity'.`);
    });
    this.config = config;
  }

  getCardSize() {
    return 12;
  }

  static getConfigElement() {
    return document.createElement("network-dashboard-card-editor");
  }

  constructor() {
    super();
    this._rebooting = {};
    this._pendingDevice = null;
    this._toasts = [];
    this._toastSeq = 0;
  }

  // ── Hilfsfunktionen: HA-Entity-State lesen ──
  _binaryState(entityId) {
    if (!entityId || !this.hass) return "unknown";
    const st = this.hass.states[entityId];
    if (!st) return "unknown";
    if (st.state === "on") return "online";
    if (st.state === "off") return "offline";
    return "unknown";
  }

  _rawState(entityId) {
    if (!entityId || !this.hass) return "unknown";
    const st = this.hass.states[entityId];
    if (!st) return "unknown";
    return (st.state || "unknown").toLowerCase();
  }

  _deviceStatus(device) {
    if (this._rebooting[device.id]) return "offline";
    return this._binaryState(device.ha_ping_entity);
  }

  _linkStatus(link, nodesById) {
    // Wenn das steuernde Gerät rebootet, ist der Link sofort offline (sofortiges Feedback)
    if (link.controlledBy && this._rebooting[link.controlledBy]) return "offline";
    const toNode = nodesById[link.to];
    if (toNode && toNode.device) return this._deviceStatus(toNode.device);
    if (link.to === "__internet__" && this.config.internet_entity) {
      return this._binaryState(this.config.internet_entity);
    }
    return "unknown";
  }

  // ── Reboot-Flow ──
  _confirmReboot(deviceId) {
    this._pendingDevice = deviceId;
  }

  _closeConfirm() {
    this._pendingDevice = null;
  }

  async _doReboot() {
    const id = this._pendingDevice;
    this._pendingDevice = null;
    if (!id) return;
    const device = this.config.devices.find((d) => d.id === id);
    if (!device) return;
    await this._triggerReboot(device);
  }

  async _triggerReboot(device) {
    this._rebooting = { ...this._rebooting, [device.id]: true };
    this._showToast(`⟳ ${device.name} wird neu gestartet …`, "warn");

    const [domain, service] = (device.ha_service || "").split(".");
    if (!domain || !service) {
      this._showToast(`✗ Kein ha_service für ${device.name} konfiguriert`, "error");
      const r = { ...this._rebooting };
      delete r[device.id];
      this._rebooting = r;
      return;
    }

    try {
      // button-Entities: press mit entity_id. Alles andere: domain/service ohne target,
      // bzw. mit target falls in der Config ein target angegeben ist.
      const isButton = domain === "button";
      const serviceData = device.service_data || {};
      const target = isButton
        ? { entity_id: device.ha_service }
        : device.target || (device.target_entity ? { entity_id: device.target_entity } : undefined);

      await this.hass.callService(
        isButton ? "button" : domain,
        isButton ? "press" : service,
        serviceData,
        target
      );
      this._showToast(`✓ ${device.name} — Neustart ausgelöst`, "success");
    } catch (e) {
      this._showToast(`✗ Fehler bei ${device.name}: ${e.message || e}`, "error");
      const r = { ...this._rebooting };
      delete r[device.id];
      this._rebooting = r;
      return;
    }

    const rebootWindow = (device.reboot_seconds || 35) * 1000;
    setTimeout(() => {
      const r = { ...this._rebooting };
      delete r[device.id];
      this._rebooting = r;
      this._showToast(`↺ Prüfe ${device.name} …`, "warn");
    }, rebootWindow);
  }

  // ── Render: Topologie-SVG ──
  _renderTopology() {
    const devices = this.config.devices;
    const internetEntity = this.config.internet_entity;
    const layout = buildTopologyLayout(devices, internetEntity);
    const nodesById = {};
    layout.nodes.forEach((n) => (nodesById[n.id] = n));

    const linkTemplates = layout.links.map((link) => {
      const from = nodesById[link.from];
      const to = nodesById[link.to];
      if (!from || !to) return svg``;
      const status = this._linkStatus(link, nodesById);
      const c = LINK_COLORS[status] || LINK_COLORS.unknown;
      const x1 = from.x + from.w;
      const y1 = from.y + from.h / 2;
      const x2 = to.x;
      const y2 = to.y + to.h / 2;
      return svg`
        <line id="${link.id}" class="topo-link"
          x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
          stroke="${c.stroke}" stroke-width="${c.width}" stroke-dasharray="7,4" opacity="${c.opacity}"
          marker-end="${c.marker}">
          <animate attributeName="stroke-dashoffset" from="22" to="0" dur="1.4s" repeatCount="indefinite"/>
        </line>
      `;
    });

    const nodeTemplates = layout.nodes.map((n) => {
      if (n.isInternet) {
        const status = internetEntity ? this._binaryState(internetEntity) : "unknown";
        const color = { online: "#22C55E", offline: "#EF4444", unknown: "#64748B" }[status];
        return svg`
          <g transform="translate(${n.x},${n.y})">
            <rect x="0" y="0" width="${n.w}" height="${n.h}" rx="10" fill="#16202E" stroke="${color}" stroke-width="1"></rect>
            <text x="${n.w / 2}" y="22" text-anchor="middle" fill="${color}" font-size="20">☁</text>
            <text x="${n.w / 2}" y="38" text-anchor="middle" fill="${color}" font-family="Inter" font-size="7.5">Internet</text>
          </g>
        `;
      }
      const d = n.device;
      const status = this._deviceStatus(d);
      const color = { online: "#22C55E", offline: "#EF4444", unknown: "#64748B" }[status];
      const iconChar = d.topo_icon || "⊞";
      return svg`
        <g transform="translate(${n.x},${n.y})" filter="url(#glow)">
          <rect x="0" y="0" width="${n.w}" height="${n.h}" rx="10" fill="#16202E" stroke="${color}" stroke-width="1.5"></rect>
          <text x="${n.w / 2}" y="19" text-anchor="middle" fill="${color}" font-family="JetBrains Mono" font-size="12">${iconChar}</text>
          <text x="${n.w / 2}" y="31" text-anchor="middle" fill="#E2E8F0" font-family="Inter" font-size="7.5">${d.name}</text>
          <text x="${n.w / 2}" y="41" text-anchor="middle" fill="${color}" font-family="JetBrains Mono" font-size="6.5">${d.role || ""}</text>
        </g>
      `;
    });

    return html`
      <div class="topology-wrap">
        <div class="topology-header">
          <div class="topology-title">▸ Netzwerktopologie &amp; Datenfluß</div>
          <div class="legend">
            <div class="legend-item"><div class="legend-line" style="background:#22C55E"></div>Verbunden</div>
            <div class="legend-item"><div class="legend-line" style="background:#EF4444"></div>Getrennt</div>
            <div class="legend-item"><div class="legend-line" style="background:#64748B"></div>Unbekannt</div>
          </div>
        </div>
        ${svg`
          <svg id="topo-svg" viewBox="0 0 ${layout.width} ${layout.height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <marker id="arr-ok" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="#22C55E" opacity=".8"></path>
              </marker>
              <marker id="arr-err" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="#EF4444" opacity=".9"></path>
              </marker>
              <marker id="arr-unk" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="#64748B" opacity=".7"></path>
              </marker>
              <filter id="glow">
                <feGaussianBlur stdDeviation="2.5" result="blur"></feGaussianBlur>
                <feMerge><feMergeNode in="blur"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge>
              </filter>
            </defs>
            ${linkTemplates}
            ${nodeTemplates}
          </svg>
        `}
      </div>
    `;
  }

  // Kleines Helfer: rohes SVG-Markup einfügen (vertrauenswürdig, da nur aus eigener Config generiert)
  _unsafeSvg(str) {
    const div = document.createElement("template");
    div.innerHTML = str;
    return div.content;
  }

  // ── Render: Status-Chips ──
  _renderStatusBar() {
    return html`
      <div class="status-bar">
        ${this.config.devices.map((d) => {
          const st = this._deviceStatus(d);
          return html`
            <div class="status-chip ${st}">
              <div class="dot"></div>
              <span>${d.name}</span>
            </div>
          `;
        })}
      </div>
    `;
  }

  // ── Render: Geräte-Karten ──
  _renderDeviceCards() {
    return html`
      <div class="section-label">▸ Geräte &amp; Neustart</div>
      <div class="device-grid">
        ${this.config.devices.map((d) => this._renderDeviceCard(d))}
      </div>
    `;
  }

  _renderDeviceCard(d) {
    const st = this._deviceStatus(d);
    const isRebooting = !!this._rebooting[d.id];
    const dotClass = isRebooting ? "rebooting" : st;
    const statusClass = { online: "ok", offline: "fail", unknown: "gray" }[st];
    const iconSvg = ICONS[d.type] || ICONS.router;

    return html`
      <div class="card ${st === "offline" && !isRebooting ? "offline-card" : ""}">
        <div class="card-head">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="card-icon">${this._unsafeSvg(iconSvg)}</div>
            <div>
              <div class="card-name">${d.name}</div>
              <div class="card-model">${d.model || ""}</div>
            </div>
          </div>
          <div class="status-dot ${dotClass}"></div>
        </div>
        <div class="card-meta">
          <div class="meta-row">
            <span class="meta-key">Status</span>
            <span class="meta-val ${statusClass}">${isRebooting ? "Startet neu …" : STATUS_LABELS[st]}</span>
          </div>
          ${d.ip ? html`<div class="meta-row"><span class="meta-key">IP-Adresse</span><span class="meta-val">${d.ip}</span></div>` : ""}
          ${d.role ? html`<div class="meta-row"><span class="meta-key">Rolle</span><span class="meta-val">${d.role}</span></div>` : ""}
          ${d.ports ? html`<div class="meta-row"><span class="meta-key">Ports</span><span class="meta-val">${d.ports}</span></div>` : ""}
          <div class="meta-row"><span class="meta-key">HA-Entity</span><span class="meta-val gray" style="font-size:.63rem">${d.ha_ping_entity}</span></div>
          ${this._renderVoipRow(d)}
        </div>
        ${d.ha_service
          ? html`
              <button
                class="btn-reboot ${isRebooting ? "rebooting" : ""}"
                ?disabled=${isRebooting}
                @click=${() => this._confirmReboot(d.id)}
              >
                ${this._unsafeSvg(REBOOT_ICON)}
                ${isRebooting ? "Startet neu …" : "Neu starten"}
              </button>
            `
          : ""}
      </div>
    `;
  }

  _renderVoipRow(d) {
    if (!d.voip_numbers || !d.voip_numbers.length) return "";
    return html`
      <div class="voip-row">
        <span class="voip-key">Rufnummern</span>
        <span class="voip-dots">
          ${d.voip_numbers.map((n) => {
            const st = this._rawState(n.entity);
            const label = VOIP_LABELS[st] || "Unbekannt";
            return html`
              <span class="voip-dot-wrap">
                <span class="voip-dot ${st}"></span>
                <span class="voip-tooltip"
                  ><span class="tt-label">${n.label}:</span
                  ><span class="tt-status ${st}">${label}</span></span
                >
              </span>
            `;
          })}
        </span>
      </div>
    `;
  }

  // ── Render: VoIP-Detailkarten ──
  _renderVoipGrid() {
    const allNumbers = [];
    this.config.devices.forEach((d) => {
      if (!d.voip_numbers) return;
      d.voip_numbers.forEach((n) => allNumbers.push({ ...n, device: d.name }));
    });
    if (allNumbers.length === 0) return "";

    return html`
      <div class="section-label">▸ Rufnummern-Registrierung</div>
      <div class="voip-grid">
        ${allNumbers.map((n) => {
          const st = this._rawState(n.entity);
          const label = VOIP_LABELS[st] || "Unbekannt";
          return html`
            <div class="voip-card ${st}">
              <div class="voip-card-info">
                <span class="voip-card-label">${n.label}</span>
                <span class="voip-card-entity">${n.device}</span>
              </div>
              <div class="voip-card-status ${st}"><span class="dot"></span>${label}</div>
            </div>
          `;
        })}
      </div>
    `;
  }

  // ── Render: Confirm-Dialog ──
  _renderConfirmDialog() {
    if (!this._pendingDevice) return "";
    const d = this.config.devices.find((x) => x.id === this._pendingDevice);
    if (!d) return "";
    return html`
      <div class="overlay show" @click=${(e) => { if (e.target === e.currentTarget) this._closeConfirm(); }}>
        <div class="confirm-box">
          <h3>${d.name} neu starten?</h3>
          <p>Das Gerät${d.ip ? ` (${d.ip})` : ""} wird kurz nicht erreichbar sein. Abhängige Geräte können ebenfalls betroffen sein.</p>
          <div class="confirm-actions">
            <button class="btn-cancel" @click=${() => this._closeConfirm()}>Abbrechen</button>
            <button class="btn-confirm" @click=${() => this._doReboot()}>Neu starten</button>
          </div>
        </div>
      </div>
    `;
  }

  // ── Render: Toasts ──
  _renderToasts() {
    return html`
      <div class="toast-wrap">
        ${this._toasts.map(
          (t) => html`<div class="toast ${t.type === "success" ? "success" : t.type === "error" ? "error" : ""}">${t.msg}</div>`
        )}
      </div>
    `;
  }

  // ── Haupt-Render ──
  render() {
    if (!this.config || !this.hass) return html``;
    return html`
      <ha-card>
        <div class="dashboard">
          <div class="header">
            <div class="header-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M2 10h20"/>
              </svg>
            </div>
            <div>
              <h1>${this.config.title || "Netzwerk Dashboard"}</h1>
              <p>${this.config.subtitle || ""}</p>
            </div>
            <div class="header-right">
              <div class="live-badge"><div class="pulse"></div>LIVE</div>
            </div>
          </div>

          ${this._renderTopology()}
          ${this._renderStatusBar()}
          ${this._renderDeviceCards()}
          ${this._renderVoipGrid()}
          ${this._renderConfirmDialog()}
          ${this._renderToasts()}
        </div>
      </ha-card>
    `;
  }

  static getStubConfig() {
    return {
      title: "Netzwerk Dashboard",
      subtitle: "Datenfluss · Gerätemanagement · Infrastruktur",
      internet_entity: "binary_sensor.ping_internet",
      topology: { width: 1000, height: 380, links: [] },
      devices: [
        {
          id: "router_1",
          name: "Router",
          model: "Beispiel-Router",
          type: "router",
          ip: "192.168.0.1",
          role: "Internet-Gateway",
          ports: "4x LAN",
          ha_ping_entity: "binary_sensor.ping_router",
          ha_service: "button.router_reboot",
        },
      ],
    };
  }
}

customElements.define("network-dashboard-card", NetworkDashboardCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "network-dashboard-card",
  name: "Network Dashboard Card",
  description: "Netzwerktopologie mit Live-Status und Reboot-Funktion, ohne Token im Frontend.",
});

// ═══════════════════════════════════════════════════════════
// EDITOR (im selben File, siehe Hinweis am Dateianfang)
// ═══════════════════════════════════════════════════════════
if (!customElements.get("network-dashboard-card-editor")) {
  class NetworkDashboardCardEditor extends HTMLElement {
    setConfig(config) {
      this._config = config;
      this._render();
    }

    set hass(hass) {
      this._hass = hass;
    }

    configChanged(newConfig) {
      const event = new CustomEvent("config-changed", {
        detail: { config: newConfig },
        bubbles: true,
        composed: true,
      });
      this.dispatchEvent(event);
    }

    _render() {
      if (this._rendered) return;
      this._rendered = true;

      const wrapper = document.createElement("div");
      wrapper.style.padding = "12px";

      const hint = document.createElement("div");
      hint.style.marginBottom = "8px";
      hint.style.fontSize = "0.85rem";
      hint.style.opacity = "0.75";
      hint.textContent =
        "Network Dashboard Card – Konfiguration als YAML. Siehe README im Repository für das vollständige Schema (devices, parent, voip_numbers, internet_entity, ...).";

      const textarea = document.createElement("textarea");
      textarea.style.width = "100%";
      textarea.style.minHeight = "320px";
      textarea.style.fontFamily = "monospace";
      textarea.style.fontSize = "0.85rem";
      textarea.style.boxSizing = "border-box";
      textarea.value = this._toYamlLike(this._config);

      textarea.addEventListener("change", () => {
        try {
          const parsed = this._fromYamlLike(textarea.value);
          this.configChanged(parsed);
          textarea.style.borderColor = "";
        } catch (e) {
          textarea.style.borderColor = "red";
        }
      });

      wrapper.appendChild(hint);
      wrapper.appendChild(textarea);
      this.appendChild(wrapper);
    }

    _toYamlLike(config) {
      if (window.jsyaml && window.jsyaml.dump) {
        return window.jsyaml.dump(config);
      }
      return JSON.stringify(config, null, 2);
    }

    _fromYamlLike(text) {
      if (window.jsyaml && window.jsyaml.load) {
        return window.jsyaml.load(text);
      }
      return JSON.parse(text);
    }
  }

  customElements.define("network-dashboard-card-editor", NetworkDashboardCardEditor);
}
