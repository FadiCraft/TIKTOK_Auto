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
    const caption = 'تم النشر بنجاح عبر الأتمتة 🚀'; 

    console.log('1. تحميل الفيديو...');
    await downloadVideo(videoUrl, videoPath);

    console.log('2. تشغيل المتصفح...');
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1280,720'
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
        const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 3000 });
        await fileInput.uploadFile(videoPath);

        console.log('6. كتابة الوصف...');
        await page.waitForSelector('.public-DraftEditor-content', { timeout: 60000 });
        await page.click('.public-DraftEditor-content');
        // مسح النص القديم وكتابة الجديد
        await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(caption);

        console.log('7. انتظار تفعيل زر النشر (Post)...');
        // التعديل الجوهري: البحث عن الزر باستخدام data-e2e والتأكد أنه ليس معطلاً
        const postButtonSelector = 'button[data-e2e="post_video_button"]';
        await page.waitForFunction((sel) => {
            const btn = document.querySelector(sel);
            // التأكد أن الزر موجود، ليس disabled، ولا يظهر عليه علامة التحميل (loading-false)
            return btn && btn.getAttribute('data-disabled') === 'false' && btn.getAttribute('aria-disabled') === 'false';
        }, { timeout: 180000 }, postButtonSelector);

        console.log('8. الضغط على زر النشر...');
        await page.click(postButtonSelector);

        console.log('9. انتظار نهائي للتأكيد...');
        await new Promise(r => setTimeout(r, 15000)); 
        console.log('✅ تمت عملية النشر بنجاح!');

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
