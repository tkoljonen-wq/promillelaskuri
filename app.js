// --- INDEXEDDB ALUSTUS ---
let db;
const dbName = "AlkolaskuriDB";

const initDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);

        request.onupgradeneeded = (e) => {
            db = e.target.result;
            if (!db.objectStoreNames.contains('drinks_log')) {
                db.createObjectStore('drinks_log', { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains('drink_types')) {
                db.createObjectStore('drink_types', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('settings')) {
                db.createObjectStore('settings', { keyPath: 'key' });
            }
        };

        request.onsuccess = (e) => {
            db = e.target.result;
            resolve();
        };

        // Virheenkäsittely: esim. yksityinen selaus tai täysi levy
        request.onerror = (e) => {
            reject(e.target.error);
        };
    });
};

// --- OLETUSARVOT JA APUFUNKTIOT ---
const defaultTypes = [
    { id: 'beer',      label: 'Olut'    },
    { id: 'cider',     label: 'Siideri' },
    { id: 'longdrink', label: 'Lonkero' },
    { id: 'wine',      label: 'Viini'   },
    { id: 'strong',    label: 'Väkevä'  }
];

let activeType = 'beer';

// Oletusalkoholiprosentit sisäänrakennetuille juomalajeille
const defaultTypeAbvs = {
    beer:      '4.5',
    cider:     '4.5',
    longdrink: '5.5',
    wine:      '13.0',
    strong:    '38.0'
};

// Juomalajikohtaiset viimeksi käytetyt alkoholiprosentit (ladataan DB:stä)
let typeAbvs = {};

// Palauttaa juomalajin tallennetun tai oletus-ABV:n
function getTypeAbv(typeId) {
    return typeAbvs[typeId] || defaultTypeAbvs[typeId] || '4.5';
}

// Tallentaa juomalajin käytetyn ABV:n muistiin
async function setTypeAbv(typeId, abv) {
    typeAbvs[typeId] = abv;
    await dbWrite('settings', { key: 'drink_type_abvs', abvs: typeAbvs });
}

// Geneeriset DB-operaatiot — kaikki palauttavat Promisen
function dbWrite(storeName, data) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).put(data);
        req.onsuccess = () => resolve(req.result);
        req.onerror  = () => reject(req.error);
    });
}

function dbGetAll(storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror  = () => reject(req.error);
    });
}

function dbGet(storeName, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror  = () => reject(req.error);
    });
}

function dbClearStore(storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).clear();
        req.onsuccess = () => resolve();
        req.onerror  = () => reject(req.error);
    });
}

function dbDelete(storeName, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).delete(key);
        req.onsuccess = () => resolve();
        req.onerror  = () => reject(req.error);
    });
}

// --- KEHON JAKAUTUMISTILAVUUDEN LASKENTA (Watson-kaava 1980) ---

// Palauttaa kehon kokonaisvesimäärän (TBW) litroissa.
// Lähde: Watson PE ym., Am J Clin Nutr 1980;33:27–39.
// Huom: naisilla ikä ei sisälly Watsonin alkuperäiseen kaavaan.
function calculateTBW(weightKg, heightCm, age, gender) {
    if (gender === 'male') {
        return 2.447 - 0.09516 * age + 0.1074 * heightCm + 0.3362 * weightKg;
    } else {
        return -2.097 + 0.1069 * heightCm + 0.2466 * weightKg;
    }
}

// Alkoholin jakautumistilavuus (L) = TBW / veri-vesi-jakautumiskerroin (0.85).
// Korvaa Widmarkin weight*r -lausekkeen: ylipainoisella TBW kasvaa selvästi
// hitaammin kuin kokonaispaino, joten promillearvio on oikeampi.
function calculateDistributionVolume(weightKg, heightCm, age, gender) {
    const tbw = calculateTBW(weightKg, heightCm, age, gender);
    // Turvaraja äärimmäisille syötteille: vähintään 30 % painosta
    return Math.max(tbw / 0.85, weightKg * 0.30);
}

