/**
 * Network Dashboard Card – Editor
 * Stellt im Lovelace-UI-Editor einen YAML-Editor für die Card-Konfiguration bereit.
 * (Bewusst kein vollständiges Formular: bei verschachtelten Listen wie "devices"
 *  und "voip_numbers" ist ein YAML-Editor robuster als ein generiertes Formular
 *  und bleibt automatisch mit dem Schema synchron.)
 */
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

  // Nutzt window.jsyaml, falls von HA global verfügbar (ist es im Frontend i.d.R.);
  // Fallback: JSON-Darstellung, falls jsyaml nicht geladen ist.
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
