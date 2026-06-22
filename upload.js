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

async function diagnosticRun() {
    console.log("🛠️ بدء تشغيل سكريبت التشخيص وتصوير المراحل خطوة بخطوة...");
    
    // تأكد من وجود المجلد لحفظ الصور
    if (!fs.existsSync('./screenshots')) {
        fs.mkdirSync('./screenshots');
    }

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
        // المرحلة 1: فتح الموقع الرئيسي لاختيار فيلم
        console.log(`🔎 1. جاري فتح صفحة الأفلام الرئيسية...`);
        await page.goto(MOVIES_SITE, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.screenshot({ path: './screenshots/step1_main_site.png' });
        console.log("📸 تم حفظ صورة المرحلة 1: الصفحة الرئيسية.");

        // كشط واختيار فيلم عشوائي
        const movies = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('.Small--Box a.recent--block'));
            return items.map(item => ({
                title: item.getAttribute('title') ? item.getAttribute('title').replace('مترجم اون لاين', '').trim() : 'فيلم مشوق',
                url: item.getAttribute('href')
            }));
        });

        if (movies.length === 0) throw new Error("لم يتم العثور على أفلام.");
        const randomMovie = movies[Math.floor(Math.random() * movies.length)];
        
        // بناء رابط التضمين بناءً على اكتشافك
        const embedUrl = randomMovie.url.endsWith('/') ? `${randomMovie.url}?embedScreen=true` : `${randomMovie.url}/?embedScreen=true`;
        
        console.log(`🎬 الفيلم المختار: ${randomMovie.title}`);
        console.log(`🚀 2. جاري الانتقال مباشرة إلى رابط التضمين السحري: ${embedUrl}`);

        // المرحلة 2: فتح رابط التضمين وقبل التشغيل
        console.log(`🔗 2. جاري فتح رابط التضمين...`);
        await page.goto(embedUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.screenshot({ path: './screenshots/step2_embed_url.png' });
        console.log("📸 تم حفظ صورة المرحلة 2: بعد فتح رابط التضمين.");

        // المرحلة 3: انتظار تحميل المشغل بالكامل
        console.log(`⏳ 3. انتظار تحميل المشغل...`);
        await new Promise(r => setTimeout(r, 10000));
        await page.screenshot({ path: './screenshots/step3_after_wait.png' });
        console.log("📸 تم حفظ صورة المرحلة 3: بعد انتظار تحميل المشغل.");

        // المرحلة 4: محاولة الضغط في منتصف الشاشة للتشغيل
        console.log(`🖱️ 4. جاري إرسال نقرة تشغيل للمشغل...`);
        await page.mouse.click(540, 960); 
        await page.screenshot({ path: './screenshots/step4_after_click.png' });
        console.log("📸 تم حفظ صورة المرحلة 4: بعد نقرة التشغيل.");

        // المرحلة 5: الحالة النهائية بعد النقرة
        await new Promise(r => setTimeout(r, 5000));
        await page.screenshot({ path: './screenshots/step5_final_diagnostic.png' });
        console.log("📸 تم حفظ صورة المرحلة 5: الحالة النهائية للمشغل.");

        console.log("\n🚀 انتهت عملية التشخيص وحفظ الصور بنجاح كامل.");
        
    } catch (e) {
        console.error(`❌ حدث خطأ غير متوقع أثناء التشخيص:`, e.message);
        await page.screenshot({ path: './screenshots/diagnostic_error.png' });
    } finally {
        await browser.close();
    }
}

diagnosticRun();