// --- ABV-VALIKKO ---
// 4.0–14.0 % välein 0.5 % (oluet, siiderit, viinit)
// 15–22 %   välein 1 %   (väkevöidyt viinit, portviini)
// 24–60 %   välein 2 %   (väkevät juomat, viski, vodka)
const selectAbv = document.getElementById('select-abv');

for (let abv = 4.0; abv <= 14.0; abv += 0.5) {
    const opt = document.createElement('option');
    opt.value = abv.toFixed(1);
    opt.textContent = abv.toFixed(1) + " %";
    selectAbv.appendChild(opt);
}
for (let abv = 15; abv <= 22; abv += 1) {
    const opt = document.createElement('option');
    opt.value = abv.toFixed(1);
    opt.textContent = abv.toFixed(1) + " %";
    selectAbv.appendChild(opt);
}
for (let abv = 24; abv <= 60; abv += 2) {
    const opt = document.createElement('option');
    opt.value = abv.toFixed(1);
    opt.textContent = abv.toFixed(1) + " %";
    selectAbv.appendChild(opt);
}

function setVolume(ml) {
    document.getElementById('input-volume').value = ml;
}

// --- JUOMALAJIPAINIKKEET ---
async function renderDrinkTypes() {
    const customTypes = await dbGetAll('drink_types');
    const allTypes = [...defaultTypes, ...customTypes];
    const container = document.getElementById('drink-type-buttons');
    container.innerHTML = '';

    allTypes.forEach(t => {
        const isCustom = t.id.startsWith('custom_');
        const isActive = activeType === t.id;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = [
            'flex-1 min-w-[28%] text-sm font-medium py-3 rounded-xl border transition-all duration-200',
            isActive
                ? 'bg-amber-500 text-slate-950 border-amber-500 font-bold shadow-lg scale-105'
                : 'bg-slate-850 text-slate-300 border-slate-700 hover:bg-slate-750',
            isCustom ? 'flex items-center pl-3 pr-2' : 'px-2'
        ].join(' ');

        if (isCustom) {
            const labelSpan = document.createElement('span');
            labelSpan.className = 'flex-1 text-center';
            labelSpan.textContent = t.label;
            btn.appendChild(labelSpan);

            const delSpan = document.createElement('span');
            delSpan.textContent = '✕';
            delSpan.className = `text-xs ml-1 flex-shrink-0 ${isActive ? 'text-slate-700/70' : 'text-red-400/60'}`;
            delSpan.onclick = (e) => {
                e.stopPropagation();
                deleteCustomType(t.id);
            };
            btn.appendChild(delSpan);
        } else {
            btn.textContent = t.label;
        }

        btn.onclick = () => {
            activeType = t.id;
            selectAbv.value = getTypeAbv(t.id);
            renderDrinkTypes();
        };
        container.appendChild(btn);
    });
}

// Poistaa oman juomalajin
async function deleteCustomType(typeId) {
    if (!confirm('Poistetaanko juomalaji?')) return;
    await dbDelete('drink_types', typeId);
    if (activeType === typeId) {
        activeType = 'beer';
    }
    selectAbv.value = getTypeAbv(activeType);
    renderDrinkTypes();
}

