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
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `flex-1 min-w-[28%] text-sm font-medium py-3 px-2 rounded-xl border transition-all duration-200 ${
            activeType === t.id
            ? 'bg-amber-500 text-slate-950 border-amber-500 font-bold shadow-lg scale-105'
            : 'bg-slate-850 text-slate-300 border-slate-700 hover:bg-slate-750'
        }`;
        btn.textContent = t.label;
        btn.onclick = () => {
            activeType = t.id;
            renderDrinkTypes();
        };
        container.appendChild(btn);
    });
}

// --- LASKENTALOGIIKKA (WIDMARK + 30 MIN IMEYTYMISAIKA) ---
function calculatePromilles() {
    const weight = parseFloat(document.getElementById('input-weight').value) || 80;
    const gender = document.getElementById('select-gender').value;
    const r = gender === 'male' ? 0.68 : 0.55; // Kehon nestekerroin
    const burnRatePerHour = 0.15;               // Promilleä/tunti, Widmark-vakio

    dbGetAll('drinks_log').then(logs => {
        if (logs.length === 0) {
            updateUI(0, null, 0, 0);
            return;
        }

        // Järjestetään aikajärjestykseen
        logs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        const now = new Date();
        const lastDrinkTime = new Date(logs[logs.length - 1].timestamp);

        // 24 tunnin nollaussääntö viimeisestä juomasta
        if ((now - lastDrinkTime) / (1000 * 60 * 60) >= 24) {
            updateUI(0, null, 0, 0);
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

        // Lasketaan imeytynyt alkoholi: lineaarinen nousu 0 → 30 min, sen jälkeen täysi
        let totalAbsorbedGrams = 0;
        sessionDrinks.forEach(drink => {
            const drinkTime = new Date(drink.timestamp);
            const elapsedMinutes = (now - drinkTime) / (1000 * 60);

            if (elapsedMinutes > 0) {
                if (elapsedMinutes >= 30) {
                    totalAbsorbedGrams += drink.alcohol_grams;
                } else {
                    totalAbsorbedGrams += drink.alcohol_grams * (elapsedMinutes / 30);
                }
            }
        });

        // Widmark-kaava: C = A / (r * W)
        let theoreticalPromilles = totalAbsorbedGrams / (weight * r);

        // Vähennetään palaminen ensimmäisestä juomasta lähtien
        const totalElapsedHours = (now - firstDrinkTime) / (1000 * 60 * 60);
        let currentPromilles = theoreticalPromilles - (totalElapsedHours * burnRatePerHour);
        if (currentPromilles < 0) currentPromilles = 0;

        // Arvioidaan milloin promillet ovat nollassa
        let zeroTime = null;
        if (currentPromilles > 0) {
            const hoursToBurn = currentPromilles / burnRatePerHour;
            zeroTime = new Date(now.getTime() + hoursToBurn * 60 * 60 * 1000);
        }

        updateUI(currentPromilles, zeroTime, sessionDrinks.length, totalSessionGrams);
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

    if (zeroTime && promilles > 0) {
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

// --- TALLENNUS ---
document.getElementById('btn-save').onclick = async function() {
    const abv    = parseFloat(selectAbv.value);
    const volume = parseFloat(document.getElementById('input-volume').value);
    const weight = parseFloat(document.getElementById('input-weight').value) || 80;
    const gender = document.getElementById('select-gender').value;

    if (!volume || volume <= 0) return alert("Syötä määrä!");

    // Alkoholin grammamäärä: tilavuus (ml) × prosentti × etanolin tiheys (0,789 g/ml)
    const alcoholGrams = volume * (abv / 100) * 0.789;

    const drinkRecord = {
        timestamp:     new Date().toISOString(),
        drink_type:    activeType,
        abv:           abv,
        volume_ml:     volume,
        alcohol_grams: alcoholGrams
    };

    // Odotetaan juoman tallentuminen ennen laskentaa (race condition -korjaus)
    await dbWrite('drinks_log', drinkRecord);

    // Profiili ja viimeisin syöte — ei tarvitse odottaa
    dbWrite('settings', { key: 'user_profile', weight, gender });
    dbWrite('settings', { key: 'last_input', drink_type: activeType, abv, volume_ml: volume });

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
    dbWrite('drink_types', { id, label: name });
    activeType = id;
    input.value = '';
    renderDrinkTypes();
};

// --- PROFIILIN TALLENNUS ---
document.getElementById('input-weight').onchange = saveProfile;
document.getElementById('select-gender').onchange = saveProfile;

function saveProfile() {
    const weight = parseFloat(document.getElementById('input-weight').value) || 80;
    const gender = document.getElementById('select-gender').value;
    dbWrite('settings', { key: 'user_profile', weight, gender });
    calculatePromilles();
}

// --- SOVELLUKSEN KÄYNNISTYS ---
initDB().then(async () => {
    // Ladataan tallennettu profiili
    const profile = await dbGet('settings', 'user_profile');
    if (profile) {
        document.getElementById('input-weight').value = profile.weight;
        document.getElementById('select-gender').value = profile.gender;
    }

    // Ladataan viimeisin syöte oletuksiksi
    const lastInput = await dbGet('settings', 'last_input');
    if (lastInput) {
        activeType = lastInput.drink_type;
        selectAbv.value = lastInput.abv.toFixed(1);
        document.getElementById('input-volume').value = lastInput.volume_ml;
    }

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
