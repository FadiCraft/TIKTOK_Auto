const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const axios = require('axios');
const { execSync } = require('child_process');
const { google } = require('googleapis');

puppeteer.use(StealthPlugin());

// =============== إعداداتك الثابتة ===============
const CONFIG = {
    // حسابات تيك توك التي تريد النشر عليها
    tiktokAccounts: [
        { name: "حسابي الأول", cookies: null }, // سيتم قراءة الكوكيز من المتغيرات البيئية
        { name: "حسابي الثاني", cookies: null }
    ],
    
    // حساب المصدر (اللي هنسحب منه الفيديو)
    sourceTiktok: 'https://www.tiktok.com/@dramaboli1',
    
    // العنوان الثابت
    fixedCaption: 'للمشاهده الحلقه كامله الرابط في البايو 🎬✨',
    
    // ملف لحفظ تاريخ الفيديوهات المنشورة
    dbFile: 'published_history.json',
    
    // إعدادات يوتيوب (لن تستخدمها الآن لكن نتركها احتياطاً)
    youtube: {
        clientId: "",
        clientSecret: "",
        refreshToken: ""
    }
};

// =============== أدوات مساعدة ===============
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function downloadVideo(url, path) {
    const writer = fs.createWriteStream(path);
    const response = await axios({ url, method: 'GET', responseType: 'stream' });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

// =============== 1. استخراج فيديو جديد من حساب المصدر ===============
async function fetchNewVideoFromSource() {
    let history = fs.existsSync(CONFIG.dbFile) ? JSON.parse(fs.readFileSync(CONFIG.dbFile)) : [];
    
    console.log(`🔍 فحص حساب المصدر: ${CONFIG.sourceTiktok}`);
    
    try {
        // جلب قائمة المعرفات (IDs) للفيديوهات
        const idsRaw = execSync(`yt-dlp --impersonate chrome --flat-playlist --get-id "${CONFIG.sourceTiktok}"`, { encoding: 'utf-8' });
        let allIds = idsRaw.trim().split('\n').filter(id => id.trim().length > 0);

        if (allIds.length === 0) {
            console.log("❌ لم يتم العثور على فيديوهات في الحساب المصدر.");
            return null;
        }

        // نعكس الترتيب عشان نبدأ من الأقدم للأحدث
        allIds.reverse();
        const newId = allIds.find(id => !history.includes(id));

        if (!newId) {
            console.log("✅ لا توجد فيديوهات جديدة. كل شيء منشور مسبقاً.");
            return null;
        }

        console.log(`🎯 فيديو جديد مستهدف: ${newId}`);
        
        // تحميل الفيديو باستخدام yt-dlp
        console.log("📥 جاري تحميل الفيديو...");
        execSync(`yt-dlp --impersonate chrome -f "bestvideo[height<=1080]+bestaudio/best" -o "source_video.mp4" "https://www.tiktok.com/@any/video/${newId}"`);
        
        // معالجة بسيطة بالفيديو لتغيير الهوية (تجنب الحظر)
        console.log("🎨 معالجة الفيديو (تغيير بصمة بسيطة)...");
        execSync(`ffmpeg -i source_video.mp4 -vf "scale=iw*1.01:ih*1.01,crop=iw/1.01:ih/1.01,eq=brightness=0.02:contrast=1.02" -map_metadata -1 -c:v libx264 -crf 22 -c:a aac -y ready_video.mp4`);
        
        // حفظ التاريخ
        history.push(newId);
        fs.writeFileSync(CONFIG.dbFile, JSON.stringify(history, null, 2));
        
        return 'ready_video.mp4';
        
    } catch (err) {
        console.error(`⚠️ خطأ في جلب الفيديو: ${err.message}`);
        return null;
    }
}

// =============== 2. النشر على حساب تيك توك مع الكوكيز ===============
async function publishToTikTok(videoPath, caption, accountName) {
    console.log(`\n🚀 بدء النشر على حساب: ${accountName}`);
    
    // استيراد الكوكيز الخاصة بهذا الحساب من المتغيرات البيئية
    const cookiesEnvName = `TIKTOK_COOKIES_${accountName.replace(/\s/g, '_')}`;
    const cookiesJson = process.env[cookiesEnvName];
    
    if (!cookiesJson) {
        console.error(`❌ لم يتم العثور على كوكيز للحساب ${accountName}. متغير: ${cookiesEnvName}`);
        return false;
    }
    
    let cookies;
    try {
        cookies = JSON.parse(cookiesJson);
    } catch(e) {
        console.error(`❌ خطأ في قراءة كوكيز ${accountName}`);
        return false;
    }
    
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled']
    });
    
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');
        
        // تحميل الكوكيز
        await page.setCookie(...cookies);
        
        console.log("📍 التوجه لصفحة الرفع...");
        await page.goto('https://www.tiktok.com/upload?lang=ar', { waitUntil: 'networkidle2', timeout: 90000 });
        
        // رفع الفيديو
        console.log("📂 رفع الملف...");
        const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 30000 });
        await fileInput.uploadFile(videoPath);
        
        // كتابة الوصف الثابت
        console.log("✏️ كتابة الوصف...");
        await page.waitForSelector('.public-DraftEditor-content', { timeout: 60000 });
        await page.click('.public-DraftEditor-content');
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(caption);
        
        // انتظار تفعيل زر النشر
        const postBtnSelector = 'button[data-e2e="post_video_button"]';
        await page.waitForFunction((sel) => {
            const btn = document.querySelector(sel);
            return btn && btn.getAttribute('data-disabled') === 'false';
        }, { timeout: 180000 }, postBtnSelector);
        
        console.log("📤 الضغط على زر النشر...");
        await page.click(postBtnSelector);
        
        // التعامل مع نافذة التأكيد إن وجدت
        await delay(7000);
        const confirmed = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const confirmBtn = buttons.find(b => b.innerText.includes('النشر الآن') || b.innerText.includes('Post now'));
            if (confirmBtn) { confirmBtn.click(); return true; }
            return false;
        });
        
        if (confirmed) console.log("✅ تم تأكيد النشر عبر النافذة المنبثقة.");
        
        await delay(15000); // انتظار رفع الفيديو
        await page.screenshot({ path: `${accountName}_success.png`, fullPage: true });
        console.log(`✅ تم النشر بنجاح على حساب ${accountName}`);
        return true;
        
    } catch (error) {
        console.error(`❌ فشل النشر على ${accountName}:`, error.message);
        if (page) await page.screenshot({ path: `${accountName}_error.png`, fullPage: true });
        return false;
    } finally {
        await browser.close();
    }
}