// --- KORJATTU BAC-LASKENTA ---
// Laskee BAC ajanhetkellä targetMs käyttäen paloittain lineaarista segmenttimallia.
// Huomioi oikein, että promillet eivät voi alittaa nollaa: jos palaminen ylittää
// imeytyneen alkoholin, BAC pysyy nollassa eikä kerry "palaamisvelkaa" seuraaviin
// juomiin. Tämä korjaa bugin, jossa uusi juoma ei nosta promilleja nollan jälkeen.
function computeBAC(targetMs, sessionDrinks, distributionVolume, burnRatePerHour) {
    if (!sessionDrinks || sessionDrinks.length === 0) return 0;
    const drinks = [...sessionDrinks].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const startMs = new Date(drinks[0].timestamp).getTime();
    if (targetMs <= startMs) return 0;

    // Avainhetket: jokaisen juoman aloitus ja imeytymisen päättyminen (+30 min)
    const keySet = new Set([startMs, targetMs]);
    drinks.forEach(d => {
        const t = new Date(d.timestamp).getTime();
        keySet.add(t);
        keySet.add(t + 30 * 60 * 1000);
    });
    const timeline = [...keySet]
        .filter(t => t >= startMs && t <= targetMs)
        .sort((a, b) => a - b);

    let bac = 0;
    for (let i = 0; i < timeline.length - 1; i++) {
        const t0 = timeline[i];
        const t1 = timeline[i + 1];
        const dtHours = (t1 - t0) / (1000 * 60 * 60);

        // Imeytymisvauhti tässä segmentissä (‰/h): mukaan vain juomat jotka
        // imeytyy koko segmentin ajan (avainhetket takaavat, ettei osittaisia)
        let absRate = 0;
        drinks.forEach(d => {
            const drinkMs  = new Date(d.timestamp).getTime();
            const absEndMs = drinkMs + 30 * 60 * 1000;
            if (drinkMs <= t0 && absEndMs >= t1) {
                absRate += (d.alcohol_grams / distributionVolume) / (30 / 60);
            }
        });

        // Jos nettovaikutus vie BAC:n alle 0, katkaise nollaan (ei velkaa)
        bac = Math.max(0, bac + (absRate - burnRatePerHour) * dtHours);
    }
    return bac;
}

// --- LASKENTALOGIIKKA (WATSON-WIDMARK + 30 MIN IMEYTYMISAIKA) ---
function calculatePromilles() {
    const weight        = parseFloat(document.getElementById('input-weight').value) || 80;
    const height        = parseFloat(document.getElementById('input-height').value) || 178;
    const age           = parseInt(document.getElementById('input-age').value, 10) || 35;
    const gender        = document.getElementById('select-gender').value;
    const burnRatePerHour = parseFloat(document.getElementById('input-burn-rate').value) || 0.15;

    const distributionVolume = calculateDistributionVolume(weight, height, age, gender);

    dbGetAll('drinks_log').then(logs => {
        if (logs.length === 0) {
            updateUI(0, null, 0, 0);
            renderBacChart([], distributionVolume, burnRatePerHour, 0);
            if (statsOpen) renderStatistics();
            return;
        }

        // Järjestetään aikajärjestykseen
        logs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        const now = new Date();
        const lastDrinkTime = new Date(logs[logs.length - 1].timestamp);

        // 24 tunnin nollaussääntö viimeisestä juomasta
        if ((now - lastDrinkTime) / (1000 * 60 * 60) >= 24) {
            updateUI(0, null, 0, 0);
            renderBacChart([], distributionVolume, burnRatePerHour, 0);
            if (statsOpen) renderStatistics();
            return;
        }

        // Etsitään kuluvan istunnon juomat — katkaistaan jos välissä yli 24 h tauko
        let sessionDrinks = [];
        let totalSessionGrams = 0;

        for (let i = logs.length - 1; i >= 0; i--) {
            const drinkTime = new Date(logs[i].timestamp);
            if (i < logs.length - 1) {
                const nextDrinkTime = new Date(logs[i + 1].timestamp);
                if ((nextDrinkTime - drinkTime) / (1000 * 60 * 60) >= 24) {
                    break; // Yli 24 h tauko: vanhemmat juomat jätetään pois
                }
            }
            sessionDrinks.unshift(logs[i]);
            totalSessionGrams += logs[i].alcohol_grams;
        }

        const firstDrinkTime = new Date(sessionDrinks[0].timestamp);

        // Lasketaan nykyinen BAC segmenttimallilla (ei nollavelkaa juomien välillä)
        const currentPromilles = computeBAC(now.getTime(), sessionDrinks, distributionVolume, burnRatePerHour);

        // Arvioidaan milloin promillet ovat nollassa.
        // Huipputaso (viimeisin juoma täysin imeytynyt) lasketaan computeBAC:lla.
        const peakTime = new Date(lastDrinkTime.getTime() + 30 * 60 * 1000);
        let zeroTime = null;

        if (now >= peakTime) {
            // Imeytyminen ohi — ekstrapoloidaan lineaarisesti nykyisestä tasosta
            if (currentPromilles > 0) {
                const hoursToBurn = currentPromilles / burnRatePerHour;
                zeroTime = new Date(now.getTime() + hoursToBurn * 60 * 60 * 1000);
            }
        } else {
            // Ollaan vielä 30 min imeytymisikkunassa — lasketaan huipputaso ja ekstrapoloidaan
            const bacAtPeak = computeBAC(peakTime.getTime(), sessionDrinks, distributionVolume, burnRatePerHour);
            if (bacAtPeak > 0) {
                const hoursFromPeakToZero = bacAtPeak / burnRatePerHour;
                zeroTime = new Date(peakTime.getTime() + hoursFromPeakToZero * 60 * 60 * 1000);
            }
        }

        updateUI(currentPromilles, zeroTime, sessionDrinks.length, totalSessionGrams);
        renderBacChart(sessionDrinks, distributionVolume, burnRatePerHour, currentPromilles, zeroTime);
        if (statsOpen) renderStatistics();
    });
}

