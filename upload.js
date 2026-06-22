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
            console.log("⚠️ فشل تحميل خط Cairo.");
            CONFIG.fontPath = '/usr/share/fonts/truetype/kacst/KacstBook.ttf';
        }
    }
}

async function startScreenCapture() {
    downloadArabicFont();
    const currentDisplay = process.env.DISPLAY || ':0.0';
    console.log(`🖥️ الشاشة الافتراضية المعتمدة: ${currentDisplay}`);

    const browser = await puppeteer.launch({
        headless: false, 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--window-size=1080,1920',
            '--start-fullscreen',
            '--autoplay-policy=no-user-gesture-required',
            // كرت شاشة وهمي قوي لمنع الشاشة السوداء في المواقع المعتمدة على الـ WebGL أو حمايات الفيديو
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--disable-gpu-program-cache'
        ]
    });
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.userAgent);
    await page.setViewport({ width: 1080, height: 1920 });

    try {
        console.log(`🔎 جاري فتح صفحة الأفلام الرئيسية...`);
        await page.goto(MOVIES_SITE, { waitUntil: 'networkidle2', timeout: 60000 });

        const movies = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('.Small--Box a.recent--block'));
            return items.map(item => ({
                title: item.getAttribute('title') ? item.getAttribute('title').replace('مترجم اون لاين', '').trim() : 'فيلم مشوق',
                url: item.getAttribute('href')
            }));
        });

        const randomMovie = movies[Math.floor(Math.random() * movies.length)];
        const watchUrl = randomMovie.url.endsWith('/') ? `${randomMovie.url}watch/` : `${randomMovie.url}/watch/`;
        
        console.log(`🎬 الفيلم المختار: ${randomMovie.title}`);
        console.log(`🔗 رابط صفحة المشاهدة: ${watchUrl}`);

        await page.goto(watchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        console.log(`🔄 جاري اختيار سيرفر البث المتاح...`);
        await page.evaluate(() => {
            const servers = Array.from(document.querySelectorAll('.watch--servers--list ul li'));
            const target = servers.find(s => s.innerText.includes('StreamWish') || s.innerText.includes('متعدد')) || servers[0];
            if (target) target.click();
        });

        // انتظار كافٍ لتحميل عناصر وإعلانات المشغل في الخلفية بدون مشاكل
        await new Promise(r => setTimeout(r, 15000));

        // بدلاً من حذف الصفحة، نقوم بجعل المشغل يغطي كل شيء بالـ CSS ليبقى شغالاً ومحمياً
        console.log(`🧹 جاري تكبير المشغل على كامل أبعاد الشاشة تيك توك...`);
        await page.evaluate(() => {
            const player = document.querySelector('.watch-player-box, #video_player, iframe');
            if (player) {
                player.style.setProperty('position', 'fixed', 'important');
                player.style.setProperty('top', '0', 'important');
                player.style.setProperty('left', '0', 'important');
                player.style.setProperty('width', '1080px', 'important');
                player.style.setProperty('height', '1920px', 'important');
                player.style.setProperty('z-index', '999999', 'important');
                player.style.setProperty('background', 'black', 'important');
            }
        });

        await new Promise(r => setTimeout(r, 5000));

        // محاكاة ضغطة بشرية لتشغيل المقطع الفعلي
        console.log(`🖱️ جاري إرسال نقرة تشغيل للمشغل...`);
        await page.mouse.click(540, 960); 

        // انتظر 7 ثوانٍ لنتأكد أن الإعلان اختفى وبدأ البث الفعلي
        await new Promise(r => setTimeout(r, 7000));

        console.log(`🎥 🔴 جاري تسجيل الشاشة الآن (لمدة 60 ثانية)...`);
        const recordCmd = `ffmpeg -f x11grab -video_size 1080x1920 -i ${currentDisplay} -f pulse -i default -t 60 -c:v libx264 -pix_fmt yuv420p -y ${CONFIG.rawCapture}`;
        
        execSync(recordCmd, { env: process.env, stdio: 'inherit' });
        
        console.log(`🛑 تم الانتهاء من التسجيل بنجاح.`);
        await browser.close();

        console.log(`🎨 جاري معالجة وتعديل ألوان الفيديو وطباعة النصوص العربية...`);
        const filterCmd = `ffmpeg -i ${CONFIG.rawCapture} -vf "setpts=0.95*PTS,eq=brightness=0.03:contrast=1.05,drawtext=fontfile=${CONFIG.fontPath}:text='${randomMovie.title}':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=250,drawtext=fontfile=${CONFIG.fontPath}:text='${CONFIG.fixedText}':fontcolor=yellow:fontsize=32:x=(w-text_w)/2:y=1650" -c:v libx264 -crf 23 -c:a aac -af "atempo=1.05" -y ${CONFIG.outputVideo}`;
        
        execSync(filterCmd, { env: process.env, stdio: 'inherit' });
        
        if (fs.existsSync(CONFIG.rawCapture)) fs.unlinkSync(CONFIG.rawCapture);

        console.log(`🚀 تم إنتاج مقطع تيك توك بنجاح وبدون مشاكل سوداء: ${CONFIG.outputVideo}`);
        return true;

    } catch (e) {
        console.error(`❌ حدث خطأ غير متوقع:`, e.message);
        try { await page.screenshot({ path: 'failed-screen.png' }); } catch(err){}
        await browser.close();
        return false;
    }
}

(async () => {
    await startScreenCapture();
})();
