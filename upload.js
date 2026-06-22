const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const MOVIES_SITE = 'https://topcinemaa.cam/movies/';
const CONFIG = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
};

async function diagnosticRun() {
    console.log("🛠️ بدء تشغيل سكريبت التشخيص وتصوير المراحل خطوة بخطوة...");
    
    const browser = await puppeteer.launch({
        headless: false, 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--window-size=1080,1920',
            '--autoplay-policy=no-user-gesture-required'
        ]
    });
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.userAgent);
    await page.setViewport({ width: 1080, height: 1920 });

    try {
        // المرحلة 1: فتح الموقع الرئيسي
        console.log(`🔎 1. جاري فتح صفحة الأفلام الرئيسية...`);
        await page.goto(MOVIES_SITE, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.screenshot({ path: 'step1_main_site.png' });
        console.log("📸 تم حفظ صورة المرحلة 1: الصفحة الرئيسية.");

        // كشط واختيار فيلم
        const movies = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('.Small--Box a.recent--block'));
            return items.map(item => ({
                title: item.getAttribute('title') ? item.getAttribute('title').replace('مترجم اون لاين', '').trim() : 'فيلم مشوق',
                url: item.getAttribute('href')
            }));
        });

        if (movies.length === 0) throw new Error("لم يتم العثور على أفلام.");
        const randomMovie = movies[Math.floor(Math.random() * movies.length)];
        const watchUrl = randomMovie.url.endsWith('/') ? `${randomMovie.url}watch/` : `${randomMovie.url}/watch/`;
        
        console.log(`🎬 الفيلم المختار: ${randomMovie.title}`);
        
        // المرحلة 2: فتح صفحة المشاهدة قبل الضغط على السيرفر
        console.log(`🔗 2. جاري فتح صفحة المشاهدة...`);
        await page.goto(watchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.screenshot({ path: 'step2_watch_page.png' });
        console.log("📸 تم حفظ صورة المرحلة 2: صفحة المشاهدة قبل السيرفر.");

        // المرحلة 3: اختيار السيرفر والضغط عليه
        console.log(`🔄 3. جاري اختيار والضغط على سيرفر البث...`);
        await page.evaluate(() => {
            const servers = Array.from(document.querySelectorAll('.watch--servers--list ul li'));
            const target = servers.find(s => s.innerText.includes('StreamWish') || s.innerText.includes('متعدد')) || servers[0];
            if (target) target.click();
        });
        
        // انتظار 10 ثوانٍ لتحميل السيرفر
        await new Promise(r => setTimeout(r, 10000));
        await page.screenshot({ path: 'step3_after_server_click.png' });
        console.log("📸 تم حفظ صورة المرحلة 3: بعد الضغط على السيرفر.");

        // المرحلة 4: محاولة تكبير المشغل بالـ CSS
        console.log(`🧹 4. جاري تجربة تكبير حجم المشغل بالـ CSS...`);
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
        
        await new Promise(r => setTimeout(r, 3000));
        await page.screenshot({ path: 'step4_after_css_resize.png' });
        console.log("📸 تم حفظ صورة المرحلة 4: بعد التكبير بالـ CSS.");

        // المرحلة 5: محاكاة الضغط للتشغيل
        console.log(`🖱️ 5. جاري إرسال نقرة في منتصف الشاشة...`);
        await page.mouse.click(540, 960);
        
        await new Promise(r => setTimeout(r, 5000));
        await page.screenshot({ path: 'step5_final_state.png' });
        console.log("📸 تم حفظ صورة المرحلة 5: الحالة النهائية للمشغل.");

        console.log("\n🚀 انتهت عملية التشخيص وحفظ الصور بنجاح كامل.");
        
    } catch (e) {
        console.error(`❌ حدث خطأ أثناء التشخيص:`, e.message);
        await page.screenshot({ path: 'diagnostic_error.png' });
    } finally {
        await browser.close();
    }
}

diagnosticRun();
