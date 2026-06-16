const urlInput = document.getElementById('urlInput');
const fetchBtn = document.getElementById('fetchBtn');
const pasteBtn = document.getElementById('pasteBtn');
const tagContainer = document.getElementById('tagContainer');
const status = document.getElementById('status');
const resultsArea = document.getElementById('results');
const mediaList = document.getElementById('mediaList');
const downloadBtn = document.getElementById('downloadBtn');
const selectAllCheckbox = document.getElementById('selectAll');
const downloadStatus = document.getElementById('downloadStatus');
const progressList = document.getElementById('progressList');

// Modal Elements
const viewerModal = document.getElementById('viewerModal');
const viewport = document.getElementById('viewport');
const closeBtn = document.querySelector('.close-btn');

let currentMediaItems = [];
let selectedIndices = new Set();

// Flag to prevent double-triggering fetch from paste + input events
let pasteAutoFetchTriggered = false;

// --- Article Library Random Illustrations ---
let enableRandomIllustrations = true;
let cachedImages = [];
let currentReaderFontScale = 100; // Font size scale percentage (70% to 160%)

async function fetchCachedImages() {
    try {
        const res = await fetch('/api/downloads');
        const data = await res.json();
        // strict filter to only allow standard lightweight images, excluding video formats like gifv/mp4
        const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        cachedImages = data.files.filter(f => {
            const extIdx = f.name.lastIndexOf('.');
            if (extIdx === -1) return false;
            const ext = f.name.substring(extIdx).toLowerCase();
            return allowedExtensions.includes(ext);
        });
    } catch (e) {
        console.error('Failed to load images for illustration', e);
        cachedImages = [];
    }
}

function renderMarkdownWithImages(md, images) {
    let html = renderMarkdown(md);
    if (!images || images.length === 0) return html;

    const paragraphs = html.split('</p>');
    if (paragraphs.length <= 1) return html;

    // Limit maximum inserted images to 6 to prevent OOM/render lag in extremely long posts
    const maxImages = Math.min(6, images.length);
    const shuffledImages = [...images].sort(() => 0.5 - Math.random()).slice(0, maxImages);

    // Calculate step interval to distribute images evenly throughout the post
    const step = Math.max(2, Math.floor(paragraphs.length / (maxImages + 1)));

    let newHtml = '';
    let imgIndex = 0;

    paragraphs.forEach((p, idx) => {
        if (idx === paragraphs.length - 1) {
            newHtml += p;
            return;
        }
        newHtml += p + '</p>';

        if ((idx + 1) % step === 0 && imgIndex < shuffledImages.length) {
            const img = shuffledImages[imgIndex++];
            newHtml += `
                <div class="article-inline-image-container">
                    <img src="${img.url}" class="article-inline-image" alt="插圖" onclick="openViewer({ type: 'image', url: '${img.url}' })">
                </div>
            `;
        }
    });
    return newHtml;
}

// --- Mobile-friendly clipboard paste logic ---
pasteBtn.addEventListener('click', async () => {
    // Strategy 1: Modern Clipboard API (works on desktop Chrome/Firefox, some Android)
    if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                urlInput.value = text;
                showStatus('已從剪貼簿貼上', 'success');
                tryAutoFetch(text);
                return;
            }
        } catch (err) {
            // Permission denied or not supported — fall through
            console.log('Clipboard API readText failed:', err.message);
        }
    }

    // Strategy 2: Focus the input field and prompt user to paste manually
    // On mobile, programmatic clipboard access is restricted.
    // The best UX is to focus the field so the user can use the native paste action.
    urlInput.value = '';
    urlInput.focus();

    // On iOS, we can trigger the paste menu by selecting the field
    // Also try execCommand('paste') as a last resort (works in some older webviews)
    try {
        const didPaste = document.execCommand('paste');
        if (didPaste && urlInput.value) {
            showStatus('已從剪貼簿貼上', 'success');
            tryAutoFetch(urlInput.value);
            return;
        }
    } catch (err) {
        // execCommand('paste') not supported
    }

    showStatus('請在輸入框中長按貼上連結 📲', 'info');
});

// Auto-trigger fetch when pasting into the input field directly
urlInput.addEventListener('paste', (e) => {
    // Use a small delay to let the browser fill in the pasted text
    setTimeout(() => {
        const text = urlInput.value.trim();
        if (text && text.startsWith('http')) {
            pasteAutoFetchTriggered = true;
            showStatus('偵測到連結，自動解析中...', 'success');
            fetchBtn.click();
            // Reset the flag after a short delay
            setTimeout(() => { pasteAutoFetchTriggered = false; }, 1000);
        }
    }, 100);
});

// Also listen for 'input' event to catch mobile paste that doesn't fire 'paste' event
urlInput.addEventListener('input', debounce((e) => {
    if (pasteAutoFetchTriggered) return;
    const text = urlInput.value.trim();
    // Heuristic: if a full URL appeared in one input event, it's likely a paste
    if (text.startsWith('http') && text.includes('tumblr')) {
        showStatus('偵測到 Tumblr 連結，自動解析中...', 'success');
        fetchBtn.click();
    }
}, 500));

function tryAutoFetch(text) {
    if (text && text.trim().startsWith('http')) {
        fetchBtn.click();
    }
}

