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
        console.log("📥 جاري تحميل الخط العربي لضمان وضوح النصوص...");
        try {
            const { execSync } = require('child_process');
            execSync(`curl -L -s "https://github.com/google/fonts/raw/main/ofl/cairo/Cairo%5Bwght%5D.ttf" -o ${CONFIG.fontPath}`);
            console.log("✅ تم تحميل الخط بنجاح.");
        } catch (e) {
            console.log("⚠️ فشل تحميل خط Cairo.");
            CONFIG.fontPath = '/usr/share/fonts/truetype/kacst/KacstBook.ttf';
        }
    }
}

async function startScreenCapture() {
    downloadArabicFont();

    // تشغيل المتصفح بإعدادات تتوافق تماماً مع البيئة الوهمية
    const browser = await puppeteer.launch({
        headless: "new", // تم التغيير لـ "new" لضمان استقرار الأداء ومنع انهيار كرت الشاشة الافتراضي
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--window-size=1080,1920',
            '--autoplay-policy=no-user-gesture-required',
            '--disable-web-security',
            '--allow-running-insecure-content',
            '--disable-blink-features=AutomationControlled'
        ]
    });
    
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.userAgent);
    await page.setViewport({ width: 1080, height: 1920 });

    // 🎥 إعداد مسجل الشاشة المدمج لتصوير كافة تفاصيل الأتمتة
    const recorderConfig = {
        followNewTab: true,
        fps: 25,
        ffmpeg_Path: null, // سيقوم تلقائياً باكتشاف FFmpeg المثبت في النظام
        videoFrame: { width: 1080, height: 1920 }
    };
    
    const recorder = new PuppeteerScreenRecorder(page, recorderConfig);
    
    console.log(`🎥 🔴 تم بدء تسجيل الفيديو الشامل للعملية منذ هذه اللحظة...`);
    await recorder.start(CONFIG.rawCapture);

    try {
        console.log(`🔎 1. جاري فتح صفحة الأفلام الرئيسية...`);
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
        
        const embedUrl = randomMovie.url.endsWith('/') ? `${randomMovie.url}?embedScreen=true` : `${randomMovie.url}/?embedScreen=true`;
        console.log(`🎬 الفيلم المختار: ${randomMovie.title}`);
        
        console.log(`🚀 2. جاري الانتقال إلى رابط التضمين والمشاهدة الحية...`);
        await page.goto(embedUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        console.log("⏳ انتهاء تحميل صفحة الفيلم، جاري الانتظار والتفاعل...");
        await new Promise(r => setTimeout(r, 10000));

        console.log(` Baltic 🖱️ 3. جاري إرسال نقرة ماوس لتشغيل المشغل...`);
        await page.mouse.move(540, 960);
        await page.mouse.down();
        await page.mouse.up();

        console.log("⏳ ترك الصفحة تعمل أمام الكاميرا لمدة 30 ثانية لتوثيق التحميل والمشغل...");
        await new Promise(r => setTimeout(r, 30000));

        console.log(`🛑 إيقاف تسجيل الفيديو وإغلاق المتصفح آمنًا...`);
        await recorder.stop();
        await browser.close();

        // معالجة وإضافة النصوص فوق الفيديو الملتقط بنجاح
        console.log(`🎨 5. جاري إضافة العناوين والنصوص على الفيديو النهائي...`);
        const { execSync } = require('child_process');
        const filterCmd = `ffmpeg -i ${CONFIG.rawCapture} -vf "drawtext=fontfile=${CONFIG.fontPath}:text='${randomMovie.title}':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=250,drawtext=fontfile=${CONFIG.fontPath}:text='${CONFIG.fixedText}':fontcolor=yellow:fontsize=32:x=(w-text_w)/2:y=1650" -c:v libx264 -crf 23 -y ${CONFIG.outputVideo}`;
        
        execSync(filterCmd, { env: process.env, stdio: 'inherit' });
        
        if (fs.existsSync(CONFIG.rawCapture)) fs.unlinkSync(CONFIG.rawCapture);

        console.log(`🚀 انتهى العمل بنجاح! تم حفظ الفيديو الشامل في: ${CONFIG.outputVideo}`);
        return true;

    } catch (e) {
        console.error(`❌ حدث خطأ أثناء تشغيل وتصوير الفيديو:`, e.message);
        try { await recorder.stop(); } catch(err){}
        await browser.close();
        return false;
    }
}

(async () => {
    // تأكد من تثبيت الحزمة أولاً عبر إطلاق الأمر: npm install puppeteer-screen-recorder
    await startScreenCapture();
})();
