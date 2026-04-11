const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// --- الإعدادات والمصادر ---
const SOURCES = [
    'https://www.tiktok.com/@dramawaveapp',
    'https://www.tiktok.com/@dramaboxshorts'
];

const MY_ACCOUNTS = [
    { name: "Acc 1", cookies: process.env.TIKTOK_COOKIES },
    { name: "Acc 2", cookies: process.env.TIKTOK_COOKIES2 }
].filter(acc => acc.cookies);

const CONFIG = {
    videosPerAccount: 1,
    fixedText: " | شاهد الحلقة كاملة الرابط في البايو 🔗🍿",
    dbFile: 'history.json',
    tempVideo: 'input.mp4',
    outputVideo: 'output.mp4',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
};

// جلب معلومات الفيديو كاملة مع العنوان
async function fetchVideoInfo(videoUrl) {
    try {
        const cmd = `yt-dlp --no-check-certificates --user-agent "${CONFIG.userAgent}" --print "%(title)s" "${videoUrl}"`;
        const title = execSync(cmd, { encoding: 'utf-8' }).trim();
        return title;
    } catch (e) {
        console.error(`❌ فشل جلب عنوان الفيديو:`, e.message);
        return null;
    }
}

// جلب قائمة الفيديوهات من المصادر
async function fetchNewVideos() {
    let allFound = [];
    for (const source of SOURCES) {
        console.log(`🔎 سحب محتوى من: ${source}`);
        try {
            const cmd = `yt-dlp --no-check-certificates --user-agent "${CONFIG.userAgent}" --flat-playlist --print "%(id)s" --playlist-items 1-30 "${source}"`;
            const output = execSync(cmd, { encoding: 'utf-8' });
            output.trim().split('\n').forEach(id => {
                if (id) allFound.push({ id, url: `https://www.tiktok.com/@any/video/${id}` });
            });
        } catch (e) { console.error(`❌ فشل السحب من ${source}:`, e.message); }
    }
    return allFound;
}

// دالة للتعامل مع نافذة تأكيد النشر
async function handlePublishConfirmation(page) {
    try {
        console.log("🔍 فحص وجود نافذة تأكيد النشر...");
        
        // انتظار ظهور النافذة المنبثقة
        await page.waitForFunction(() => {
            const elements = Array.from(document.querySelectorAll('div, span, button'));
            return elements.some(el => 
                el.innerText && (
                    el.innerText.includes('هل تريد المتابعة للنشر') ||
                    el.innerText.includes('لم تكتمل مراجعة حقوق النشر') ||
                    el.innerText.includes('هل ترغب في مواصلة النشر')
                )
            );
        }, { timeout: 10000 }).catch(() => {
            console.log("✅ لم تظهر نافذة تأكيد، متابعة عادية...");
            return false;
        });

        // البحث عن زر "النشر الآن" في النافذة المنبثقة
        const confirmButton = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const confirmBtn = buttons.find(btn => 
                btn.innerText && (
                    btn.innerText.includes('النشر الآن') ||
                    btn.innerText.includes('Post now') ||
                    btn.innerText.includes('نشر') ||
                    btn.innerText.includes('متابعة')
                )
            );
            
            if (confirmBtn) {
                confirmBtn.click();
                return true;
            }
            return false;
        });

        if (confirmButton) {
            console.log("✅ تم النقر على زر تأكيد النشر");
            await new Promise(r => setTimeout(r, 3000));
        }

        // فحص مرة أخرى للتأكد من عدم وجود نافذة ثانية
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const secondConfirm = buttons.find(btn => 
                btn.innerText && (
                    btn.innerText.includes('نشر') ||
                    btn.innerText.includes('تأكيد')
                )
            );
            if (secondConfirm && secondConfirm.offsetParent !== null) {
                secondConfirm.click();
            }
        });

        return true;
    } catch (error) {
        console.log("⚠️ خطأ في معالجة نافذة التأكيد:", error.message);
        return false;
    }
}

