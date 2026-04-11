const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
const fs = require('fs');
const axios = require('axios');

puppeteer.use(StealthPlugin());

// --- الإعدادات ---
const CONFIG = {
    targetAccount: 'https://www.tiktok.com/@tonnysweden', // الحساب المستهدف للسحب منه
    myCaption: 'مشهد رهيب! 🔥 #أفلام #سينما #KiroZozo',
    dbFile: 'history.json',
    videoPath: './input.mp4',
    editedPath: './output.mp4'
};

// 1. دالة لجلب آخر فيديو من الحساب المستهدف
async function getLatestVideoId(accountUrl) {
    console.log("🔎 فحص الفيديوهات الجديدة...");
    const idsRaw = execSync(`yt-dlp --impersonate chrome --flat-playlist --get-id "${accountUrl}"`, { encoding: 'utf-8' });
    let allIds = idsRaw.trim().split('\n').filter(id => id.trim().length > 0);
    
    let history = fs.existsSync(CONFIG.dbFile) ? JSON.parse(fs.readFileSync(CONFIG.dbFile)) : [];
    const nextId = allIds.find(id => !history.includes(id));
    
    return { nextId, history };
}

// 2. دالة معالجة الفيديو (تغيير البصمة لمنع كشف المحتوى المكرر)
function processVideo(input, output) {
    console.log("🎨 جاري معالجة الفيديو تقنياً (تغيير البصمة)...");
    // تقليل الجودة قليلاً، تغيير الأبعاد 10%، وتعديل الألوان
    execSync(`ffmpeg -i ${input} -vf "scale=iw*1.1:ih*1.1,crop=iw/1.1:ih/1.1,eq=brightness=0.02:contrast=1.03" -map_metadata -1 -c:v libx264 -crf 24 -c:a aac -y ${output}`);
}

// 3. دالة الرفع عبر المتصفح
async function uploadToTikTok(videoPath, caption) {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
    });

    const page = await browser.newPage();
    const cookies = JSON.parse(process.env.TIKTOK_COOKIES);
    await page.setCookie(...cookies);

    try {
        console.log('📤 الدخول لصفحة الرفع...');
        await page.goto('https://www.tiktok.com/upload?lang=ar', { waitUntil: 'networkidle2' });

        console.log('📁 رفع الملف...');
        const fileInput = await page.waitForSelector('input[type="file"]');
        await fileInput.uploadFile(videoPath);

        console.log('✍️ كتابة الوصف...');
        await page.waitForSelector('.public-DraftEditor-content');
        await page.click('.public-DraftEditor-content');
        await page.keyboard.type(caption);

        console.log('⏳ انتظار جاهزية زر النشر...');
        const postBtn = 'button[data-e2e="post_video_button"]';
        await page.waitForFunction((sel) => {
            const btn = document.querySelector(sel);
            return btn && btn.getAttribute('data-disabled') === 'false';
        }, { timeout: 120000 }, postBtn);

        await page.click(postBtn);
        console.log('✅ تم الضغط على زر النشر بنجاح!');
        
        await new Promise(r => setTimeout(r, 10000)); // انتظار نهائي
    } catch (err) {
        console.error('❌ خطأ أثناء الرفع:', err.message);
    } finally {
        await browser.close();
    }
}

// --- المحرك الرئيسي ---
async function startBot() {
    try {
        // الخطوة 1: البحث عن فيديو جديد
        const { nextId, history } = await getLatestVideoId(CONFIG.targetAccount);
        
        if (!nextId) {
            console.log("✅ لا توجد فيديوهات جديدة لنشرها.");
            return;
        }

        console.log(`🎯 فيديو جديد مكتشف: ${nextId}`);

        // الخطوة 2: التحميل
        console.log("📥 جاري التحميل...");
        execSync(`yt-dlp --impersonate chrome -o "${CONFIG.videoPath}" "https://www.tiktok.com/@any/video/${nextId}"`);

        // الخطوة 3: المونتاج السريع لتجنب الحظر
        processVideo(CONFIG.videoPath, CONFIG.editedPath);

        // الخطوة 4: الرفع إلى حسابك
        await uploadToTikTok(CONFIG.editedPath, CONFIG.myCaption);

        // الخطوة 5: تحديث السجل
        history.push(nextId);
        fs.writeFileSync(CONFIG.dbFile, JSON.stringify(history, null, 2));
        
        console.log("🚀 انتهت العملية بنجاح كامل!");

    } catch (error) {
        console.error("⚠️ حدث خطأ في النظام:", error.message);
    }
}

startBot();
