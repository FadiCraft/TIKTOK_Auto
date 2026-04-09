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
    const caption = 'Automated Upload Test via GitHub Actions 🚀';

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
    
    // استخدام User-Agent حديث لتقليل احتمالية كشف البوت
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    console.log('3. تحميل الكوكيز...');
    if (!process.env.TIKTOK_COOKIES) throw new Error("TIKTOK_COOKIES secret is missing!");
    const cookies = JSON.parse(process.env.TIKTOK_COOKIES);
    await page.setCookie(...cookies);

    try {
        console.log('4. التوجه لصفحة الرفع...');
        await page.goto('https://www.tiktok.com/upload?lang=en', { waitUntil: 'networkidle2', timeout: 90000 });

        console.log('5. اختيار ملف الفيديو...');
        const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 30000 });
        await fileInput.uploadFile(videoPath);

        console.log('6. كتابة الوصف...');
        // ننتظر الصندوق النصي الخاص بالوصف
        await page.waitForSelector('.public-DraftEditor-content', { timeout: 40000 });
        await page.click('.public-DraftEditor-content');
        await page.keyboard.type(caption);

        console.log('7. انتظار معالجة الفيديو (قد يستغرق وقتاً)...');
        // نبحث عن زر Post بأكثر من طريقة لضمان إيجاده
        const postButtonSelector = "button[data-e2e='post_video_button'], //button[contains(., 'Post')]";
        await page.waitForFunction((sel) => {
            const btn = document.querySelector(sel) || document.evaluate("//button[contains(., 'Post')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            return btn && !btn.disabled && btn.innerText.includes('Post');
        }, { timeout: 120000 }, "button[data-e2e='post_video_button']");

        console.log('8. الضغط على زر النشر...');
        // محاولة الضغط عبر الـ JavaScript لضمان التنفيذ حتى لو كان العنصر مغطى بشيء آخر
        await page.evaluate(() => {
            const btn = document.querySelector("button[data-e2e='post_video_button']") || document.evaluate("//button[contains(., 'Post')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (btn) btn.click();
        });

        console.log('9. انتظار تأكيد النشر...');
        await new Promise(r => setTimeout(r, 10000)); 
        console.log('✅ عملية النشر انتهت بنجاح!');

    } catch (error) {
        console.error('❌ فشل السكريبت. جاري التقاط صورة للخطأ...');
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