function debounce(fn, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

fetchBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) {
        showStatus('請輸入網址', 'error');
        return;
    }

    showStatus('正在解析中，請稍候...', 'info');
    fetchBtn.disabled = true;
    resultsArea.classList.add('hidden');
    tagContainer.classList.add('hidden');
    downloadStatus.classList.add('hidden');
    selectedIndices.clear();
    selectAllCheckbox.checked = false;

    try {
        const response = await fetch('/api/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });

        const data = await response.json();

        if (data.error) {
            showStatus('解析失敗: ' + data.error, 'error');
        } else if (data.media.length === 0) {
            showStatus('在該頁面找不到任何媒體內容', 'info');
        } else {
            currentMediaItems = data.media;
            renderMedia(data.media);
            renderTags(data.tags);
            resultsArea.classList.remove('hidden');
            showStatus(`成功尋找到 ${data.media.length} 個媒體檔案`, 'success');
            updateDownloadButton();
        }
    } catch (err) {
        showStatus('連線錯誤', 'error');
        console.error(err);
    } finally {
        fetchBtn.disabled = false;
    }
});

selectAllCheckbox.addEventListener('change', (e) => {
    if (e.target.checked) {
        currentMediaItems.forEach((_, i) => selectedIndices.add(i));
    } else {
        selectedIndices.clear();
    }
    renderMedia(currentMediaItems);
    updateDownloadButton();
});

downloadBtn.addEventListener('click', async () => {
    if (selectedIndices.size === 0) return;

    const itemsToDownload = Array.from(selectedIndices).map(i => currentMediaItems[i]);

    downloadBtn.disabled = true;
    downloadStatus.classList.remove('hidden');
    progressList.innerHTML = '<p>開始下載...</p>';

    try {
        const response = await fetch('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: itemsToDownload })
        });

        const data = await response.json();
        renderProgress(data.results);
    } catch (err) {
        progressList.innerHTML = '<p class="status-error">下載過程中發生錯誤</p>';
        console.error(err);
    } finally {
        downloadBtn.disabled = false;
    }
});

function updateDownloadButton() {
    downloadBtn.innerText = `下載所選項目 (${selectedIndices.size})`;
    downloadBtn.disabled = selectedIndices.size === 0;
}

function showStatus(msg, type) {
    status.innerText = msg;
    status.className = 'status-msg ' + (type === 'error' ? 'status-error' : type === 'success' ? 'status-success' : '');
}

function renderTags(tags) {
    tagContainer.innerHTML = '';
    if (!tags || tags.length === 0) {
        tagContainer.classList.add('hidden');
        return;
    }
    tags.forEach(t => {
        const span = document.createElement('span');
        span.className = 'tag';
        span.innerText = '#' + t;
        tagContainer.appendChild(span);
    });
    tagContainer.classList.remove('hidden');
}

function renderMedia(items) {
    mediaList.innerHTML = '';
    items.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = `media-item ${selectedIndices.has(index) ? 'selected' : ''}`;
        
        if (item.type === 'image') {
            const img = document.createElement('img');
            img.src = item.url;
            img.loading = 'lazy';
            div.appendChild(img);
        } else if (item.type === 'video') {
            const video = document.createElement('video');
            video.preload = 'none';
            video.muted = true;
            video.loop = true;
            video.dataset.src = item.url;
            div.appendChild(video);
            
            const playOverlay = document.createElement('div');
            playOverlay.className = 'play-overlay';
            playOverlay.innerHTML = '▶';
            div.appendChild(playOverlay);
            
            div.onmouseover = () => {
                playOverlay.style.opacity = '0';
                if (!video.src) {
                    video.src = video.dataset.src;
                }
                video.play().catch(err => console.warn('Video play failed:', err.message));
            };
            div.onmouseout = () => {
                playOverlay.style.opacity = '1';
                video.pause();
                try { video.currentTime = 0; } catch (err) {}
            };
        } else if (item.type === 'audio') {
            const audioIcon = document.createElement('div');
            audioIcon.style.cssText = 'height:100%; display:flex; align-items:center; justify-content:center; font-size:3rem;';
            audioIcon.innerText = '🎵';
            div.appendChild(audioIcon);
        }

        const badge = document.createElement('div');
        badge.className = 'badge';
        badge.innerText = item.type;
        div.appendChild(badge);

        // Preview Button
        const previewBtn = document.createElement('div');
        previewBtn.className = 'preview-btn';
        previewBtn.innerHTML = '🔍';
        previewBtn.onclick = (e) => {
            e.stopPropagation();
            openViewer(item, currentMediaItems, index);
        };
        div.appendChild(previewBtn);

        // Click to toggle selection
        div.onclick = () => {
            if (selectedIndices.has(index)) {
                selectedIndices.delete(index);
                div.classList.remove('selected');
            } else {
                selectedIndices.add(index);
                div.classList.add('selected');
            }
            updateDownloadButton();
            selectAllCheckbox.checked = (selectedIndices.size === currentMediaItems.length);
        };

        mediaList.appendChild(div);
    });
}

// --- Viewer with random-next (tap to shuffle) ---
let viewerItemsList = [];
let viewerCurrentIndex = -1;
const viewerCounter = document.getElementById('viewerCounter');
const shuffleBtn = document.getElementById('shuffleBtn');

function openViewer(item, list, index) {
    // Store the list context for random navigation
    if (list && list.length > 0) {
        // Filter to only image/video for shuffle (skip audio)
        viewerItemsList = list;
        viewerCurrentIndex = (typeof index === 'number') ? index : list.indexOf(item);
    } else {
        viewerItemsList = [item];
        viewerCurrentIndex = 0;
    }
    loadViewerItem(item);
    viewerModal.classList.remove('hidden');
}

