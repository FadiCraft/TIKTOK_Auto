const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const { execSync } = require('child_process');

puppeteer.use(StealthPlugin());

// =============== تحديد مسار Chrome ===============
const CHROME_PATHS = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
];

for (const chromePath of CHROME_PATHS) {
    if (fs.existsSync(chromePath)) {
        process.env.PUPPETEER_EXECUTABLE_PATH = chromePath;
        console.log(`✅ تم العثور على Chrome: ${chromePath}`);
        break;
    }
}

// =============== الإعدادات ===============
const CONFIG = {
    fixedCaption: 'للمشاهده الحلقه كامله الرابط في البايو 🎬✨',
    dbFile: 'published_history.json',
    sourceTikTok: 'https://www.tiktok.com/@pubity', // غير هذا إلى حساب المصدر
    accounts: [
        { name: 'Account1', cookiesEnv: 'TIKTOK_COOKIES_ACCOUNT1' },
        { name: 'Account2', cookiesEnv: 'TIKTOK_COOKIES_ACCOUNT2' }
    ]
};

// =============== أدوات مساعدة ===============
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// =============== جلب فيديو جديد من حساب المصدر ===============
async function fetchNewVideo() {
    let history = [];
    if (fs.existsSync(CONFIG.dbFile)) {
        try {
            history = JSON.parse(fs.readFileSync(CONFIG.dbFile));
            console.log(`📜 تاريخ الفيديوهات المنشورة: ${history.length} فيديو`);
        } catch(e) {
            console.log("⚠️ ملف التاريخ تالف، سيتم إنشاء ملف جديد");
        }
    }
    
    console.log(`🔍 فحص حساب المصدر: ${CONFIG.sourceTikTok}`);
    
    // قائمة حسابات بديلة إذا فشل الحساب الرئيسي
    const backupAccounts = [
        'https://www.tiktok.com/@viralhog',
        'https://www.tiktok.com/@funnycats',
        'https://www.tiktok.com/@amazing'
    ];
    
    let accountsToTry = [CONFIG.sourceTikTok, ...backupAccounts];
    
    for (const accountUrl of accountsToTry) {
        console.log(`\n📋 محاولة جلب فيديوهات من: ${accountUrl}`);
        
        try {
            // بناء أمر yt-dlp مع دعم الوكيل إذا وجد
            let ytDlpCmd = `yt-dlp --impersonate chrome --flat-playlist --get-id "${accountUrl}" 2>&1`;
            
            if (process.env.PROXY_URL) {
                ytDlpCmd = `yt-dlp --proxy "${process.env.PROXY_URL}" --impersonate chrome --flat-playlist --get-id "${accountUrl}" 2>&1`;
                console.log("🌐 باستخدام وكيل لتجاوز الحظر");
            }
            
            console.log("📡 جاري جلب قائمة الفيديوهات...");
            const idsRaw = execSync(ytDlpCmd, { 
                encoding: 'utf-8',
                timeout: 60000,
                maxBuffer: 50 * 1024 * 1024 // 50MB
            });
            
            // تنظيف الناتج من أخطاء yt-dlp
            let allIds = idsRaw.split('\n')
                .filter(line => line.trim().length > 0)
                .filter(line => !line.includes('ERROR') && !line.includes('WARNING'))
                .filter(line => /^[a-zA-Z0-9_-]+$/.test(line.trim())); // فقط معرفات الفيديو الصحيحة
            
            if (allIds.length === 0) {
                console.log(`⚠️ لم يتم العثور على فيديوهات في ${accountUrl}`);
                continue;
            }
            
            console.log(`✅ تم العثور على ${allIds.length} فيديو في ${accountUrl}`);
            
            // جلب أحدث فيديو (أول عنصر في القائمة)
            const newId = allIds[0];
            
            if (history.includes(newId)) {
                console.log(`📌 الفيديو ${newId} تم نشره مسبقاً، ننتقل للحساب التالي`);
                continue;
            }
            
            console.log(`🎯 فيديو جديد مستهدف: ${newId}`);
            
            // تحميل الفيديو
            console.log("📥 جاري تحميل الفيديو...");
            let downloadCmd = `yt-dlp --impersonate chrome -f "best[height<=720]" -o "source_video.mp4" "https://www.tiktok.com/@any/video/${newId}" 2>&1`;
            
            if (process.env.PROXY_URL) {
                downloadCmd = `yt-dlp --proxy "${process.env.PROXY_URL}" --impersonate chrome -f "best[height<=720]" -o "source_video.mp4" "https://www.tiktok.com/@any/video/${newId}" 2>&1`;
            }
            
            execSync(downloadCmd, {
                stdio: 'inherit',
                timeout: 120000
            });
            
            // التحقق من نجاح التحميل
            if (!fs.existsSync('source_video.mp4') || fs.statSync('source_video.mp4').size < 10000) {
                console.log("❌ فشل تحميل الفيديو أو الملف تالف");
                continue;
            }
            
            console.log(`✅ تم تحميل الفيديو: ${(fs.statSync('source_video.mp4').size / 1024 / 1024).toFixed(2)} MB`);
            
            // معالجة الفيديو (تغيير بسيط لتجنب التكرار)
            console.log("🎨 معالجة الفيديو...");
            try {
                // تغيير بسيط في المقاسات والسطوع
                execSync(`ffmpeg -i source_video.mp4 -vf "scale=iw*0.99:ih*0.99,eq=brightness=0.02" -map_metadata -1 -c:v libx264 -crf 23 -c:a aac -y ready_video.mp4 2>&1`, {
                    stdio: 'inherit',
                    timeout: 60000
                });
            } catch (e) {
                console.log("⚠️ فشلت المعالجة، استخدام الفيديو الأصلي");
                execSync(`cp source_video.mp4 ready_video.mp4`);
            }
            
            // حفظ التاريخ
            history.push(newId);
            fs.writeFileSync(CONFIG.dbFile, JSON.stringify(history, null, 2));
            
            console.log(`✅ تم تجهيز الفيديو بنجاح من ${accountUrl}`);
            return 'ready_video.mp4';
            
        } catch (error) {
            console.log(`❌ فشل في ${accountUrl}: ${error.message}`);
            continue;
        }
    }
    
    console.log("🚫 لم يتم العثور على أي فيديو جديد في جميع الحسابات");
    return null;
}

