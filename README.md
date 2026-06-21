# Network Dashboard Card

Custom Lovelace Card für Home Assistant: Netzwerktopologie mit Live-Status
(SVG, automatisches Layout), Geräte-Karten mit Reboot-Button und optionaler
VoIP-Rufnummern-Registrierungsanzeige.

**Kein Token, kein API-Key im Frontend nötig.** Die Card nutzt das
`hass`-Objekt der laufenden Home-Assistant-Session für Statusabfragen
(`hass.states`) und Schaltvorgänge (`hass.callService`). Authentifizierung
läuft komplett über die ohnehin bestehende HA-Login-Session.

## Installation über HACS (Custom Repository)

1. HACS → Frontend → Menü (⋮) → *Benutzerdefinierte Repositories*
2. Repository-URL eintragen, Kategorie **Lovelace**
3. "Network Dashboard Card" suchen und installieren
4. HA neu laden (Strg+R reicht meist, ggf. Browser-Cache leeren)
5. Falls nicht automatisch geschehen: unter *Einstellungen → Dashboards →
   Ressourcen* die Datei `/hacsfiles/network-dashboard-card/network-dashboard-card.js`
   als JavaScript-Modul hinzufügen

## Verwendung

In einem Lovelace-Dashboard (YAML-Modus) oder per UI-Editor (Karte hinzufügen
→ "Network Dashboard Card" suchen):

```yaml
type: custom:network-dashboard-card
title: Netzwerk Dashboard
subtitle: Datenfluss · Gerätemanagement · Infrastruktur
internet_entity: binary_sensor.ping_internet
devices:
  - id: fritzbox_internet
    name: FRITZ!Box (Internet)
    model: Internet-Gateway
    type: router
    ip: 192.168.0.1
    role: WAN-Eingang
    ports: 4× LAN + 1× WAN
    ha_ping_entity: binary_sensor.ping_fritzbox_internet
    ha_service: button.fritz_box_7590_neu_starten
    # kein 'parent' → hängt direkt unter "Internet"

  - id: opnsense
    name: OPNsense
    model: Firewall / Router
    type: firewall
    ip: 192.168.20.1
    role: Firewall & NAT
    ports: 4× NIC
    ha_ping_entity: binary_sensor.ping_opnsense
    ha_service: shell_command.reboot_opnsense
    parent: fritzbox_internet

  - id: es216g
    name: TP-Link ES216G
    model: TL-SG2216
    type: switch
    ip: 192.168.5.2
    role: Core-Switch
    ports: 16× GbE
    ha_ping_entity: binary_sensor.ping_es216g
    ha_service: shell_command.reboot_es216g
    parent: opnsense

  - id: fritzbox_dect
    name: FRITZ!Box (DECT)
    model: Telefonanlage
    type: dect
    ip: 192.168.178.1
    role: DECT-Zentrale
    ports: 4× LAN
    ha_ping_entity: binary_sensor.ping_fritzbox_dect
    ha_service: button.fritz_box_7590_reboot
    parent: es216g
    voip_numbers:
      - label: Rufnummer 1
        entity: sensor.voip_status_rufnummer_1
      - label: Rufnummer 2
        entity: sensor.voip_status_rufnummer_2
      - label: Rufnummer 3
        entity: sensor.voip_status_rufnummer_3

  - id: es208g_1
    name: TP-Link ES208G #1
    model: TL-SG2008
    type: switch
    ip: 192.168.5.3
    role: Access-Switch
    ports: 8× GbE
    ha_ping_entity: binary_sensor.ping_es208g_1
    ha_service: shell_command.reboot_es208g_1
    parent: es216g

  - id: es208g_2
    name: TP-Link ES208G #2
    model: TL-SG2008
    type: switch
    ip: 192.168.5.4
    role: Access-Switch
    ports: 8× GbE
    ha_ping_entity: binary_sensor.ping_es208g_2
    ha_service: shell_command.reboot_es208g_2
    parent: es216g

  - id: eap610
    name: EAP610
    model: TP-Link EAP610
    type: ap
    ip: 192.168.5.5
    role: Access Point Wi-Fi 6
    ports: 1× GbE PoE
    ha_ping_entity: binary_sensor.ping_eap610
    ha_service: shell_command.reboot_eap610
    parent: es216g

  - id: eap673_1
    name: EAP673 #1
    model: TP-Link EAP673
    type: ap
    ip: 192.168.5.6
    role: Access Point Wi-Fi 6E
    ports: 1× 2.5G PoE
    ha_ping_entity: binary_sensor.ping_eap673_1
    ha_service: shell_command.reboot_eap673_1
    parent: es216g

  - id: eap673_2
    name: EAP673 #2
    model: TP-Link EAP673
    type: ap
    ip: 192.168.5.7
    role: Access Point Wi-Fi 6E
    ports: 1× 2.5G PoE
    ha_ping_entity: binary_sensor.ping_eap673_2
    ha_service: shell_command.reboot_eap673_2
    parent: es216g
```