function loadViewerItem(item) {
    viewport.innerHTML = '';
    if (item.type === 'image') {
        const img = document.createElement('img');
        img.src = item.url;
        img.classList.add('viewer-media');
        viewport.appendChild(img);
    } else if (item.type === 'video') {
        const video = document.createElement('video');
        video.src = item.url;
        video.controls = true;
        video.autoplay = true;
        video.classList.add('viewer-media');
        viewport.appendChild(video);
    } else if (item.type === 'audio') {
        const audio = document.createElement('audio');
        audio.src = item.url;
        audio.controls = true;
        audio.autoplay = true;
        viewport.appendChild(audio);
    }
    updateViewerCounter();
}

function updateViewerCounter() {
    if (viewerCounter) {
        if (viewerItemsList.length > 1) {
            viewerCounter.innerText = `${viewerCurrentIndex + 1} / ${viewerItemsList.length}`;
            viewerCounter.classList.remove('hidden');
        } else {
            viewerCounter.classList.add('hidden');
        }
    }
    // Show/hide shuffle button
    if (shuffleBtn) {
        shuffleBtn.style.display = viewerItemsList.length > 1 ? '' : 'none';
    }
}

function viewerRandomNext() {
    if (viewerItemsList.length <= 1) return;
    let nextIndex;
    do {
        nextIndex = Math.floor(Math.random() * viewerItemsList.length);
    } while (nextIndex === viewerCurrentIndex);
    viewerCurrentIndex = nextIndex;
    const nextItem = viewerItemsList[nextIndex];
    // Update currentViewerFile if it's a history item
    if (nextItem.name) {
        currentViewerFile = nextItem.name;
    }
    // Add transition animation
    viewport.classList.add('viewer-transition');
    setTimeout(() => {
        loadViewerItem(nextItem);
        viewport.classList.remove('viewer-transition');
    }, 150);
}

// Tap/click on viewport to shuffle to random next
viewport.addEventListener('click', (e) => {
    // Don't trigger on video controls or audio elements
    const tag = e.target.tagName.toLowerCase();
    if (tag === 'video' || tag === 'audio') return;
    // Only trigger on images or the viewport itself
    if (tag === 'img' || e.target === viewport) {
        viewerRandomNext();
    }
});

// Shuffle button click
if (shuffleBtn) {
    shuffleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        viewerRandomNext();
    });
}

// Keyboard support: press space or right arrow to shuffle
document.addEventListener('keydown', (e) => {
    if (viewerModal.classList.contains('hidden')) return;
    if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        viewerRandomNext();
    } else if (e.key === 'Escape') {
        closeViewer();
    }
});

function closeViewer() {
    viewerModal.classList.add('hidden');
    viewport.innerHTML = '';
    viewerItemsList = [];
    viewerCurrentIndex = -1;
}

closeBtn.onclick = () => closeViewer();

window.onclick = (event) => {
    if (event.target == viewerModal) {
        closeViewer();
    }
};

// Settings Elements
const cookieInput = document.getElementById('cookieInput');
const geminiApiKeyInput = document.getElementById('geminiApiKeyInput');
const geminiModelInput = document.getElementById('geminiModelInput');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');

// Tab Switching
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const refreshHistoryBtn = document.getElementById('refreshHistory');
const historyGrid = document.getElementById('historyGrid');

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        tabContents.forEach(content => {
            if (content.id === `${target}Tab`) {
                content.classList.remove('hidden');
            } else {
                content.classList.add('hidden');
            }
        });

        if (target === 'history') {
            fetchHistory();
        } else if (target === 'settings') {
            loadSettings();
        } else if (target === 'library') {
            initLibrary();
        }
    });
});

async function loadSettings() {
    try {
        const response = await fetch('/api/settings');
        const data = await response.json();
        cookieInput.value = data.cookies || '';
        if (geminiApiKeyInput) geminiApiKeyInput.value = data.geminiApiKey || '';
        if (geminiModelInput) geminiModelInput.value = data.geminiModel || 'gemini-3.1-flash-lite';
    } catch (err) {
        console.error('Failed to load settings');
    }
}

saveSettingsBtn.addEventListener('click', async () => {
    saveSettingsBtn.disabled = true;
    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cookies: cookieInput.value,
                geminiApiKey: geminiApiKeyInput ? geminiApiKeyInput.value.trim() : '',
                geminiModel: geminiModelInput ? geminiModelInput.value.trim() : 'gemini-3.1-flash-lite'
            })
        });
        const data = await response.json();
        if (data.success) {
            alert('設定已儲存！');
        }
    } catch (err) {
        alert('儲存失敗');
    } finally {
        saveSettingsBtn.disabled = false;
    }
});

// Initial load
loadSettings();

refreshHistoryBtn.addEventListener('click', fetchHistory);

async function fetchHistory() {
    historyGrid.innerHTML = '<p>讀取中...</p>';
    try {
        const response = await fetch('/api/downloads');
        const data = await response.json();
        renderHistory(data.files);
    } catch (err) {
        historyGrid.innerHTML = '<p class="status-error">讀取歷史記錄失敗</p>';
    }
}

let currentViewerFile = null;

