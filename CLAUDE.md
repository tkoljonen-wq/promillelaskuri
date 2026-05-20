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
| `settings` | `key` string | `user_profile` (paino, sukupuoli) ja `last_input` (viimeisin syöte) |

Kaikki DB-funktiot (`dbWrite`, `dbGet`, `dbGetAll`, `dbClearStore`) palauttavat Promisen. `dbWrite` pitää awaitta ennen `calculatePromilles()`-kutsua.

### Laskentalogiikka (`calculatePromilles`)

1. Haetaan kaikki `drinks_log`-tapahtumat, järjestetään aikajärjestykseen.
2. **Istuntomääritelmä**: peruutetaan taaksepäin viimeisimmästä juomasta; jos juomien välillä ≥ 24 h tauko, katkaistaan istunto siitä.
3. **Imeytymismalli**: lineaarinen 0 → 30 min, sen jälkeen täysin imeytynyt.
4. **Widmark**: `C = absorbed_grams / (weight * r)`, missä `r = 0.68` (mies) / `0.55` (nainen).
5. **Palaminen**: `0.15 ‰/h` alkaen ensimmäisen juoman ajanhetkestä.
6. Promillet päivitetään automaattisesti 10 sekunnin välein (`setInterval`).

### PWA-vaatimukset

- `manifest.json`: `start_url` on `"."`, ikonit SVG-muodossa (192, 512, maskable).
- `sw.js`: Network First — haetaan verkosta, välimuisti vain offlinessa. Versionimi (`alkolaskuri-vN`) pitää kasvattaa kun SW-logiikka muuttuu, jotta vanhat välimuistit tyhjennetään.
- `index.html`: SW rekisteröidään suhteellisella polulla `'sw.js'` (ei `'/sw.js'`).
