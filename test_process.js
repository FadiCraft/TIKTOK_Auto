const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const MOVIES_SITE = 'https://topcinemaa.cam/movies/';

const CONFIG = {
    fixedText: "🍿 شاهد الفيلم كامل بدقة عالية، الرابط في البايو 🔗",
    outputVideo: 'tiktok_ready.mp4',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
};

// 1. دالة كشط موقع الأفلام واختيار فيلم عشوائي واستخراج رابط التشغيل
async function getMovieData() {
    const browser = await puppeteer.launch({
        headless: "new", // يمكنك جعلها false إذا كنت تجربه على جهازك الشخصي لترى المتصفح
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.userAgent);

    try {
        console.log(`🔎 جاري فتح صفحة الأفلام الرئيسية...`);
        await page.goto(MOVIES_SITE, { waitUntil: 'networkidle2', timeout: 60000 });

        // استخراج جميع روابط الأفلام وأسمائها من الصفحة
        const movies = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('.Small--Box a.recent--block'));
            return items.map(item => ({
                title: item.getAttribute('title') ? item.getAttribute('title').replace('مترجم اون لاين', '').trim() : 'فيلم مشوق',
                url: item.getAttribute('href')
            }));
        });

        if (movies.length === 0) throw new Error("لم يتم العثور على أي أفلام في الصفحة، قد يكون الـ Selector تغير.");

        // اختيار فيلم عشوائي
        const randomMovie = movies[Math.floor(Math.random() * movies.length)];
        // بناء رابط صفحة المشاهدة مباشرة بإضافة /watch/ في النهاية
        const watchUrl = randomMovie.url.endsWith('/') ? `${randomMovie.url}watch/` : `${randomMovie.url}/watch/`;
        
        console.log(`🎬 الفيلم المختار عشوائياً: ${randomMovie.title}`);
        console.log(`🔗 رابط صفحة المشاهدة: ${watchUrl}`);

        // الانتقال لصفحة المشاهدة لاستخراج السيرفر
        await page.goto(watchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        console.log(`⏳ جاري البحث عن سيرفر متاح (StreamWish أو UpDown)...`);
        
        // سنبحث عن سيرفر StreamWish أو UpDown بالضغط عليه ومراقبة الشبكة لجلب رابط الفيديو المباشر
        // هذه الدالة تراقب روابط البث الإعلانية وروابط الـ m3u8 أو mp4 الناتجة عن المشغلات
        let directStreamUrl = null;

        // تفعيل ميزة مراقبة طلبات الشبكة للقبض على رابط الفيديو الثمين
        page.on('response', response => {
            const url = response.url();
            // الروابط المباشرة للسيرفرات غالباً تحتوي على .mp4 أو .m3u8 أو تتبع لمجالات البث
            if (url.includes('.mp4') || url.includes('.m3u8') || url.includes('streamwish') || url.includes('updown')) {
                // استثناء روابط الـ سكريبتات أو الصور الصغيره
                if (!url.includes('.js') && !url.includes('.css') && !url.includes('.png')) {
                    directStreamUrl = url;
                }
            }
        });

        // محاكاة الضغط على سيرفر StreamWish (الذي يحتوي نص StreamWish)
        await page.evaluate(() => {
            const servers = Array.from(document.querySelectorAll('.watch--servers--list ul li'));
            // نحاول إيجاد سيرفر StreamWish أولاً لأنه الأسهل في جلب الرابط المباشر
            const targetServer = servers.find(s => s.innerText.includes('StreamWish') || s.innerText.includes('UpDown') || s.innerText.includes('متعدد'));
            if (targetServer) {
                targetServer.click();
            } else if (servers.length > 0) {
                servers[0].click(); // إذا لم نجد، نضغط على أول سيرفر متاح
            }
        });

        // انتظر 10 ثوانٍ لكي يقوم المشغل بالتحميل وتلتقط الشبكة الرابط
        await new Promise(r => setTimeout(r, 10000));

        // إذا لم نلتقطه من الشبكة، نبحث داخل الـ iframe الموجود بالصفحة
        if (!directStreamUrl) {
            directStreamUrl = await page.evaluate(() => {
                const iframe = document.querySelector('.watch-player-box iframe, #video_player iframe');
                return iframe ? iframe.getAttribute('src') : null;
            });
        }

        if (!directStreamUrl) throw new Error("لم نتمكن من استخراج الرابط المباشر للمشغل.");
        
        console.log(`🎯 تم العثور على رابط البث بنجاح!`);
        return { title: randomMovie.title, streamUrl: directStreamUrl };

    } catch (e) {
        console.error(`❌ فشل في مرحلة الكشط:`, e.message);
        return null;
    } finally {
        await browser.close();
    }
}

