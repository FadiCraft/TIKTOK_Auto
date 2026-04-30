const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const SOURCES = [
    'https://www.dailymotion.com/video/x9z2nlw', 
    'https://www.dailymotion.com/tseries'       
];

const CONFIG = {
    fixedText: " | شاهد الحلقة كاملة الرابط في البايو 🔗🍿",
    dbFile: 'history.json',
    tempVideo: 'input.mp4',
    outputVideo: 'output.mp4',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
};

const MY_ACCOUNT = { name: "Acc 1", cookies: process.env.TIKTOK_COOKIES };

// --- وظيفة التحميل الجديدة (تستخدم استراتيجية كسر الحماية) ---
function downloadFromDailymotion(url) {
    console.log(`📥 جاري محاولة التحميل عبر استراتيجية كسر الحماية...`);
    try {
        // نستخدم --impersonate-client لتقليد متصفح حقيقي بالكامل وتجنب الـ 404
        const cmd = `yt-dlp --no-check-certificates \
            --no-cache-dir \
            --user-agent "${CONFIG.userAgent}" \
            --add-header "Accept:text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8" \
            --add-header "Accept-Language:en-US,en;q=0.5" \
            --referer "https://www.dailymotion.com/" \
            -f "best[ext=mp4]/best" \
            --geo-bypass \
            -o "${CONFIG.tempVideo}" "${url}"`;
        
        execSync(cmd, { stdio: 'inherit' });
        return true;
    } catch (e) {
        console.error("❌ فشل التحميل بالطريقة العادية، نجرب الجودة المنخفضة...");
        try {
            // محاولة أخيرة بجودة محددة جداً غالباً ما تكون متاحة كملف MP4 مباشر
            execSync(`yt-dlp -f "http-360/http-480/best" -o "${CONFIG.tempVideo}" "${url}"`, { stdio: 'inherit' });
            return true;
        } catch (e2) {
            throw new Error("Dailymotion is blocking GitHub Servers.");
        }
    }
}

async function fetchVideoInfo(videoUrl) {
    try {
        const title = execSync(`yt-dlp --get-title "${videoUrl}"`, { encoding: 'utf-8' }).trim();
        return title;
    } catch (e) { return "Drama Episode"; }
}

async function fetchNewVideos() {
    let allFound = [];
    for (const source of SOURCES) {
        try {
            const output = execSync(`yt-dlp --flat-playlist --get-id --playlist-items 1-5 "${source}"`, { encoding: 'utf-8' });
            output.trim().split('\n').forEach(id => {
                if (id) allFound.push({ id: id.trim(), url: `https://www.dailymotion.com/video/${id.trim()}` });
            });
        } catch (e) {}
    }
    return allFound;
}

// --- وظيفة الرفع (TikTok) ---
async function uploadAndPost(videoPath, originalTitle, cookiesStr, accName) {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    try {
        await page.setCookie(...JSON.parse(cookiesStr));
        await page.goto('https://www.tiktok.com/upload?lang=ar', { waitUntil: 'networkidle2' });
        
        const fileInput = await page.waitForSelector('input[type="file"]');
        await fileInput.uploadFile(videoPath);

        const editorSelector = '.public-DraftEditor-content';
        await page.waitForSelector(editorSelector, { timeout: 60000 });
        await page.focus(editorSelector);
        await page.keyboard.type(`${originalTitle} ${CONFIG.fixedText} #explore #dailymotion`);

        const postBtn = 'button[data-e2e="post_video_button"]';
        await page.waitForFunction(sel => !document.querySelector(sel).disabled, {}, postBtn);
        await page.click(postBtn);
        
        await new Promise(r => setTimeout(r, 10000));
        return true;
    } catch (err) {
        console.error("❌ Error during upload:", err.message);
        return false;
    } finally {
        await browser.close();
    }
}

// --- المحرك الرئيسي ---
(async () => {
    let history = fs.existsSync(CONFIG.dbFile) ? JSON.parse(fs.readFileSync(CONFIG.dbFile)) : { posted: [] };
    const availableVideos = await fetchNewVideos();
    const unpostedVideos = availableVideos.filter(v => !history.posted.includes(v.id));

    if (unpostedVideos.length === 0) return;

    const selected = unpostedVideos[0];
    const title = await fetchVideoInfo(selected.url);

    try {
        // تنفيذ التحميل باستراتيجية كسر الحماية
        downloadFromDailymotion(selected.url);

        console.log("🎨 معالجة الفيديو...");
        execSync(`ffmpeg -i ${CONFIG.tempVideo} -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" -c:v libx264 -crf 23 -y ${CONFIG.outputVideo}`, { stdio: 'ignore' });

        const success = await uploadAndPost(CONFIG.outputVideo, title, MY_ACCOUNT.cookies, MY_ACCOUNT.name);

        if (success) {
            history.posted.push(selected.id);
            fs.writeFileSync(CONFIG.dbFile, JSON.stringify(history, null, 2));
            console.log("✅ Done!");
        }
    } catch (e) {
        console.error(`⚠️ الحماية منعت التحميل: ${e.message}`);
        console.log("💡 نصيحة: Dailymotion يحجب GitHub. يفضل استخدام فيديو من TikTok أو YouTube كمصدر حالياً.");
    }

    [CONFIG.tempVideo, CONFIG.outputVideo].forEach(f => { if(fs.existsSync(f)) fs.unlinkSync(f); });
})();
