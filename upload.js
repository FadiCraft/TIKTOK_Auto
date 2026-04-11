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
    { name: "Acc 2", cookies: process.env.TIKTOK_COOKIES2 },
    { name: "Acc 3", cookies: process.env.TIKTOK_COOKIES3 }
].filter(acc => acc.cookies);

const CONFIG = {
    videosPerAccount: 20,
    fixedText: " | شاهد الحلقة كاملة الرابط في البايو 🔗🍿",
    dbFile: 'history.json',
    tempVideo: 'input.mp4',
    outputVideo: 'output.mp4',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
};

async function fetchNewVideos() {
    let allFound = [];
    for (const source of SOURCES) {
        console.log(`🔎 سحب فيديوهات من المصدر: ${source}`);
        try {
            const cmd = `yt-dlp --no-check-certificates --user-agent "${CONFIG.userAgent}" --flat-playlist --print "%(id)s|%(title)s" --playlist-items 1-60 "${source}"`;
            const output = execSync(cmd, { encoding: 'utf-8' });
            output.trim().split('\n').forEach(line => {
                const [id, title] = line.split('|');
                if (id && title) allFound.push({ id, title });
            });
        } catch (e) { console.error(`❌ فشل السحب من ${source}`); }
    }
    return allFound;
}

async function uploadAndSchedule(videoPath, finalCaption, cookiesStr) {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.userAgent);

    try {
        await page.setCookie(...JSON.parse(cookiesStr));
        await page.goto('https://www.tiktok.com/upload?lang=ar', { waitUntil: 'networkidle2', timeout: 120000 });

        console.log(`📤 رفع الفيديو...`);
        const fileInput = await page.waitForSelector('input[type="file"]');
        await fileInput.uploadFile(videoPath);

        // كتابة العنوان
        await page.waitForSelector('.public-DraftEditor-content');
        await page.click('.public-DraftEditor-content');
        await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(finalCaption);

        // --- تفعيل الجدولة بناءً على كود الـ HTML الذي أرسلته ---
        console.log("⏳ تفعيل وضع الجدولة...");
        await page.evaluate(() => {
            const radio = document.querySelector('input[value="schedule"]');
            if (radio) radio.click();
        });
        
        await new Promise(r => setTimeout(r, 5000));

        const postBtn = 'button[data-e2e="post_video_button"]';
        await page.waitForFunction(sel => {
            const btn = document.querySelector(sel);
            return btn && btn.getAttribute('data-disabled') === 'false';
        }, {timeout: 180000}, postBtn);

        await page.click(postBtn);
        await new Promise(r => setTimeout(r, 12000));
        console.log("✅ تمت الجدولة بنجاح.");
        return true;
    } catch (err) {
        console.error("❌ فشل في الرفع:", err.message);
        return false;
    } finally {
        await browser.close();
    }
}

(async () => {
    let history = fs.existsSync(CONFIG.dbFile) ? JSON.parse(fs.readFileSync(CONFIG.dbFile)) : {};
    const availableVideos = await fetchNewVideos();

    for (const acc of MY_ACCOUNTS) {
        console.log(`\n🚀 معالجة حساب: ${acc.name}`);
        if (!history[acc.name]) history[acc.name] = [];

        const toUpload = availableVideos.filter(v => !history[acc.name].includes(v.id)).slice(0, CONFIG.videosPerAccount);

        for (let i = 0; i < toUpload.length; i++) {
            const video = toUpload[i];
            console.log(`🎬 فيديو ${i+1}/${toUpload.length}: ${video.title}`);

            if (fs.existsSync(CONFIG.tempVideo)) fs.unlinkSync(CONFIG.tempVideo);
            if (fs.existsSync(CONFIG.outputVideo)) fs.unlinkSync(CONFIG.outputVideo);

            try {
                execSync(`yt-dlp --no-check-certificates --user-agent "${CONFIG.userAgent}" -o "${CONFIG.tempVideo}" "https://www.tiktok.com/@any/video/${video.id}"`, {stdio: 'inherit'});
                execSync(`ffmpeg -i ${CONFIG.tempVideo} -vf "scale=iw*1.01:ih*1.01,crop=iw/1.01:ih/1.01,eq=brightness=0.03" -map_metadata -1 -c:v libx264 -y ${CONFIG.outputVideo}`, {stdio: 'ignore'});

                const success = await uploadAndSchedule(CONFIG.outputVideo, `${video.title}${CONFIG.fixedText}`, acc.cookies);

                if (success) {
                    history[acc.name].push(video.id);
                    fs.writeFileSync(CONFIG.dbFile, JSON.stringify(history, null, 2));
                }
            } catch (e) { console.error(`⚠️ تخطي بسبب خطأ: ${e.message}`); }
            
            await new Promise(r => setTimeout(r, 20000));
        }
    }
})();