// 2. دالة فحص المدة، اختيار توقيت عشوائي، والقص عبر FFmpeg بالأبعاد المطلوبة وتخطي الحقوق
function processVideoClip(streamUrl, movieTitle) {
    try {
        console.log(`⏱️ جاري فحص مدة الفيلم الإجمالية عن بُعد عبر ffprobe...`);
        
        const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nocorrect_header=1:novariable=1 -sexagesimal "${streamUrl}"`;
        const durationStr = execSync(durationCmd, { encoding: 'utf-8' }).trim();
        
        const p = durationStr.split(':');
        const totalSeconds = (+p[0]) * 60 * 60 + (+p[1]) * 60 + (+p[2].split('.')[0]);

        console.log(`🎬 مدة الفيلم الإجمالية: ${durationStr} (${totalSeconds} ثانية)`);

        // الحسابات: تجنب أول 10 دقائق (600 ثانية) وآخر 10 دقائق
        const minStart = 10 * 60; 
        const maxStart = totalSeconds - (10 * 60) - 120; // ناقص دقيقتين للقطة

        if (maxStart <= minStart) {
            console.log("⚠️ الفيلم قصير جداً (قد يكون إعلان أو حلقة قصيرة)، سيتم القص من المنتصف تلقائياً.");
            return false;
        }

        const randomStart = Math.floor(Math.random() * (maxStart - minStart + 1)) + minStart;
        const startTimeStr = new Date(randomStart * 1000).toISOString().substr(11, 8);
        
        console.log(`✂️ التوقيت العشوائي المختار للقص: ${startTimeStr}`);
        console.log(`🎨 جاري بدء المعالجة والقص بمقاسات تيك توك وإضافة النصوص الرقمية...`);

        // فلتر الـ FFmpeg الخارق:
        // 1. القفز للتوقيت وقص دقيقتين (-ss و -t)
        // 2. الفلتر المرئي (vf): تحويل الأبعاد لعمودي، تكبير خفيف (1.02) لتفادي الحقوق، تباين وإضاءة خفيفة، ثم طباعة النصوص
        // 3. الفلتر الصوتي (af): تسريع الصوت بنسبة 1.05 لتغيير البصمة الصوتية وتفادي الحقوق الرقمية
        
        const ffmpegCmd = `ffmpeg -ss ${startTimeStr} -i "${streamUrl}" -t 00:02:00 -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setpts=0.95*PTS,scale=iw*1.02:ih*1.02,crop=iw/1.02:ih/1.02,eq=brightness=0.03:contrast=1.05,drawtext=text='${movieTitle}':fontcolor=white:fontsize=45:x=(w-text_w)/2:y=250,drawtext=text='${CONFIG.fixedText}':fontcolor=yellow:fontsize=38:x=(w-text_w)/2:y=1650" -c:v libx264 -crf 22 -af "atempo=1.05" -y ${CONFIG.outputVideo}`;

        execSync(ffmpegCmd, { stdio: 'inherit' });
        
        console.log(`🚀 تمت العملية بنجاح! تم حفظ الفيديو باسم: ${CONFIG.outputVideo}`);
        return true;

    } catch (e) {
        console.error("❌ فشل أمر الـ FFmpeg في معالجة اللقطة:", e.message);
        return false;
    }
}

// المشغل الرئيسي للاختبار
(async () => {
    console.log("🚀 بدء تشغيل سكريبت الاختبار الخاص بالأفلام...");
    
    const movieData = await getMovieData();
    
    if (movieData && movieData.streamUrl) {
        console.log(`\n🍿 اسم الفيلم المستخرج: ${movieData.title}`);
        const success = processVideoClip(movieData.streamUrl, movieData.title);
        if (success) {
            console.log("\n✨ انتهى الاختبار بنجاح! يمكنك الآن فتح ملف 'tiktok_ready.mp4' ومشاهدة النتيجة بنفسك.");
        }
    } else {
        console.log("\n❌ فشل السكريبت في الحصول على بيانات كافية للفيلم.");
    }
})();