// =============== 3. التشغيل الرئيسي ===============
async function main() {
    console.log("=".repeat(50));
    console.log("🔄 بدء البوت المتكامل (سحب + نشر على حسابين)");
    console.log("=".repeat(50));
    
    // الخطوة 1: سحب فيديو جديد من المصدر
    const videoFile = await fetchNewVideoFromSource();
    if (!videoFile) {
        console.log("🚫 لا يوجد محتوى جديد. إنهاء العملية.");
        return;
    }
    
    // الخطوة 2: النشر على كل حساب تيك توك
    const accounts = [
        { name: "حسابي_الاول", cookiesVar: "TIKTOK_COOKIES_ACCOUNT1" },
        { name: "حسابي_الثاني", cookiesVar: "TIKTOK_COOKIES_ACCOUNT2" }
    ];
    
    for (const acc of accounts) {
        // تأكد من وجود الكوكيز في البيئة
        if (!process.env[acc.cookiesVar]) {
            console.warn(`⚠️ تخطي حساب ${acc.name}: لم يتم تعيين متغير ${acc.cookiesVar}`);
            continue;
        }
        
        await publishToTikTok(videoFile, CONFIG.fixedCaption, acc.name);
        await delay(30000); // انتظار 30 ثانية بين الحسابات لتجنب الحظر
    }
    
    // تنظيف الملفات المؤقتة
    console.log("🧹 حذف الملفات المؤقتة...");
    if (fs.existsSync('source_video.mp4')) fs.unlinkSync('source_video.mp4');
    if (fs.existsSync('ready_video.mp4')) fs.unlinkSync('ready_video.mp4');
    
    console.log("🏁 العملية انتهت بنجاح!");
}

// =============== التشغيل ===============
main().catch(err => {
    console.error("💥 خطأ فادح:", err);
    process.exit(1);
});