// =============== النشر على تيك توك ===============
async function publishToTikTok(videoPath, caption, accountName, cookiesJson) {
    console.log(`\n🚀 بدء النشر على حساب: ${accountName}`);
    
    let cookies;
    try {
        cookies = JSON.parse(cookiesJson);
        console.log(`✅ تم تحميل ${cookies.length} كوكيز بنجاح`);
    } catch(e) {
        console.error(`❌ خطأ في قراءة الكوكيز للحساب ${accountName}`);
        console.error(`تأكد من أن الكوكيز بصيغة JSON صحيحة`);
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
        
        // إضافة الكوكيز
        await page.setCookie(...cookies);
        
        console.log("📍 التوجه إلى صفحة الرفع...");
        await page.goto('https://www.tiktok.com/upload', { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });
        
        await delay(5000);
        
        // رفع الفيديو
        console.log("📂 رفع الفيديو...");
        const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 30000 });
        await fileInput.uploadFile(videoPath);
        
        console.log("⏳ انتظار اكتمال الرفع...");
        await delay(15000);
        
        // كتابة الوصف
        console.log("✏️ كتابة الوصف...");
        try {
            // محاولة إيجاد حقل الوصف بعدة طرق
            const captionSelector = '.public-DraftEditor-content, [contenteditable="true"], div[data-text="true"]';
            await page.waitForSelector(captionSelector, { timeout: 30000 });
            await page.click(captionSelector);
            await delay(1000);
            await page.keyboard.down('Control');
            await page.keyboard.press('A');
            await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');
            await page.keyboard.type(caption);
            console.log("✅ تم كتابة الوصف");
        } catch(e) {
            console.log("⚠️ لم يتم العثور على حقل الوصف، قد تكون الواجهة مختلفة");
        }
        
        await delay(3000);
        
        // الضغط على زر النشر
        console.log("📤 البحث عن زر النشر...");
        const postClicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const postBtn = buttons.find(b => 
                b.innerText.includes('Post') || 
                b.innerText.includes('نشر') ||
                b.innerText.includes('Publish') ||
                b.getAttribute('data-e2e') === 'post_video_button'
            );
            if (postBtn) {
                postBtn.click();
                return true;
            }
            return false;
        });
        
        if (postClicked) {
            console.log("✅ تم الضغط على زر النشر");
            await delay(10000);
            
            // التعامل مع نافذة التأكيد إن وجدت
            const confirmed = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const confirmBtn = buttons.find(b => 
                    b.innerText.includes('Confirm') || 
                    b.innerText.includes('تأكيد') ||
                    b.innerText.includes('Post now') ||
                    b.innerText.includes('النشر الآن')
                );
                if (confirmBtn) {
                    confirmBtn.click();
                    return true;
                }
                return false;
            });
            
            if (confirmed) console.log("✅ تم تأكيد النشر");
            
            await delay(5000);
            
            // التقاط صورة للتأكيد
            await page.screenshot({ path: `${accountName}_success.png`, fullPage: true });
            console.log(`🎉 تم النشر بنجاح على ${accountName}`);
            return true;
        } else {
            console.log("❌ لم يتم العثور على زر النشر");
            return false;
        }
        
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

