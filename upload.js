const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const axios = require('axios');

puppeteer.use(StealthPlugin());

async function downloadVideo(url, path) {
    const writer = fs.createWriteStream(path);
    const response = await axios({ url, method: 'GET', responseType: 'stream' });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

async function run() {
    const videoUrl = 'https://www.w3schools.com/html/mov_bbb.mp4'; 
    const videoPath = './video.mp4';
    const caption = 'Automated Upload Success! 🚀 #KiroZozo'; 

    console.log('1. تحميل الفيديو...');
    await downloadVideo(videoUrl, videoPath);

    console.log('2. تشغيل المتصفح...');
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage', 
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

    console.log('3. تحميل الكوكيز...');
    const cookies = JSON.parse(process.env.TIKTOK_COOKIES);
    await page.setCookie(...cookies);

    try {
        console.log('4. التوجه لصفحة الرفع...');
        await page.goto('https://www.tiktok.com/upload?lang=ar', { waitUntil: 'networkidle2', timeout: 90000 });

        console.log('5. اختيار ملف الفيديو...');
        const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 30000 });
        await fileInput.uploadFile(videoPath);

        console.log('6. كتابة الوصف...');
        await page.waitForSelector('.public-DraftEditor-content', { timeout: 60000 });
        await page.click('.public-DraftEditor-content');
        await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(caption);

        console.log('7. انتظار تفعيل زر النشر الأصلي...');
        const postBtnSelector = 'button[data-e2e="post_video_button"]';
        await page.waitForFunction((sel) => {
            const btn = document.querySelector(sel);
            return btn && btn.getAttribute('data-disabled') === 'false';
        }, { timeout: 180000 }, postBtnSelector);

        console.log('8. الضغط على زر النشر...');
        await page.click(postBtnSelector);

        // --- نظام تجاوز النافذة المنبثقة (النشر الآن) ---
        console.log('9. فحص ظهور نافذة تأكيد إضافية...');
        try {
            // ننتظر 10 ثواني لظهور النافذة
            await new Promise(r => setTimeout(r, 7000)); 
            
            // البحث عن زر "النشر الآن" باستخدام النص الظاهر في الصورة
            const postNowClicked = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const targetBtn = buttons.find(b => b.innerText.includes('النشر الآن') || b.innerText.includes('Post now'));
                if (targetBtn) {
                    targetBtn.click();
                    return true;
                }
                return false;
            });

            if (postNowClicked) {
                console.log('⚠️ تم اكتشاف النافذة والضغط على "النشر الآن" بنجاح.');
            } else {
                console.log('✅ لم تظهر نوافذ منبثقة، يبدو أن النشر مباشر.');
            }
        } catch (e) {
            console.log('ℹ️ تخطي فحص النافذة.');
        }
        // ----------------------------------------------

        console.log('10. انتظار 20 ثانية للتأكد من انتهاء الطلب...');
        await new Promise(r => setTimeout(r, 20000)); 
        
        await page.screenshot({ path: 'final-result.png', fullPage: true });
        console.log('📸 تم حفظ الصورة النهائية للتحقق.');
        console.log('✅ العملية انتهت.');

    } catch (error) {
        console.error('❌ حدث خطأ، جاري تصوير الشاشة...');
        await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
        throw error;
    } finally {
        await browser.close();
    }
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
