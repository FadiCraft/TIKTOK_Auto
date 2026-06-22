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

// دالة سريعة للتأكد من أن الرابط المستخرج مستجيب ولا يعطي حظر 403
function checkLinkResponse(url, referer) {
    try {
        console.log(`📡 جاري اختبار الرابط وصلاحيته للتحميل...`);
        // استخدام curl لفحص الهيدرز فقط وتجنب تحميل الملف بالكامل لسرعة الفحص
        const cmd = `curl -I -s -A "${CONFIG.userAgent}" -e "${referer}" --max-time 5 "${url}"`;
        const output = execSync(cmd, { encoding: 'utf-8' });
        
        if (output.includes("403") || output.includes("400") || output.includes("401")) {
            console.log(`⚠️ الرابط مرفوض من السيرفر (حماية أو حظر الوصول).`);
            return false;
        }
        console.log(`✅ الرابط مستجيب وجاهز للمعالجة.`);
        return true;
    } catch (e) {
        return false;
    }
}

// 1. دالة كشط موقع الأفلام واختيار فيلم وتجربة السيرفرات بالتتابع
async function getMovieData() {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.userAgent);

    let caughtUrl = null;

    // مراقبة مستمرة للشبكة
    page.on('response', response => {
        const url = response.url();
        if (url.includes('master.m3u8') || url.includes('.m3u8') || url.includes('.mp4')) {
            if (!url.includes('.js') && !url.includes('.css') && !url.includes('.png') && !url.includes('.jpg')) {
                caughtUrl = url;
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

        const serverCount = await page.evaluate(() => {
            return document.querySelectorAll('.watch--servers--list ul li').length;
        });

        console.log(`📊 تم العثور على (${serverCount}) سيرفرات جاهزة للاختبار.`);

        let validStreamUrl = null;

        for (let i = 0; i < serverCount; i++) {
            caughtUrl = null; // تصفير الرابط الملتقط قبل تجربة السيرفر الجديد

            const serverName = await page.evaluate((index) => {
                const el = document.querySelectorAll('.watch--servers--list ul li')[index];
                return el ? el.innerText.trim() : `سيرفر ${index + 1}`;
            }, i);

            console.log(`🔄 جاري تشغيل وتجربة السيرفر رقم [${i + 1}]: ${serverName}...`);

            await page.evaluate((index) => {
                const el = document.querySelectorAll('.watch--servers--list ul li')[index];
                if (el) el.click();
            }, i);

            // انتظار 8 ثوانٍ لالتقاط الرابط من الشبكة
            await new Promise(r => setTimeout(r, 8000));

            if (caughtUrl) {
                console.log(`🎯 تم التقاط رابط من سيرفر: ${serverName}. جاري التحقق من الحماية...`);
                const isAccessible = checkLinkResponse(caughtUrl, watchUrl);
                
                if (isAccessible) {
                    validStreamUrl = caughtUrl;
                    console.log(`🌟 اعتمدنا السيرفر: ${serverName}`);
                    break;
                } else {
                    console.log(`❌ تخطي السيرفر ${serverName} بسبب قيود الحماية (403). جاري تجربة سيرفر آخر...`);
                }
            }
        }

        if (!validStreamUrl) {
            console.log(`❌ فشلت جميع السيرفرات في إعطاء رابط قابل للوصول والتحميل. جاري تصوير الشاشة...`);
            await page.screenshot({ path: 'failed-page.png', fullPage: true });
            throw new Error("لم نجد أي سيرفر شغال ومفتوح الحماية.");
        }
        
        return { title: randomMovie.title, streamUrl: validStreamUrl, referer: watchUrl };

    } catch (e) {
        console.error(`❌ فشل في مرحلة الكشط:`, e.message);
        try { await page.screenshot({ path: 'failed-page.png' }); } catch(err){}
        return null;
    } finally {
        await browser.close();
    }
}

// 2. دالة فحص المدة والقص عبر FFmpeg
function processVideoClip(streamUrl, movieTitle, refererUrl) {
    try {
        console.log(`⏱️ جاري فحص مدة الفيلم عبر ffprobe...`);
        
        // تم تنظيف الأمر تماماً من خيارات الـ header المتعارضة
        const durationCmd = `ffprobe -v error -headers "User-Agent: ${CONFIG.userAgent}\r\nReferer: ${refererUrl}\r\n" -show_entries format=duration -of default=noprint_wrappers=1 "${streamUrl}"`;
        const durationOutput = execSync(durationCmd, { encoding: 'utf-8' }).trim();
        
        const totalSeconds = Math.floor(parseFloat(durationOutput.split('=')[1] || durationOutput));

        if (isNaN(totalSeconds) || totalSeconds <= 0) {
            throw new Error(`لم نتمكن من قراءة مدة الفيديو بشكل صحيح.`);
        }

        console.log(`🎬 مدة الفيلم الإجمالية: ${totalSeconds} ثانية.`);

        const minStart = 10 * 60; 
        const maxStart = totalSeconds - (10 * 60) - 120; 

        let randomStart = 12 * 60; 
        if (maxStart > minStart) {
            randomStart = Math.floor(Math.random() * (maxStart - minStart + 1)) + minStart;
        }

        const startTimeStr = new Date(randomStart * 1000).toISOString().substr(11, 8);
        
        console.log(`✂️ التوقيت المختار للقص: ${startTimeStr}`);
        console.log(`🎨 جاري بدء معالجة اللقطة عمودياً وإضافة الفلاتر والنصوص...`);

        const ffmpegCmd = `ffmpeg -headers "User-Agent: ${CONFIG.userAgent}\r\nReferer: ${refererUrl}\r\n" -ss ${startTimeStr} -i "${streamUrl}" -t 00:02:00 -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setpts=0.95*PTS,scale=iw*1.02:ih*1.02,crop=iw/1.02:ih/1.02,eq=brightness=0.03:contrast=1.05,drawtext=fontfile=/usr/share/fonts/truetype/kacst/KacstBook.ttf:text='${movieTitle}':fontcolor=white:fontsize=45:x=(w-text_w)/2:y=250,drawtext=fontfile=/usr/share/fonts/truetype/kacst/KacstBook.ttf:text='${CONFIG.fixedText}':fontcolor=yellow:fontsize=35:x=(w-text_w)/2:y=1650" -c:v libx264 -crf 23 -c:a aac -af "atempo=1.05" -y ${CONFIG.outputVideo}`;

        execSync(ffmpegCmd, { stdio: 'inherit' });
        
        console.log(`🚀 تمت العملية بنجاح كامل! تم إنتاج مقطع تيك توك: ${CONFIG.outputVideo}`);
        return true;

    } catch (e) {
        console.error("❌ فشل أمر الـ FFmpeg في معالجة اللقطة:", e.message);
        return false;
    }
}

// المحرك الرئيسي
(async () => {
    console.log("🚀 بدء تشغيل سكريبت الأفلام الذكي مع نظام فحص الحماية...");
    
    const movieData = await getMovieData();
    
    if (movieData && movieData.streamUrl) {
        console.log(`\n🍿 اسم الفيلم النهائي المعتمد: ${movieData.title}`);
        
        const success = processVideoClip(movieData.streamUrl, movieData.title, movieData.referer);
        if (success) {
            console.log("\n✨ تم تجهيز المقطع بنجاح كامل وصافٍ دون أي أخطاء تداخل!");
        }
    } else {
        console.log("\n❌ انتهى السكريبت لعدم وجود سيرفر مفتوح الحماية في هذا الفيلم.");
    }
})();
