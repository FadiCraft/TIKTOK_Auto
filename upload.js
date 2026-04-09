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
    const caption = 'تم النشر تلقائياً بنجاح! 🚀'; 

    console.log('1. تحميل الفيديو...');
    await downloadVideo(videoUrl, videoPath);

    console.log('2. تشغيل المتصفح...');
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
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

        console.log('7. انتظار معالجة الفيديو وتفعيل زر النشر...');
        // الاعتماد على الكود الذي أرسلته أنت (data-e2e)
        const postBtnSelector = 'button[data-e2e="post_video_button"]';
        
        await page.waitForFunction((sel) => {
            const btn = document.querySelector(sel);
            // التأكد أن الزر موجود وأن تيك توك فعلّه (data-disabled="false")
            return btn && btn.getAttribute('data-disabled') === 'false';
        }, { timeout: 180000 }, postBtnSelector);

      console.log('8. الضغط على زر النشر (نشر)...');
        await page.click(postBtnSelector);

        console.log('9. الانتظار للتأكد من نجاح العملية على الشاشة...');
        // ننتظر ظهور كلمة "Manage your posts" أو "View profile" اللي بتظهر بعد النشر
        try {
            await page.waitForFunction(() => {
                return document.body.innerText.includes('Manage your posts') || 
                       document.body.innerText.includes('Your video is being uploaded') ||
                       document.body.innerText.includes('View profile');
            }, { timeout: 30000 });
            console.log('✅ ظهرت رسالة تأكيد النشر على الواجهة!');
        } catch (e) {
            console.log('⚠️ لم تظهر رسالة التأكيد، لكن قد يكون النشر قيد المعالجة.');
        }

        // لقطة شاشة أخيرة "بعد" النشر عشان تتأكد شو صار
        await page.screenshot({ path: 'after-post.png', fullPage: true });

        console.log('10. انتظار نهائي لضمان استقرار الطلب...');
        await new Promise(r => setTimeout(r, 20000)); // زدنا الوقت لـ 20 ثانية
        console.log('🚀 انتهت العملية بالكامل.');

    } catch (error) {
        // ... (كود الـ catch القديم)
