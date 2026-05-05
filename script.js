const fileInput = document.getElementById('video-upload');
const videoPlayer = document.getElementById('bg-video');
const imagePlayer = document.getElementById('bg-image');
const mediaPositionSlider = document.getElementById('media-position');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarClose = document.getElementById('sidebar-close');
const clockElement = document.getElementById('clock');
const dateElement = document.getElementById('date');
const videoFitToggle = document.getElementById('video-fit');
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
let currentLoadedVideoId = null; // Track which video is currently loaded
let use24hFormat = true;
let idleTimer;
let idleThrottleTimer = null;
let clockInterval = null;
let lastClockMinute = -1;
const IDLE_TIME = 10000; // 10 seconds

// --- IndexedDB Setup ---
const DB_NAME = 'ZenTabDB';
const DB_VERSION = 3; // Bumped from 2 → 3 for thumbnails store
const STORE_NAME = 'videos';
const THUMB_STORE = 'thumbnails';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
            if (!db.objectStoreNames.contains(THUMB_STORE)) {
                db.createObjectStore(THUMB_STORE);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Helper: run a transaction and close db when done
async function withDB(storeNames, mode, callback) {
    const db = await openDB();
    try {
        const tx = db.transaction(storeNames, mode);
        const result = await callback(tx, db);
        return result;
    } finally {
        db.close();
    }
}

async function saveVideoToLibrary(blob, id = null) {
    const vidId = id || `vid_${Date.now()}`;

    // Save video blob first
    await withDB(STORE_NAME, 'readwrite', (tx) => {
        tx.objectStore(STORE_NAME).put(blob, vidId);
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    });

    // Generate and cache thumbnail in a separate transaction
    // (generateThumbnail is async and would cause the previous tx to auto-commit)
    try {
        const thumbnail = await generateThumbnail(blob);
        if (thumbnail) {
            await withDB(THUMB_STORE, 'readwrite', (tx) => {
                tx.objectStore(THUMB_STORE).put(thumbnail, vidId);
                return new Promise((resolve, reject) => {
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                });
            });
        }
    } catch (e) {
        // Thumbnail generation failed — not critical, video still saved
        console.warn('Thumbnail generation failed:', e);
    }

    return vidId;
}

async function getVideoFromLibrary(id) {
    return withDB(STORE_NAME, 'readonly', (tx) => {
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(id);
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    });
}

async function getThumbnailFromCache(id) {
    return withDB(THUMB_STORE, 'readonly', (tx) => {
        const store = tx.objectStore(THUMB_STORE);
        const request = store.get(id);
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    });
}

async function getAllVideoIds() {
    return withDB(STORE_NAME, 'readonly', (tx) => {
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAllKeys();
        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                resolve(request.result.filter(key => key !== 'background'));
            };
            request.onerror = () => reject(request.error);
        });
    });
}