function updateUI(promilles, zeroTime, count, grams) {
    const display     = document.getElementById('promille-display');
    const burnDisplay = document.getElementById('burn-time-display');

    display.textContent = promilles.toFixed(2) + " ‰";

    // Värikoodi: vihreä = selvin, keltainen = humaltunut, punainen = yli 0,5 ‰
    if (promilles === 0) {
        display.className = "text-6xl font-black my-3 text-emerald-400 transition-colors duration-500";
    } else if (promilles < 0.5) {
        display.className = "text-6xl font-black my-3 text-amber-400 transition-colors duration-500";
    } else {
        display.className = "text-6xl font-black my-3 text-rose-500 transition-colors duration-500";
    }

    if (zeroTime) {
        const timeString = zeroTime.toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' });
        const msRemaining   = zeroTime - new Date();
        const totalMinutes  = Math.ceil(msRemaining / (1000 * 60));
        const hours         = Math.floor(totalMinutes / 60);
        const minutes       = totalMinutes % 60;
        const countdownStr  = hours > 0 && minutes > 0 ? `${hours} h ${minutes} min`
                            : hours > 0                ? `${hours} h`
                            :                            `${minutes} min`;
        burnDisplay.textContent = `Alkoholi poltettu arviolta klo ${timeString} (${countdownStr})`;
    } else {
        burnDisplay.textContent = "Keho on puhdas alkoholista.";
    }

    document.getElementById('session-count').textContent = count;
    document.getElementById('session-grams').textContent = grams.toFixed(1);
}

// --- KELLONAJAN VALINTA ---
let customTimeOpen = false;

function updateTimeResultLabel() {
    const mins    = parseInt(document.getElementById('select-time-ago').value, 10);
    const result  = new Date(Date.now() - mins * 60000);
    const timeStr = result.toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' });

    // Näytetään "eilen" jos päivä on vaihtunut
    const today     = new Date();
    const isYesterday = result.getDate() !== today.getDate()
                     || result.getMonth() !== today.getMonth()
                     || result.getFullYear() !== today.getFullYear();
    const dayLabel  = isYesterday ? ' (eilen)' : '';

    document.getElementById('time-result-label').textContent = `→ klo ${timeStr}${dayLabel}`;
}

document.getElementById('btn-time-toggle').onclick = function() {
    customTimeOpen = !customTimeOpen;
    const row   = document.getElementById('time-input-row');
    const label = document.getElementById('time-toggle-label');
    const icon  = document.getElementById('time-toggle-icon');

    if (customTimeOpen) {
        row.classList.remove('hidden');
        label.textContent = 'Peruuta — käytä nykyistä aikaa';
        icon.textContent  = '✕';
        updateTimeResultLabel();
    } else {
        row.classList.add('hidden');
        label.textContent = 'Unohditko merkitä? Aseta kellonaika';
        icon.textContent  = '⏱';
    }
};

document.getElementById('select-time-ago').onchange = updateTimeResultLabel;