// عملية الرفع عبر المتصفح مع عنوان ديناميكي
async function uploadAndPost(videoPath, originalTitle, cookiesStr, accName) {
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.userAgent);
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        await page.setCookie(...JSON.parse(cookiesStr));
        await page.goto('https://www.tiktok.com/upload?lang=ar', { 
            waitUntil: 'networkidle2', 
            timeout: 120000 
        });

        console.log(`📤 جاري رفع الفيديو لحساب ${accName}...`);
        
        // انتظار تحميل صفحة الرفع بالكامل
        await new Promise(r => setTimeout(r, 3000));
        
        const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 30000 });
        await fileInput.uploadFile(videoPath);
        
        console.log("✅ تم رفع الفيديو، جاري كتابة الوصف...");
        
        // انتظار ظهور حقل الوصف
        await new Promise(r => setTimeout(r, 5000));

        // استخدام العنوان الأصلي مع النص الثابت
        const finalCaption = `${originalTitle}${CONFIG.fixedText}`;
        console.log(`📝 العنوان المستخدم: ${finalCaption}`);

        // === الطريقة المحسنة لكتابة الوصف ===
        // البحث عن حقل الوصف باستخدام المحدد الصحيح
        const captionSelector = '[data-e2e="caption_container"] [contenteditable="true"]';
        
        try {
            await page.waitForSelector(captionSelector, { timeout: 15000 });
            
            // النقر على حقل الوصف
            await page.click(captionSelector);
            await new Promise(r => setTimeout(r, 1000));
            
            // مسح المحتوى الحالي
            await page.evaluate((selector) => {
                const element = document.querySelector(selector);
                if (element) {
                    element.innerHTML = '';
                    element.focus();
                }
            }, captionSelector);
            
            // كتابة النص حرفاً حرفاً لضمان ظهوره
            await page.type(captionSelector, finalCaption, { delay: 50 });
            
            // التحقق من كتابة النص
            const writtenText = await page.evaluate((selector) => {
                const element = document.querySelector(selector);
                return element ? element.innerText : '';
            }, captionSelector);
            
            console.log(`✅ تمت كتابة الوصف (${writtenText.length} حرف)`);
            
        } catch (error) {
            console.log("⚠️ فشل في استخدام المحدد الأول، تجربة طريقة بديلة...");
            
            // طريقة بديلة: استخدام class مباشرة
            await page.evaluate((text) => {
                const editor = document.querySelector('.public-DraftEditor-content');
                if (editor) {
                    editor.focus();
                    editor.innerHTML = '';
                    
                    // محاكاة كتابة النص
                    const event = new InputEvent('input', { bubbles: true });
                    editor.textContent = text;
                    editor.dispatchEvent(event);
                }
            }, finalCaption);
            
            await new Promise(r => setTimeout(r, 2000));
        }

        // اختيار "النشر الآن"
        console.log("⏰ جاري اختيار النشر الآن...");
        await page.evaluate(() => {
            const nowRadio = document.querySelector('input[value="post_now"]');
            if (nowRadio) {
                nowRadio.click();
                nowRadio.checked = true;
            }
            
            // طريقة بديلة
            const labels = Array.from(document.querySelectorAll('label'));
            const nowLabel = labels.find(l => l.innerText.includes('النشر الآن'));
            if (nowLabel) {
                const radio = nowLabel.querySelector('input[type="radio"]');
                if (radio) radio.click();
            }
        });

        await new Promise(r => setTimeout(r, 2000));

        // انتظار تفعيل زر النشر والنقر عليه
        console.log("🖱️ جاري النقر على زر النشر...");
        
        // انتظار حتى يصبح الزر قابلاً للنقر
        await page.waitForFunction(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const postBtn = buttons.find(btn => 
                btn.innerText.includes('نشر') && 
                !btn.disabled && 
                btn.offsetParent !== null
            );
            return postBtn !== undefined;
        }, { timeout: 60000 });

        // النقر على زر النشر
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const postBtn = buttons.find(btn => 
                btn.innerText.includes('نشر') && 
                !btn.disabled
            );
            if (postBtn) {
                postBtn.click();
                return true;
            }
            
            // محاولة باستخدام data-e2e
            const e2eBtn = document.querySelector('button[data-e2e="post_video_button"]');
            if (e2eBtn) {
                e2eBtn.click();
                return true;
            }
            
            return false;
        });

        console.log("✅ تم النقر على زر النشر");
        
        // انتظار ومعالجة نافذة التأكيد
        await new Promise(r => setTimeout(r, 5000));
        await handlePublishConfirmation(page);

        // انتظار اكتمال النشر
        console.log("⏳ انتظار اكتمال عملية النشر...");
        await new Promise(r => setTimeout(r, 15000));
        
        // التقاط صورة للتأكيد
        await page.screenshot({ path: `success-${accName}-${Date.now()}.png`, fullPage: true });
        
        console.log(`✅ تم النشر بنجاح على ${accName}!`);
        return true;
        
    } catch (err) {
        console.error(`❌ فشل الرفع لحساب ${accName}:`, err.message);
        await page.screenshot({ path: `error-${accName}-${Date.now()}.png`, fullPage: true });
        return false;
    } finally {
        await browser.close();
    }
}

