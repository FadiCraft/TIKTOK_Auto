const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const { execSync } = require('child_process');

puppeteer.use(StealthPlugin());

// إعداد مسار Chrome لـ GitHub Actions
if (process.env.CHROME_PATH) {
    process.env.PUPPETEER_EXECUTABLE_PATH = process.env.CHROME_PATH;
} else {
    // محاولة إيجاد Chrome تلقائياً
    const possiblePaths = [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser'
    ];
    for (const path of possiblePaths) {
        if (fs.existsSync(path)) {
            process.env.PUPPETEER_EXECUTABLE_PATH = path;
            break;
        }
    }
}

const CONFIG = {
    fixedCaption: 'للمشاهده الحلقه كامله الرابط في البايو 🎬✨',
    dbFile: 'published_history.json',
    sourceTikTok: 'https://www.tiktok.com/@tonnysweden', // غير هذا لحساب المصدر
    accounts: [
        { name: 'account1', cookiesEnv: 'TIKTOK_COOKIES_ACCOUNT1' },
        { name: 'account2', cookiesEnv: 'TIKTOK_COOKIES_ACCOUNT2' }
    ]
};

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// جلب فيديو جديد من حساب المصدر
async function fetchNewVideo() {
    let history = [];
    if (fs.existsSync(CONFIG.dbFile)) {
        history = JSON.parse(fs.readFileSync(CONFIG.dbFile));
    }
    
    console.log(`🔍 فحص حساب المصدر: ${CONFIG.sourceTikTok}`);
    
    try {
        // جلب قائمة الفيديوهات
        console.log("📋 جلب قائمة الفيديوهات...");
        const idsRaw = execSync(`yt-dlp --impersonate chrome --flat-playlist --get-id "${CONFIG.sourceTikTok}" 2>/dev/null`, { 
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'] // تجاهل الأخطاء
        });
        
        let allIds = idsRaw.trim().split('\n').filter(id => id.trim().length > 0);
        
        if (allIds.length === 0) {
            console.log("❌ لم يتم العثور على فيديوهات");
            return null;
        }
        
        console.log(`📊 تم العثور على ${allIds.length} فيديو في الحساب`);
        
        // ترتيب من الأقدم للأحدث
        allIds.reverse();
        const newId = allIds.find(id => !history.includes(id));
        
        if (!newId) {
            console.log("✅ لا توجد فيديوهات جديدة للنشر");
            return null;
        }
        
        console.log(`🎯 فيديو جديد: ${newId}`);
        
        // تحميل الفيديو
        console.log("📥 تحميل الفيديو...");
        execSync(`yt-dlp --impersonate chrome -f "bestvideo[height<=720]+bestaudio/best" -o "source_video.mp4" "https://www.tiktok.com/@any/video/${newId}" 2>/dev/null`, {
            stdio: 'inherit'
        });
        
        // معالجة الفيديو (تجنب التكرار)
        console.log("🎨 معالجة الفيديو...");
        try {
            execSync(`ffmpeg -i source_video.mp4 -vf "scale=iw*1.01:ih*1.01,crop=iw/1.01:ih/1.01" -map_metadata -1 -c:v libx264 -crf 23 -c:a aac -y ready_video.mp4 2>/dev/null`, {
                stdio: 'inherit'
            });
        } catch (e) {
            console.log("⚠️ فشلت المعالجة، استخدام الفيديو الأصلي");
            execSync(`cp source_video.mp4 ready_video.mp4`);
        }
        
        // حفظ التاريخ
        history.push(newId);
        fs.writeFileSync(CONFIG.dbFile, JSON.stringify(history, null, 2));
        
        return 'ready_video.mp4';
        
    } catch (error) {
        console.error(`❌ خطأ في الجلب: ${error.message}`);
        return null;
    }
}