function renderHistory(files) {
    historyGrid.innerHTML = '';
    if (!files || files.length === 0) {
        historyGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-dim);">尚無下載紀錄</p>';
        return;
    }
    files.forEach(file => {
        const div = document.createElement('div');
        div.className = 'media-item';
        
        if (file.type === 'image') {
            const img = document.createElement('img');
            img.src = file.url;
            div.appendChild(img);
        } else if (file.type === 'video') {
            const video = document.createElement('video');
            video.preload = 'none';
            video.muted = true;
            video.loop = true;
            video.dataset.src = file.url;
            div.appendChild(video);
            
            const playOverlay = document.createElement('div');
            playOverlay.className = 'play-overlay';
            playOverlay.innerHTML = '▶';
            div.appendChild(playOverlay);
            
            div.onmouseover = () => {
                playOverlay.style.opacity = '0';
                if (!video.src) {
                    video.src = video.dataset.src;
                }
                video.play().catch(err => console.warn('Video play failed:', err.message));
            };
            div.onmouseout = () => {
                playOverlay.style.opacity = '1';
                video.pause();
                try { video.currentTime = 0; } catch (err) {}
            };
        } else if (file.type === 'audio') {
            const audioIcon = document.createElement('div');
            audioIcon.style.cssText = 'height:100%; display:flex; align-items:center; justify-content:center; font-size:3rem;';
            audioIcon.innerText = '🎵';
            div.appendChild(audioIcon);
        }

        const badge = document.createElement('div');
        badge.className = 'badge';
        badge.innerText = file.type;
        div.appendChild(badge);
        
        // Delete button on history item
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'item-delete-btn';
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.title = '刪除此檔案';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm('確定要刪除此檔案嗎？')) {
                deleteFile(file.name);
            }
        };
        div.appendChild(deleteBtn);

        div.onclick = () => {
            currentViewerFile = file.name;
            const viewableFiles = files.map(f => ({ url: f.url, type: f.type, name: f.name }));
            const idx = files.indexOf(file);
            openViewer({ url: file.url, type: file.type, name: file.name }, viewableFiles, idx);
        };
        historyGrid.appendChild(div);
    });
}

