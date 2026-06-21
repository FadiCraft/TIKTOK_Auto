const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const MOVIES_SITE = 'https://topcinemaa.cam/movies/';

const CONFIG = {
    fixedText: " | شاهد الفيلم كامل الرابط في البايو 🔗🍿",
    dbFile: 'history.json',
    outputVideo: 'tiktok_ready.mp4',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
};

// 1. دالة كشط موقع الأفلام واختيار فيلم وتجربة السيرفرات
async function getMovieData() {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.userAgent);

    // متغير لتخزين رابط البث الثمين بمجرد التقاطه
    let directStreamUrl = null;

    // تفعيل مراقبة الشبكة لالتقاط روابط m3u8 أو mp4
    await page.setRequestInterception(false); // نترك المتصفح يتعامل طبيعياً مع الطلبات
    page.on('response', response => {
        const url = response.url();
        if (url.includes('master.m3u8') || url.includes('.m3u8') || url.includes('.mp4')) {
            // استبعاد ملفات الصور أو التصميم التي قد تحمل أسماء مشابهة بالخطأ
            if (!url.includes('.js') && !url.includes('.css') && !url.includes('.png') && !url.includes('.jpg')) {
                directStreamUrl = url;
            }
        }
    });

    try {
        console.log(`🔎 جاري فتح صفحة الأفلام الرئيسية...`);
        await page.goto(MOVIES_SITE, { waitUntil: 'networkidle2', timeout: 60000 });

        const movies = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('.Small--Box a.recent--block'));
            return items.map(item => ({
                title: item.getAttribute('title') ? item.getAttribute('title').replace('مترجم اون لاين', '').trim() : 'فيلم مشوق',
                url: item.getAttribute('href')
            }));
        });

        if (movies.length === 0) throw new Error("لم يتم العثور على أي أفلام في الصفحة الرئيسية.");

        const randomMovie = movies[Math.floor(Math.random() * movies.length)];
        const watchUrl = randomMovie.url.endsWith('/') ? `${randomMovie.url}watch/` : `${randomMovie.url}/watch/`;
        
        console.log(`🎬 الفيلم المختار عشوائياً: ${randomMovie.title}`);
        console.log(`🔗 رابط صفحة المشاهدة: ${watchUrl}`);

        await page.goto(watchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        console.log(`⏳ جاري فحص السيرفرات المتاحة وتجربتها واحداً تلو الآخر...`);

        // معرفة عدد السيرفرات الموجودة في القائمة
        const serverCount = await page.evaluate(() => {
            return document.querySelectorAll('.watch--servers--list ul li').length;
        });

        console.log(`📊 تم العثور على (${serverCount}) سيرفرات جاهزة للاختبار.`);

        // الدوران على السيرفرات وتجربتها حتى نجد الرابط
        for (let i = 0; i < serverCount; i++) {
            if (directStreamUrl) break; // لو وجدنا الرابط من سيرفر سابق نخرج فوراً

            const serverName = await page.evaluate((index) => {
                const el = document.querySelectorAll('.watch--servers--list ul li')[index];
                return el ? el.innerText.trim() : `سيرفر ${index + 1}`;
            }, i);

            console.log(`🔄 جاري تشغيل وتجربة السيرفر رقم [${i + 1}]: ${serverName}...`);

            // الضغط على السيرفر الحالي
            await page.evaluate((index) => {
                const el = document.querySelectorAll('.watch--servers--list ul li')[index];
                if (el) el.click();
            }, i);

            // الانتظار 8 ثوانٍ لمنح المشغل فرصة لطلب رابط الـ m3u8 من الشبكة
            await new Promise(r => setTimeout(r, 8000));

            if (directStreamUrl) {
                console.log(`🎯 نجاح! تم صيد الرابط المباشر من سيرفر: ${serverName}`);
                break;
            }
        }

        // إذا مررنا على كل السيرفرات ولم نجد الرابط، نأخذ لقطة شاشة للمعاينة
        if (!directStreamUrl) {
            console.log(`❌ فشلت جميع السيرفرات في إعطاء رابط مباشر. جاري التقاط لقطة شاشة للأعطال...`);
            await page.screenshot({ path: 'failed-page.png', fullPage: true });
            throw new Error("لم نتمكن من استخراج الرابط المباشر للمشغل من أي سيرفر.");
        }
        
        return { title: randomMovie.title, streamUrl: directStreamUrl };

    } catch (e) {
        console.error(`❌ فشل في مرحلة الكشط:`, e.message);
        // تأكيد أخذ لقطة شاشة في حال حدوث أي خطأ مفاجئ آخر
        try { await page.screenshot({ path: 'failed-page.png' }); } catch(err){}
        return null;
    } finally {
        await browser.close();
    }
}

