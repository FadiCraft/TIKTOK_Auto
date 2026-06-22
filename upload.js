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
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
};

async function startScreenCapture() {
    const browser = await puppeteer.launch({
        headless: false, // يجب أن يكون false داخل xvfb
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

        console.log(`🔄 جاري تشغيل المشغل والتحضير للتسجيل...`);
        await page.evaluate(() => {
            const servers = Array.from(document.querySelectorAll('.watch--servers--list ul li'));
            const target = servers.find(s => s.innerText.includes('StreamWish') || s.innerText.includes('متعدد')) || servers[0];
            if (target) target.click();
        });

        // انتظار تحميل وتشغيل المشغل
        await new Promise(r => setTimeout(r, 12000));

        // تنظيف الصفحة وتكبير المشغل عمودياً بمقاسات الهاتف
        await page.evaluate(() => {
            const player = document.querySelector('.watch-player-box, #video_player, iframe');
            if (player) {
                document.body.innerHTML = '';
                document.body.appendChild(player);
                player.style.width = '1080px';
                player.style.height = '1920px';
                player.style.position = 'fixed';
                player.style.top = '0';
                player.style.left = '0';
                player.style.zIndex = '99999';
            }
        });

        await new Promise(r => setTimeout(r, 3000));
        console.log(`🎥 🔴 جاري تسجيل الشاشة الافتراضية (لمدة 60 ثانية)...`);

        // أمر الـ FFmpeg محدث ليلتزم ببيئة خادم الشاشة الشغالة حالياً بشكل متزامن
        const recordCmd = `ffmpeg -f x11grab -video_size 1080x1920 -i :0.0 -f pulse -i default -t 60 -c:v libx264 -pix_fmt yuv420p -y ${CONFIG.rawCapture}`;
        
        // تشغيل الأمر مع تمرير البيئة الحالية لـ Linux
        execSync(recordCmd, { env: process.env, stdio: 'inherit' });
        
        console.log(`🛑 تم الانتهاء من تسجيل المقطع الخام بنجاح.`);
        await browser.close();

        // مرحلة المعالجة والفلترة وإضافة النصوص والخطوط
        console.log(`🎨 جاري معالجة الفيديو النهائي وإضافة النصوص الترويجية الخارقة...`);
        const filterCmd = `ffmpeg -i ${CONFIG.rawCapture} -vf "setpts=0.95*PTS,eq=brightness=0.03:contrast=1.05,drawtext=fontfile=/usr/share/fonts/truetype/kacst/KacstBook.ttf:text='${randomMovie.title}':fontcolor=white:fontsize=45:x=(w-text_w)/2:y=250,drawtext=fontfile=/usr/share/fonts/truetype/kacst/KacstBook.ttf:text='${CONFIG.fixedText}':fontcolor=yellow:fontsize=35:x=(w-text_w)/2:y=1650" -c:v libx264 -crf 23 -c:a aac -af "atempo=1.05" -y ${CONFIG.outputVideo}`;
        
        execSync(filterCmd, { env: process.env, stdio: 'inherit' });
        
        if (fs.existsSync(CONFIG.rawCapture)) fs.unlinkSync(CONFIG.rawCapture);

        console.log(`🚀 رائع! تم إنتاج الفيديو النهائي بنجاح تام: ${CONFIG.outputVideo}`);
        return true;

    } catch (e) {
        console.error(`❌ فشل أثناء محاولة التصوير أو المعالجة:`, e.message);
        try { await page.screenshot({ path: 'failed-screen.png' }); } catch(err){}
        await browser.close();
        return false;
    }
}

(async () => {
    await startScreenCapture();
})();
