const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const MOVIES_SITE = 'https://topcinemaa.cam/movies/';
const CONFIG = {
    fixedText: " | شاهد الفيلم كامل الرابط في البايو 🔗🍿",
    outputVideo: 'tiktok_ready.mp4',
    rawCapture: 'raw_capture.mp4',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    fontPath: '/tmp/Cairo-Bold.ttf'
};

function downloadArabicFont() {
    if (!fs.existsSync(CONFIG.fontPath)) {
        console.log("📥 جاري تحميل الخط العربي لضمان وضوح النصوص...");
        try {
            execSync(`curl -L -s "https://github.com/google/fonts/raw/main/ofl/cairo/Cairo%5Bwght%5D.ttf" -o ${CONFIG.fontPath}`);
            console.log("✅ تم تحميل الخط بنجاح.");
        } catch (e) {
            console.log("⚠️ فشل تحميل خط Cairo، سيتم استخدام الخط البديل.");
            CONFIG.fontPath = '/usr/share/fonts/truetype/kacst/KacstBook.ttf';
        }
    }
}

async function startScreenCapture() {
    downloadArabicFont();
    const currentDisplay = process.env.DISPLAY || ':99';
    console.log(`🖥️ الشاشة الافتراضية المعتمدة: ${currentDisplay}`);

    const browser = await puppeteer.launch({
        headless: false, 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--window-size=1080,1920',
            '--start-fullscreen',
            '--autoplay-policy=no-user-gesture-required'
        ]
    });
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.userAgent);
    await page.setViewport({ width: 1080, height: 1920 });

    try {
        console.log(`🔎 1. جاري فتح صفحة الأفلام الرئيسية لاختيار فيلم...`);
        await page.goto(MOVIES_SITE, { waitUntil: 'networkidle2', timeout: 60000 });

        const movies = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('.Small--Box a.recent--block'));
            return items.map(item => ({
                title: item.getAttribute('title') ? item.getAttribute('title').replace('مترجم اون لاين', '').trim() : 'فيلم مشوق',
                url: item.getAttribute('href')
            }));
        });

        const randomMovie = movies[Math.floor(Math.random() * movies.length)];
        
        // 🔴 تطبيق فكرتك العبقرية: بناء رابط التضمين والشاشة الكاملة مباشرة
        const embedUrl = randomMovie.url.endsWith('/') ? `${randomMovie.url}?embedScreen=true` : `${randomMovie.url}/?embedScreen=true`;
        
        console.log(`🎬 الفيلم المختار: ${randomMovie.title}`);
        console.log(`🚀 2. جاري الانتقال مباشرة إلى رابط التضمين السحري: ${embedUrl}`);

        await page.goto(embedUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // انتظر 10 ثوانٍ ليتأكد البوت من تحميل مشغل التضمين النظيف بالكامل
        await new Promise(r => setTimeout(r, 10000));

        // محاكاة نقرة بشرية في منتصف الشاشة لتخطي زر Play البدائي وتفعيل الصوت تلقائياً
        console.log(`鼠标 3. إرسال نقرة تشغيل لبدء البث السينمائي الفعلي...`);
        await page.mouse.click(540, 960); 

        // انتظار ثوانٍ معدودة للتأكد من انطلاق العرض واختفاء أيقونة التشغيل
        await new Promise(r => setTimeout(r, 4000));

        console.log(`🎥 🔴 4. جاري تسجيل الشاشة الافتراضية الآن صوت وصورة (لمدة 60 ثانية)...`);
        const recordCmd = `ffmpeg -f x11grab -video_size 1080x1920 -i ${currentDisplay} -f pulse -i default -t 60 -c:v libx264 -pix_fmt yuv420p -y ${CONFIG.rawCapture}`;
        
        execSync(recordCmd, { env: process.env, stdio: 'inherit' });
        
        console.log(`🛑 تم الانتهاء من رصد وتسجيل المقطع بنجاح.`);
        await browser.close();

        // مرحلة المعالجة اللونية الاحترافية وطباعة النصوص بخط Cairo العربي بدون مربعات
        console.log(`🎨 5. جاري فلترة ألوان الفيديو وطباعة العنوان التسويقي...`);
        const filterCmd = `ffmpeg -i ${CONFIG.rawCapture} -vf "setpts=0.95*PTS,eq=brightness=0.03:contrast=1.05,drawtext=fontfile=${CONFIG.fontPath}:text='${randomMovie.title}':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=250,drawtext=fontfile=${CONFIG.fontPath}:text='${CONFIG.fixedText}':fontcolor=yellow:fontsize=32:x=(w-text_w)/2:y=1650" -c:v libx264 -crf 23 -c:a aac -af "atempo=1.05" -y ${CONFIG.outputVideo}`;
        
        execSync(filterCmd, { env: process.env, stdio: 'inherit' });
        
        if (fs.existsSync(CONFIG.rawCapture)) fs.unlinkSync(CONFIG.rawCapture);

        console.log(`🚀 مبارك! تم إنتاج مقطع التيك توك النهائي بنجاح خارق: ${CONFIG.outputVideo}`);
        return true;

    } catch (e) {
        console.error(`❌ حدث خطأ أثناء تطبيق الحل الذكي:`, e.message);
        try { await page.screenshot({ path: 'embed_error.png' }); } catch(err){}
        await browser.close();
        return false;
    }
}

(async () => {
    await startScreenCapture();
})();
