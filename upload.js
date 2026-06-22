const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { exec, execSync } = require('child_process');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const MOVIES_SITE = 'https://topcinemaa.cam/movies/';
const CONFIG = {
    fixedText: " | شاهد الفيلم كامل الرابط في البايو ",
    outputVideo: 'tiktok_ready.mp4',
    rawCapture: 'raw_capture.mp4',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
};

async function startScreenCapture() {
    const currentDisplay = process.env.DISPLAY || ':0.0';
    console.log(`🖥️ الشاشة الافتراضية المعتمدة: ${currentDisplay}`);

    // 🔴 [تحديث مهم] بدء تسجيل الشاشة فوراً في الخلفية لتسجيل كل المراحل (الفتح، الكليك، التكبير)
    console.log(`🎥 🔴 بدأنا تسجيل الشاشة الإجمالي لرصد حركات البوت كاملة...`);
    const recordCmd = `ffmpeg -f x11grab -video_size 1080x1920 -i ${currentDisplay} -f pulse -i default -t 90 -c:v libx264 -pix_fmt yuv420p -y ${CONFIG.rawCapture}`;
    const recordingProcess = exec(recordCmd, { env: process.env });

    // انتظر ثانيتين ليتأكد الـ FFmpeg من بدء التسجيل
    await new Promise(r => setTimeout(r, 2000));

    const browser = await puppeteer.launch({
        headless: false, 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--window-size=1080,1920',
            '--start-fullscreen',
            '--autoplay-policy=no-user-gesture-required',
            // خيارات إضافية لإجبار المتصفح على دعم تشغيل ملفات الفيديو المحمية (DRM/HTML5) في جيت هاب
            '--disable-web-security',
            '--allow-running-insecure-content',
            '--use-gl=swiftshader'
        ]
    });
    const page = await browser.newPage();
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

        const randomMovie = movies[Math.floor(Math.random() * movies.length)];
        const watchUrl = randomMovie.url.endsWith('/') ? `${randomMovie.url}watch/` : `${randomMovie.url}/watch/`;
        
        console.log(`🎬 2. الفيلم المختار: ${randomMovie.title}`);
        await page.goto(watchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        console.log(`🔄 3. جاري اختيار سيرفر البث وانتظار تحميل المشغل الأصلي...`);
        await page.evaluate(() => {
            const servers = Array.from(document.querySelectorAll('.watch--servers--list ul li'));
            const target = servers.find(s => s.innerText.includes('StreamWish') || s.innerText.includes('متعدد')) || servers[0];
            if (target) target.click();
        });

        // سننتظر 15 ثانية والمشغل بوضعه الطبيعي الصغير لنرى في الفيديو إن كان يشتغل أم لا
        await new Promise(r => setTimeout(r, 15000));

        console.log(`🧹 4. جاري تجربة التكبير بالـ CSS الآن...`);
        await page.evaluate(() => {
            const player = document.querySelector('.watch-player-box, #video_player, iframe');
            if (player) {
                player.style.setProperty('position', 'fixed', 'important');
                player.style.setProperty('top', '0', 'important');
                player.style.setProperty('left', '0', 'important');
                player.style.setProperty('width', '1080px', 'important');
                player.style.setProperty('height', '1920px', 'important');
                player.style.setProperty('z-index', '999999', 'important');
            }
        });

        await new Promise(r => setTimeout(r, 5000));

        console.log(`鼠标 5. جاري الضغط في المنتصف لتجاوز أزرار التشغيل الوهمية...`);
        await page.mouse.click(540, 960); 

        // الانتظار حتى اكتمال الـ 90 ثانية الخاصة بالتسجيل الإجمالي للـ FFmpeg
        console.log(`⏳ جاري استكمال التسجيل الفيديوي لرصد النتيجة الثابتة...`);
        await new Promise(r => setTimeout(r, 45000));

        console.log(`🛑 تم الانتهاء من فترة الرصد بالكامل.`);
        await browser.close();

        // نسخ الفيديو الخام مباشرة كفيديو نهائي لنستطيع تحميله ومعاينته من الـ Artifacts ورؤية المشكلة بعيننا
        if (fs.existsSync(CONFIG.rawCapture)) {
            fs.copyFileSync(CONFIG.rawCapture, CONFIG.outputVideo);
            fs.unlinkSync(CONFIG.rawCapture);
            console.log(`🚀 تم حفظ فيديو المراقبة بنجاح باسم: ${CONFIG.outputVideo}`);
        }
        return true;

    } catch (e) {
        console.error(`❌ حدث خطأ غير متوقع:`, e.message);
        await browser.close();
        if (fs.existsSync(CONFIG.rawCapture)) fs.copyFileSync(CONFIG.rawCapture, CONFIG.outputVideo);
        return false;
    }
}

(async () => {
    await startScreenCapture();
})();
