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
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ cookies: '' }));
}

/**
 * Loads settings from file
 */
async function getSettings() {
    const data = await fs.promises.readFile(SETTINGS_FILE, 'utf8');
    return JSON.parse(data);
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
        const { cookies } = req.body;
        await fs.promises.writeFile(SETTINGS_FILE, JSON.stringify({ cookies }, null, 2));
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

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
