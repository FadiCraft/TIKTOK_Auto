const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { PuppeteerScreenRecorder } = require('puppeteer-screen-recorder');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const MOVIES_SITE = 'https://topcinemaa.cam/movies/';
const CONFIG = {
    fixedText: " | شاهد الفيلم كامل الرابط في البايو 🔗🍿",
    outputVideo: 'tiktok_ready.mp4',
    rawCapture: 'raw_capture.mp4',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    fontPath: '/tmp/Cairo-Bold.ttf'
};

function downloadArabicFont() {
    if (!fs.existsSync(CONFIG.fontPath)) {
        console.log("📥 جاري تحميل الخط العربي...");
        try {
            const { execSync } = require('child_process');
            execSync(`curl -L -s "https://github.com/google/fonts/raw/main/ofl/cairo/Cairo%5Bwght%5D.ttf" -o ${CONFIG.fontPath}`);
            console.log("✅ تم تحميل الخط.");
        } catch (e) {
            CONFIG.fontPath = '/usr/share/fonts/truetype/kacst/KacstBook.ttf';
        }
    }
}

async function startScreenCapture() {
    downloadArabicFont();

    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--window-size=1080,1920',
            '--disable-web-security',
            '--allow-running-insecure-content',
            '--disable-blink-features=AutomationControlled'
        ]
    });
    
    const page = await browser.newPage();
    
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await page.setUserAgent(CONFIG.userAgent);
    await page.setViewport({ width: 1080, height: 1920 });

    const recorder = new PuppeteerScreenRecorder(page, {
        followNewTab: true,
        fps: 25,
        videoFrame: { width: 1080, height: 1920 }
    });
    
    console.log(`🎥 بدء تسجيل الفيديو الشامل...`);
    await recorder.start(CONFIG.rawCapture);

    try {
        console.log(`🔎 1. فتح الموقع لالتقاط الفيلم...`);
        await page.goto(MOVIES_SITE, { waitUntil: 'networkidle2', timeout: 60000 });

        const movies = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('.Small--Box a.recent--block'));
            return items.map(item => ({
                title: item.getAttribute('title') ? item.getAttribute('title').replace('مترجم اون لاين', '').trim() : 'فيلم مشوق',
                url: item.getAttribute('href')
            }));
        });

        if (movies.length === 0) throw new Error("لم يتم العثور على أفلام.");
        const randomMovie = movies[Math.floor(Math.random() * movies.length)];
        console.log(`🎬 الفيلم المختار: ${randomMovie.title}`);
        
        console.log(`🚀 2. الانتقال المباشر لصفحة العرض الافتراضية...`);
        await page.goto(randomMovie.url, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));

        // 🟢 [تحديث عبقري تكتيكي]: استخراج رابط السيرفر المباشر رغماً عن الواجهة المعلقة
        console.log(`📡 3. جاري سحب رابط البث المباشر (Embed Server)...`);
        const targetEmbed = await page.evaluate(() => {
            // البحث عن أول سيرفر متاح للبث داخل أزرار الموقع أو داخل iframe مدمج
            const iframe = document.querySelector('.watch-container iframe, #player-embed iframe, iframe');
            if(iframe) return iframe.src;
            
            const serverBtn = document.querySelector('.servers-list li, .server-item, [data-url]');
            if(serverBtn) return serverBtn.getAttribute('data-url') || serverBtn.getAttribute('href');
            
            return null;
        });

        if (targetEmbed && targetEmbed.startsWith('http')) {
            console.log(`🔗 تم العثور على سيرفر البث المباشر: ${targetEmbed}`);
            console.log(`🔀 الانتقال الفوري لصفحة السيرفر لتفادي حظر الموقع الحاضن...`);
            await page.goto(targetEmbed, { waitUntil: 'networkidle2', timeout: 60000 });
        } else {
            console.log(`⚠️ لم يتم استخراج سيرفر فرعي مخصص، سنستمر في نفس الصفحة كخيار احتياطي.`);
        }

        console.log("⏳ انتظار 10 ثوانٍ لبدء تلقيم مشغل الفيديو وتخطي شاشات التحميل...");
        await new Promise(r => setTimeout(r, 10000));

        console.log(`🖱️ 4. إرسال نقرة تشغيل حية في منتصف المشغل الافتراضي...`);
        await page.mouse.move(540, 960);
        await page.mouse.down();
        await page.mouse.up();

        console.log("⏳ جاري تسجيل البث المباشر الآن لمدة 35 ثانية كاملة أمام الكاميرا...");
        await new Promise(r => setTimeout(r, 35000));

        await recorder.stop();
        await browser.close();

        console.log(`🎨 5. دمج النصوص والعناوين فوق الفيديو الملتَقط...`);
        const { execSync } = require('child_process');
        const filterCmd = `ffmpeg -i ${CONFIG.rawCapture} -vf "drawtext=fontfile=${CONFIG.fontPath}:text='${randomMovie.title}':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=250,drawtext=fontfile=${CONFIG.fontPath}:text='${CONFIG.fixedText}':fontcolor=yellow:fontsize=32:x=(w-text_w)/2:y=1650" -c:v libx264 -crf 23 -y ${CONFIG.outputVideo}`;
        
        execSync(filterCmd, { env: process.env, stdio: 'inherit' });
        if (fs.existsSync(CONFIG.rawCapture)) fs.unlinkSync(CONFIG.rawCapture);

        console.log(`🚀 تم التغلب على الحجب وتصدير الفيديو بنجاح: ${CONFIG.outputVideo}`);
        return true;

    } catch (e) {
        console.error(`❌ فشلت العملية:`, e.message);
        try { await recorder.stop(); } catch(err){}
        await browser.close();
        return false;
    }
}

(async () => {
    await startScreenCapture();
})();