// =============== التشغيل الرئيسي ===============
async function main() {
    console.log("=".repeat(50));
    console.log("🤖 TikTok Auto Uploader BOT - الإصدار المتكامل");
    console.log("=".repeat(50));
    console.log(`🕐 وقت البدء: ${new Date().toISOString()}`);
    console.log(`📱 حساب المصدر: ${CONFIG.sourceTikTok}`);
    console.log(`📝 العنوان الثابت: ${CONFIG.fixedCaption}`);
    console.log("=".repeat(50));
    
    // جلب فيديو جديد
    console.log("\n📥 الخطوة 1: جلب فيديو جديد من المصدر");
    const videoFile = await fetchNewVideo();
    
    if (!videoFile) {
        console.log("\n❌ لا يوجد فيديوهات جديدة للنشر");
        console.log("💡 نصائح:");
        console.log("   1. تأكد من أن حساب المصدر ينشر فيديوهات جديدة");
        console.log("   2. جرب تغيير حساب المصدر في الإعدادات");
        console.log("   3. إذا كنت تستخدم GitHub Actions، قد تحتاج إلى وكيل (Proxy)");
        return;
    }
    
    // التحقق من وجود الفيديو
    if (!fs.existsSync(videoFile)) {
        console.error(`❌ ملف الفيديو غير موجود: ${videoFile}`);
        return;
    }
    
    const videoSize = fs.statSync(videoFile).size;
    console.log(`✅ تم تجهيز الفيديو: ${videoFile} (${(videoSize / 1024 / 1024).toFixed(2)} MB)`);
    
    // النشر على كل حساب
    console.log("\n📤 الخطوة 2: النشر على حسابات تيك توك");
    
    let successCount = 0;
    for (const account of CONFIG.accounts) {
        const cookiesValue = process.env[account.cookiesEnv];
        
        if (!cookiesValue) {
            console.warn(`⚠️ تخطي حساب ${account.name}: متغير ${account.cookiesEnv} غير موجود`);
            continue;
        }
        
        if (cookiesValue === 'undefined' || cookiesValue === 'null') {
            console.warn(`⚠️ تخطي حساب ${account.name}: قيمة الكوكيز غير صالحة`);
            continue;
        }
        
        const success = await publishToTikTok(videoFile, CONFIG.fixedCaption, account.name, cookiesValue);
        
        if (success) {
            successCount++;
            console.log(`✅ نجح النشر على ${account.name}`);
        } else {
            console.log(`❌ فشل النشر على ${account.name}`);
        }
        
        // انتظار بين الحسابات لتجنب الحظر
        if (account !== CONFIG.accounts[CONFIG.accounts.length - 1]) {
            console.log("⏳ انتظار 30 ثانية قبل النشر على الحساب التالي...");
            await delay(30000);
        }
    }
    
    // تنظيف الملفات المؤقتة
    console.log("\n🧹 الخطوة 3: تنظيف الملفات المؤقتة");
    const tempFiles = ['source_video.mp4', 'ready_video.mp4'];
    for (const file of tempFiles) {
        if (fs.existsSync(file)) {
            fs.unlinkSync(file);
            console.log(`🗑️ تم حذف: ${file}`);
        }
    }
    
    // التقرير النهائي
    console.log("\n" + "=".repeat(50));
    console.log("🏁 التقرير النهائي");
    console.log("=".repeat(50));
    console.log(`✅ تم النشر بنجاح على ${successCount} من أصل ${CONFIG.accounts.length} حساب`);
    console.log(`🕐 وقت الانتهاء: ${new Date().toISOString()}`);
    console.log("=".repeat(50));
}

// =============== تشغيل الكود ===============
main().catch(err => {
    console.error("\n💥 خطأ فادح في البرنامج:");
    console.error(err);
    process.exit(1);
});
