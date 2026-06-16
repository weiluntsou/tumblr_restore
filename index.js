const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');
const morgan = require('morgan');
const cors = require('cors');
const { pipeline } = require('stream/promises');

const app = express();
const PORT = process.env.PORT || 5278;
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

// Ensure settings file exists
if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ cookies: '', geminiApiKey: '', geminiModel: 'gemini-3.1-flash-lite' }, null, 2));
}

/**
 * Loads settings from file
 */
async function getSettings() {
    const data = await fs.promises.readFile(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(data);
    return {
        cookies: '',
        geminiApiKey: '',
        geminiModel: 'gemini-3.1-flash-lite',
        ...parsed
    };
}

app.use(morgan('dev'));
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/files', express.static(DOWNLOAD_DIR));

app.get('/api/settings', async (req, res) => {
    try {
        const settings = await getSettings();
        res.json(settings);
    } catch (e) {
        res.status(500).json({ error: 'Failed to load settings' });
    }
});

app.post('/api/settings', async (req, res) => {
    try {
        const { cookies, geminiApiKey, geminiModel } = req.body;
        const current = await getSettings();
        const updated = {
            ...current,
            cookies: cookies !== undefined ? cookies : current.cookies,
            geminiApiKey: geminiApiKey !== undefined ? geminiApiKey : current.geminiApiKey,
            geminiModel: geminiModel !== undefined ? geminiModel : current.geminiModel,
        };
        await fs.promises.writeFile(SETTINGS_FILE, JSON.stringify(updated, null, 2));
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

/**
 * Converts cookie storage (JSON array or plain string) to a cookie header string
 */
function parseCookies(cookieData) {
    if (!cookieData) return '';
    const trimmed = cookieData.trim();
    if (trimmed.startsWith('[')) {
        try {
            const arr = JSON.parse(trimmed);
            return arr.map(c => `${c.name}=${c.value}`).join('; ');
        } catch (e) {
            return trimmed;
        }
    }
    return trimmed;
}

/**
 * Extracts blog name and post ID from various Tumblr URL formats
 */
function parseTumblrUrl(urlStr) {
    const url = new URL(urlStr);
    
    // Format: https://www.tumblr.com/blogname/postid
    const wwwMatch = url.pathname.match(/^\/([^/]+)\/(\d+)/);
    if (url.hostname === 'www.tumblr.com' && wwwMatch) {
        return { blogName: wwwMatch[1], postId: wwwMatch[2] };
    }
    
    // Format: https://blogname.tumblr.com/post/postid
    const subdomainMatch = url.hostname.match(/^([^.]+)\.tumblr\.com$/);
    const postMatch = url.pathname.match(/\/post\/(\d+)/);
    if (subdomainMatch && postMatch) {
        return { blogName: subdomainMatch[1], postId: postMatch[1] };
    }
    
    // Fallback: just try to get something
    if (subdomainMatch) {
        return { blogName: subdomainMatch[1], postId: null };
    }
    
    return null;
}

/**
 * Downloads a file from a URL and saves it to the downloads folder
 */
async function downloadFile(url, filename) {
    const filePath = path.join(DOWNLOAD_DIR, filename);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    });
    await pipeline(response.data, fs.createWriteStream(filePath));
    return filePath;
}

app.post('/api/fetch', async (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        const settings = await getSettings();
        const cookieStr = parseCookies(settings.cookies);
        const parsed = parseTumblrUrl(url);
        
        console.log(`Fetching URL: ${url}`);
        console.log(`Parsed: blog=${parsed?.blogName}, post=${parsed?.postId}`);

        const media = [];
        const tags = [];
        let apiSuccess = false;

        // Strategy 1: Use Tumblr API v2 (most reliable)
        if (parsed && parsed.postId && cookieStr) {
            try {
                const apiUrl = `https://www.tumblr.com/api/v2/blog/${parsed.blogName}/posts/${parsed.postId}?npf=true`;
                console.log(`Trying API: ${apiUrl}`);
                
                const apiRes = await axios.get(apiUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'application/json;format=camelcase',
                        'Cookie': cookieStr,
                        'Referer': `https://www.tumblr.com/${parsed.blogName}/${parsed.postId}`,
                        'X-Requested-With': 'XMLHttpRequest',
                        'Authorization': 'Bearer aIcXSOoTtqrzR8L8YEIOmBeW94c3FmbSNSWAUbxsny9KKx5VFh',
                    }
                });

                const post = apiRes.data?.response?.posts?.[0] || apiRes.data?.response;
                
                if (post) {
                    apiSuccess = true;
                    
                    // Extract tags
                    if (post.tags) {
                        post.tags.forEach(t => { if (!tags.includes(t)) tags.push(t); });
                    }

                    // Extract media from NPF content blocks
                    const content = post.content || [];
                    content.forEach(block => {
                        if (block.type === 'image' && block.media) {
                            // Get the highest resolution
                            const best = block.media.reduce((a, b) => 
                                (a.width * a.height) > (b.width * b.height) ? a : b
                            );
                            if (best.url && !media.find(m => m.url === best.url)) {
                                media.push({ type: 'image', url: best.url });
                            }
                        } else if (block.type === 'video') {
                            const videoUrl = block.url || block.media?.url;
                            if (videoUrl && !media.find(m => m.url === videoUrl)) {
                                media.push({ type: 'video', url: videoUrl });
                            }
                        } else if (block.type === 'audio') {
                            const audioUrl = block.url || block.media?.url;
                            if (audioUrl && !media.find(m => m.url === audioUrl)) {
                                media.push({ type: 'audio', url: audioUrl });
                            }
                        }
                    });

                    // Also check trail (reblogged content)
                    const trail = post.trail || [];
                    trail.forEach(t => {
                        (t.content || []).forEach(block => {
                            if (block.type === 'image' && block.media) {
                                const best = block.media.reduce((a, b) => 
                                    (a.width * a.height) > (b.width * b.height) ? a : b
                                );
                                if (best.url && !media.find(m => m.url === best.url)) {
                                    media.push({ type: 'image', url: best.url });
                                }
                            } else if (block.type === 'video') {
                                const videoUrl = block.url || block.media?.url;
                                if (videoUrl && !media.find(m => m.url === videoUrl)) {
                                    media.push({ type: 'video', url: videoUrl });
                                }
                            }
                        });
                    });

                    console.log(`API success: found ${media.length} media, ${tags.length} tags`);
                }
            } catch (apiErr) {
                console.warn(`API failed (${apiErr.response?.status || apiErr.message}), falling back to HTML scraping`);
            }
        }

        // Strategy 2: HTML scraping fallback
        if (!apiSuccess) {
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'en-US,en;q=0.9',
            };
            if (cookieStr) headers['Cookie'] = cookieStr;

            // Try the subdomain URL format (often returns more content)
            let fetchUrl = url;
            if (parsed) {
                fetchUrl = `https://${parsed.blogName}.tumblr.com/post/${parsed.postId}`;
            }

            const response = await axios.get(fetchUrl, { headers });
            const html = response.data;
            const $ = cheerio.load(html);

            // Tags
            $('meta[property="article:tag"]').each((i, el) => {
                const tag = $(el).attr('content');
                if (tag && !tags.includes(tag)) tags.push(tag);
            });

            // OpenGraph
            $('meta[property="og:image"]').each((i, el) => {
                const content = $(el).attr('content');
                if (content && !media.find(m => m.url === content)) media.push({ type: 'image', url: content });
            });
            $('meta[property="og:video"]').each((i, el) => {
                const content = $(el).attr('content');
                if (content && !media.find(m => m.url === content)) media.push({ type: 'video', url: content });
            });

            // Tumblr video URLs in raw HTML
            const videoPattern = /https:\/\/v[a-z0-9]+\.video\.tumblr\.com\/[^\s"'<>]+\.mp4/g;
            const foundVideos = html.match(videoPattern);
            if (foundVideos) {
                foundVideos.forEach(vUrl => {
                    if (!media.find(m => m.url === vUrl)) media.push({ type: 'video', url: vUrl });
                });
            }

            // Images in post body
            $('img').each((i, el) => {
                const src = $(el).attr('src');
                if (src && src.includes('media.tumblr.com') && !media.find(m => m.url === src)) {
                    media.push({ type: 'image', url: src });
                }
            });

            // Video elements
            $('video source, video').each((i, el) => {
                const src = $(el).attr('src') || $(el).find('source').attr('src');
                if (src && !media.find(m => m.url === src) && !src.startsWith('blob:')) {
                    media.push({ type: 'video', url: src });
                }
            });
        }

        res.json({ url, media, tags });
    } catch (error) {
        console.error('Error fetching URL:', error.message);
        res.status(500).json({ error: 'Failed to fetch the URL contents: ' + error.message });
    }
});

