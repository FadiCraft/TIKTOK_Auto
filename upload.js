const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// --- الإعدادات والمصادر (تم التعديل لـ Dailymotion) ---
const SOURCES = [
    'https://www.dailymotion.com/video/x9z2nlw', // رابط فيديو مباشر
    'https://www.dailymotion.com/tseries'       // أو رابط قناة كاملة
];

const MY_ACCOUNT = { name: "Acc 1", cookies: process.env.TIKTOK_COOKIES };

const CONFIG = {
    fixedText: " | شاهد الحلقة كاملة الرابط في البايو 🔗🍿",
    dbFile: 'history.json',
    tempVideo: 'input.mp4',
    outputVideo: 'output.mp4',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
};

// جلب معلومات الفيديو (لا يتغير)
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

// جلب قائمة الفيديوهات (تم التعديل ليتناسب مع روابط Dailymotion)
async function fetchNewVideos() {
    let allFound = [];
    for (const source of SOURCES) {
        console.log(`🔎 سحب محتوى من: ${source}`);
        try {
            // استخدام --get-id لجلب المعرفات فقط
            const cmd = `yt-dlp --no-check-certificates --user-agent "${CONFIG.userAgent}" --flat-playlist --get-id --playlist-items 1-10 "${source}"`;
            const output = execSync(cmd, { encoding: 'utf-8' });
            output.trim().split('\n').forEach(id => {
                if (id) {
                    allFound.push({ 
                        id: id.trim(), 
                        url: `https://www.dailymotion.com/video/${id.trim()}` 
                    });
                }
            });
        } catch (e) { console.error(`❌ فشل السحب من ${source}:`, e.message); }
    }
    return allFound;
}

// وظيفة الرفع (تبقى كما هي لأنك تنشر على تيك توك)
async function uploadAndPost(videoPath, originalTitle, cookiesStr, accName) {
    // ... (نفس كود الرفع الخاص بك بدون تغيير)
}

// --- المحرك الرئيسي ---
(async () => {
    let history = fs.existsSync(CONFIG.dbFile) ? JSON.parse(fs.readFileSync(CONFIG.dbFile)) : { posted: [] };
    
    const availableVideos = await fetchNewVideos();
    // تصفية الفيديوهات التي لم تنشر من قبل
    const unpostedVideos = availableVideos.filter(v => !history.posted.includes(v.id));
    
    if (unpostedVideos.length === 0) {
        console.log("👋 لا يوجد فيديوهات جديدة للنشر حالياً.");
        return;
    }

    // اختيار فيديو عشوائي من القائمة غير المنشورة
    const selectedVideo = unpostedVideos[0]; 
    console.log(`🎯 الفيديو المختار: ${selectedVideo.url}`);

    const originalTitle = await fetchVideoInfo(selectedVideo.url);
    if (!originalTitle) return;

    // تنظيف الملفات القديمة
    if (fs.existsSync(CONFIG.tempVideo)) fs.unlinkSync(CONFIG.tempVideo);
    if (fs.existsSync(CONFIG.outputVideo)) fs.unlinkSync(CONFIG.outputVideo);

    try {
        console.log("📥 جاري تحميل الفيديو من Dailymotion...");
        // yt-dlp سيتعامل مع الرابط تلقائياً
        execSync(`yt-dlp --no-check-certificates -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4" -o "${CONFIG.tempVideo}" "${selectedVideo.url}"`, {stdio: 'inherit'});
        
        console.log("🎨 جاري معالجة الفيديو بـ FFmpeg...");
        execSync(`ffmpeg -i ${CONFIG.tempVideo} -vf "setpts=0.95*PTS,scale=iw*1.02:ih*1.02,crop=iw/1.02:ih/1.02,eq=brightness=0.03:contrast=1.05" -map_metadata -1 -c:v libx264 -crf 22 -af "atempo=1.05" -y ${CONFIG.outputVideo}`, {stdio: 'ignore'});

        const success = await uploadAndPost(CONFIG.outputVideo, originalTitle, MY_ACCOUNT.cookies, MY_ACCOUNT.name);

        if (success) {
            history.posted.push(selectedVideo.id);
            fs.writeFileSync(CONFIG.dbFile, JSON.stringify(history, null, 2));
            console.log(`💾 تم حفظ الفيديو ${selectedVideo.id} في التاريخ`);
        }
    } catch (e) { 
        console.error(`⚠️ خطأ تقني: ${e.message}`); 
    }
})();
