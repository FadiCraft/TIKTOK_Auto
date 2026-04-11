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
    { name: "Acc1", cookies: process.env.TIKTOK_COOKIES },
    { name: "Acc2", cookies: process.env.TIKTOK_COOKIES2 }
].filter(acc => acc.cookies);

const CONFIG = {
    fixedText: " | شاهد الحلقة كاملة الرابط في البايو 🔗🍿",
    dbFile: 'history.json',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
};

async function fetchNewVideos() {
    let allFound = [];
    for (const source of SOURCES) {
        console.log(`🔎 سحب محتوى من: ${source}`);
        try {
            const cmd = `yt-dlp --no-check-certificates --user-agent "${CONFIG.userAgent}" --flat-playlist --print "%(id)s|%(title)s" --playlist-items 1-40 "${source}"`;
            const output = execSync(cmd, { encoding: 'utf-8' });
            output.trim().split('\n').forEach(line => {
                const [id, title] = line.split('|');
                if (id && title) allFound.push({ id, title: title.trim() });
            });
        } catch (e) { console.error(`❌ فشل السحب`); }
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

        console.log(`📤 رفع لـ ${accName}...`);
        const fileInput = await page.waitForSelector('input[type="file"]');
        await fileInput.uploadFile(videoPath);

        await page.waitForSelector('.public-DraftEditor-content', { visible: true, timeout: 60000 });
        await new Promise(r => setTimeout(r, 7000));
        
        console.log(`✍️ كتابة الوصف...`);
        await page.click('.public-DraftEditor-content');
        
        await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await new Promise(r => setTimeout(r, 1000));

        await page.evaluate((text) => {
            document.execCommand('insertText', false, text);
        }, finalCaption);
        
        await new Promise(r => setTimeout(r, 3000));

        const postBtn = 'button[data-e2e="post_video_button"]';
        await page.waitForFunction(sel => {
            const btn = document.querySelector(sel);
            return btn && btn.getAttribute('data-disabled') === 'false';
        }, {timeout: 240000}, postBtn);

        await page.click(postBtn);

        for (let i = 0; i < 3; i++) {
            await new Promise(r => setTimeout(r, 6000));
            await page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button'));
                const target = btns.find(b => {
                    const txt = b.innerText;
                    return (txt.includes('النشر الآن') || txt.includes('تجاهل') || txt.includes('Post now') || txt.includes('Ignore')) 
                           && !txt.includes('إلغاء') && !txt.includes('Cancel');
                });
                if (target) target.click();
            });
        }

        await new Promise(r => setTimeout(r, 10000));
        return true;
    } catch (err) {
        console.error(`❌ خطأ رفع:`, err.message);
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
        if (!history[acc.name]) history[acc.name] = [];

        const unposted = availableVideos.filter(v => !history[acc.name].includes(v.id));
        const video = unposted[i] || unposted[0]; 

        if (video) {
            console.log(`\n🎬 الحساب: ${acc.name} -> يستهدف: ${video.title}`);
            const tempFileName = `temp_${acc.name}.mp4`;
            const finalFile = `final_${acc.name}.mp4`;

            try {
                // استخدام علامات التنصيص حول أسماء الملفات في الأوامر
                execSync(`yt-dlp --no-check-certificates -o "${tempFileName}" "https://www.tiktok.com/@any/video/${video.id}"`, {stdio: 'inherit'});
                
                console.log("⚙️ معالجة نهائية للملف...");
                execSync(`ffmpeg -i "${tempFileName}" -c copy -map_metadata -1 -y "${finalFile}"`, {stdio: 'ignore'});

                const success = await uploadAndPost(finalFile, `${video.title}${CONFIG.fixedText}`, acc.cookies, acc.name);

                if (success) {
                    history[acc.name].push(video.id);
                    fs.writeFileSync(CONFIG.dbFile, JSON.stringify(history, null, 2));
                }
                
                if (fs.existsSync(tempFileName)) fs.unlinkSync(tempFileName);
                if (fs.existsSync(finalFile)) fs.unlinkSync(finalFile);

            } catch (e) { console.error(`⚠️ خطأ في المعالجة: ${e.message}`); }
        }
    }
})();