app.post('/api/download', async (req, res) => {
    const { items } = req.body; // Array of { url, type }
    if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: 'Items array is required' });
    }

    const results = [];
    for (const item of items) {
        try {
            const url = new URL(item.url);
            const ext = path.extname(url.pathname) || (item.type === 'video' ? '.mp4' : '.jpg');
            const filename = `tumblr_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`;
            
            console.log(`Downloading: ${item.url}`);
            await downloadFile(item.url, filename);
            results.push({ url: item.url, status: 'success', filename });
        } catch (error) {
            console.error(`Failed to download ${item.url}:`, error.message);
            results.push({ url: item.url, status: 'failed', error: error.message });
        }
    }

    res.json({ results });
});

app.get('/api/downloads', async (req, res) => {
    try {
        const files = await fs.promises.readdir(DOWNLOAD_DIR);
        const fileList = files.filter(f => !f.startsWith('.')).map(f => {
            const stats = fs.statSync(path.join(DOWNLOAD_DIR, f));
            return {
                name: f,
                url: `/files/${f}`,
                size: stats.size,
                createdAt: stats.birthtime,
                type: f.endsWith('.mp4') ? 'video' : (f.endsWith('.mp3') ? 'audio' : 'image')
            };
        });
        // Sort by newest first
        fileList.sort((a, b) => b.createdAt - a.createdAt);
        res.json({ files: fileList });
    } catch (error) {
        res.status(500).json({ error: 'Failed to list downloads' });
    }
});

