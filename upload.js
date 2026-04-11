const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const SOURCES = [
    'https://www.tiktok.com/@dramawaveapp',
    'https://www.tiktok.com/@dramaboxshorts'
];

const MY_ACCOUNTS = [
    { name: "Acc 1", cookies: process.env.TIKTOK_COOKIES },
    { name: "Acc 2", cookies: process.env.TIKTOK_COOKIES2 }
].filter(acc => acc.cookies);

const CONFIG = {
    videosPerAccount: 1, 
    fixedText: " | شاهد الحلقة كاملة الرابط في البايو 🔗🍿",
    dbFile: 'history.json',
    tempVideo: 'input.mp4',
    outputVideo: 'output.mp4',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
};

async function fetchNewVideos() {
    let allFound = [];
    for (const source of SOURCES) {
        console.log(`🔎 سحب محتوى من: ${source}`);
        try {
            const cmd = `yt-dlp --no-check-certificates --user-agent "${CONFIG.userAgent}" --flat-playlist --print "%(id)s|%(title)s" --playlist-items 1-30 "${source}"`;
            const output = execSync(cmd, { encoding: 'utf-8' });
            output.trim().split('\n').forEach(line => {
                const [id, title] = line.split('|');
                if (id && title) allFound.push({ id, title: title.trim() });
            });
        } catch (e) { console.error(`❌ فشل السحب من ${source}`); }
    }
    return allFound;
}

async function uploadAndPost(videoPath, finalCaption, cookiesStr, accName) {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.userAgent);

    try {
        await page.setCookie(...JSON.parse(cookiesStr));
        await page.goto('https://www.tiktok.com/upload?lang=ar', { waitUntil: 'networkidle2', timeout: 120000 });

        console.log(`📤 جاري رفع الفيديو لحساب ${accName}...`);
        const fileInput = await page.waitForSelector('input[type="file"]');
        await fileInput.uploadFile(videoPath);

        // --- تحسين كتابة العنوان ---
        console.log(`✍️ كتابة الوصف: ${finalCaption}`);
        await page.waitForSelector('.public-DraftEditor-content');
        await page.click('.public-DraftEditor-content');
        
        // مسح أي نص افتراضي وكتابة العنوان الجديد
        await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(finalCaption, { delay: 50 }); // إضافة تأخير بسيط لضمان الكتابة الصحيحة

        const postBtn = 'button[data-e2e="post_video_button"]';
        await page.waitForFunction(sel => {
            const btn = document.querySelector(sel);
            return btn && btn.getAttribute('data-disabled') === 'false';
        }, {timeout: 240000}, postBtn);

        await page.click(postBtn);
        
        // --- تجاوز نافذة "النشر الآن" المزعجة ---
        console.log("🔍 فحص نافذة تأكيد النشر...");
        await new Promise(r => setTimeout(r, 6000)); 
        
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const confirmBtn = buttons.find(btn => 
                btn.innerText.includes('النشر الآن') || 
                btn.innerText.includes('Post now') ||
                btn.innerText.includes('تجاهل')
            );
            if (confirmBtn) confirmBtn.click();
        });

        await new Promise(r => setTimeout(r, 15000));
        await page.screenshot({ path: `final-${accName}-${Date.now()}.png` });
        
        console.log(`✅ تم النشر بنجاح على ${accName}!`);
        return true;
    } catch (err) {
        console.error(`❌ فشل الرفع لحساب ${accName}:`, err.message);
        return false;
    } finally {
        await browser.close();
    }
}

(async () => {
    let history = fs.existsSync(CONFIG.dbFile) ? JSON.parse(fs.readFileSync(CONFIG.dbFile)) : {};
    const availableVideos = await fetchNewVideos();

    for (let i = 0; i < MY_ACCOUNTS.length; i++) {
        const acc = MY_ACCOUNTS[i];
        console.log(`\n🚀 معالجة حساب: ${acc.name}`);
        if (!history[acc.name]) history[acc.name] = [];

        const unpostedVideos = availableVideos.filter(v => !history[acc.name].includes(v.id));
        const video = unpostedVideos[0]; // سننشر نفس الفيديو على الحسابين لضمان التزامن

        if (video) {
            console.log(`🎯 الفيديو المختار: ${video.title}`);
            
            if (fs.existsSync(CONFIG.tempVideo)) fs.unlinkSync(CONFIG.tempVideo);
            if (fs.existsSync(CONFIG.outputVideo)) fs.unlinkSync(CONFIG.outputVideo);

            try {
                // التحميل بجودة أصلية
                execSync(`yt-dlp --no-check-certificates --user-agent "${CONFIG.userAgent}" -o "${CONFIG.tempVideo}" "https://www.tiktok.com/@any/video/${video.id}"`, {stdio: 'inherit'});
                
                // نسخة طبق الأصل بدون أي تغيير في الشكل (فقط تنظيف Metadata وتوافق الحجم)
                console.log("⚙️ معالجة الفيديو للحفاظ على الحالة الأصلية...");
                execSync(`ffmpeg -i ${CONFIG.tempVideo} -map_metadata -1 -c:v libx264 -crf 20 -c:a copy -y ${CONFIG.outputVideo}`, {stdio: 'ignore'});

                const fullCaption = `${video.title}${CONFIG.fixedText}`;
                const success = await uploadAndPost(CONFIG.outputVideo, fullCaption, acc.cookies, acc.name);

                if (success) {
                    history[acc.name].push(video.id);
                    fs.writeFileSync(CONFIG.dbFile, JSON.stringify(history, null, 2));
                }
            } catch (e) { console.error(`⚠️ خطأ: ${e.message}`); }
            
            await new Promise(r => setTimeout(r, 20000));
        }
    }
})();