async function deleteVideoFromLibrary(id) {
    return withDB([STORE_NAME, THUMB_STORE], 'readwrite', (tx) => {
        tx.objectStore(STORE_NAME).delete(id);
        tx.objectStore(THUMB_STORE).delete(id);
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
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

// 2. Real-time Clock & Greeting — Using requestAnimationFrame
function updateClock() {
    if (!clockElement || !dateElement || !greetingElement) return;

    const now = new Date();
    let hours = now.getHours();
    const minutes = now.getMinutes();

    // Only update DOM when minute changes (reduces unnecessary repaints)
    const currentMinute = hours * 60 + minutes;
    if (currentMinute === lastClockMinute) return;
    lastClockMinute = currentMinute;

    const minuteStr = String(minutes).padStart(2, '0');

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
        clockElement.textContent = `${hours}:${minuteStr} ${ampm}`;
    } else {
        clockElement.textContent = `${String(hours).padStart(2, '0')}:${minuteStr}`;
    }

    const options = { weekday: 'long', day: 'numeric', month: 'long' };
    dateElement.textContent = now.toLocaleDateString('en-US', options);
}

function startClock() {
    if (clockInterval) clearInterval(clockInterval);
    lastClockMinute = -1; // Force update on start
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

// 3. Idle Detection — Throttled mousemove
function resetIdleTimer() {
    if (!mainContent) return;
    mainContent.classList.remove('idle-fade');
    if (sidebarToggle) sidebarToggle.style.opacity = '1';
    clearTimeout(idleTimer);
    idleTimer = setTimeout(goIdle, IDLE_TIME);
}

function throttledResetIdle() {
    if (idleThrottleTimer) return;
    idleThrottleTimer = setTimeout(() => {
        idleThrottleTimer = null;
        resetIdleTimer();
    }, 200); // Throttle to once per 200ms
}

function goIdle() {
    if (sidebar && !sidebar.classList.contains('active') && mainContent) {
        mainContent.classList.add('idle-fade');
        if (sidebarToggle) sidebarToggle.style.opacity = '0.3';
    }
}

document.addEventListener('mousemove', throttledResetIdle);
document.addEventListener('keypress', resetIdleTimer);
resetIdleTimer();

// 4. Video Loading & Persistence
function loadVideo(blob, id = null) {
    if (!blob || !videoPlayer || !imagePlayer) return;

    if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
        currentBlobUrl = null;
    }

    currentBlobUrl = URL.createObjectURL(blob);

    if (blob.type && blob.type.startsWith('image/')) {
        videoPlayer.style.display = 'none';
        videoPlayer.pause();
        videoPlayer.removeAttribute('src');
        videoPlayer.load();

        imagePlayer.style.display = 'block';
        imagePlayer.src = currentBlobUrl;
    } else {
        imagePlayer.style.display = 'none';
        imagePlayer.removeAttribute('src');

        videoPlayer.style.display = 'block';
        videoPlayer.src = currentBlobUrl;
        videoPlayer.load();

        const playPromise = videoPlayer.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.warn("Autoplay block or error:", error);
                if (statusText) statusText.textContent = "Click to activate media";
            });
        }
    }

    if (id) {
        currentLoadedVideoId = id;
        chrome.storage.local.set({ activeVideoId: id });
        updateRecentVideosUI();
    }
}

// 4.1 Visibility & Focus Optimization — Pausing/Unloading to save RAM and CPU
let wasPlayingBeforeHide = false;
let unloadTimeout = null;
let isCurrentlyActive = !document.hidden && document.hasFocus();
const UNLOAD_DELAY = 10000; // 10 seconds before full unload memory

function checkActiveState() {
    // Active if tab is visible AND window is focused
    const nowActive = !document.hidden && document.hasFocus();

    // Skip if state hasn't actually changed (debounce)
    if (nowActive === isCurrentlyActive) return;
    isCurrentlyActive = nowActive;

    if (!nowActive) {
        // Tab became background or unfocused — pause immediately, schedule full unload
        if (videoPlayer) {
            wasPlayingBeforeHide = !videoPlayer.paused;
            videoPlayer.pause();
        }
        stopClock();

        // Schedule full memory release after X seconds
        unloadTimeout = setTimeout(() => {
            if (!isCurrentlyActive) {
                if (videoPlayer) {
                    videoPlayer.removeAttribute('src');
                    videoPlayer.load(); // Release decoded frames & GPU memory
                }
                if (imagePlayer) {
                    imagePlayer.removeAttribute('src');
                }
                if (currentBlobUrl) {
                    URL.revokeObjectURL(currentBlobUrl);
                    currentBlobUrl = null;
                }
                currentLoadedVideoId = null; // Force reload on restore
            }
        }, UNLOAD_DELAY);
    } else {
        // Tab became active/focused — cancel pending unload, restore video
        if (unloadTimeout) {
            clearTimeout(unloadTimeout);
            unloadTimeout = null;
        }

        if ((videoPlayer || imagePlayer) && currentBlobUrl && currentLoadedVideoId) {
            // Media was only paused/hidden (quick switch) — just resume
            if (wasPlayingBeforeHide && videoPlayer.style.display !== 'none') {
                videoPlayer.play().catch(() => { });
            }
        } else {
            // Media was fully unloaded (long absence) — reload from IndexedDB
            (async () => {
                try {
                    const settings = await chrome.storage.local.get(['activeVideoId']);
                    if (settings.activeVideoId && (videoPlayer || imagePlayer)) {
                        const blob = await getVideoFromLibrary(settings.activeVideoId);
                        if (blob) {
                            loadVideo(blob, settings.activeVideoId);
                        }
                    }
                } catch (e) {
                    console.warn('Error restoring media:', e);
                }
            })();
        }

        startClock();
        updateRecentVideosUI();
    }
}