app.delete('/api/downloads/:filename', async (req, res) => {
    const { filename } = req.params;
    const filePath = path.join(DOWNLOAD_DIR, filename);
    try {
        if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'File not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

// ─── Article Library & Paragraph Database ───────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const ARTICLES_FILE = path.join(DATA_DIR, 'articles.json');

// Ensure data folder and database file exist
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(ARTICLES_FILE)) {
    fs.writeFileSync(ARTICLES_FILE, JSON.stringify({ articles: [], paragraphs: [] }, null, 2));
}

async function loadArticlesDB() {
    try {
        const data = await fs.promises.readFile(ARTICLES_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return { articles: [], paragraphs: [] };
    }
}

async function saveArticlesDB(db) {
    await fs.promises.writeFile(ARTICLES_FILE, JSON.stringify(db, null, 2), 'utf8');
}

/**
 * Universal Gemini API call wrapper
 */
async function callGemini(prompt, responseJson = false) {
    const settings = await getSettings();
    const apiKey = settings.geminiApiKey;
    if (!apiKey) {
        throw new Error('請先在系統設定中填寫 Gemini API 金鑰');
    }
    const model = settings.geminiModel || 'gemini-3.1-flash-lite';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const generationConfig = {
        temperature: 0.3
    };
    if (responseJson) {
        generationConfig.responseMimeType = 'application/json';
    }

    const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig
    };

    const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' }
    });

    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
        throw new Error('Gemini API 未回傳有效內容');
    }
    return text.trim();
}

/**
 * API: Reformat pasted article, segment into paragraphs, detect roles (起承轉合), extract names
 */
app.post('/api/articles/reformat', async (req, res) => {
    const { content } = req.body;
    if (!content) {
        return res.status(400).json({ error: '請提供文章內容' });
    }

    try {
        const prompt = `你是一個專業的文章排版與分析助手。請分析以下貼入的文章，並將其處理成結構化的 JSON 格式。

處理要求：
1. **重新排版**：將整篇文章排版成易於閱讀的格式（使用 Markdown），修正錯誤的標點符號，並保留語意通順。
2. **段落切割與角色分類**：依語意將文章切分成數個段落。對於每個段落，根據其在文章結構中的角色，將其分類為：
   - 「起」：引導、開端、介紹背景或人物。
   - 「承」：延續開端、展開敘事、補充細節。
   - 「轉」：轉折、情節起伏、引入衝突或改變視角。
   - 「合」：收尾、總結、得出結論或情感昇華。
3. **人名辨識**：在每個段落中，找出所有出現的「真實人名」或「角色名字」（如「張三」、「王五」、「John」等），若無人名則留空陣列。
4. **繁體中文輸出**：不論輸入文章是簡體中文、英文或其他語言，輸出的文章標題、排版後全文 (reformatted) 以及段落內容 (content)，必須全部轉換為繁體中文 (Taiwanese Traditional Chinese)，並修正任何非繁體中文用語。

請嚴格以 JSON 格式回傳，結構如下，不要包含任何 markdown code block (如 \`\`\`json)：
{
  "title": "請提供一個適合的文章標題（如果原文章無標題則自動擬定）",
  "reformatted": "排版後的完整 Markdown 文章內容",
  "paragraphs": [
    {
      "content": "此段落的文字內容（排版後）",
      "role": "起 或 承 或 轉 或 合",
      "names": ["段落中出現的人名列表，例如 ['張三']"]
    }
  ]
}

原文章內容：
${content}`;

        const responseText = await callGemini(prompt, true);
        
        let cleaned = responseText;
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }
        
        const result = JSON.parse(cleaned);
        res.json(result);
    } catch (e) {
        console.error('Reformat error:', e);
        res.status(500).json({ error: '排版文章時發生錯誤: ' + e.message });
    }
});

