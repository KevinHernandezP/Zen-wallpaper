const fileInput = document.getElementById('video-upload');
const videoPlayer = document.getElementById('bg-video');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarClose = document.getElementById('sidebar-close');
const clockElement = document.getElementById('clock');
const dateElement = document.getElementById('date');
const opacitySlider = document.getElementById('video-opacity');
const resetBtn = document.getElementById('reset-video');
const statusText = document.getElementById('status-text');

let currentBlobUrl = null;

// --- IndexedDB Setup ---
const DB_NAME = 'ZenTabDB';
const DB_VERSION = 1;
const STORE_NAME = 'videos';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveVideoBlob(blob) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(blob, 'background');
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getVideoBlob() {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get('background');
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function clearVideoBlob() {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete('background');
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// 1. Sidebar Logic
sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('active');
});

sidebarClose.addEventListener('click', () => {
    sidebar.classList.remove('active');
});

// Close sidebar when clicking outside on the main content
document.querySelector('.main-content').addEventListener('click', () => {
    if (sidebar.classList.contains('active')) {
        sidebar.classList.remove('active');
    }
});

// 2. Real-time Clock
function updateClock() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    clockElement.textContent = `${hours}:${minutes}`;

    const options = { weekday: 'long', day: 'numeric', month: 'long' };
    dateElement.textContent = now.toLocaleDateString('es-ES', options);
}

setInterval(updateClock, 1000);
updateClock();

// 3. Video Loading & Persistence
function loadVideo(blob) {
    if (!blob) return;

    // Revoke old URL to free memory
    if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
    }

    currentBlobUrl = URL.createObjectURL(blob);
    videoPlayer.src = currentBlobUrl;
    videoPlayer.load();

    const playPromise = videoPlayer.play();
    if (playPromise !== undefined) {
        playPromise.catch(error => {
            console.warn("Autoplay block or error:", error);
            statusText.textContent = "Haz clic para activar el video";
        });
    }
}

// Initial Load
(async function init() {
    try {
        const [blob, settings] = await Promise.all([
            getVideoBlob(),
            new Promise(resolve => chrome.storage.local.get(['videoOpacity', 'savedVideo'], resolve))
        ]);

        if (blob) {
            loadVideo(blob);
            statusText.textContent = "Video loaded successfully.";
        } else if (settings.savedVideo) {
            // Migration logic: if we have old Base64, convert it once and save as Blob
            statusText.textContent = "Migrando video...";
            const response = await fetch(settings.savedVideo);
            const newBlob = await response.blob();
            await saveVideoBlob(newBlob);
            loadVideo(newBlob);
            chrome.storage.local.remove('savedVideo'); // Cleanup old storage
            statusText.textContent = "Optimización completada.";
        }

        if (settings.videoOpacity !== undefined) {
            videoPlayer.style.opacity = settings.videoOpacity;
            opacitySlider.value = settings.videoOpacity;
        } else {
            videoPlayer.style.opacity = 1;
            opacitySlider.value = 1;
        }
    } catch (err) {
        console.error("Init error:", err);
    }
})();

fileInput.addEventListener('change', async function () {
    const file = this.files[0];
    if (file) {
        statusText.textContent = "Guardando video...";
        try {
            await saveVideoBlob(file);
            loadVideo(file);
            statusText.textContent = "Video optimizado y guardado.";
        } catch (err) {
            statusText.textContent = "Error al guardar el video.";
            console.error(err);
        }
    }
});

// 4. Opacity Control
opacitySlider.addEventListener('input', (e) => {
    const opacity = e.target.value;
    videoPlayer.style.opacity = opacity;
    chrome.storage.local.set({ 'videoOpacity': opacity });
});

// 5. Reset Background
resetBtn.addEventListener('click', async () => {
    if (confirm('¿Estás seguro de que quieres restablecer el fondo?')) {
        await clearVideoBlob();
        videoPlayer.src = '';
        videoPlayer.load();
        statusText.textContent = "Fondo restablecido.";
        alert('Fondo restablecido correctamente.');
    }
});

const toast = document.getElementById('donation-toast');
const closeToast = document.getElementById('close-toast');

// Lógica para mostrar el Toast con respeto
chrome.storage.local.get(['lastToastDate'], (result) => {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    // Si nunca se ha mostrado o pasaron más de 24h
    if (!result.lastToastDate || (now - result.lastToastDate > oneDay)) {
        setTimeout(() => {
            toast.classList.add('show');
        }, 5000); // Aparece a los 5 segundos
    }
});

closeToast.addEventListener('click', () => {
    toast.classList.remove('show');
    // Guardamos la fecha actual para no molestar hasta mañana
    chrome.storage.local.set({ 'lastToastDate': Date.now() });
});