// Track both visibility and window focus/blur
document.addEventListener('visibilitychange', checkActiveState);
window.addEventListener('focus', checkActiveState);
window.addEventListener('blur', checkActiveState);

// Generate a small thumbnail from a media blob (returns a data URL)
function generateThumbnail(blob) {
    return new Promise((resolve) => {
        if (blob.type && blob.type.startsWith('image/')) {
            const img = new Image();
            const tempUrl = URL.createObjectURL(blob);
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = 80;
                canvas.height = 80;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, 80, 80);
                const dataUrl = canvas.toDataURL('image/webp', 0.5);
                URL.revokeObjectURL(tempUrl);
                resolve(dataUrl);
            };
            img.onerror = () => {
                URL.revokeObjectURL(tempUrl);
                resolve(null);
            };
            img.src = tempUrl;
            return;
        }

        const tempVideo = document.createElement('video');
        tempVideo.preload = 'metadata';
        tempVideo.muted = true;
        const tempUrl = URL.createObjectURL(blob);
        tempVideo.src = tempUrl;

        const cleanup = () => {
            URL.revokeObjectURL(tempUrl);
            tempVideo.removeAttribute('src');
            tempVideo.load();
        };

        tempVideo.addEventListener('loadeddata', () => {
            tempVideo.currentTime = 0.5; // seek to 0.5s for a good frame
        });

        tempVideo.addEventListener('seeked', () => {
            const canvas = document.createElement('canvas');
            canvas.width = 80;
            canvas.height = 80;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(tempVideo, 0, 0, 80, 80);
            const dataUrl = canvas.toDataURL('image/webp', 0.5);
            cleanup();
            resolve(dataUrl);
        }, { once: true });

        // Fallback if seek fails
        tempVideo.addEventListener('error', () => {
            cleanup();
            resolve(null);
        });
    });
}

// Track last rendered state to avoid unnecessary DOM rebuilds
let lastRenderedVideoIds = null;
let lastRenderedActiveId = null;

async function updateRecentVideosUI() {
    if (!recentVideosGroup || !recentVideosList) return;

    const ids = await getAllVideoIds();
    const activeId = (await chrome.storage.local.get(['activeVideoId'])).activeVideoId;
    const recentIds = ids.slice(-5).reverse();

    // Skip rebuild if nothing changed
    const idsKey = recentIds.join(',');
    if (idsKey === lastRenderedVideoIds && activeId === lastRenderedActiveId) return;
    lastRenderedVideoIds = idsKey;
    lastRenderedActiveId = activeId;

    if (recentIds.length > 0) {
        recentVideosGroup.style.display = 'block';
        recentVideosList.innerHTML = '';

        for (const id of recentIds) {
            const item = document.createElement('div');
            item.className = `recent-video-item ${id === activeId ? 'active' : ''}`;

            // Load cached thumbnail instead of full video blob
            let thumbnail = await getThumbnailFromCache(id);

            // If no cached thumbnail exists (legacy video), generate and cache it
            if (!thumbnail) {
                try {
                    const blob = await getVideoFromLibrary(id);
                    if (blob) {
                        thumbnail = await generateThumbnail(blob);
                        if (thumbnail) {
                            // Cache for future use
                            await withDB(THUMB_STORE, 'readwrite', (tx) => {
                                tx.objectStore(THUMB_STORE).put(thumbnail, id);
                                return new Promise(resolve => { tx.oncomplete = resolve; });
                            });
                        }
                    }
                } catch (e) {
                    console.warn('Failed to generate legacy thumbnail:', e);
                }
            }

            if (thumbnail) {
                const img = document.createElement('img');
                img.src = thumbnail;
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                item.appendChild(img);
            }

            // Delete button
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-video-btn';
            deleteBtn.innerHTML = '×';
            deleteBtn.title = 'Remove from library';
            deleteBtn.onclick = async (e) => {
                e.stopPropagation();
                if (confirm('Remove this video from your library?')) {
                    await deleteVideoFromLibrary(id);
                    const currentSettings = await chrome.storage.local.get(['activeVideoId']);
                    if (currentSettings.activeVideoId === id) {
                        chrome.storage.local.remove('activeVideoId');
                        if (videoPlayer) {
                            videoPlayer.removeAttribute('src');
                            videoPlayer.load();
                        }
                        currentLoadedVideoId = null;
                        if (statusText) statusText.textContent = "Video removed. Upload a new one!";
                    }
                    // Force rebuild
                    lastRenderedVideoIds = null;
                    updateRecentVideosUI();
                }
            };
            item.appendChild(deleteBtn);

            item.addEventListener('click', async () => {
                const freshBlob = await getVideoFromLibrary(id);
                loadVideo(freshBlob, id);
            });

            recentVideosList.appendChild(item);
        }
    } else {
        recentVideosGroup.style.display = 'none';
    }
}