async function deleteFile(filename) {
    try {
        const response = await fetch(`/api/downloads/${filename}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (data.success) {
            fetchHistory();
            if (currentViewerFile === filename) {
                closeViewer();
            }
        } else {
            alert('刪除失敗');
        }
    } catch (err) {
        alert('刪除發生錯誤');
    }
}

const deleteViewerFile = document.getElementById('deleteViewerFile');
if (deleteViewerFile) {
    deleteViewerFile.onclick = () => {
        if (currentViewerFile && confirm('確定要刪除此正在瀏覽的檔案嗎？')) {
            deleteFile(currentViewerFile);
        }
    };
}

function renderProgress(results) {
    progressList.innerHTML = '';
    // ... existing progress rendering code ...
    results.forEach(res => {
        const div = document.createElement('div');
        div.className = 'progress-item';
        
        const name = res.url.split('/').pop().split('?')[0];
        const statusSpan = document.createElement('span');
        
        if (res.status === 'success') {
            statusSpan.className = 'status-success';
            statusSpan.innerText = '完成 (' + res.filename + ')';
        } else {
            statusSpan.className = 'status-error';
            statusSpan.innerText = '失敗: ' + res.error;
        }

        div.innerHTML = `<span>${name.substring(0, 30)}...</span>`;
        div.appendChild(statusSpan);
        progressList.appendChild(div);
    });
}

// ─── Article Library Frontend Logic ─────────────────────────────
let libraryInitialized = false;
let reformatData = null; // Stores parsed reformat result temporarily before saving

function initLibrary() {
    if (libraryInitialized) {
        fetchArticles();
        return;
    }
    libraryInitialized = true;
    
    // 1. Setup Sub Tabs Navigation
    const subTabBtns = document.querySelectorAll('.sub-tab-btn');
    const subTabContents = document.querySelectorAll('.sub-tab-content');
    
    subTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.subTab;
            subTabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            subTabContents.forEach(content => {
                if (content.id === `lib${target.charAt(0).toUpperCase() + target.slice(1)}Panel`) {
                    content.classList.remove('hidden');
                } else {
                    content.classList.add('hidden');
                }
            });

            if (target === 'list') {
                fetchArticles();
            } else if (target === 'generator') {
                loadUniqueNames();
            }
        });
    });

    const refreshLibraryBtn = document.getElementById('refreshLibrary');
    if (refreshLibraryBtn) {
        refreshLibraryBtn.onclick = () => fetchArticles();
    }

    // Load initial list
    fetchArticles();
}

// ─── Article List Logic ───
async function fetchArticles() {
    const container = document.getElementById('articleListContainer');
    if (!container) return;
    container.innerHTML = '<div class="loading-state">載入中...</div>';
    
    try {
        const response = await fetch('/api/articles');
        const data = await response.json();
        renderArticles(data.articles);
    } catch (e) {
        container.innerHTML = '<div class="loading-state status-error">無法讀取文章清單</div>';
    }
}

function renderArticles(articles) {
    const container = document.getElementById('articleListContainer');
    if (!container) return;
    container.innerHTML = '';
    
    if (!articles || articles.length === 0) {
        container.innerHTML = '<div class="loading-state">目前資料庫無文章，請先點擊「匯入文章」分頁貼入文章！</div>';
        return;
    }
    
    articles.forEach(art => {
        const card = document.createElement('div');
        card.className = 'card glass article-card';
        
        const dateStr = new Date(art.createdAt).toLocaleDateString('zh-TW', {
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        });
        
        const isRaw = art.status === 'raw';
        const statusBadge = isRaw ? '<span class="role-badge role-zhuan" style="margin-left: 8px; font-size: 0.75rem; padding: 2px 6px;">⚠️ 尚未分析</span>' : '';
        const wordCountText = isRaw ? '尚未分析' : `${art.wordCount} 字`;
        const paragraphCountText = isRaw ? '尚未分析' : `${art.paragraphCount} 個`;
        
        card.innerHTML = `
            <h3>${escapeHtml(art.title)} ${statusBadge}</h3>
            <div class="article-meta-info">
                <span>📅 儲存時間: ${dateStr}</span>
                <span>📏 總字數: ${wordCountText} | 🧩 段落數: ${paragraphCountText}</span>
            </div>
            <div class="article-tags-names">
                ${isRaw ? '<span style="color: var(--text-dim); font-size: 0.8rem; font-style: italic;">💡 請點擊此卡片，開啟後進行 AI 結構分析</span>' : (art.names || []).map(name => `<span class="name-tag">👤 ${escapeHtml(name)}</span>`).join('')}
            </div>
            <button class="article-delete-btn" title="刪除文章">🗑️</button>
        `;
        
        // Delete button logic
        const deleteBtn = card.querySelector('.article-delete-btn');
        deleteBtn.onclick = async (e) => {
            e.stopPropagation();
            if (confirm(`確定要刪除文章「${art.title}」及其所有段落記錄嗎？`)) {
                try {
                    const res = await fetch(`/api/articles/${art.id}`, { method: 'DELETE' });
                    const resData = await res.json();
                    if (resData.success) {
                        fetchArticles();
                    } else {
                        alert('刪除失敗');
                    }
                } catch (err) {
                    alert('刪除時發生錯誤');
                }
            }
        };

        // Click to view detail modal
        card.onclick = () => {
            openArticleDetails(art.id);
        };
        
        container.appendChild(card);
    });
}

async function openArticleDetails(articleId) {
    try {
        // Fetch latest images for random illustrations
        await fetchCachedImages();

        const response = await fetch(`/api/articles/${articleId}`);
        const data = await response.json();
        
        const { article, paragraphs } = data;
        
        // Create full detail layout
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'articleDetailModal';
        
        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content glass article-detail-modal-content';
        
        const updateModalBody = (art, paras) => {
            const formattedDate = new Date(art.createdAt).toLocaleDateString('zh-TW');
            const innerIsRaw = art.status === 'raw';
            
            let contentHtml = '';
            if (innerIsRaw) {
                if (art.originalContent.length > 100000) {
                    contentHtml = escapeHtml(art.originalContent.substring(0, 100000)) + 
                        `\n\n<div class="truncated-notice" style="padding: 20px; background: rgba(255,255,255,0.02); border: 1px dashed var(--glass-border); border-radius: 8px; margin-top: 20px; text-align: center;">
                            <p style="color: var(--text-dim); font-size: 0.85rem; margin-bottom: 12px; line-height: 1.5;">⚠️ 本文內容過長（共 ${art.originalContent.length.toLocaleString()} 字），已預載前 100,000 字以防網頁卡頓。</p>
                            <button id="modalLoadAllBtn" class="primary-btn" style="background: linear-gradient(135deg, #3b82f6, #2563eb); font-size: 0.8rem; padding: 8px 20px; border-radius: 6px; cursor: pointer;">載入剩餘全文</button>
                         </div>`;
                } else {
                    contentHtml = escapeHtml(art.originalContent);
                }
            } else {
                contentHtml = enableRandomIllustrations ? renderMarkdownWithImages(art.reformatted, cachedImages) : renderMarkdown(art.reformatted);
            }
            
            modalContent.innerHTML = `
                <div class="modal-header-bar" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--glass-border); padding-bottom: 12px; margin-bottom: 15px; flex-shrink: 0; gap: 15px; width: 100%;">
                    <div style="display: flex; align-items: center; gap: 10px; overflow: hidden; flex: 1;">
                        <span class="close-btn" id="closeDetailBtnMobile" style="font-size: 1.8rem; cursor: pointer; line-height: 1; padding: 0 5px;">&larr;</span>
                        <h2 style="margin: 0; font-weight: 600; font-size: 1.25rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(art.title)}</h2>
                    </div>
                    <div style="display: flex; align-items: center; gap: 12px; flex-shrink: 0;">
                        <div class="font-size-adjuster" style="display: flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); padding: 2px 8px; border-radius: 20px;">
                            <button id="fontDecBtn" style="background: none; border: none; color: var(--text); cursor: pointer; font-size: 0.75rem; font-weight: bold; padding: 2px 5px;">A-</button>
                            <span id="fontSizeDisplay" style="font-size: 0.7rem; color: var(--text-dim); min-width: 32px; text-align: center; font-weight: bold;">${currentReaderFontScale}%</span>
                            <button id="fontIncBtn" style="background: none; border: none; color: var(--text); cursor: pointer; font-size: 0.75rem; font-weight: bold; padding: 2px 5px;">A+</button>
                        </div>
                        <label style="display: flex; align-items: center; gap: 4px; font-size: 0.8rem; cursor: pointer; color: var(--text-dim); user-select: none; margin: 0; white-space: nowrap;">
                            <input type="checkbox" id="toggleIllustrations" ${enableRandomIllustrations ? 'checked' : ''} style="cursor: pointer; margin: 0;">
                            🖼️ 插圖
                        </label>
                        <span class="close-btn" id="closeDetailBtn" style="line-height: 1; font-size: 1.8rem;">&times;</span>
                    </div>
                </div>

                <div class="modal-tab-bar" style="width: 100%; gap: 10px; margin-bottom: 12px; border-bottom: 1px solid var(--glass-border); padding-bottom: 8px; flex-shrink: 0;">
                    <button id="modalTabRead" class="sub-tab-btn active" style="flex: 1; padding: 8px 0; border-radius: 6px; font-weight: bold;">📖 閱讀排版</button>
                    <button id="modalTabParas" class="sub-tab-btn" style="flex: 1; padding: 8px 0; border-radius: 6px; font-weight: bold;">🧩 段落清單 (${paras.length})</button>
                </div>

                <div class="preview-layout" style="width: 100%; min-height: 0;">
                    <div class="preview-column active-tab" style="height: 100%;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-shrink: 0; width: 100%;">
                            <h3 style="margin: 0; font-size: 1rem;">排版內容</h3>
                            <span style="color: var(--text-dim); font-size: 0.75rem;">儲存日期: ${formattedDate} | 人物: ${innerIsRaw ? '尚未分析' : (art.names || []).join('、') || '無'}</span>
                        </div>
                        <div class="reformatted-content-view" id="modalContentView" style="white-space: ${innerIsRaw ? 'pre-wrap' : 'normal'};">
                            ${contentHtml}
                        </div>
                    </div>
                    
                    <div class="preview-column" id="modalRightColumn" style="height: 100%;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-shrink: 0; width: 100%;">
                            <h3 style="margin: 0; font-size: 1rem;">段落細節紀錄 (${paras.length})</h3>
                            ${innerIsRaw ? `
                                <button id="libStartAnalysisBtn" class="primary-btn" style="background: linear-gradient(135deg, #3b82f6, #2563eb); font-weight: bold; padding: 4px 10px; font-size: 0.75rem; border-radius: 6px; cursor: pointer; margin: 0;">🤖 AI 優化角色與人名</button>
                            ` : ''}
                        </div>
                        ${innerIsRaw ? `<div id="libAnalysisModalStatus" class="status-msg" style="margin-bottom: 10px; font-size: 0.8rem; display: none;"></div>` : ''}
                            <div class="paragraphs-list-view" style="flex: 1; max-height: none;">
                                ${(() => {
                                    let rightColHtml = '';
                                    // Limit right column images to max 4 to keep list clean and responsive
                                    const maxRightImages = Math.min(4, cachedImages.length);
                                    const shuffledImagesRight = [...cachedImages].sort(() => 0.5 - Math.random()).slice(0, maxRightImages);
                                    const stepRight = Math.max(2, Math.floor(paras.length / (maxRightImages + 1)));
                                    let imgIndexRight = 0;
                                    
                                    paras.forEach((p, i) => {
                                        rightColHtml += `
                                            <div class="paragraph-analysis-card">
                                                <div class="paragraph-analysis-header">
                                                    <span>段落 #${i+1}</span>
                                                    <span class="role-badge role-${getRoleClass(p.role)}">${p.role}</span>
                                                </div>
                                                <div class="paragraph-content-text">${escapeHtml(p.content)}</div>
                                                <div style="font-size: 0.75rem; color: var(--text-dim);">
                                                    👤 人物: ${(p.names || []).join('、') || '無'}
                                                </div>
                                            </div>
                                        `;
                                        
                                        if (enableRandomIllustrations && (i + 1) % stepRight === 0 && imgIndexRight < shuffledImagesRight.length) {
                                            const img = shuffledImagesRight[imgIndexRight++];
                                            rightColHtml += `
                                                <div class="paragraph-analysis-card" style="padding: 10px; text-align: center; cursor: pointer; border: 1px dashed var(--glass-border);" onclick="openViewer({ type: 'image', url: '${img.url}' })">
                                                    <img src="${img.url}" style="max-width: 100%; max-height: 150px; border-radius: 6px; object-fit: cover;">
                                                    <div style="font-size: 0.7rem; color: var(--text-dim); margin-top: 5px;">🖼️ 圖片庫插圖</div>
                                                </div>
                                            `;
                                        }
                                    });
                                    return rightColHtml;
                                })()}
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            const contentView = modalContent.querySelector('#modalContentView');
            if (contentView) {
                contentView.style.fontSize = `${0.95 * (currentReaderFontScale / 100)}rem`;
            }

            // Re-bind close handlers
            const closeBtn = modalContent.querySelector('#closeDetailBtn');
            if (closeBtn) closeBtn.onclick = closeModal;
            
            const closeBtnMobile = modalContent.querySelector('#closeDetailBtnMobile');
            if (closeBtnMobile) closeBtnMobile.onclick = closeModal;
            
            // Re-bind Load All button if it exists
            const loadAllBtn = modalContent.querySelector('#modalLoadAllBtn');
            if (loadAllBtn) {
                loadAllBtn.onclick = () => {
                    const contentView = modalContent.querySelector('#modalContentView');
                    if (contentView) {
                        contentView.innerHTML = escapeHtml(art.originalContent);
                    }
                };
            }

            // Re-bind font scale adjuster
            const decBtn = modalContent.querySelector('#fontDecBtn');
            const incBtn = modalContent.querySelector('#fontIncBtn');
            const sizeDisplay = modalContent.querySelector('#fontSizeDisplay');
            if (decBtn && incBtn && sizeDisplay && contentView) {
                decBtn.onclick = () => {
                    if (currentReaderFontScale > 70) {
                        currentReaderFontScale -= 10;
                        contentView.style.fontSize = `${0.95 * (currentReaderFontScale / 100)}rem`;
                        sizeDisplay.innerText = currentReaderFontScale + '%';
                    }
                };
                incBtn.onclick = () => {
                    if (currentReaderFontScale < 160) {
                        currentReaderFontScale += 10;
                        contentView.style.fontSize = `${0.95 * (currentReaderFontScale / 100)}rem`;
                        sizeDisplay.innerText = currentReaderFontScale + '%';
                    }
                };
            }

            // Re-bind mobile tabs switching
            const tabRead = modalContent.querySelector('#modalTabRead');
            const tabParas = modalContent.querySelector('#modalTabParas');
            const colLeft = modalContent.querySelector('.preview-column:first-child');
            const colRight = modalContent.querySelector('#modalRightColumn');
            
            if (colLeft && colRight) {
                if (tabRead && tabRead.classList.contains('active')) {
                    colLeft.classList.add('active-tab');
                    colRight.classList.remove('active-tab');
                } else if (tabParas && tabParas.classList.contains('active')) {
                    colRight.classList.add('active-tab');
                    colLeft.classList.remove('active-tab');
                } else {
                    colLeft.classList.add('active-tab');
                    colRight.classList.remove('active-tab');
                }
            }

            if (tabRead && tabParas && colLeft && colRight) {
                tabRead.onclick = () => {
                    tabRead.classList.add('active');
                    tabParas.classList.remove('active');
                    colLeft.classList.add('active-tab');
                    colRight.classList.remove('active-tab');
                };
                tabParas.onclick = () => {
                    tabParas.classList.add('active');
                    tabRead.classList.remove('active');
                    colRight.classList.add('active-tab');
                    colLeft.classList.remove('active-tab');
                };
            }

            // Re-bind illustrations toggle
            const toggleBtn = modalContent.querySelector('#toggleIllustrations');
            if (toggleBtn) {
                toggleBtn.onchange = (e) => {
                    enableRandomIllustrations = e.target.checked;
                    updateModalBody(art, paras);
                };
            }
            
            // Re-bind analyze handler if raw
            if (innerIsRaw) {
                const analyzeBtn = modalContent.querySelector('#libStartAnalysisBtn');
                const statusMsg = modalContent.querySelector('#libAnalysisModalStatus');
                
                if (analyzeBtn && statusMsg) {
                    analyzeBtn.onclick = async () => {
                        analyzeBtn.disabled = true;
                        statusMsg.style.display = 'block';
                        statusMsg.innerText = '正在執行 AI 優化中，請稍後... ⏳';
                        statusMsg.className = 'status-msg info';
                        
                        try {
                            const res = await fetch(`/api/articles/${art.id}/analyze`, {
                                method: 'POST'
                            });
                            const resData = await res.json();
                            
                            if (resData.error) {
                                statusMsg.innerText = '優化失敗: ' + resData.error;
                                statusMsg.className = 'status-msg status-error';
                                analyzeBtn.disabled = false;
                            } else {
                                // Success! Rerender modal body with new data
                                updateModalBody(resData.article, resData.paragraphs);
                                // Refresh back-end list
                                fetchArticles();
                            }
                        } catch (err) {
                            statusMsg.innerText = '連線伺服器失敗: ' + err.message;
                            statusMsg.className = 'status-msg status-error';
                            analyzeBtn.disabled = false;
                        }
                    };
                }
            }
        };
        
        const closeModal = () => {
            modal.remove();
        };
        
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
        
        updateModalBody(article, paragraphs);
        
        modal.onclick = (e) => {
            if (e.target === modal) closeModal();
        };
        
    } catch (err) {
        alert('載入文章詳情失敗: ' + err.message);
    }
}

