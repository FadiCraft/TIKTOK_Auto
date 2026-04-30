const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// --- الإعدادات والمصادر ---
const SOURCES = [
    'https://www.dailymotion.com/video/x9z2nlw', 
    'https://www.dailymotion.com/tseries'       
];

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
        return execSync(cmd, { encoding: 'utf-8' }).trim();
    } catch (e) {
        console.error(`❌ فشل جلب العنوان:`, e.message);
        return "New Video";
    }
}

// جلب قائمة الفيديوهات
async function fetchNewVideos() {
    let allFound = [];
    for (const source of SOURCES) {
        try {
            console.log(`🔎 سحب المعرفات من: ${source}`);
            // استخدام --get-id لجلب المعرفات فقط من القائمة
            const cmd = `yt-dlp --no-check-certificates --flat-playlist --get-id --playlist-items 1-5 "${source}"`;
            const output = execSync(cmd, { encoding: 'utf-8' });
            output.trim().split('\n').forEach(id => {
                if (id) allFound.push({ id: id.trim(), url: `https://www.dailymotion.com/video/${id.trim()}` });
            });
        } catch (e) { console.error(`❌ فشل السحب من ${source}`); }
    }
    return allFound;
}

// عملية الرفع (تيك توك)
async function uploadAndPost(videoPath, originalTitle, cookiesStr, accName) {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.userAgent);

    try {
        if (!cookiesStr) throw new Error("Cookies are missing!");
        await page.setCookie(...JSON.parse(cookiesStr));
        
        await page.goto('https://www.tiktok.com/upload?lang=ar', { waitUntil: 'networkidle2', timeout: 120000 });

        console.log(`📤 رفع الفيديو إلى TikTok...`);
        const fileInput = await page.waitForSelector('input[type="file"]');
        await fileInput.uploadFile(videoPath);

        // إنشاء الوصف والهاشتاجات
        const cleanTitle = originalTitle.replace(/[^\u0600-\u06FFa-zA-Z0-9 ]/g, '');
        const hashtags = "#explore #dailymotion #drama";
        const finalCaption = `${cleanTitle} ${CONFIG.fixedText} ${hashtags}`;

        const editorSelector = '.public-DraftEditor-content';
        await page.waitForSelector(editorSelector, { timeout: 60000 });
        await page.focus(editorSelector);
        
        // مسح النص الافتراضي وكتابة الجديد
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(finalCaption, { delay: 50 });

        // انتظار زر النشر ليصبح قابلاً للضغط
        const postBtn = 'button[data-e2e="post_video_button"]';
        await page.waitForFunction(sel => {
            const btn = document.querySelector(sel);
            return btn && btn.getAttribute('data-disabled') === 'false';
        }, { timeout: 240000 }, postBtn);

        await page.click(postBtn);
        console.log("🚀 تم الضغط على زر النشر!");

        await new Promise(r => setTimeout(r, 15000));
        return true;
    } catch (err) {
        console.error(`❌ خطأ أثناء الرفع:`, err.message);
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
        console.log("👋 لا فيديوهات جديدة.");
        return;
    }

    const selected = unpostedVideos[0];
    const title = await fetchVideoInfo(selected.url);

    try {
        console.log(`📥 جاري التحميل: ${selected.url}`);
        
        /* 
           تعديل التحميل: 
           1. --no-cache-dir لضمان عدم طلب روابط منتهية الصلاحية.
           2. -f "bestvideo+bestaudio/best" لتحميل أفضل جودة متاحة.
           3. --merge-output-format mp4 لضمان دمج الصوت والفيديو في ملف واحد.
        */
        const downloadCmd = `yt-dlp --no-check-certificates --no-cache-dir --user-agent "${CONFIG.userAgent}" -f "bestvideo+bestaudio/best" --merge-output-format mp4 -o "${CONFIG.tempVideo}" "${selected.url}"`;
        execSync(downloadCmd, { stdio: 'inherit' });

        console.log("🎨 جاري المعالجة (FFmpeg)...");
        execSync(`ffmpeg -i ${CONFIG.tempVideo} -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" -c:v libx264 -crf 23 -preset fast -y ${CONFIG.outputVideo}`, { stdio: 'ignore' });

        const success = await uploadAndPost(CONFIG.outputVideo, title, MY_ACCOUNT.cookies, MY_ACCOUNT.name);

        if (success) {
            history.posted.push(selected.id);
            fs.writeFileSync(CONFIG.dbFile, JSON.stringify(history, null, 2));
            console.log("✅ تم الحفظ في التاريخ.");
        }
    } catch (e) {
        console.error(`⚠️ فشلت المهمة: ${e.message}`);
    }

    // تنظيف الملفات المؤقتة
    [CONFIG.tempVideo, CONFIG.outputVideo].forEach(f => { if(fs.existsSync(f)) fs.unlinkSync(f); });
})();
