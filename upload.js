const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const CONFIG = {
    targetAccount: 'https://www.tiktok.com/@tonnysweden', 
    myCaption: 'مشهد رائع يستحق المتابعة! 🔥 #أفلام #سينما #KiroZozo',
    dbFile: 'history.json',
    videoPath: './input.mp4',
    editedPath: './output.mp4',
    // User Agent حديث لتجنب الحظر
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
};

// 1. جلب الفيديو الجديد
async function getLatestVideoId(accountUrl) {
    console.log("🔎 فحص الفيديوهات الجديدة...");
    try {
        // خيارات إضافية لتخطي الحظر الجغرافي وحل مشكلة الـ JSON
        const cmd = `yt-dlp --no-check-certificates --geo-bypass --user-agent "${CONFIG.userAgent}" --flat-playlist --get-id --playlist-items 1-3 "${accountUrl}"`;
        const idsRaw = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
        let allIds = idsRaw.trim().split('\n').filter(id => id.trim().length > 0);

        if (allIds.length === 0) throw new Error("لا توجد فيديوهات متاحة حالياً.");

        let history = fs.existsSync(CONFIG.dbFile) ? JSON.parse(fs.readFileSync(CONFIG.dbFile)) : [];
        const nextId = allIds.find(id => !history.includes(id));
        
        return { nextId, history };
    } catch (err) {
        console.error("❌ فشل الفحص:", err.message);
        return { nextId: null, history: [] };
    }
}

// 2. معالجة الفيديو (تغيير البصمة)
function processVideo(input, output) {
    console.log("🎨 معالجة الفيديو تقنياً...");
    try {
        // تغيير طفيف في الحجم والألوان لحذف البصمة القديمة
        const ffmpegCmd = `ffmpeg -i ${input} -vf "scale=iw*1.02:ih*1.02,crop=iw/1.02:ih/1.02,eq=brightness=0.02:contrast=1.02" -map_metadata -1 -c:v libx264 -crf 24 -c:a aac -y ${output}`;
        execSync(ffmpegCmd, { stdio: 'inherit' });
    } catch (err) {
        console.error("⚠️ خطأ في معالجة FFmpeg:", err.message);
    }
}

// 3. رفع الفيديو عبر Puppeteer
async function uploadToTikTok(videoPath, caption) {
    console.log('🚀 بدء عملية الرفع...');
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });

    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.userAgent);

    try {
        const cookies = JSON.parse(process.env.TIKTOK_COOKIES);
        await page.setCookie(...cookies);

        await page.goto('https://www.tiktok.com/upload?lang=ar', { waitUntil: 'networkidle2', timeout: 90000 });

        console.log('📁 اختيار الملف...');
        const fileInput = await page.waitForSelector('input[type="file"]');
        await fileInput.uploadFile(videoPath);

        console.log('✍️ كتابة الوصف...');
        await page.waitForSelector('.public-DraftEditor-content');
        await page.click('.public-DraftEditor-content');
        await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(caption);

        console.log('⏳ انتظار تفعيل زر النشر (قد يستغرق دقيقة)...');
        const postBtn = 'button[data-e2e="post_video_button"]';
        await page.waitForFunction((sel) => {
            const btn = document.querySelector(sel);
            return btn && btn.getAttribute('data-disabled') === 'false';
        }, { timeout: 180000 }, postBtn);

        await page.click(postBtn);
        
        // محاولة الضغط على "النشر الآن" إذا ظهرت نافذة تأكيد
        await new Promise(r => setTimeout(r, 12000));
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const now = btns.find(b => b.innerText.includes('النشر الآن') || b.innerText.includes('Post now'));
            if (now) now.click();
        });

        await page.screenshot({ path: 'final-result.png' });
        console.log('✅ تم النشر بنجاح!');

    } catch (err) {
        await page.screenshot({ path: 'error-screenshot.png' });
        throw err;
    } finally {
        await browser.close();
    }
}

// التشغيل الرئيسي
(async () => {
    const { nextId, history } = await getLatestVideoId(CONFIG.targetAccount);
    
    if (nextId) {
        console.log(`🎯 العمل على فيديو: ${nextId}`);
        execSync(`yt-dlp --user-agent "${CONFIG.userAgent}" -o "${CONFIG.videoPath}" "https://www.tiktok.com/@any/video/${nextId}"`, { stdio: 'inherit' });
        
        processVideo(CONFIG.videoPath, CONFIG.editedPath);
        await uploadToTikTok(CONFIG.editedPath, CONFIG.myCaption);

        history.push(nextId);
        fs.writeFileSync(CONFIG.dbFile, JSON.stringify(history, null, 2));
    } else {
        console.log("👋 لا محتوى جديد.");
    }
})();
