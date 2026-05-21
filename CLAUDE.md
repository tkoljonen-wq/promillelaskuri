# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projekti

PWA-pohjainen veren alkoholipitoisuuslaskuri (Widmark-kaava). Ajetaan GitHub Pagesilta, ei build-prosessia — kaikki tiedostot ovat suoraan selaimelle tarkoitettua staattista koodia.

## Kehitysympäristö

Ei build-työkaluja, ei riippuvuuksien asennusta, ei testejä. Avaa `index.html` suoraan selaimessa tai käytä paikallista HTTP-palvelinta (esim. `npx serve .`). Tailwind CSS ladataan CDN:stä (`@tailwindcss/browser@4`) — ei erillistä konfiguraatiota.

Service Workeria ei voi testata `file://`-protokollalla; tarvitaan `localhost` tai HTTPS.

## Arkkitehtuuri

Koko sovellus koostuu kolmesta tiedostosta:

- **`index.html`** — rakenne ja Tailwind-tyylittely. Ei omaa logiikkaa.
- **`app.js`** — kaikki sovelluslogiikka: IndexedDB, laskenta, UI-päivitys.
- **`sw.js`** — Service Worker, Network First -strategia.

### Tietokanta (IndexedDB: `AlkolaskuriDB`)

| Store | Avain | Sisältö |
|-------|-------|---------|
| `drinks_log` | autoIncrement `id` | Yksittäiset juomat: `timestamp`, `drink_type`, `abv`, `volume_ml`, `alcohol_grams` |
| `drink_types` | `id` (string) | Käyttäjän omat juomalajit |
| `settings` | `key` string | `user_profile` (paino, pituus, ikä, sukupuoli, **burnRate**), `last_input` (viimeisin syöte), `drink_type_abvs` (juomalajikohtaiset viimeksi käytetyt ABV:t) |

Kaikki DB-funktiot (`dbWrite`, `dbGet`, `dbGetAll`, `dbClearStore`, `dbDelete`) palauttavat Promisen. `dbWrite` pitää awaitta ennen `calculatePromilles()`-kutsua.

### Laskentalogiikka (`calculatePromilles`)

1. Haetaan kaikki `drinks_log`-tapahtumat, järjestetään aikajärjestykseen.
2. **Istuntomääritelmä**: peruutetaan taaksepäin viimeisimmästä juomasta; jos juomien välillä ≥ 24 h tauko, katkaistaan istunto siitä.
3. **Imeytymismalli**: lineaarinen 0 → 30 min, sen jälkeen täysin imeytynyt.
4. **Watson-Widmark**: `C = absorbed_grams / V_d`, missä `V_d = TBW / 0.85`. TBW lasketaan Watson-kaavalla (1980): miehillä `2.447 − 0.09516×ikä + 0.1074×pituus + 0.3362×paino`, naisilla `−2.097 + 0.1069×pituus + 0.2466×paino`. Jakautumistilavuus huomioi kehonkoostumuksen — ylipainoisella V_d kasvaa hitaammin kuin kokonaispaino, joten promillearvio on realistisempi.
5. **Palaminen**: oletuksena `0.15 ‰/h`, käyttäjä voi säätää välillä 0.08–0.25 ‰/h (`input-burn-rate`-liukusäädin käyttäjätiedoissa). Arvo luetaan suoraan kentästä `calculatePromilles()`-funktiossa ja tallennetaan `user_profile`-asetukseen. ‰/h-malli on perusteltu: gramma- ja tilavuusskaala kasvavat yhdessä, joten normaalipaino-referenssissä 0.15 ‰/h ≈ 0.10 g/kg/h. Älä vaihda g/kg/h-malliin — se loisi ristiriidan Watson-V_d:n kanssa ja antaisi ylipainoiselle virheellisesti nopeamman clearance-arvion.
6. Promillet päivitetään automaattisesti 10 sekunnin välein (`setInterval`).

### PWA-vaatimukset

- `manifest.json`: `start_url` on `"."`, ikonit SVG-muodossa (192, 512, maskable).
- `sw.js`: Network First — haetaan verkosta, välimuisti vain offlinessa. Versionimi (`alkolaskuri-vN`) pitää kasvattaa kun SW-logiikka muuttuu, jotta vanhat välimuistit tyhjennetään.
- `index.html`: SW rekisteröidään suhteellisella polulla `'sw.js'` (ei `'/sw.js'`).
