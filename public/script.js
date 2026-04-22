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
            openViewer(item);
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

function openViewer(item) {
    viewport.innerHTML = '';
    if (item.type === 'image') {
        const img = document.createElement('img');
        img.src = item.url;
        viewport.appendChild(img);
    } else if (item.type === 'video') {
        const video = document.createElement('video');
        video.src = item.url;
        video.controls = true;
        video.autoplay = true;
        viewport.appendChild(video);
    } else if (item.type === 'audio') {
        const audio = document.createElement('audio');
        audio.src = item.url;
        audio.controls = true;
        audio.autoplay = true;
        viewport.appendChild(audio);
    }
    viewerModal.classList.remove('hidden');
}

closeBtn.onclick = () => {
    viewerModal.classList.add('hidden');
    viewport.innerHTML = '';
};

window.onclick = (event) => {
    if (event.target == viewerModal) {
        viewerModal.classList.add('hidden');
        viewport.innerHTML = '';
    }
};

// Settings Elements
const cookieInput = document.getElementById('cookieInput');
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
        }
    });
});

async function loadSettings() {
    try {
        const response = await fetch('/api/settings');
        const data = await response.json();
        cookieInput.value = data.cookies || '';
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
            body: JSON.stringify({ cookies: cookieInput.value })
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
            openViewer({ url: file.url, type: file.type });
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
