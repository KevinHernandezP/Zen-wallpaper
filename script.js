const fileInput = document.getElementById('video-upload');
const videoPlayer = document.getElementById('bg-video');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarClose = document.getElementById('sidebar-close');
const clockElement = document.getElementById('clock');
const dateElement = document.getElementById('date');
const opacitySlider = document.getElementById('video-opacity');
const volumeSlider = document.getElementById('video-volume');
const speedBtns = document.querySelectorAll('.speed-btn');
const clockFormatToggle = document.getElementById('clock-format');
const clockVisibilityToggle = document.getElementById('clock-visibility');
const posBtns = document.querySelectorAll('.pos-btn');
const searchInput = document.getElementById('search-input');
const greetingElement = document.getElementById('greeting');
const resetBtn = document.getElementById('reset-video');
const statusText = document.getElementById('status-text');
const recentVideosGroup = document.getElementById('recent-videos-group');
const recentVideosList = document.getElementById('recent-videos-list');

let currentBlobUrl = null;
let previewUrls = [];
let use24hFormat = true;
let idleTimer;
let clockInterval = null;
const IDLE_TIME = 10000; // 10 seconds

// --- IndexedDB Setup ---
const DB_NAME = 'ZenTabDB';
const DB_VERSION = 2;
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

async function saveVideoToLibrary(blob, id = null) {
    const db = await openDB();
    const vidId = id || `vid_${Date.now()}`;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(blob, vidId);

    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(vidId);
        tx.onerror = () => reject(tx.error);
    });
}

async function getVideoFromLibrary(id) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getAllVideoIds() {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAllKeys();
    return new Promise((resolve, reject) => {
        request.onsuccess = () => {
            resolve(request.result.filter(key => key !== 'background'));
        };
        request.onerror = () => reject(request.error);
    });
}

// --- UI Logic ---

// 1. Sidebar Logic
if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('active');
    });
}

if (sidebarClose) {
    sidebarClose.addEventListener('click', () => {
        sidebar.classList.remove('active');
    });
}

const mainContent = document.querySelector('.main-content');
if (mainContent) {
    mainContent.addEventListener('click', (e) => {
        if (e.target.closest('#search-container')) return;
        if (sidebar && sidebar.classList.contains('active')) {
            sidebar.classList.remove('active');
        }
    });
}

// 2. Real-time Clock & Greeting
function updateClock() {
    if (!clockElement || !dateElement || !greetingElement) return;

    const now = new Date();
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');

    // Update Greeting
    let greeting = "Good Night";
    if (hours >= 5 && hours < 12) greeting = "Good Morning";
    else if (hours >= 12 && hours < 18) greeting = "Good Afternoon";
    else if (hours >= 18 && hours < 22) greeting = "Good Evening";
    greetingElement.textContent = greeting;

    if (!use24hFormat) {
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        clockElement.textContent = `${hours}:${minutes} ${ampm}`;
    } else {
        clockElement.textContent = `${String(hours).padStart(2, '0')}:${minutes}`;
    }

    const options = { weekday: 'long', day: 'numeric', month: 'long' };
    dateElement.textContent = now.toLocaleDateString('en-US', options);
}

function startClock() {
    if (clockInterval) clearInterval(clockInterval);
    updateClock();
    clockInterval = setInterval(updateClock, 1000);
}

function stopClock() {
    if (clockInterval) {
        clearInterval(clockInterval);
        clockInterval = null;
    }
}

startClock();

// 3. Idle Detection
function resetIdleTimer() {
    if (!mainContent) return;
    mainContent.classList.remove('idle-fade');
    if (sidebarToggle) sidebarToggle.style.opacity = '1';
    clearTimeout(idleTimer);
    idleTimer = setTimeout(goIdle, IDLE_TIME);
}

function goIdle() {
    if (sidebar && !sidebar.classList.contains('active') && mainContent) {
        mainContent.classList.add('idle-fade');
        if (sidebarToggle) sidebarToggle.style.opacity = '0.3';
    }
}

document.addEventListener('mousemove', resetIdleTimer);
document.addEventListener('keypress', resetIdleTimer);
resetIdleTimer();