// ─── Article Import Logic ───
const libImportTitle = document.getElementById('libImportTitle');
const libImportTextarea = document.getElementById('libImportTextarea');
const libDirectSaveBtn = document.getElementById('libDirectSaveBtn');
const libImportStatus = document.getElementById('libImportStatus');

if (libDirectSaveBtn) {
    libDirectSaveBtn.onclick = async () => {
        const title = libImportTitle ? libImportTitle.value.trim() : '';
        const content = libImportTextarea ? libImportTextarea.value.trim() : '';
        
        if (!content) {
            alert('請貼入文章內容');
            return;
        }

        libDirectSaveBtn.disabled = true;
        libImportStatus.innerText = '正在儲存文章... 💾';
        libImportStatus.className = 'status-msg info';

        try {
            const res = await fetch('/api/articles/save-raw', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, originalContent: content })
            });
            const data = await res.json();
            
            if (data.error) {
                libImportStatus.innerText = '儲存失敗: ' + data.error;
                libImportStatus.className = 'status-msg status-error';
            } else {
                libImportStatus.innerText = `文章「${data.title}」已成功儲存！請至「文章庫列表」進行 AI 分析。`;
                libImportStatus.className = 'status-msg status-success';
                
                if (libImportTitle) libImportTitle.value = '';
                if (libImportTextarea) libImportTextarea.value = '';
                
                // Redirect to list sub-tab after 1.5 seconds
                setTimeout(() => {
                    const listSubTabBtn = document.querySelector('.sub-tab-btn[data-sub-tab="list"]');
                    if (listSubTabBtn) {
                        listSubTabBtn.click();
                    }
                }, 1500);
            }
        } catch (err) {
            libImportStatus.innerText = '連線伺服器失敗: ' + err.message;
            libImportStatus.className = 'status-msg status-error';
        } finally {
            libDirectSaveBtn.disabled = false;
        }
    };
}