/**
 * API: Save article and paragraphs into database
 */
app.post('/api/articles/save', async (req, res) => {
    const { title, originalContent, reformatted, paragraphs } = req.body;
    if (!originalContent || !paragraphs || !Array.isArray(paragraphs)) {
        return res.status(400).json({ error: '無效的儲存資料' });
    }

    try {
        const db = await loadArticlesDB();
        const articleId = `art_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        
        // Collect all unique names in this article
        const allNamesSet = new Set();
        paragraphs.forEach(p => {
            if (p.names && Array.isArray(p.names)) {
                p.names.forEach(n => {
                    const trimmed = n.trim();
                    if (trimmed) allNamesSet.add(trimmed);
                });
            }
        });
        const allNames = Array.from(allNamesSet);

        // Create article record
        const newArticle = {
            id: articleId,
            title: title || `未命名文章 - ${new Date().toLocaleDateString('zh-TW')}`,
            originalContent,
            reformatted: reformatted || '',
            names: allNames,
            status: 'analyzed',
            createdAt: new Date().toISOString()
        };

        // Create paragraphs records
        const newParagraphs = paragraphs.map((p, idx) => ({
            id: `par_${Date.now()}_${idx}_${Math.random().toString(36).substring(7)}`,
            articleId,
            content: p.content || '',
            role: p.role || '承',
            names: p.names || [],
            seq: idx
        }));

        db.articles.push(newArticle);
        db.paragraphs.push(...newParagraphs);
        
        await saveArticlesDB(db);
        
        res.json({ success: true, articleId, title: newArticle.title });
    } catch (e) {
        console.error('Save article error:', e);
        res.status(500).json({ error: '儲存文章時發生錯誤: ' + e.message });
    }
});

/**
 * API: Save raw article without analysis
 */
app.post('/api/articles/save-raw', async (req, res) => {
    const { title, originalContent } = req.body;
    if (!originalContent) {
        return res.status(400).json({ error: '請提供文章內容' });
    }

    try {
        const db = await loadArticlesDB();
        const articleId = `art_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        const newArticle = {
            id: articleId,
            title: title || `未命名文章 - ${new Date().toLocaleDateString('zh-TW')}`,
            originalContent,
            reformatted: '',
            names: [],
            status: 'raw',
            createdAt: new Date().toISOString()
        };

        db.articles.push(newArticle);
        await saveArticlesDB(db);

        res.json({ success: true, articleId, title: newArticle.title });
    } catch (e) {
        console.error('Save raw article error:', e);
        res.status(500).json({ error: '儲存文章時發生錯誤: ' + e.message });
    }
});

/**
 * API: Run AI analysis, segmentation, role labeling and name extraction on a raw article
 */