// Initial Load
(async function init() {
    try {
        const settings = await new Promise(resolve =>
            chrome.storage.local.get(['videoFit', 'videoVolume', 'videoSpeed', 'activeVideoId', 'use24hFormat', 'showClock', 'clockPos', 'mediaPosition'], resolve)
        );

        let blob = null;
        if (settings.activeVideoId) {
            blob = await getVideoFromLibrary(settings.activeVideoId);
        } else {
            const db = await openDB();
            try {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const request = store.get('background');
                blob = await new Promise(resolve => {
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => resolve(null);
                });
            } finally {
                db.close();
            }

            if (blob) {
                const newId = await saveVideoToLibrary(blob);
                chrome.storage.local.set({ activeVideoId: newId });
                settings.activeVideoId = newId;
            }
        }

        if (blob) {
            loadVideo(blob, settings.activeVideoId);
            if (statusText) statusText.textContent = "Video loaded successfully.";
        }

        if (videoPlayer) {
            // Force brightness by ensuring opacity is 1
            videoPlayer.style.opacity = "1";

            if (settings.videoFit !== undefined) {
                videoPlayer.classList.toggle('fit-contain', !settings.videoFit);
                if (imagePlayer) imagePlayer.classList.toggle('fit-contain', !settings.videoFit);
                if (videoFitToggle) videoFitToggle.checked = settings.videoFit;
            } else {
                // Default to Fill Screen (Crop)
                if (videoFitToggle) videoFitToggle.checked = true;
            }

            if (settings.mediaPosition !== undefined) {
                if (mediaPositionSlider) mediaPositionSlider.value = settings.mediaPosition;
                videoPlayer.style.objectPosition = `center ${settings.mediaPosition}%`;
                if (imagePlayer) imagePlayer.style.objectPosition = `center ${settings.mediaPosition}%`;
            } else {
                if (mediaPositionSlider) mediaPositionSlider.value = 50;
                videoPlayer.style.objectPosition = 'center 50%';
                if (imagePlayer) imagePlayer.style.objectPosition = 'center 50%';
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
                // Force rebuild of recent videos
                lastRenderedVideoIds = null;
                updateRecentVideosUI();
                if (statusText) statusText.textContent = "Video saved to library.";
            } catch (err) {
                if (statusText) statusText.textContent = "Error saving video.";
                console.error(err);
            }
        }
    });
}

// 4. Controls
if (videoFitToggle) {
    videoFitToggle.addEventListener('change', (e) => {
        const fillScreen = e.target.checked;
        if (videoPlayer) videoPlayer.classList.toggle('fit-contain', !fillScreen);
        if (imagePlayer) imagePlayer.classList.toggle('fit-contain', !fillScreen);
        chrome.storage.local.set({ 'videoFit': fillScreen });
    });
}

if (mediaPositionSlider) {
    mediaPositionSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        if (videoPlayer) videoPlayer.style.objectPosition = `center ${val}%`;
        if (imagePlayer) imagePlayer.style.objectPosition = `center ${val}%`;
        chrome.storage.local.set({ 'mediaPosition': val });
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
        lastClockMinute = -1; // Force clock redraw
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
            try {
                const storeNames = Array.from(db.objectStoreNames);
                const tx = db.transaction(storeNames, 'readwrite');
                storeNames.forEach(name => tx.objectStore(name).clear());
                await new Promise(resolve => {
                    tx.oncomplete = resolve;
                });
            } finally {
                db.close();
            }
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
