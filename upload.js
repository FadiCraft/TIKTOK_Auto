const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// --- الإعدادات والمصادر ---
const SOURCES = [
    'https://www.tiktok.com/@dramawaveapp',
    'https://www.tiktok.com/@dramaboxshorts'
];

const MY_ACCOUNT = { name: "Acc 1", cookies: process.env.TIKTOK_COOKIES };

const CONFIG = {
    fixedText: " | شاهد الحلقة كاملة الرابط في البايو 🔗🍿",
    dbFile: 'history.json',
    tempVideo: 'input.mp4',
    outputVideo: 'output.mp4',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
};

// جلب معلومات الفيديو كاملة مع العنوان
async function fetchVideoInfo(videoUrl) {
    try {
        const cmd = `yt-dlp --no-check-certificates --user-agent "${CONFIG.userAgent}" --print "%(title)s" "${videoUrl}"`;
        const title = execSync(cmd, { encoding: 'utf-8' }).trim();
        return title;
    } catch (e) {
        console.error(`❌ فشل جلب عنوان الفيديو:`, e.message);
        return null;
    }
}

// جلب قائمة الفيديوهات من المصادر
async function fetchNewVideos() {
    let allFound = [];
    for (const source of SOURCES) {
        console.log(`🔎 سحب محتوى من: ${source}`);
        try {
            const cmd = `yt-dlp --no-check-certificates --user-agent "${CONFIG.userAgent}" --flat-playlist --print "%(id)s" --playlist-items 1-30 "${source}"`;
            const output = execSync(cmd, { encoding: 'utf-8' });
            output.trim().split('\n').forEach(id => {
                if (id) allFound.push({ id, url: `https://www.tiktok.com/@any/video/${id}` });
            });
        } catch (e) { console.error(`❌ فشل السحب من ${source}:`, e.message); }
    }
    return allFound;
}

// عملية الرفع عبر المتصفح 
async function uploadAndPost(videoPath, originalTitle, cookiesStr, accName) {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.userAgent);

    try {
        if (!cookiesStr) throw new Error("ملفات تعريف الارتباط (Cookies) غير موجودة!");
        
        await page.setCookie(...JSON.parse(cookiesStr));
        await page.goto('https://www.tiktok.com/upload?lang=ar', { waitUntil: 'networkidle2', timeout: 120000 });

        console.log(`📤 جاري رفع الفيديو لحساب ${accName}...`);
        const fileInput = await page.waitForSelector('input[type="file"]');
        await fileInput.uploadFile(videoPath);

        // --- توليد وصف ديناميكي بالكامل ---
        // استخراج أول كلمتين من العنوان لتحويلها لهاشتاجات ديناميكية (لزيادة التفاعل)
        const dynamicWords = originalTitle.split(' ').slice(0, 2)
            .map(w => w.replace(/[^a-zA-Z\u0600-\u06FF]/g, ''))
            .filter(w => w.length > 2);
        const dynamicHashtags = dynamicWords.map(w => `#${w}`).join(' ');
        
        const finalCaption = `${originalTitle} ${CONFIG.fixedText} ${dynamicHashtags} #dramabox #explore`;
        console.log(`📝 الوصف الديناميكي الذي سيتم كتابته:\n${finalCaption}`);
        
        // --- الطريقة الصحيحة للتعامل مع محرر Draft.js الخاص بتيك توك ---
        const editorSelector = '.public-DraftEditor-content';
        await page.waitForSelector(editorSelector, { timeout: 30000 });
        await page.focus(editorSelector);
        await page.click(editorSelector);
        
        // 1. تحديد أي نص موجود مسبقاً (Ctrl+A) ثم مسحه
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');

        // 2. كتابة النص الجديد كأنك مستخدم حقيقي (تأخير 50 جزء من الثانية بين كل حرف)
        await page.keyboard.type(finalCaption, { delay: 50 });

        // اختيار "النشر الآن" (لتجنب الحفظ كمسودة)
        await page.evaluate(() => {
            const nowRadio = document.querySelector('input[value="post_now"]');
            if (nowRadio) nowRadio.click();
        });

        // انتظار تفعيل زر النشر الرئيسي
        const postBtn = 'button[data-e2e="post_video_button"]';
        await page.waitForFunction(sel => {
            const btn = document.querySelector(sel);
            return btn && btn.getAttribute('data-disabled') === 'false';
        }, { timeout: 240000 }, postBtn);

        console.log("🚀 جاري الضغط على زر النشر...");
        await page.click(postBtn);
        
        // --- معالجة نافذة تأكيد النشر ---
        console.log("🔍 فحص وجود نافذة تأكيد النشر...");
        await new Promise(r => setTimeout(r, 6000));
        
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const confirmBtn = buttons.find(btn => 
                (btn.innerText && btn.innerText.trim() === 'النشر الآن') || 
                (btn.innerText && btn.innerText.trim() === 'Post now') ||
                (btn.innerText && btn.innerText.includes('النشر الآن'))
            );
            
            const divs = Array.from(document.querySelectorAll('div[role="button"]'));
            const confirmDiv = divs.find(div => 
                (div.innerText && div.innerText.trim() === 'النشر الآن')
            );

            if (confirmBtn) confirmBtn.click();
            else if (confirmDiv) confirmDiv.click();
        });

        await new Promise(r => setTimeout(r, 15000));
        await page.screenshot({ path: `success-${accName}-${Date.now()}.png` });
        
        console.log(`✅ تم النشر بنجاح!`);
        return true;
    } catch (err) {
        console.error(`❌ فشل الرفع:`, err.message);
        await page.screenshot({ path: `error-${accName}-${Date.now()}.png` });
        return false;
    } finally {
        await browser.close();
    }
}