app.post('/api/articles/:id/analyze', async (req, res) => {
    const articleId = req.params.id;
    try {
        const db = await loadArticlesDB();
        const articleIndex = db.articles.findIndex(art => art.id === articleId);
        if (articleIndex === -1) {
            return res.status(404).json({ error: '找不到該文章' });
        }

        const article = db.articles[articleIndex];

        const prompt = `你是一個專業的文章排版與分析助手。請分析以下貼入的文章，並將其處理成結構化的 JSON 格式。

處理要求：
1. **重新排版**：將整篇文章排版成易於閱讀的格式（使用 Markdown），修正錯誤的標點符號，並保留語意通順。
2. **段落切割與角色分類**：依語意將文章切分成數個段落。對於每個段落，根據其在文章結構中的角色，將其分類為：
   - 「起」：引導、開端、介紹背景或人物。
   - 「承」：延續開端、展開敘事、補充細節。
   - 「轉」：轉折、情節起伏、引入衝突或改變視角。
   - 「合」：收尾、總結、得出結論或情感昇華。
3. **人名辨識**：在每個段落中，找出所有出現的「真實人名」或「角色名字」（如「張三」、「王五」、「John」等），若無人名則留空陣列。
4. **繁體中文輸出**：不論輸入文章是簡體中文、英文或其他語言，輸出的文章標題、排版後全文 (reformatted) 以及段落內容 (content)，必須全部轉換為繁體中文 (Taiwanese Traditional Chinese)，並修正任何非繁體中文用語。

請嚴格以 JSON 格式回傳，結構如下，不要包含 any markdown code block (如 \`\`\`json)：
{
  "title": "請提供一個適合的文章標題（如果原文章無標題則自動擬定）",
  "reformatted": "排版後的完整 Markdown 文章內容",
  "paragraphs": [
    {
      "content": "此段落的文字內容（排版後）",
      "role": "起 或 承 或 轉 或 合",
      "names": ["段落中出現的人名列表，例如 ['張三']"]
    }
  ]
}

原文章內容：
${article.originalContent}`;

        const responseText = await callGemini(prompt, true);
        
        let cleaned = responseText;
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }

        const result = JSON.parse(cleaned);

        // Collect all unique names in this article
        const allNamesSet = new Set();
        result.paragraphs.forEach(p => {
            if (p.names && Array.isArray(p.names)) {
                p.names.forEach(n => {
                    const trimmed = n.trim();
                    if (trimmed) allNamesSet.add(trimmed);
                });
            }
        });
        const allNames = Array.from(allNamesSet);

        // Update database record
        article.title = result.title || article.title;
        article.reformatted = result.reformatted || '';
        article.names = allNames;
        article.status = 'analyzed';

        // Clear any existing paragraphs for this article just in case
        db.paragraphs = db.paragraphs.filter(p => p.articleId !== articleId);

        // Save paragraphs
        const newParagraphs = result.paragraphs.map((p, idx) => ({
            id: `par_${Date.now()}_${idx}_${Math.random().toString(36).substring(7)}`,
            articleId,
            content: p.content || '',
            role: p.role || '承',
            names: p.names || [],
            seq: idx
        }));

        db.paragraphs.push(...newParagraphs);
        
        await saveArticlesDB(db);

        res.json({ success: true, article, paragraphs: newParagraphs });
    } catch (e) {
        console.error('Analyze article error:', e);
        res.status(500).json({ error: 'AI 分析時發生錯誤: ' + e.message });
    }
});

/**
 * API: Get list of articles
 */
app.get('/api/articles', async (req, res) => {
    try {
        const db = await loadArticlesDB();
        const list = db.articles.map(art => {
            const artParagraphs = db.paragraphs.filter(p => p.articleId === art.id);
            return {
                id: art.id,
                title: art.title,
                createdAt: art.createdAt,
                names: art.names || [],
                status: art.status || 'analyzed',
                wordCount: art.reformatted ? art.reformatted.length : 0,
                paragraphCount: artParagraphs.length
            };
        });
        list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json({ articles: list });
    } catch (e) {
        res.status(500).json({ error: '無法讀取文章列表' });
    }
});

/**
 * API: Get specific article detail and its paragraphs
 */
app.get('/api/articles/:id', async (req, res) => {
    try {
        const db = await loadArticlesDB();
        const article = db.articles.find(art => art.id === req.params.id);
        if (!article) {
            return res.status(404).json({ error: '找不到該文章' });
        }
        const paragraphs = db.paragraphs
            .filter(p => p.articleId === article.id)
            .sort((a, b) => a.seq - b.seq);
            
        res.json({ article, paragraphs });
    } catch (e) {
        res.status(500).json({ error: '無法讀取文章內容' });
    }
});

/**
 * API: Delete specific article and its paragraphs
 */
app.delete('/api/articles/:id', async (req, res) => {
    try {
        const db = await loadArticlesDB();
        const articleId = req.params.id;
        
        db.articles = db.articles.filter(art => art.id !== articleId);
        db.paragraphs = db.paragraphs.filter(p => p.articleId !== articleId);
        
        await saveArticlesDB(db);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '刪除文章失敗' });
    }
});

/**
 * API: Get list of all unique names in database
 */