Das erzeugt automatisch eine Baumstruktur: Internet → FRITZ!Box → OPNsense → ES216G (Core), darunter
FB-DECT / ES208G #1 / ES208G #2 / EAP610 / EAP673 #1 / EAP673 #2 als Kinder von
ES216G. Das Layout (Spalten, Zentrierung, Zeilenhöhe) wird automatisch berechnet.

## Konfigurationsschema

### Karten-Ebene

| Schlüssel          | Pflicht | Beschreibung                                                                 |
|---------------------|---------|-------------------------------------------------------------------------------|
| `type`               | ja      | immer `custom:network-dashboard-card`                                        |
| `title`              | nein    | Überschrift, Standard "Netzwerk Dashboard"                                   |
| `subtitle`           | nein    | Unterzeile unter dem Titel                                                   |
| `internet_entity`    | nein    | `binary_sensor`, der die generelle Internet-Erreichbarkeit abbildet (`on`/`off`). Wird als eigener "Internet"-Knoten gezeichnet, ganz links. Wenn weggelassen, gibt es keinen Internet-Knoten. |
| `devices`            | ja      | Liste der Geräte, siehe unten                                                |

### Geräte-Ebene (`devices[]`)

| Schlüssel          | Pflicht | Beschreibung                                                                 |
|---------------------|---------|-------------------------------------------------------------------------------|
| `id`                 | ja      | Eindeutiger Schlüssel, wird auch als `parent`-Referenz anderer Geräte genutzt |
| `name`               | ja      | Anzeigename                                                                  |
| `ha_ping_entity`     | ja      | `binary_sensor`-Entity, der Online/Offline liefert (`on` = online)            |
| `model`              | nein    | Modellbezeichnung, auf der Karte angezeigt                                   |
| `type`               | nein    | Icon-Typ: `router`, `firewall`, `switch`, `ap`, `dect` (Standard: `router`)   |
| `ip`                 | nein    | Anzeige der IP-Adresse auf der Karte                                         |
| `role`               | nein    | Funktionsbeschreibung (z. B. "Core-Switch")                                  |
| `ports`              | nein    | Anzeige der Port-Anzahl/-Art                                                 |
| `parent`             | nein    | `id` des übergeordneten Geräts in der Topologie. Weglassen oder `internet` = oberste Ebene |
| `ha_service`         | nein    | Service, der per Reboot-Button aufgerufen wird (siehe unten). Ohne diesen Schlüssel erscheint kein Reboot-Button. |
| `target_entity`      | nein    | Nur relevant, wenn `ha_service` **kein** `button.*` ist und der Service eine `entity_id` als Target erwartet |
| `target`             | nein    | Vollständiges Service-Target-Objekt (z. B. `{ entity_id: ... }` oder `{ device_id: ... }`), falls mehr als `target_entity` nötig ist |
| `service_data`        | nein    | Zusätzliche Service-Daten (Dict), die beim Service-Call mitgeschickt werden  |
| `reboot_seconds`      | nein    | Wie lange die Karte den Status nach einem Reboot auf "Startet neu…" hält, Standard 35 |
| `topo_icon`           | nein    | Ein einzelnes Zeichen/Symbol für den Topologie-Knoten (Standard: ⊞)          |
| `voip_numbers`        | nein    | Liste von `{ label, entity }` für die VoIP-Registrierungsanzeige             |

**Hinweis zu `ha_service`:** Bei `button.*`-Entities wird automatisch
`button.press` mit `entity_id: <ha_service>` aufgerufen — das deckt den
häufigsten Fall (FRITZ!Box-Reboot-Buttons) ohne weitere Angaben ab. Bei
anderen Services (z. B. `shell_command.reboot_xyz`) wird der Service ohne
Target aufgerufen, es sei denn du gibst zusätzlich `target` oder
`target_entity` an.