// ─── Article Generator Logic ───
const libGenWordCount = document.getElementById('libGenWordCount');
const libGenNamesContainer = document.getElementById('libGenNamesContainer');
const libGenerateBtn = document.getElementById('libGenerateBtn');
const libGenStatus = document.getElementById('libGenStatus');
const libGenResult = document.getElementById('libGenResult');
const libGenResultBody = document.getElementById('libGenResultBody');
const libGenCopyBtn = document.getElementById('libGenCopyBtn');

async function loadUniqueNames() {
    if (!libGenNamesContainer) return;
    libGenNamesContainer.innerHTML = '<p style="color: var(--text-dim);">讀取人名中...</p>';
    
    try {
        const res = await fetch('/api/articles/names');
        const data = await res.json();
        
        if (!data.names || data.names.length === 0) {
            libGenNamesContainer.innerHTML = '<p style="color: var(--text-dim); font-style: italic;">資料庫中尚無儲存的文章或人名紀錄</p>';
            return;
        }
        
        libGenNamesContainer.innerHTML = data.names.map(name => `
            <div class="name-replace-item">
                <label>👤 原名: <strong>${escapeHtml(name)}</strong></label>
                <input type="text" class="name-replace-input" data-original-name="${escapeHtml(name)}" placeholder="新名字...">
            </div>
        `).join('');
    } catch (e) {
        libGenNamesContainer.innerHTML = '<p style="color: var(--text-error);">無法讀取人名清單</p>';
    }
}