// 2. دالة فحص المدة والقص عبر FFmpeg بمقاسات تيك توك وتخطي الحقوق
function processVideoClip(streamUrl, movieTitle) {
    try {
        console.log(`⏱️ جاري فحص مدة الفيلم الإجمالية عن بُعد عبر ffprobe...`);
        
        // جلب المدة الإجمالية للبث
        const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nocorrect_header=1:novariable=1 -sexagesimal "${streamUrl}"`;
        const durationStr = execSync(durationCmd, { encoding: 'utf-8' }).trim();
        
        const p = durationStr.split(':');
        const totalSeconds = (+p[0]) * 60 * 60 + (+p[1]) * 60 + (+p[2].split('.')[0]);

        console.log(`🎬 مدة الفيلم الإجمالية: ${durationStr} (${totalSeconds} ثانية)`);

        // الحسابات لتجنب أول وأخر 10 دقائق
        const minStart = 10 * 60; 
        const maxStart = totalSeconds - (10 * 60) - 120; 

        if (maxStart <= minStart) {
            console.log("⚠️ الفيلم قصير جداً، سيتم القص من التوقيت الافتراضي (الدقيقة 12).");
        }

        const randomStart = maxStart > minStart ? Math.floor(Math.random() * (maxStart - minStart + 1)) + minStart : 12 * 60;
        const startTimeStr = new Date(randomStart * 1000).toISOString().substr(11, 8);
        
        console.log(`✂️ التوقيت المختار للقص: ${startTimeStr}`);
        console.log(`🎨 جاري بدء المعالجة والقص الفوري...`);

        // أمر الـ FFmpeg المعدل لتركيب الفيديو عمودياً + التعديلات المضادة للحقوق الرقمية وضبط مسار الخط العربي في لينكس
        const ffmpegCmd = `ffmpeg -ss ${startTimeStr} -i "${streamUrl}" -t 00:02:00 -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setpts=0.95*PTS,scale=iw*1.02:ih*1.02,crop=iw/1.02:ih/1.02,eq=brightness=0.03:contrast=1.05,drawtext=fontfile=/usr/share/fonts/truetype/kacst/KacstBook.ttf:text='${movieTitle}':fontcolor=white:fontsize=45:x=(w-text_w)/2:y=250,drawtext=fontfile=/usr/share/fonts/truetype/kacst/KacstBook.ttf:text='${CONFIG.fixedText}':fontcolor=yellow:fontsize=35:x=(w-text_w)/2:y=1650" -c:v libx264 -crf 23 -c:a aac -af "atempo=1.05" -y ${CONFIG.outputVideo}`;

        execSync(ffmpegCmd, { stdio: 'inherit' });
        
        console.log(`🚀 تمت العملية بنجاح! تم حفظ الفيديو باسم: ${CONFIG.outputVideo}`);
        return true;

    } catch (e) {
        console.error("❌ فشل أمر الـ FFmpeg في معالجة اللقطة:", e.message);
        return false;
    }
}

// المحرك الرئيسي
(async () => {
    console.log("🚀 بدء تشغيل سكريبت الأفلام المحدث...");
    
    // جلب فيلم عشوائي وتجربة السيرفرات
    const movieData = await getMovieData();
    
    if (movieData && movieData.streamUrl) {
        console.log(`\n🍿 اسم الفيلم: ${movieData.title}`);
        console.log(`🔗 رابط البث المستهدف: ${movieData.streamUrl}`);
        
        // معالجة اللقطة وقصها
        const success = processVideoClip(movieData.streamUrl, movieData.title);
        if (success) {
            console.log("\n✨ انتهت معالجة الفيديو بنجاح وجاهز للرفع التلقائي مستقبلاً!");
        }
    } else {
        console.log("\n❌ انتهى السكريبت بالفشل في الحصول على رابط بث.");
    }
})();