app.get('/api/articles/names', async (req, res) => {
    try {
        const db = await loadArticlesDB();
        const allNamesSet = new Set();
        db.paragraphs.forEach(p => {
            if (p.names && Array.isArray(p.names)) {
                p.names.forEach(n => {
                    const trimmed = n.trim();
                    if (trimmed) allNamesSet.add(trimmed);
                });
            }
        });
        res.json({ names: Array.from(allNamesSet) });
    } catch (e) {
        res.status(500).json({ error: '讀取名字清單失敗' });
    }
});

/**
 * API: Reassemble paragraphs and generate a new article with logical transition rewrites and name replacements
 */
app.post('/api/articles/generate', async (req, res) => {
    const { targetWordCount, nameReplacements } = req.body;
    const wordCount = parseInt(targetWordCount) || 500;
    const replacements = nameReplacements || {};

    try {
        const db = await loadArticlesDB();
        const allParagraphs = db.paragraphs;
        if (!allParagraphs || allParagraphs.length === 0) {
            return res.status(400).json({ error: '資料庫中沒有任何段落，請先匯入一些文章' });
        }

        // Group paragraphs by their roles
        let qi = allParagraphs.filter(p => p.role === '起');
        let cheng = allParagraphs.filter(p => p.role === '承');
        let zhuan = allParagraphs.filter(p => p.role === '轉');
        let he = allParagraphs.filter(p => p.role === '合');

        // Fallbacks if any structural role is missing
        if (qi.length === 0) qi = allParagraphs;
        if (cheng.length === 0) cheng = allParagraphs;
        if (zhuan.length === 0) zhuan = allParagraphs;
        if (he.length === 0) he = allParagraphs;

        // Determine how many paragraphs to pick based on word count
        let chengCount = 1;
        let zhuanCount = 1;
        
        if (wordCount >= 1200) {
            chengCount = 3;
            zhuanCount = 2;
        } else if (wordCount >= 800) {
            chengCount = 2;
            zhuanCount = 2;
        } else if (wordCount >= 500) {
            chengCount = 2;
            zhuanCount = 1;
        }

        const getRandomElement = (arr) => arr[Math.floor(Math.random() * arr.length)];
        const getRandomElements = (arr, count) => {
            const shuffled = [...arr].sort(() => 0.5 - Math.random());
            return shuffled.slice(0, count);
        };

        const selected = [];
        // 1. Pick '起'
        selected.push(getRandomElement(qi));
        // 2. Pick '承'
        selected.push(...getRandomElements(cheng, chengCount));
        // 3. Pick '轉'
        selected.push(...getRandomElements(zhuan, zhuanCount));
        // 4. Pick '合'
        selected.push(getRandomElement(he));

        // Format selected paragraphs and perform initial name replacement
        let reassembledText = '';
        selected.forEach((p, idx) => {
            let content = p.content;
            for (const [oldName, newName] of Object.entries(replacements)) {
                if (newName && newName.trim() && oldName !== newName) {
                    const escName = oldName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                    const regex = new RegExp(escName, 'g');
                    content = content.replace(regex, newName.trim());
                }
            }
            reassembledText += `段落 ${idx + 1} (角色: ${p.role || '承'}):\n${content}\n\n`;
        });

        const prompt = `你是一個優秀的小說與文章寫作大師。
我有幾段隨機挑選自資料庫的段落，它們已經被標示了在文章結構中的角色（起、承、轉、合）。
請你將這些段落融合成一篇結構完整、邏輯連貫、情節流暢的文章。

融合要求：
1. **符合起承轉合**：文章結構必須符合「起（開端引入）」->「承（延續發展）」->「轉（轉折衝突）」->「合（收尾總結）」的敘事邏輯。
2. **段落合理補寫**：在原本的段落之間，補寫必要的「過渡句」或「銜接情節」，讓原本不相關的段落串接得極其自然，如同原本就是同一篇文章。
3. **名字一致性**：確保段落中所有人物姓名保持一致，不要搞混人名。
4. **目標字數**：整篇文章的字數目標約為 ${wordCount} 字左右。
5. **繁體中文輸出**：整篇文章的內容（包括補寫的銜接段落）必須全部以繁體中文 (Taiwanese Traditional Chinese) 輸出。
6. **格式**：請以 Markdown 格式輸出，只回傳排版後的最終文章內容。

以下是隨機挑選的段落內容：
${reassembledText}`;

        const generatedArticle = await callGemini(prompt, false);
        res.json({ success: true, article: generatedArticle });
    } catch (e) {
        console.error('Generate article error:', e);
        res.status(500).json({ error: '重組生成文章時發生錯誤: ' + e.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
