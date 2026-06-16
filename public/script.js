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
            video.src = item.url;
            video.muted = true;
            video.loop = true;
            div.appendChild(video);
            
            div.onmouseover = () => video.play();
            div.onmouseout = () => { video.pause(); video.currentTime = 0; };
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
            video.src = file.url;
            video.muted = true;
            div.appendChild(video);
            div.onmouseover = () => video.play();
            div.onmouseout = () => { video.pause(); video.currentTime = 0; };
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
        
        card.innerHTML = `
            <h3>${escapeHtml(art.title)}</h3>
            <div class="article-meta-info">
                <span>📅 儲存時間: ${dateStr}</span>
                <span>📏 總字數: ${art.wordCount} 字 | 🧩 段落數: ${art.paragraphCount} 個</span>
            </div>
            <div class="article-tags-names">
                ${(art.names || []).map(name => `<span class="name-tag">👤 ${escapeHtml(name)}</span>`).join('')}
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
        const response = await fetch(`/api/articles/${articleId}`);
        const data = await response.json();
        
        const { article, paragraphs } = data;
        
        // Create full detail layout
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'articleDetailModal';
        
        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content glass';
        modalContent.style.cssText = 'width: 90%; max-width: 900px; height: 85vh; padding: 30px;';
        
        const formattedDate = new Date(article.createdAt).toLocaleDateString('zh-TW');
        
        modalContent.innerHTML = `
            <div class="modal-controls" style="position: absolute; top: 20px; right: 20px;">
                <span class="close-btn" id="closeDetailBtn">&times;</span>
            </div>
            <div style="width: 100%; display: flex; flex-direction: column; height: 100%; overflow: hidden;">
                <h2 style="margin-bottom: 5px; font-weight: 600;">${escapeHtml(article.title)}</h2>
                <div style="color: var(--text-dim); font-size: 0.85rem; margin-bottom: 20px;">
                    儲存日期: ${formattedDate} | 人物: ${(article.names || []).join('、') || '無'}
                </div>
                
                <div class="preview-layout" style="flex: 1; min-height: 0; margin-top: 10px;">
                    <div class="preview-column" style="display: flex; flex-direction: column; height: 100%;">
                        <h3 style="margin-bottom: 10px;">重新排版內容</h3>
                        <div class="reformatted-content-view" style="flex: 1; max-height: none;">
                            ${renderMarkdown(article.reformatted)}
                        </div>
                    </div>
                    <div class="preview-column" style="display: flex; flex-direction: column; height: 100%;">
                        <h3 style="margin-bottom: 10px;">段落細節紀錄 (${paragraphs.length})</h3>
                        <div class="paragraphs-list-view" style="flex: 1; max-height: none;">
                            ${paragraphs.map((p, i) => `
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
                            `).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
        
        // Close modal handlers
        const closeBtn = modalContent.querySelector('#closeDetailBtn');
        const closeModal = () => {
            modal.remove();
        };
        
        closeBtn.onclick = closeModal;
        modal.onclick = (e) => {
            if (e.target === modal) closeModal();
        };
        
    } catch (err) {
        alert('載入文章詳情失敗: ' + err.message);
    }
}

// ─── Article Import Logic ───
const libImportTextarea = document.getElementById('libImportTextarea');
const libReformatBtn = document.getElementById('libReformatBtn');
const libImportStatus = document.getElementById('libImportStatus');
const libImportPreview = document.getElementById('libImportPreview');
const libPreviewTitle = document.getElementById('libPreviewTitle');
const libPreviewBody = document.getElementById('libPreviewBody');
const libPreviewParagraphs = document.getElementById('libPreviewParagraphs');
const libSaveBtn = document.getElementById('libSaveBtn');

if (libReformatBtn) {
    libReformatBtn.onclick = async () => {
        const content = libImportTextarea.value.trim();
        if (!content) {
            alert('請貼入文章內容');
            return;
        }

        libReformatBtn.disabled = true;
        libImportStatus.innerText = '正在呼叫 AI 進行文章分析與排版，請稍後... ⏳';
        libImportStatus.className = 'status-msg info';
        libImportPreview.classList.add('hidden');
        reformatData = null;

        try {
            const res = await fetch('/api/articles/reformat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
            const data = await res.json();
            
            if (data.error) {
                libImportStatus.innerText = '分析失敗: ' + data.error;
                libImportStatus.className = 'status-msg status-error';
            } else {
                reformatData = data;
                reformatData.originalContent = content; // cache original
                
                libPreviewTitle.value = data.title || '';
                libPreviewBody.innerHTML = renderMarkdown(data.reformatted || '');
                
                libPreviewParagraphs.innerHTML = data.paragraphs.map((p, i) => `
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
                `).join('');
                
                libImportPreview.classList.remove('hidden');
                libImportStatus.innerText = '文章分析完成！請檢視下方排版與段落切分，確認無誤後點擊「儲存文章」';
                libImportStatus.className = 'status-msg status-success';
            }
        } catch (err) {
            libImportStatus.innerText = '與伺服器連線失敗: ' + err.message;
            libImportStatus.className = 'status-msg status-error';
        } finally {
            libReformatBtn.disabled = false;
        }
    };
}

if (libSaveBtn) {
    libSaveBtn.onclick = async () => {
        if (!reformatData) return;
        
        libSaveBtn.disabled = true;
        libImportStatus.innerText = '正在儲存至資料庫... 💾';
        libImportStatus.className = 'status-msg info';

        try {
            const res = await fetch('/api/articles/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: libPreviewTitle.value.trim() || reformatData.title,
                    originalContent: reformatData.originalContent,
                    reformatted: reformatData.reformatted,
                    paragraphs: reformatData.paragraphs
                })
            });
            const data = await res.json();
            if (data.success) {
                libImportStatus.innerText = `文章「${data.title}」已成功儲存！`;
                libImportStatus.className = 'status-msg status-success';
                libImportTextarea.value = '';
                libImportPreview.classList.add('hidden');
                reformatData = null;
            } else {
                libImportStatus.innerText = '儲存失敗';
                libImportStatus.className = 'status-msg status-error';
            }
        } catch (err) {
            libImportStatus.innerText = '儲存時連線錯誤';
            libImportStatus.className = 'status-msg status-error';
        } finally {
            libSaveBtn.disabled = false;
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
                libGenResultBody.innerHTML = renderMarkdown(data.article);
                libGenResult.classList.remove('hidden');
                
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