// --- TALLENNUS ---
document.getElementById('btn-save').onclick = async function() {
    const abv    = parseFloat(selectAbv.value);
    const volume = parseFloat(document.getElementById('input-volume').value);
    const weight = parseFloat(document.getElementById('input-weight').value) || 80;
    const height = parseFloat(document.getElementById('input-height').value) || 178;
    const age    = parseInt(document.getElementById('input-age').value, 10) || 35;
    const gender = document.getElementById('select-gender').value;

    if (!volume || volume <= 0) return alert("Syötä määrä!");

    // Kellonaika: pudotusvalikosta laskettu tai nykyinen hetki
    const timestamp = customTimeOpen
        ? new Date(Date.now() - parseInt(document.getElementById('select-time-ago').value, 10) * 60000).toISOString()
        : new Date().toISOString();

    // Alkoholin grammamäärä: tilavuus (ml) × prosentti × etanolin tiheys (0,789 g/ml)
    const alcoholGrams = volume * (abv / 100) * 0.789;

    const drinkRecord = {
        timestamp,
        drink_type:    activeType,
        abv:           abv,
        volume_ml:     volume,
        alcohol_grams: alcoholGrams
    };

    // Odotetaan juoman tallentuminen ennen laskentaa (race condition -korjaus)
    await dbWrite('drinks_log', drinkRecord);

    // Tallennetaan tämän juomalajin käytetty alkoholiprosentti muistiin
    await setTypeAbv(activeType, abv.toFixed(1));

    // Profiili ja viimeisin syöte — ei tarvitse odottaa
    dbWrite('settings', { key: 'user_profile', weight, height, age, gender });
    dbWrite('settings', { key: 'last_input', drink_type: activeType, abv, volume_ml: volume });

    // Nollataan kellonaikovalinta tallennuksen jälkeen
    if (customTimeOpen) {
        document.getElementById('btn-time-toggle').click();
    }

    calculatePromilles();
};

// --- ISTUNNON TYHJENNYS ---
document.getElementById('btn-clear-session').onclick = async function() {
    if (!confirm('Tyhjennetäänkö kaikki juomat? Tietoja ei voi palauttaa.')) return;
    await dbClearStore('drinks_log');
    calculatePromilles();
};

// --- OMAN JUOMALAJIN LISÄYS ---
document.getElementById('btn-add-custom').onclick = function() {
    const input = document.getElementById('custom-drink-name');
    const name  = input.value.trim();
    if (!name) return;

    const id = 'custom_' + Date.now();
    // Peritään nykyinen valittu prosentti uudelle juomalajille oletukseksi
    typeAbvs[id] = selectAbv.value;
    dbWrite('settings', { key: 'drink_type_abvs', abvs: typeAbvs });
    dbWrite('drink_types', { id, label: name });
    activeType = id;
    input.value = '';
    renderDrinkTypes();
};

// --- PROFIILIN TALLENNUS ---
document.getElementById('input-weight').onchange    = saveProfile;
document.getElementById('input-height').onchange    = saveProfile;
document.getElementById('input-age').onchange       = saveProfile;
document.getElementById('select-gender').onchange   = saveProfile;
document.getElementById('input-burn-rate').oninput  = function() {
    const v = parseFloat(this.value).toFixed(2);
    document.getElementById('burn-rate-value').textContent = v + ' ‰/h';
    saveProfile();
};

function saveProfile() {
    const weight    = parseFloat(document.getElementById('input-weight').value) || 80;
    const height    = parseFloat(document.getElementById('input-height').value) || 178;
    const age       = parseInt(document.getElementById('input-age').value, 10) || 35;
    const gender    = document.getElementById('select-gender').value;
    const burnRate  = parseFloat(document.getElementById('input-burn-rate').value) || 0.15;
    dbWrite('settings', { key: 'user_profile', weight, height, age, gender, burnRate });
    calculatePromilles();
}

// --- TILASTO (viimeiset 24 h) ---
let statsOpen = false;

document.getElementById('btn-stats-toggle').onclick = function() {
    statsOpen = !statsOpen;
    const content = document.getElementById('stats-content');
    const arrow   = document.getElementById('stats-arrow');
    if (statsOpen) {
        content.classList.remove('hidden');
        arrow.style.transform = 'rotate(90deg)';
        renderStatistics();
    } else {
        content.classList.add('hidden');
        arrow.style.transform = 'rotate(0deg)';
    }
};

