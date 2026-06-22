const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { exec } = require('child_process'); // تم استخدام exec غير الحاصر ليعمل الفيدو بالتوازي
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
    const currentDisplay = process.env.DISPLAY || ':99';
    console.log(`🖥️ الشاشة الافتراضية المعتمدة: ${currentDisplay}`);

    // 🎥 🔴 [تحديث جوهري]: تشغيل الـ FFmpeg فوراً في الخلفية لتصوير كل شيء من البداية
    console.log(`🎥 🔴 جاري بدء تسجيل الشاشة الشامل لتوثيق العملية بالكامل من أول ثانية...`);
    const recordCmd = `ffmpeg -f x11grab -video_size 1080x1920 -i ${currentDisplay} -t 75 -c:v libx264 -pix_fmt yuv420p -y ${CONFIG.rawCapture}`;
    
    // تشغيل التسجيل كـ Background Process حتى لا يعطل بقية كود الـ Puppeteer
    const ffmpegProcess = exec(recordCmd, { env: process.env });
    ffmpegProcess.stdout.on('data', (data) => {}); 
    ffmpegProcess.stderr.on('data', (data) => {});

    // انتظار ثانيتين للتأكد من أن الـ FFmpeg بدأ التسجيل فعلياً
    await new Promise(r => setTimeout(r, 2000));

    const browser = await puppeteer.launch({
        headless: false, 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--window-size=1080,1920',
            '--start-fullscreen',
            '--autoplay-policy=no-user-gesture-required',
            '--disable-web-security',
            '--allow-running-insecure-content',
            '--disable-blink-features=AutomationControlled' // لتخطي حجب الحماية وسيرفرات الفيديو
        ]
    });
    
    const page = await browser.newPage();
    
    // إخفاء الـ WebDriver لئلا تكتشفنا السيرفرات وتظهر رسالة Video Error
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await page.setUserAgent(CONFIG.userAgent);
    await page.setViewport({ width: 1080, height: 1920 });

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

        console.log("⏳ انتهاء تحميل الصفحة، جاري الانتظار والتفاعل لتخطي الـ Block وسرقة النقرة...");
        await new Promise(r => setTimeout(r, 12000));

        // محاكاة حركة الماوس الحرة والنقر لتشغيل الفيديو
        console.log(`🖱️ 3. جاري إرسال نقرة ماوس في منتصف المشغل...`);
        await page.mouse.move(540, 960);
        await page.mouse.down();
        await page.mouse.up();

        console.log("⏳ جاري ترك الفيديو يشتغل الآن أمام الكاميرا لمدة 40 ثانية كاملة لتوثيقه...");
        await new Promise(r => setTimeout(r, 40000));

        console.log(`🛑 تم الانتهاء من فترة المشاهدة الافتراضية بنجاح.`);
        await browser.close();

        // الانتظار قليلاً للتأكد من قيام FFmpeg بإغلاق وكتابة الملف بشكل سليم
        await new Promise(r => setTimeout(r, 5000));

        console.log(`🎨 5. جاري معالجة الفيديو النهائي وإضافة العناوين...`);
        const { execSync } = require('child_process');
        const filterCmd = `ffmpeg -i ${CONFIG.rawCapture} -vf "eq=brightness=0.02:contrast=1.03,drawtext=fontfile=${CONFIG.fontPath}:text='${randomMovie.title}':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=250,drawtext=fontfile=${CONFIG.fontPath}:text='${CONFIG.fixedText}':fontcolor=yellow:fontsize=32:x=(w-text_w)/2:y=1650" -c:v libx264 -crf 23 -y ${CONFIG.outputVideo}`;
        
        execSync(filterCmd, { env: process.env, stdio: 'inherit' });
        
        if (fs.existsSync(CONFIG.rawCapture)) fs.unlinkSync(CONFIG.rawCapture);

        console.log(`🚀 تم إنتاج الفيديو التوثيقي الشامل بنجاح: ${CONFIG.outputVideo}`);
        return true;

    } catch (e) {
        console.error(`❌ خطأ أثناء تشغيل وتصوير الفيديو:`, e.message);
        await browser.close();
        return false;
    }
}

(async () => {
    await startScreenCapture();
})();