// --- المحرك الرئيسي ---
(async () => {
    let history = fs.existsSync(CONFIG.dbFile) ? JSON.parse(fs.readFileSync(CONFIG.dbFile)) : { posted: [] };
    
    if (!history.posted) {
        const oldHistory = history;
        history = { posted: [] };
        Object.values(oldHistory).forEach(videos => {
            if (Array.isArray(videos)) history.posted.push(...videos);
        });
    }

    const availableVideos = await fetchNewVideos();
    const unpostedVideos = availableVideos.filter(v => !history.posted.includes(v.id));
    
    if (unpostedVideos.length === 0) {
        console.log("👋 لا يوجد فيديوهات جديدة للنشر حالياً.");
        return;
    }

    const selectedVideo = unpostedVideos[Math.floor(Math.random() * unpostedVideos.length)];
    const originalTitle = await fetchVideoInfo(selectedVideo.url);
    
    if (!originalTitle) {
        console.error("❌ لم نتمكن من جلب عنوان الفيديو");
        return;
    }

    if (fs.existsSync(CONFIG.tempVideo)) fs.unlinkSync(CONFIG.tempVideo);
    if (fs.existsSync(CONFIG.outputVideo)) fs.unlinkSync(CONFIG.outputVideo);

    try {
        console.log("📥 جاري تحميل الفيديو...");
        execSync(`yt-dlp --no-check-certificates --user-agent "${CONFIG.userAgent}" -o "${CONFIG.tempVideo}" "${selectedVideo.url}"`, {stdio: 'inherit'});
        
        console.log("🎨 جاري معالجة الفيديو...");
        execSync(`ffmpeg -i ${CONFIG.tempVideo} -vf "setpts=0.95*PTS,scale=iw*1.02:ih*1.02,crop=iw/1.02:ih/1.02,eq=brightness=0.03:contrast=1.05" -map_metadata -1 -c:v libx264 -crf 22 -af "atempo=1.05" -y ${CONFIG.outputVideo}`, {stdio: 'ignore'});

        const success = await uploadAndPost(CONFIG.outputVideo, originalTitle, MY_ACCOUNT.cookies, MY_ACCOUNT.name);

        if (success) {
            history.posted.push(selectedVideo.id);
            fs.writeFileSync(CONFIG.dbFile, JSON.stringify(history, null, 2));
            console.log(`💾 تم حفظ الفيديو لمنع تكراره`);
        }
    } catch (e) { 
        console.error(`⚠️ خطأ تقني: ${e.message}`); 
    }

    if (fs.existsSync(CONFIG.tempVideo)) fs.unlinkSync(CONFIG.tempVideo);
    if (fs.existsSync(CONFIG.outputVideo)) fs.unlinkSync(CONFIG.outputVideo);
})();
