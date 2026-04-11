const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
const fs = require('fs');
const axios = require('axios');

puppeteer.use(StealthPlugin());

// --- الإعدادات العامة ---
const CONFIG = {
    targetAccount: 'https://www.tiktok.com/@tonnysweden', // الحساب المستهدف
    myCaption: 'مشهد يستحق المشاهدة! 🔥 #أفلام #سينما #KiroZozo',
    dbFile: 'history.json',
    videoPath: './input.mp4',
    editedPath: './output.mp4',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

// 1. دالة جلب آخر فيديو غير منشور
async function getLatestVideoId(accountUrl) {
    console.log("🔎 فحص الفيديوهات الجديدة في الحساب المستهدف...");
    try {
        // استخدام User-Agent لتخطي حظر GitHub Actions
        const cmd = `yt-dlp --user-agent "${CONFIG.userAgent}" --flat-playlist --get-id "${accountUrl}"`;
        const idsRaw = execSync(cmd, { encoding: 'utf-8' });
        let allIds = idsRaw.trim().split('\n').filter(id => id.trim().length > 0);

        let history = fs.existsSync(CONFIG.dbFile) ? JSON.parse(fs.readFileSync(CONFIG.dbFile)) : [];
        
        // البحث عن أول فيديو (الأحدث) ليس في السجل
        const nextId = allIds.find(id => !history.includes(id));
        
        return { nextId, history };
    } catch (err) {
        console.error("❌ فشل جلب الفيديوهات من تيك توك:", err.message);
        return { nextId: null, history: [] };
    }
}

// 2. دالة تغيير بصمة الفيديو (المونتاج التقني)
function processVideo(input, output) {
    console.log("🎨 جاري تغيير بصمة الفيديو لتجنب كشف المحتوى المكرر...");
    try {
        // زوم بسيط، تعديل ألوان، وحذف الميتا داتا
        const ffmpegCmd = `ffmpeg -i ${input} -vf "scale=iw*1.05:ih*1.05,crop=iw/1.05:ih/1.05,eq=brightness=0.03:contrast=1.05" -map_metadata -1 -c:v libx264 -crf 23 -c:a aac -y ${output}`;
        execSync(ffmpegCmd, { stdio: 'inherit' });
        console.log("✅ تمت المعالجة بنجاح.");
    } catch (err) {
        console.error("⚠️ فشل معالجة الفيديو بـ FFmpeg:", err.message);
    }
}

// 3. دالة الرفع إلى تيك توك
async function uploadToTikTok(videoPath, caption) {
    console.log('🚀 بدء عملية الرفع عبر المتصفح...');
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.userAgent);

    try {
        if (!process.env.TIKTOK_COOKIES) throw new Error("TIKTOK_COOKIES secret is missing!");
        
        const cookies = JSON.parse(process.env.TIKTOK_COOKIES);
        await page.setCookie(...cookies);

        await page.goto('https://www.tiktok.com/upload?lang=ar', { waitUntil: 'networkidle2', timeout: 90000 });

        console.log('📁 اختيار ملف الفيديو...');
        const fileInput = await page.waitForSelector('input[type="file"]');
        await fileInput.uploadFile(videoPath);

        console.log('✍️ كتابة الوصف...');
        await page.waitForSelector('.public-DraftEditor-content', { timeout: 60000 });
        await page.click('.public-DraftEditor-content');
        // مسح النص الافتراضي وكتابة الوصف
        await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(caption);

        console.log('⏳ انتظار معالجة الفيديو وتفعيل زر النشر...');
        const postBtnSelector = 'button[data-e2e="post_video_button"]';
        await page.waitForFunction((sel) => {
            const btn = document.querySelector(sel);
            return btn && btn.getAttribute('data-disabled') === 'false';
        }, { timeout: 180000 }, postBtnSelector);

        await page.click(postBtnSelector);
        console.log('✅ تم الضغط على زر النشر!');

        // التعامل مع نافذة "النشر الآن" المنبثقة إذا ظهرت
        await new Promise(r => setTimeout(r, 10000));
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const targetBtn = buttons.find(b => b.innerText.includes('النشر الآن') || b.innerText.includes('Post now'));
            if (targetBtn) targetBtn.click();
        });

        console.log('📸 أخذ لقطة شاشة للنتيجة النهائية...');
        await page.screenshot({ path: 'final-result.png' });

    } catch (err) {
        console.error('❌ خطأ أثناء الرفع:', err.message);
        await page.screenshot({ path: 'error-screenshot.png' });
        throw err;
    } finally {
        await browser.close();
    }
}

// --- المحرك الرئيسي للنظام ---
async function startBot() {
    try {
        const { nextId, history } = await getLatestVideoId(CONFIG.targetAccount);
        
        if (!nextId) {
            console.log("✅ لا توجد فيديوهات جديدة لنشرها. كل المحتوى مراجع.");
            return;
        }

        console.log(`🎯 فيديو جديد مستهدف: ${nextId}`);

        // تحميل الفيديو
        console.log("📥 جاري التحميل من تيك توك...");
        execSync(`yt-dlp --user-agent "${CONFIG.userAgent}" -o "${CONFIG.videoPath}" "https://www.tiktok.com/@any/video/${nextId}"`, { stdio: 'inherit' });

        // معالجة الفيديو (المونتاج)
        processVideo(CONFIG.videoPath, CONFIG.editedPath);

        // الرفع
        await uploadToTikTok(CONFIG.editedPath, CONFIG.myCaption);

        // تحديث السجل لتجنب التكرار
        history.push(nextId);
        fs.writeFileSync(CONFIG.dbFile, JSON.stringify(history, null, 2));
        
        console.log("🏁 تمت المهمة بنجاح!");

    } catch (error) {
        console.error("⚠️ فشل النظام في إكمال العملية:");
        console.error(error.message);
    }
}

// تشغيل البوت
startBot();