// النشر على تيك توك
async function publishToTikTok(videoPath, caption, accountName, cookiesJson) {
    console.log(`\n🚀 بدء النشر على: ${accountName}`);
    
    let cookies;
    try {
        cookies = JSON.parse(cookiesJson);
        console.log(`✅ تم تحميل ${cookies.length} كوكيز للحساب ${accountName}`);
    } catch(e) {
        console.error(`❌ خطأ في قراءة الكوكيز للحساب ${accountName}`);
        return false;
    }
    
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1280,720'
        ]
    });
    
    let page = null;
    try {
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');
        
        // تعيين الكوكيز
        await page.setCookie(...cookies);
        
        console.log("📍 التوجه لصفحة الرفع...");
        await page.goto('https://www.tiktok.com/upload?lang=ar', { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });
        
        // انتظار ظهور نموذج الرفع
        await delay(3000);
        
        // رفع الفيديو
        console.log("📂 رفع الفيديو...");
        const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 30000 });
        await fileInput.uploadFile(videoPath);
        
        // انتظار اكتمال الرفع
        console.log("⏳ انتظار رفع الفيديو...");
        await delay(10000);
        
        // كتابة الوصف
        console.log("✏️ كتابة الوصف...");
        try {
            await page.waitForSelector('.public-DraftEditor-content', { timeout: 60000 });
            await page.click('.public-DraftEditor-content');
            await page.keyboard.down('Control');
            await page.keyboard.press('A');
            await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');
            await page.keyboard.type(caption);
        } catch(e) {
            console.log("⚠️ لم يتم العثور على حقل الوصف، قد يكون الواجهة مختلفة");
        }
        
        // الضغط على زر النشر
        const postBtnSelector = 'button[data-e2e="post_video_button"]';
        console.log("📤 البحث عن زر النشر...");
        
        await page.waitForFunction((sel) => {
            const btn = document.querySelector(sel);
            return btn && btn.getAttribute('data-disabled') !== 'true';
        }, { timeout: 120000 }, postBtnSelector);
        
        await page.click(postBtnSelector);
        console.log("✅ تم الضغط على زر النشر");
        
        // التعامل مع نافذة التأكيد
        await delay(5000);
        const confirmed = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const confirmBtn = buttons.find(b => 
                b.innerText.includes('النشر الآن') || 
                b.innerText.includes('Post now') ||
                b.innerText.includes('Publish')
            );
            if (confirmBtn) {
                confirmBtn.click();
                return true;
            }
            return false;
        });
        
        if (confirmed) console.log("✅ تم تأكيد النشر");
        
        await delay(10000);
        
        // التقاط صورة للتأكيد
        await page.screenshot({ path: `${accountName}_success.png`, fullPage: true });
        console.log(`✅ تم النشر بنجاح على ${accountName}`);
        return true;
        
    } catch (error) {
        console.error(`❌ فشل النشر على ${accountName}: ${error.message}`);
        if (page) {
            await page.screenshot({ path: `${accountName}_error.png`, fullPage: true });
        }
        return false;
    } finally {
        await browser.close();
    }
}

// التشغيل الرئيسي
async function main() {
    console.log("=".repeat(50));
    console.log("🔄 TikTok Auto Uploader - BOT");
    console.log("=".repeat(50));
    console.log(`🕐 وقت البدء: ${new Date().toISOString()}`);
    
    // جلب فيديو جديد
    const videoFile = await fetchNewVideo();
    if (!videoFile) {
        console.log("🚫 لا يوجد محتوى جديد للنشر");
        return;
    }
    
    // التحقق من وجود الفيديو
    if (!fs.existsSync(videoFile)) {
        console.error(`❌ الفيديو غير موجود: ${videoFile}`);
        return;
    }
    
    console.log(`✅ تم تجهيز الفيديو: ${videoFile} (${fs.statSync(videoFile).size} bytes)`);
    
    // النشر على كل حساب
    for (const account of CONFIG.accounts) {
        const cookiesValue = process.env[account.cookiesEnv];
        
        if (!cookiesValue) {
            console.warn(`⚠️ تخطي ${account.name}: متغير ${account.cookiesEnv} غير موجود`);
            continue;
        }
        
        const success = await publishToTikTok(videoFile, CONFIG.fixedCaption, account.name, cookiesValue);
        
        if (success) {
            console.log(`🎉 نجح النشر على ${account.name}`);
        } else {
            console.log(`💔 فشل النشر على ${account.name}`);
        }
        
        // انتظار بين الحسابات
        await delay(30000);
    }
    
    // تنظيف الملفات
    console.log("🧹 تنظيف الملفات المؤقتة...");
    const tempFiles = ['source_video.mp4', 'ready_video.mp4'];
    for (const file of tempFiles) {
        if (fs.existsSync(file)) {
            fs.unlinkSync(file);
            console.log(`🗑️ حذف: ${file}`);
        }
    }
    
    console.log("=".repeat(50));
    console.log("🏁 انتهت العملية");
    console.log("=".repeat(50));
}

// تشغيل الكود
main().catch(err => {
    console.error("💥 خطأ فادح:", err);
    process.exit(1);
});