// --- المحرك الرئيسي ---
(async () => {
    let history = fs.existsSync(CONFIG.dbFile) ? JSON.parse(fs.readFileSync(CONFIG.dbFile)) : { posted: [] };
    
    // تحويل history القديم إذا كان بصيغة مختلفة
    if (!history.posted) {
        const oldHistory = history;
        history = { posted: [] };
        // جمع كل الفيديوهات المنشورة من جميع الحسابات
        Object.values(oldHistory).forEach(videos => {
            if (Array.isArray(videos)) {
                history.posted.push(...videos);
            }
        });
    }

    console.log(`📊 تم نشر ${history.posted.length} فيديو سابقاً`);

    const availableVideos = await fetchNewVideos();
    console.log(`📹 تم العثور على ${availableVideos.length} فيديو متاح`);

    // اختيار فيديو عشوائي لم يتم نشره من قبل على أي حساب
    const unpostedVideos = availableVideos.filter(v => !history.posted.includes(v.id));
    
    if (unpostedVideos.length === 0) {
        console.log("👋 لا يوجد فيديوهات جديدة للنشر حالياً.");
        return;
    }

    // اختيار فيديو عشوائي
    const selectedVideo = unpostedVideos[Math.floor(Math.random() * unpostedVideos.length)];
    console.log(`🎯 تم اختيار فيديو عشوائي: ${selectedVideo.id}`);

    // جلب العنوان الأصلي للفيديو
    const originalTitle = await fetchVideoInfo(selectedVideo.url);
    if (!originalTitle) {
        console.error("❌ لم نتمكن من جلب عنوان الفيديو");
        return;
    }
    
    console.log(`📌 العنوان الأصلي: ${originalTitle}`);

    // نشر نفس الفيديو على كلا الحسابين
    let allSuccess = true;
    for (let i = 0; i < MY_ACCOUNTS.length; i++) {
        const acc = MY_ACCOUNTS[i];
        console.log(`\n🚀 العمل على حساب: ${acc.name} (${i + 1}/${MY_ACCOUNTS.length})`);

        // تنظيف الملفات القديمة
        if (fs.existsSync(CONFIG.tempVideo)) fs.unlinkSync(CONFIG.tempVideo);
        if (fs.existsSync(CONFIG.outputVideo)) fs.unlinkSync(CONFIG.outputVideo);

        try {
            // تحميل الفيديو
            console.log("📥 جاري تحميل الفيديو...");
            execSync(`yt-dlp --no-check-certificates --user-agent "${CONFIG.userAgent}" -o "${CONFIG.tempVideo}" "${selectedVideo.url}"`, {stdio: 'inherit'});
            
            // معالجة الفيديو بدون قلب (تم إزالة hflip)
            console.log("🎨 جاري معالجة الفيديو...");
            execSync(`ffmpeg -i ${CONFIG.tempVideo} -vf "setpts=0.95*PTS,scale=iw*1.02:ih*1.02,crop=iw/1.02:ih/1.02,eq=brightness=0.03:contrast=1.05" -map_metadata -1 -c:v libx264 -crf 22 -af "atempo=1.05" -y ${CONFIG.outputVideo}`, {stdio: 'ignore'});

            const success = await uploadAndPost(CONFIG.outputVideo, originalTitle, acc.cookies, acc.name);
            
            if (!success) {
                allSuccess = false;
                console.log(`⚠️ فشل النشر على حساب ${acc.name}`);
            }
            
        } catch (e) { 
            console.error(`⚠️ خطأ تقني في حساب ${acc.name}: ${e.message}`);
            allSuccess = false;
        }
        
        // انتظار بين الحسابين
        if (i < MY_ACCOUNTS.length - 1) {
            console.log("⏳ انتظار 30 ثانية قبل الانتقال للحساب التالي...");
            await new Promise(r => setTimeout(r, 30000));
        }
    }

    // حفظ الفيديو في history إذا تم نشره على جميع الحسابات بنجاح
    if (allSuccess) {
        history.posted.push(selectedVideo.id);
        fs.writeFileSync(CONFIG.dbFile, JSON.stringify(history, null, 2));
        console.log(`💾 تم حفظ الفيديو ${selectedVideo.id} في السجل`);
    } else {
        console.log(`⚠️ لم يتم حفظ الفيديو في السجل بسبب فشل في النشر على أحد الحسابات`);
    }

    // تنظيف الملفات المؤقتة
    if (fs.existsSync(CONFIG.tempVideo)) fs.unlinkSync(CONFIG.tempVideo);
    if (fs.existsSync(CONFIG.outputVideo)) fs.unlinkSync(CONFIG.outputVideo);
    
    console.log("\n✨ تم الانتهاء من عملية النشر!");
})();
