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

// تم إزالة الحساب الثالث والإبقاء على حسابين فقط
const MY_ACCOUNTS = [
    { name: "Acc 1", cookies: process.env.TIKTOK_COOKIES },
    { name: "Acc 2", cookies: process.env.TIKTOK_COOKIES2 }
].filter(acc => acc.cookies);

const CONFIG = {
    videosPerAccount: 1, // فيديو واحد لكل حساب كل ساعة
    fixedText: " | شاهد الحلقة كاملة الرابط في البايو 🔗🍿",
    dbFile: 'history.json',
    tempVideo: 'input.mp4',
    outputVideo: 'output.mp4',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
};

// 1. جلب الفيديوهات الجديدة من المصادر
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

// 2. عملية الرفع عبر المتصفح
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

        // كتابة العنوان الأصلي + النص الترويجي
        await page.waitForSelector('.public-DraftEditor-content');
        await page.click('.public-DraftEditor-content');
        await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(finalCaption);

        // التأكد من اختيار "النشر الآن"
        await page.evaluate(() => {
            const nowRadio = document.querySelector('input[value="post_now"]');
            if (nowRadio) nowRadio.click();
        });

        // انتظار تفعيل زر النشر
        const postBtn = 'button[data-e2e="post_video_button"]';
        await page.waitForFunction(sel => {
            const btn = document.querySelector(sel);
            return btn && btn.getAttribute('data-disabled') === 'false';
        }, {timeout: 240000}, postBtn);

        await page.click(postBtn);
        
        // --- كود جديد: تجاوز نافذة "هل تريد المتابعة للنشر؟" ---
        console.log("🔍 فحص وجود نافذة تأكيد النشر...");
        await new Promise(r => setTimeout(r, 4000)); // ننتظر 4 ثوانٍ لتظهر النافذة
        
        await page.evaluate(() => {
            // نبحث عن كل الأزرار، ونضغط على الزر الذي يحتوي على نص "النشر الآن"
            const buttons = Array.from(document.querySelectorAll('button'));
            const confirmBtn = buttons.find(btn => btn.innerText.includes('النشر الآن') || btn.innerText.includes('Post now'));
            if (confirmBtn) {
                confirmBtn.click();
            }
        });
        // --------------------------------------------------------

        // انتظار اكتمال عملية النشر النهائية
        await new Promise(r => setTimeout(r, 15000));
        await page.screenshot({ path: `success-${accName}-${Date.now()}.png` });
        
        console.log(`✅ تم النشر بنجاح على ${accName}!`);
        return true;
    } catch (err) {
        console.error(`❌ فشل الرفع لحساب ${accName}:`, err.message);
        await page.screenshot({ path: `error-${accName}-${Date.now()}.png` });
        return false;
    } finally {
        await browser.close();
    }
}

// --- المحرك الرئيسي ---
(async () => {
    let history = fs.existsSync(CONFIG.dbFile) ? JSON.parse(fs.readFileSync(CONFIG.dbFile)) : {};
    const availableVideos = await fetchNewVideos();

    for (let i = 0; i < MY_ACCOUNTS.length; i++) {
        const acc = MY_ACCOUNTS[i];
        console.log(`\n🚀 العمل على حساب: ${acc.name}`);
        if (!history[acc.name]) history[acc.name] = [];

        // فلترة الفيديوهات التي لم تنشر بعد
        const unpostedVideos = availableVideos.filter(v => !history[acc.name].includes(v.id));
        
        // اختيار فيديو مختلف لكل حساب (الحساب الأول يأخذ الأول، والثاني يأخذ الثاني)
        const video = unpostedVideos[i] || unpostedVideos[0];

        if (video) {
            console.log(`🎯 فيديو مستهدف: ${video.title}`);
            
            // تنظيف الملفات القديمة
            if (fs.existsSync(CONFIG.tempVideo)) fs.unlinkSync(CONFIG.tempVideo);
            if (fs.existsSync(CONFIG.outputVideo)) fs.unlinkSync(CONFIG.outputVideo);

            try {
                // التحميل
                execSync(`yt-dlp --no-check-certificates --user-agent "${CONFIG.userAgent}" -o "${CONFIG.tempVideo}" "https://www.tiktok.com/@any/video/${video.id}"`, {stdio: 'inherit'});
                
                // تعديل البصمة عبر FFmpeg (قلب الصورة، تغيير السرعة 1.05x، تحسين الألوان) لتخطي حقوق الطبع والنشر
                console.log("🎨 جاري تعديل بصمة الفيديو...");
                execSync(`ffmpeg -i ${CONFIG.tempVideo} -vf "hflip,setpts=0.95*PTS,scale=iw*1.02:ih*1.02,crop=iw/1.02:ih/1.02,eq=brightness=0.03:contrast=1.05" -map_metadata -1 -c:v libx264 -crf 22 -af "atempo=1.05" -y ${CONFIG.outputVideo}`, {stdio: 'ignore'});

                const finalCaption = `${video.title}${CONFIG.fixedText}`;
                const success = await uploadAndPost(CONFIG.outputVideo, finalCaption, acc.cookies, acc.name);

                if (success) {
                    history[acc.name].push(video.id);
                    fs.writeFileSync(CONFIG.dbFile, JSON.stringify(history, null, 2));
                }
            } catch (e) { console.error(`⚠️ خطأ تقني: ${e.message}`); }
            
            // انتظار بين الحسابين لتجنب الضغط على السيرفر
            if (i < MY_ACCOUNTS.length - 1) {
                console.log("⏳ انتظار 30 ثانية قبل الانتقال للحساب الثاني...");
                await new Promise(r => setTimeout(r, 30000));
            }
        } else {
            console.log(`👋 لا يوجد محتوى جديد لحساب ${acc.name} حالياً.`);
        }
    }
})();