// 4. Video Loading & Persistence
function loadVideo(blob, id = null) {
    if (!blob || !videoPlayer) return;

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
            if (statusText) statusText.textContent = "Click to activate video";
        });
    }

    if (id) {
        chrome.storage.local.set({ activeVideoId: id });
        updateRecentVideosUI();
    }
}

// 4.1 Visibility & Focus Optimization
function handleVisibilityChange() {
    if (document.hidden || !document.hasFocus()) {
        if (videoPlayer && !videoPlayer.paused) {
            videoPlayer.pause();
        }
        stopClock();
    } else {
        if (videoPlayer && videoPlayer.paused) {
            videoPlayer.play().catch(() => { });
        }
        startClock();
    }
}

document.addEventListener('visibilitychange', handleVisibilityChange);
window.addEventListener('focus', handleVisibilityChange);
window.addEventListener('blur', handleVisibilityChange);

async function updateRecentVideosUI() {
    if (!recentVideosGroup || !recentVideosList) return;

    const ids = await getAllVideoIds();
    const activeId = (await chrome.storage.local.get(['activeVideoId'])).activeVideoId;

    if (ids.length > 0) {
        recentVideosGroup.style.display = 'block';

        // Revoke old preview URLs
        previewUrls.forEach(url => URL.revokeObjectURL(url));
        previewUrls = [];

        recentVideosList.innerHTML = '';

        const recentIds = ids.slice(-5).reverse();

        for (const id of recentIds) {
            const item = document.createElement('div');
            item.className = `recent-video-item ${id === activeId ? 'active' : ''}`;

            const blob = await getVideoFromLibrary(id);
            if (blob) {
                const vid = document.createElement('video');
                // Use a thumbnail instead or load on demand to save memory
                // For now, we set preload="metadata" to avoid downloading the whole thing
                vid.preload = "metadata";
                const url = URL.createObjectURL(blob);
                previewUrls.push(url);
                vid.src = url;
                vid.muted = true;
                item.appendChild(vid);

                item.addEventListener('mouseenter', () => {
                    vid.play().catch(() => { });
                });
                item.addEventListener('mouseleave', () => {
                    vid.pause();
                    vid.currentTime = 0;
                });

                item.addEventListener('click', async () => {
                    const freshBlob = await getVideoFromLibrary(id);
                    loadVideo(freshBlob, id);
                });

                recentVideosList.appendChild(item);
            }
        }
    } else {
        recentVideosGroup.style.display = 'none';
    }
}

// Initial Load
(async function init() {
    try {
        const settings = await new Promise(resolve =>
            chrome.storage.local.get(['videoOpacity', 'videoVolume', 'videoSpeed', 'activeVideoId', 'use24hFormat', 'showClock', 'clockPos'], resolve)
        );

        let blob = null;
        if (settings.activeVideoId) {
            blob = await getVideoFromLibrary(settings.activeVideoId);
        } else {
            const db = await openDB();
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get('background');
            blob = await new Promise(resolve => {
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(null);
            });

            if (blob) {
                const newId = await saveVideoToLibrary(blob);
                chrome.storage.local.set({ activeVideoId: newId });
            }
        }

        if (blob) {
            loadVideo(blob);
            if (statusText) statusText.textContent = "Video loaded successfully.";
        }

        if (videoPlayer) {
            if (settings.videoOpacity !== undefined) {
                videoPlayer.style.opacity = settings.videoOpacity;
                if (opacitySlider) opacitySlider.value = settings.videoOpacity;
            }

            if (settings.videoVolume !== undefined) {
                videoPlayer.volume = settings.videoVolume;
                if (volumeSlider) volumeSlider.value = settings.videoVolume;
                videoPlayer.muted = settings.videoVolume === 0;
            } else {
                videoPlayer.volume = 0;
                videoPlayer.muted = true;
            }

            if (settings.videoSpeed !== undefined) {
                videoPlayer.playbackRate = parseFloat(settings.videoSpeed);
                if (speedBtns) {
                    speedBtns.forEach(btn => {
                        btn.classList.toggle('active', btn.dataset.speed === settings.videoSpeed);
                    });
                }
            }
        }

        if (settings.use24hFormat !== undefined) {
            use24hFormat = settings.use24hFormat;
            if (clockFormatToggle) clockFormatToggle.checked = use24hFormat;
        }

        if (mainContent) {
            if (settings.showClock !== undefined) {
                mainContent.classList.toggle('clock-hidden', !settings.showClock);
                if (clockVisibilityToggle) clockVisibilityToggle.checked = settings.showClock;
            }

            if (settings.clockPos !== undefined) {
                const currentPosClass = Array.from(mainContent.classList).find(cls => cls.startsWith('pos-'));
                if (currentPosClass) mainContent.classList.remove(currentPosClass);
                mainContent.classList.add(`pos-${settings.clockPos}`);

                if (posBtns) {
                    posBtns.forEach(btn => {
                        btn.classList.toggle('active', btn.dataset.pos === settings.clockPos);
                    });
                }
            } else {
                mainContent.classList.add('pos-center');
            }
        }

        updateClock();
        updateRecentVideosUI();

    } catch (err) {
        console.error("Init error:", err);
    }
})();

