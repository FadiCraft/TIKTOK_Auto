const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// --- الإعدادات ---
const SOURCES = [
    'https://www.tiktok.com/@dramawaveapp',
    'https://www.tiktok.com/@dramaboxshorts'
];

const MY_ACCOUNTS = [
    { name: "Acc 1", cookies: process.env.TIKTOK_COOKIES },
    { name: "Acc 2", cookies: process.env.TIKTOK_COOKIES2 },
    { name: "Acc 3", cookies: process.env.TIKTOK_COOKIES3 }
].filter(acc => acc.cookies);

const CONFIG = {
    videosPerAccount: 1, // فيديو واحد لكل تشغيل (كل ساعة) لضمان الأمان
    fixedText: " | شاهد الحلقة كاملة الرابط في البايو 🔗🍿",
    dbFile: 'history.json',
    tempVideo: 'input.mp4',
    outputVideo: 'output.mp4',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
};

// 1. جلب فيديوهات جديدة
async function fetchNewVideos() {
    let allFound = [];
    for (const source of SOURCES) {
        console.log(`🔎 سحب محتوى من: ${source}`);
        try {
            const cmd = `yt-dlp --no-check-certificates --user-agent "${CONFIG.userAgent}" --flat-playlist --print "%(id)s|%(title)s" --playlist-items 1-30 "${source}"`;
            const output = execSync(cmd, { encoding: 'utf-8' });
            output.trim().split('\n').forEach(line => {
                const [id, title] = line.split('|');
                if (id && title) allFound.push({ id, title });
            });
        } catch (e) { console.error(`❌ فشل السحب من ${source}`); }
    }
    return allFound;
}

// 2. عملية الرفع والنشر (الآن)
async function uploadAndPost(videoPath, finalCaption, cookiesStr) {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.userAgent);

    try {
        await page.setCookie(...JSON.parse(cookiesStr));
        await page.goto('https://www.tiktok.com/upload?lang=ar', { waitUntil: 'networkidle2', timeout: 120000 });

        console.log(`📤 جاري رفع الفيديو وتجهيز النشر...`);
        const fileInput = await page.waitForSelector('input[type="file"]');
        await fileInput.uploadFile(videoPath);

        // كتابة الوصف (العنوان الأصلي + النص الثابت)
        await page.waitForSelector('.public-DraftEditor-content');
        await page.click('.public-DraftEditor-content');
        await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(finalCaption);

        // التأكد من أن خيار "الآن" هو المختار (بناءً على كود الـ HTML الذي أرسلته)
        await page.evaluate(() => {
            const nowRadio = document.querySelector('input[value="post_now"]');
            if (nowRadio) nowRadio.click();
        });

        const postBtn = 'button[data-e2e="post_video_button"]';
        // انتظار تفعيل زر النشر بعد اكتمال معالجة الفيديو
        await page.waitForFunction(sel => {
            const btn = document.querySelector(sel);
            return btn && btn.getAttribute('data-disabled') === 'false';
        }, {timeout: 240000}, postBtn);

        await page.click(postBtn);
        await new Promise(r => setTimeout(r, 15000));
        console.log("✅ تم النشر بنجاح!");
        return true;
    } catch (err) {
        console.error("❌ فشل الرفع:", err.message);
        return false;
    } finally {
        await browser.close();
    }
}

// --- المحرك الرئيسي ---
(async () => {
    let history = fs.existsSync(CONFIG.dbFile) ? JSON.parse(fs.readFileSync(CONFIG.dbFile)) : {};
    const availableVideos = await fetchNewVideos();

    for (const acc of MY_ACCOUNTS) {
        console.log(`\n🚀 العمل على حساب: ${acc.name}`);
        if (!history[acc.name]) history[acc.name] = [];

        // اختيار فيديو واحد لم يتم نشره مسبقاً لهذا الحساب
        const video = availableVideos.find(v => !history[acc.name].includes(v.id));

        if (video) {
            console.log(`🎯 فيديو مستهدف: ${video.title}`);
            
            // تنظيف الملفات
            if (fs.existsSync(CONFIG.tempVideo)) fs.unlinkSync(CONFIG.tempVideo);
            if (fs.existsSync(CONFIG.outputVideo)) fs.unlinkSync(CONFIG.outputVideo);

            try {
                // تحميل ومعالجة بصمة الفيديو بـ FFmpeg
                execSync(`yt-dlp --no-check-certificates --user-agent "${CONFIG.userAgent}" -o "${CONFIG.tempVideo}" "https://www.tiktok.com/@any/video/${video.id}"`, {stdio: 'inherit'});
                execSync(`ffmpeg -i ${CONFIG.tempVideo} -vf "scale=iw*1.01:ih*1.01,crop=iw/1.01:ih/1.01,eq=brightness=0.03:contrast=1.02" -map_metadata -1 -c:v libx264 -crf 23 -y ${CONFIG.outputVideo}`, {stdio: 'ignore'});

                const success = await uploadAndPost(CONFIG.outputVideo, `${video.title}${CONFIG.fixedText}`, acc.cookies);

                if (success) {
                    history[acc.name].push(video.id);
                    fs.writeFileSync(CONFIG.dbFile, JSON.stringify(history, null, 2));
                }
            } catch (e) { console.error(`⚠️ خطأ تقني: ${e.message}`); }
        } else {
            console.log(`👋 لا يوجد محتوى جديد لهذا الحساب حالياً.`);
        }
    }
})();