async function renderStatistics() {
    const statsList = document.getElementById('stats-list');
    statsList.innerHTML = '<p class="text-slate-500 text-sm text-center py-2">Ladataan...</p>';

    const now    = new Date();
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const logs   = await dbGetAll('drinks_log');
    const recent = logs.filter(d => new Date(d.timestamp) >= cutoff);

    if (recent.length === 0) {
        statsList.innerHTML = '<p class="text-slate-500 text-sm text-center py-3">Ei juomia viimeisen 24 tunnin aikana.</p>';
        return;
    }

    // Haetaan juomalajien nimet (oletuslajit + omat)
    const customTypes = await dbGetAll('drink_types');
    const allTypes    = [...defaultTypes, ...customTypes];
    const typeMap     = {};
    allTypes.forEach(t => typeMap[t.id] = t.label);

    // Ryhmitellään lajin ja alkoholiprosentin mukaan
    const groups = {};
    recent.forEach(d => {
        const key = `${d.drink_type}__${d.abv}`;
        if (!groups[key]) {
            groups[key] = {
                label:    typeMap[d.drink_type] || d.drink_type,
                abv:      d.abv,
                total_ml: 0,
                count:    0
            };
        }
        groups[key].total_ml += d.volume_ml;
        groups[key].count++;
    });

    // Järjestys: laji aakkosjärjestyksessä, sitten ABV nousevasti
    const sorted = Object.values(groups).sort((a, b) =>
        a.label.localeCompare(b.label, 'fi') || a.abv - b.abv
    );

    let html = '<div class="space-y-2 mt-1">';
    sorted.forEach(g => {
        const cl = (g.total_ml / 10).toFixed(1);
        html += `
        <div class="flex justify-between items-center bg-slate-900/60 rounded-lg px-3 py-2.5">
            <div>
                <span class="font-semibold text-slate-200">${g.label}</span>
                <span class="text-slate-400 text-xs ml-2">${parseFloat(g.abv).toFixed(1)} %</span>
            </div>
            <div class="text-right">
                <span class="font-bold text-amber-400">${cl} cl</span>
                <span class="text-slate-500 text-xs ml-1">(${g.count} kpl)</span>
            </div>
        </div>`;
    });

    // Yhteenveto
    const totalCl    = (recent.reduce((s, d) => s + d.volume_ml, 0) / 10).toFixed(1);
    const totalGrams = recent.reduce((s, d) => s + d.alcohol_grams, 0).toFixed(1);
    const totalCount = recent.length;

    html += `
    <div class="border-t border-slate-700 mt-3 pt-3 flex justify-between items-center">
        <span class="text-slate-400 text-xs uppercase tracking-wide">Yhteensä ${totalCount} kpl</span>
        <span class="text-amber-400 font-bold">${totalCl} cl &middot; ${totalGrams} g</span>
    </div>`;

    html += '</div>';
    statsList.innerHTML = html;
}