if (libGenerateBtn) {
    libGenerateBtn.onclick = async () => {
        libGenerateBtn.disabled = true;
        libGenStatus.innerText = '段落隨機重組中，並呼叫 Gemini 撰寫銜接過渡句... ✍️';
        libGenStatus.className = 'status-msg info';
        libGenResult.classList.add('hidden');

        // Extract name replacements
        const replacements = {};
        const inputs = document.querySelectorAll('.name-replace-input');
        inputs.forEach(input => {
            const oldName = input.dataset.originalName;
            const newName = input.value.trim();
            if (newName) {
                replacements[oldName] = newName;
            }
        });

        const targetWordCount = libGenWordCount ? libGenWordCount.value : 500;

        try {
            const res = await fetch('/api/articles/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetWordCount,
                    nameReplacements: replacements
                })
            });
            const data = await res.json();
            
            if (data.error) {
                libGenStatus.innerText = '生成失敗: ' + data.error;
                libGenStatus.className = 'status-msg status-error';
            } else {
                // Fetch latest images first
                await fetchCachedImages();

                const updateGenResult = () => {
                    libGenResultBody.innerHTML = enableRandomIllustrations ? renderMarkdownWithImages(data.article, cachedImages) : renderMarkdown(data.article);
                };

                updateGenResult();
                libGenResult.classList.remove('hidden');
                
                // Bind toggle illustrations checkbox
                const genToggle = document.getElementById('genToggleIllustrations');
                if (genToggle) {
                    genToggle.checked = enableRandomIllustrations;
                    genToggle.onchange = (e) => {
                        enableRandomIllustrations = e.target.checked;
                        updateGenResult();
                    };
                }

                libGenStatus.innerText = '文章生成完成！已符合起承轉合結構，並已完成人名替换與過渡句補寫。';
                libGenStatus.className = 'status-msg status-success';
                
                // Set text content for copy action
                libGenCopyBtn.onclick = () => {
                    navigator.clipboard.writeText(data.article)
                        .then(() => alert('已複製生成的文章！'))
                        .catch(() => alert('複製失敗'));
                };
            }
        } catch (err) {
            libGenStatus.innerText = '與伺服器連線失敗';
            libGenStatus.className = 'status-msg status-error';
        } finally {
            libGenerateBtn.disabled = false;
        }
    };
}

// ─── Helpers ───
function getRoleClass(role) {
    if (role === '起') return 'qi';
    if (role === '承') return 'cheng';
    if (role === '轉') return 'zhuan';
    if (role === '合') return 'he';
    return 'cheng';
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;");
}

function renderMarkdown(md) {
    if (!md) return '';
    
    // We escape HTML first to prevent XSS, but we want our parsed HTML tags to work
    let escaped = escapeHtml(md);
    
    // Headers
    escaped = escaped.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    escaped = escaped.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    escaped = escaped.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    
    // Bold
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Paragraphs
    const lines = escaped.split('\n\n');
    const processed = lines.map(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('&lt;h') || trimmed.startsWith('<h') || trimmed.startsWith('&lt;hr') || trimmed.startsWith('<hr')) {
            // Restore headers and horizontal rules
            return trimmed.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        }
        if (trimmed) {
            return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
        }
        return '';
    });
    
    return processed.join('\n');
}
