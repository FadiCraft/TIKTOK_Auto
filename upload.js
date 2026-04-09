const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const axios = require('axios');

puppeteer.use(StealthPlugin());

// دالة لتحميل الفيديو من الرابط المباشر
async function downloadVideo(url, path) {
    const writer = fs.createWriteStream(path);
    const response = await axios({ url, method: 'GET', responseType: 'stream' });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

// الدالة الرئيسية
async function run() {
    // رابط فيديو تجريبي خفيف جداً
    const videoUrl = 'https://www.w3schools.com/html/mov_bbb.mp4'; 
    const videoPath = './video.mp4';
    const caption = 'تجربة نشر تلقائي عبر GitHub Actions 🔥 #automation #test';

    console.log('1. جاري تحميل الفيديو التجريبي...');
    await downloadVideo(videoUrl, videoPath);
    console.log('تم تحميل الفيديو.');

    console.log('2. جاري تشغيل المتصفح...');
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const page = await browser.newPage();
    
    // محاكاة متصفح ويندوز (مهم جداً لتجنب الحظر)
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // قراءة الكوكيز من جيت هاب
    if (!process.env.TIKTOK_COOKIES) {
        throw new Error("لم يتم العثور على الكوكيز! تأكد من إضافتها في Settings > Secrets.");
    }
    const cookies = JSON.parse(process.env.TIKTOK_COOKIES);
    await page.setCookie(...cookies);

    console.log('3. جاري الدخول لصفحة الرفع...');
    await page.goto('https://www.tiktok.com/upload?lang=en', { waitUntil: 'networkidle2', timeout: 60000 });

    console.log('4. جاري اختيار الفيديو للرفع...');
    const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 30000 });
    await fileInput.uploadFile(videoPath);

    console.log('5. جاري كتابة الوصف (Caption)...');
    await page.waitForSelector('.public-DraftEditor-content', { timeout: 30000 });
    await page.click('.public-DraftEditor-content');
    await page.keyboard.type(caption);

    console.log('6. جاري معالجة الفيديو والانتظار حتى يتفعل زر النشر...');
    // السكريبت رح ينتظر هون لحد ما تيك توك يخلص معالجة ويصير زر البوست متاح
    await page.waitForXPath("//button[contains(., 'Post') and not(@disabled)]", { timeout: 120000 });
    const [postButton] = await page.$x("//button[contains(., 'Post') and not(@disabled)]");
    
    console.log('7. جاري الضغط على زر النشر...');
    await postButton.click();

    // انتظار 5 ثواني لضمان إرسال الطلب قبل إغلاق المتصفح
    await new Promise(r => setTimeout(r, 5000)); 

    console.log('✅ تم النشر بنجاح!');
    await browser.close();
}

run().catch(error => {
    console.error('❌ حدث خطأ:', error);
    process.exit(1);
});
