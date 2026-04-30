const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// --- الإعدادات والمصادر ---
const SOURCES = [
    'https://www.dailymotion.com/video/x9z2nlw', // رابط فيديو محدد
    'https://www.dailymotion.com/tseries'       // رابط قناة (سيأخذ آخر الفيديوهات منها)
];

// استخدام الحساب الأول بشكل افتراضي
const MY_ACCOUNT = { name: "Acc 1", cookies: process.env.TIKTOK_COOKIES };

const CONFIG = {
    fixedText: " | شاهد الحلقة كاملة الرابط في البايو 🔗🍿",
    dbFile: 'history.json',
    tempVideo: 'input.mp4',
    outputVideo: 'output.mp4',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
};

// جلب عنوان الفيديو
async function fetchVideoInfo(videoUrl) {
    try {
        const cmd = `yt-dlp --no-check-certificates --user-agent "${CONFIG.userAgent}" --get-title "${videoUrl}"`;
        const title = execSync(cmd, { encoding: 'utf-8' }).trim();
        return title;
    } catch (e) {
        console.error(`❌ فشل جلب عنوان الفيديو:`, e.message);
        return null;
    }
}

// جلب قائمة الفيديوهات من Dailymotion
async function fetchNewVideos() {
    let allFound = [];
    for (const source of SOURCES) {
        console.log(`🔎 فحص المحتوى في: ${source}`);
        try {
            // جلب الـ ID الخاص بالفيديوهات (أول 10 فيديوهات من المصدر)
            const cmd = `yt-dlp --no-check-certificates --flat-playlist --get-id --playlist-items 1-10 "${source}"`;
            const output = execSync(cmd, { encoding: 'utf-8' });
            output.trim().split('\n').forEach(id => {
                if (id) allFound.push({ id: id.trim(), url: `https://www.dailymotion.com/video/${id.trim()}` });
            });
        } catch (e) { console.error(`❌ فشل السحب من ${source}:`, e.message); }
    }
    return allFound;
}

// عملية الرفع إلى TikTok
async function uploadAndPost(videoPath, originalTitle, cookiesStr, accName) {
    const browser = await puppeteer.launch({
        headless: "new",
        executablePath: '/usr/bin/google-chrome', // مهم لبيئة GitHub Actions
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.userAgent);

    try {
        if (!cookiesStr) throw new Error("Cookies missing!");
        
        await page.setCookie(...JSON.parse(cookiesStr));
        await page.goto('https://www.tiktok.com/upload?lang=ar', { waitUntil: 'networkidle2', timeout: 120000 });

        console.log(`📤 جاري رفع الفيديو...`);
        const fileInput = await page.waitForSelector('input[type="file"]');
        await fileInput.uploadFile(videoPath);

        // وصف الفيديو والهاشتاجات
        const dynamicWords = originalTitle.split(' ').slice(0, 2).map(w => w.replace(/[^\u0600-\u06FFa-zA-Z]/g, '')).filter(w => w.length > 2);
        const dynamicHashtags = dynamicWords.map(w => `#${w}`).join(' ');
        const finalCaption = `${originalTitle} ${CONFIG.fixedText} ${dynamicHashtags} #explore #dailymotion`;

        const editorSelector = '.public-DraftEditor-content';
        await page.waitForSelector(editorSelector, { timeout: 60000 });
        await page.focus(editorSelector);
        await page.click(editorSelector);
        
        // مسح النص القديم وكتابة الجديد
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(finalCaption, { delay: 50 });

        // الضغط على زر النشر
        const postBtn = 'button[data-e2e="post_video_button"]';
        await page.waitForFunction(sel => {
            const btn = document.querySelector(sel);
            return btn && btn.getAttribute('data-disabled') === 'false';
        }, { timeout: 240000 }, postBtn);

        await page.click(postBtn);
        console.log("🚀 تم الضغط على زر النشر الرئيسي...");

        // انتظار وتأكيد النشر إذا ظهرت نافذة منبثقة
        await new Promise(r => setTimeout(r, 10000));
        console.log(`✅ تمت العملية بنجاح!`);
        return true;
    } catch (err) {
        console.error(`❌ فشل الرفع:`, err.message);
        await page.screenshot({ path: `error-${Date.now()}.png` });
        return false;
    } finally {
        await browser.close();
    }
}

// المحرك الرئيسي
(async () => {
    let history = fs.existsSync(CONFIG.dbFile) ? JSON.parse(fs.readFileSync(CONFIG.dbFile)) : { posted: [] };
    
    const availableVideos = await fetchNewVideos();
    const unpostedVideos = availableVideos.filter(v => !history.posted.includes(v.id));
    
    if (unpostedVideos.length === 0) {
        console.log("👋 لا يوجد جديد.");
        return;
    }

    const selectedVideo = unpostedVideos[0]; 
    const title = await fetchVideoInfo(selectedVideo.url);
    
    if (!title) return;

    try {
        console.log(`📥 تحميل: ${selectedVideo.url}`);
        // استخدام خيار -f b لضمان تحميل ملف مدمج وتجنب خطأ 404
        execSync(`yt-dlp --no-check-certificates -f "b" -o "${CONFIG.tempVideo}" "${selectedVideo.url}"`, {stdio: 'inherit'});
        
        console.log("🎨 معالجة الفيديو...");
        execSync(`ffmpeg -i ${CONFIG.tempVideo} -vf "setpts=0.95*PTS,scale=iw*1.02:ih*1.02,crop=iw/1.02:ih/1.02,eq=brightness=0.03:contrast=1.05" -c:v libx264 -crf 23 -preset fast -y ${CONFIG.outputVideo}`, {stdio: 'ignore'});

        const success = await uploadAndPost(CONFIG.outputVideo, title, MY_ACCOUNT.cookies, MY_ACCOUNT.name);

        if (success) {
            history.posted.push(selectedVideo.id);
            fs.writeFileSync(CONFIG.dbFile, JSON.stringify(history, null, 2));
        }
    } catch (e) { 
        console.error(`⚠️ خطأ: ${e.message}`); 
    }

    // تنظيف
    if (fs.existsSync(CONFIG.tempVideo)) fs.unlinkSync(CONFIG.tempVideo);
    if (fs.existsSync(CONFIG.outputVideo)) fs.unlinkSync(CONFIG.outputVideo);
})();