// --- PROMILLEKUVAAJA ---
function renderBacChart(sessionDrinks, distributionVolume, burnRatePerHour, currentPromilles, zeroTime) {
    const canvas       = document.getElementById('bac-chart');
    const chartSection = document.getElementById('chart-section');
    if (!canvas || !chartSection) return;

    if (!sessionDrinks || sessionDrinks.length === 0 || !zeroTime) {
        chartSection.classList.add('hidden');
        return;
    }

    chartSection.classList.remove('hidden');

    const now            = new Date();
    const firstDrinkTime = new Date(sessionDrinks[0].timestamp);

    // Laske BAC ajanhetkellä t käyttäen korjattua segmenttilaskentaa (ei nollavelkaa)
    function bacAt(t) {
        return computeBAC(t.getTime(), sessionDrinks, distributionVolume, burnRatePerHour);
    }

    // Generoi datapisteet 5 min välein ensimmäisestä juomasta → nollahetkeen
    const step       = 5 * 60 * 1000;
    const chartStart = firstDrinkTime.getTime();
    const chartEnd   = zeroTime.getTime() + step;
    const points     = [];
    for (let t = chartStart; t <= chartEnd; t += step) {
        points.push({ ms: t, bac: bacAt(new Date(t)) });
    }
    // Varmista "nyt"-piste on mukana
    const nowMs  = now.getTime();
    const nowBac = bacAt(now);
    let inserted = false;
    for (let i = 0; i < points.length - 1; i++) {
        if (points[i].ms <= nowMs && points[i + 1].ms > nowMs) {
            points.splice(i + 1, 0, { ms: nowMs, bac: nowBac });
            inserted = true;
            break;
        }
    }
    if (!inserted) {
        points.push({ ms: nowMs, bac: nowBac });
        points.sort((a, b) => a.ms - b.ms);
    }

    // Canvas-koko (HiDPI-tuki)
    const dpr          = window.devicePixelRatio || 1;
    const displayW     = canvas.offsetWidth || (chartSection.clientWidth - 32) || (window.innerWidth - 72);
    const displayH     = 150;
    canvas.width       = Math.round(displayW * dpr);
    canvas.height      = Math.round(displayH * dpr);
    const ctx          = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const pad    = { top: 14, right: 14, bottom: 26, left: 38 };
    const plotW  = displayW - pad.left - pad.right;
    const plotH  = displayH - pad.top  - pad.bottom;
    const maxBac = Math.max(...points.map(p => p.bac), 0.1);
    const yMax   = Math.max(Math.ceil(maxBac * 10) / 10 + 0.1, 0.3);

    const xOf = ms  => pad.left + (ms  - chartStart) / (chartEnd - chartStart) * plotW;
    const yOf = bac => pad.top  + plotH - (bac / yMax) * plotH;

    ctx.clearRect(0, 0, displayW, displayH);

    // --- Y-viivat ja -merkinnät ---
    const yStep = maxBac < 0.25 ? 0.1 : 0.5;
    ctx.font         = '9px sans-serif';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= yMax + 0.001; v = Math.round((v + yStep) * 100) / 100) {
        const y = yOf(v);
        if (y < pad.top - 4 || y > pad.top + plotH + 4) continue;
        ctx.strokeStyle = 'rgba(148,163,184,0.1)';
        ctx.lineWidth   = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + plotW, y);
        ctx.stroke();
        ctx.fillStyle = 'rgba(148,163,184,0.5)';
        ctx.fillText(v.toFixed(1), pad.left - 5, y);
    }

    // 0,5 ‰ -raja katkoviivana
    if (yMax > 0.5) {
        const y05 = yOf(0.5);
        ctx.strokeStyle = 'rgba(251,191,36,0.18)';
        ctx.setLineDash([3, 5]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad.left, y05);
        ctx.lineTo(pad.left + plotW, y05);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // --- X-akseli: tuntimerkit ---
    const spanH  = (chartEnd - chartStart) / (1000 * 60 * 60);
    const hStep  = spanH <= 3 ? 0.5 : spanH <= 6 ? 1 : spanH <= 12 ? 2 : 3;
    const hStepMs = hStep * 60 * 60 * 1000;
    const tickOrigin = Math.ceil(chartStart / hStepMs) * hStepMs;
    ctx.fillStyle    = 'rgba(148,163,184,0.45)';
    ctx.font         = '9px sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let t = tickOrigin; t <= chartEnd; t += hStepMs) {
        const x = xOf(t);
        if (x < pad.left - 2 || x > pad.left + plotW + 2) continue;
        ctx.strokeStyle = 'rgba(148,163,184,0.08)';
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + plotH + 3);
        ctx.stroke();
        const label = new Date(t).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' });
        ctx.fillText(label, x, displayH - 3);
    }

    // --- Käyrä: menneisyys (kiinteä) ---
    const pastPts   = points.filter(p => p.ms <= nowMs);
    const futurePts = points.filter(p => p.ms >= nowMs);
    const lineColor = currentPromilles > 0.5 ? '#f43f5e' : '#f59e0b';

    if (pastPts.length >= 2) {
        // Täyttö
        ctx.beginPath();
        pastPts.forEach((p, i) => {
            const x = xOf(p.ms);
            const y = yOf(p.bac);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.lineTo(xOf(pastPts[pastPts.length - 1].ms), yOf(0));
        ctx.lineTo(xOf(pastPts[0].ms), yOf(0));
        ctx.closePath();
        const fg = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
        fg.addColorStop(0, currentPromilles > 0.5 ? 'rgba(244,63,94,0.28)' : 'rgba(245,158,11,0.22)');
        fg.addColorStop(1, 'rgba(245,158,11,0.02)');
        ctx.fillStyle = fg;
        ctx.fill();
        // Viiva
        ctx.beginPath();
        pastPts.forEach((p, i) => {
            const x = xOf(p.ms);
            const y = yOf(p.bac);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = lineColor;
        ctx.lineWidth   = 2.5;
        ctx.lineJoin    = 'round';
        ctx.lineCap     = 'round';
        ctx.setLineDash([]);
        ctx.stroke();
    }

    // --- Käyrä: tulevaisuus (katkoviiva) ---
    if (futurePts.length >= 2) {
        ctx.beginPath();
        futurePts.forEach((p, i) => {
            const x = xOf(p.ms);
            const y = yOf(p.bac);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = 'rgba(148,163,184,0.4)';
        ctx.lineWidth   = 1.5;
        ctx.lineJoin    = 'round';
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // --- "Nyt"-piste ---
    const nowX = xOf(nowMs);
    const nowY = yOf(nowBac);
    // Pystyviiva
    ctx.strokeStyle = 'rgba(251,191,36,0.28)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(nowX, pad.top);
    ctx.lineTo(nowX, pad.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    // Ympyrä
    ctx.fillStyle   = lineColor;
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.arc(nowX, nowY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
}

// --- SOVELLUKSEN KÄYNNISTYS ---
initDB().then(async () => {
    // Ladataan tallennettu profiili
    const profile = await dbGet('settings', 'user_profile');
    if (profile) {
        document.getElementById('input-weight').value  = profile.weight;
        document.getElementById('input-height').value  = profile.height || 178;
        document.getElementById('input-age').value     = profile.age || 35;
        document.getElementById('select-gender').value = profile.gender;
        const burnRate = profile.burnRate || 0.15;
        document.getElementById('input-burn-rate').value    = burnRate;
        document.getElementById('burn-rate-value').textContent = burnRate.toFixed(2) + ' ‰/h';
    }

    // Ladataan juomalajikohtaiset alkoholiprosentit
    const typeAbvsRecord = await dbGet('settings', 'drink_type_abvs');
    if (typeAbvsRecord) {
        typeAbvs = typeAbvsRecord.abvs || {};
    }

    // Ladataan viimeisin syöte oletuksiksi
    const lastInput = await dbGet('settings', 'last_input');
    if (lastInput) {
        activeType = lastInput.drink_type;
        document.getElementById('input-volume').value = lastInput.volume_ml;
    }

    // Asetetaan aktiivisen juomalajin tallennettu tai oletus-ABV
    selectAbv.value = getTypeAbv(activeType);

    renderDrinkTypes();
    calculatePromilles();

    // Päivitetään promillenäyttö automaattisesti 10 sekunnin välein
    setInterval(calculatePromilles, 10000);

}).catch(err => {
    // Virhe tietokannan avauksessa — näytetään käyttäjälle selkeä viesti
    document.body.innerHTML = `
        <div class="min-h-screen bg-slate-900 flex items-center justify-center p-8">
            <div class="bg-slate-800 p-6 rounded-2xl text-center border border-red-800 max-w-sm">
                <p class="text-red-400 font-bold text-lg mb-2">⚠ Tietokanta ei avautunut</p>
                <p class="text-slate-300 text-sm mb-3">${err.message}</p>
                <p class="text-slate-500 text-xs">Tarkista selaimen asetukset tai salli tietojen tallennus sivustolle.</p>
            </div>
        </div>`;
});