if (fileInput) {
    fileInput.addEventListener('change', async function () {
        const file = this.files[0];
        if (file) {
            if (statusText) statusText.textContent = "Saving video...";
            try {
                const id = await saveVideoToLibrary(file);
                loadVideo(file, id);
                if (statusText) statusText.textContent = "Video saved to library.";
            } catch (err) {
                if (statusText) statusText.textContent = "Error saving video.";
                console.error(err);
            }
        }
    });
}

// 4. Controls
if (opacitySlider && videoPlayer) {
    opacitySlider.addEventListener('input', (e) => {
        const opacity = e.target.value;
        videoPlayer.style.opacity = opacity;
        chrome.storage.local.set({ 'videoOpacity': opacity });
    });
}

if (volumeSlider && videoPlayer) {
    volumeSlider.addEventListener('input', (e) => {
        const volume = parseFloat(e.target.value);
        videoPlayer.volume = volume;
        videoPlayer.muted = volume === 0;
        chrome.storage.local.set({ 'videoVolume': volume });
    });
}

if (speedBtns && videoPlayer) {
    speedBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const speed = btn.dataset.speed;
            videoPlayer.playbackRate = parseFloat(speed);
            speedBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            chrome.storage.local.set({ 'videoSpeed': speed });
        });
    });
}

if (clockFormatToggle) {
    clockFormatToggle.addEventListener('change', (e) => {
        use24hFormat = e.target.checked;
        chrome.storage.local.set({ 'use24hFormat': use24hFormat });
        updateClock();
    });
}

if (clockVisibilityToggle) {
    clockVisibilityToggle.addEventListener('change', (e) => {
        const show = e.target.checked;
        if (mainContent) {
            mainContent.classList.toggle('clock-hidden', !show);
        }
        chrome.storage.local.set({ 'showClock': show });
    });
}

if (posBtns) {
    posBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const pos = btn.dataset.pos;
            if (mainContent) {
                const currentPosClass = Array.from(mainContent.classList).find(cls => cls.startsWith('pos-'));
                if (currentPosClass) mainContent.classList.remove(currentPosClass);
                mainContent.classList.add(`pos-${pos}`);
            }
            posBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            chrome.storage.local.set({ 'clockPos': pos });
        });
    });
}

if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const query = searchInput.value.trim();
            if (query) {
                window.location.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
            }
        }
    });
}

if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to reset everything? This will clear your library and settings.')) {
            const db = await openDB();
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).clear();
            await new Promise(resolve => {
                tx.oncomplete = resolve;
            });
            chrome.storage.local.clear();
            location.reload();
        }
    });
}

// Toast Logic
const toast = document.getElementById('donation-toast');
const closeToast = document.getElementById('close-toast');

if (toast && closeToast) {
    chrome.storage.local.get(['lastToastDate'], (result) => {
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;

        if (!result.lastToastDate || (now - result.lastToastDate > oneDay)) {
            setTimeout(() => {
                toast.classList.add('show');
            }, 5000);
        }
    });

    closeToast.addEventListener('click', () => {
        toast.classList.remove('show');
        chrome.storage.local.set({ 'lastToastDate': Date.now() });
    });
}
