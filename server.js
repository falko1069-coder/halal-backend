import 'dotenv/config'; // 🔹 นำเข้า dotenv เพื่ออ่านรหัส API
import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai'; // 🔹 นำเข้า Gemini AI

const app = express();
app.use(cors());

const TELEGRAM_TOKEN = (process.env.TELEGRAM_TOKEN || '').trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();

const WATCHLIST = [
    'HLAL', 'PCOR', 'SPUS', 'AAPL', 'MSFT', 
    'GOOGL', 'ADBE', 'CRM', 'AMD', 'CSCO', 
    'TSLA', 'CAT', 'LLY', 'JNJ', 'TXN'
]; 

const stockStates = {}; 
let cacheData = {}; 
let isReady = false; 
let initProgress = 0; 
let yahooCookie = '';
let yahooCrumb = '';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function sendTelegramMessage(text) {
    if (!TELEGRAM_TOKEN) return; 
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text, parse_mode: 'HTML' })
        });
    } catch (error) { console.error('❌ ส่งข้อความพลาด:', error.message); }
}

// 🧠 ฟังก์ชัน AI วิเคราะห์ธุรกิจและความเสี่ยงฮาลาล (ทำงานครั้งเดียวเพื่อประหยัด API)
async function getAIBusinessAndHalalInsight(symbol, name) {
    let insight = {
        business: "ระบบกำลังรวบรวมข้อมูลธุรกิจ...",
        halalRisk: "กำลังประเมินความเสี่ยง..."
    };

    if (GEMINI_API_KEY) {
        try {
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

            const prompt = `
คุณคือนักวิเคราะห์หุ้นอิสลาม โปรดวิเคราะห์บริษัท ${symbol} (${name}) อย่างกระชับที่สุด
คำสั่ง:
1. Business: บริษัทนี้ทำธุรกิจอะไร รายได้หลักมาจากไหน (ไม่เกิน 2 บรรทัด)
2. Halal Risk: มีความเสี่ยงเรื่องรายได้ต้องห้ามตามหลักอิสลามไหม (เช่น ดอกเบี้ยรับที่สูง, อาวุธ, แอลกอฮอล์, การพนัน) (ไม่เกิน 2 บรรทัด)

รูปแบบการตอบ (ห้ามเปลี่ยนคำนำหน้า):
ธุรกิจ: [คำตอบ]
ความเสี่ยง: [คำตอบ]`;

            const result = await model.generateContent(prompt);
            const text = result.response.text().trim();
            
            // แยกข้อความที่ AI ตอบกลับมา
            const lines = text.split('\n');
            lines.forEach(line => {
                if (line.startsWith('ธุรกิจ:')) insight.business = line.replace('ธุรกิจ:', '').trim();
                if (line.startsWith('ความเสี่ยง:')) insight.halalRisk = line.replace('ความเสี่ยง:', '').trim();
            });
        } catch (e) {
            console.log(`⚠️ Gemini AI วิเคราะห์ ${symbol} พลาด: ${e.message}`);
        }
    }
    return insight;
}

function calculateRSI(prices) {
    if (!prices || prices.length < 15) return 50; 
    let gains = 0, losses = 0;
    for (let i = 1; i <= 14; i++) {
        const diff = prices[prices.length - i] - prices[prices.length - i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }
    if (losses === 0) return 100;
    if (gains === 0) return 0;
    const rs = (gains / 14) / (losses / 14);
    return Math.round(100 - (100 / (1 + rs)));
}

function calculateEMA(prices, period) {
    if (!prices || prices.length < period) return prices ? prices[prices.length - 1] : 0;
    const k = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) {
        ema = (prices[i] * k) + (ema * (1 - k));
    }
    return Math.round(ema * 100) / 100;
}

function isMarketOpen() {
    const now = new Date();
    const day = now.getUTCDay(); 
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    const time = hour + (minute / 60);
    if (day === 0 || day === 6) return false;
    return (time >= 14.5 && time < 20.0);
}

function determineState(rsi) {
    if (rsi <= 20) return 'STRONG_BUY';  
    if (rsi <= 30) return 'BUY';         
    if (rsi >= 80) return 'STRONG_SELL'; 
    if (rsi >= 70) return 'SELL';        
    return 'NEUTRAL';                    
}

async function getYahooAuth() {
    if (yahooCookie && yahooCrumb) return { cookie: yahooCookie, crumb: yahooCrumb };
    try {
        console.log('🔑 กำลังสร้าง Cookie ยืนยันตัวตนกับ Yahoo...');
        const headers = { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive'
        };

        const resCookie = await fetch('https://fc.yahoo.com', { headers });
        const cookieStr = resCookie.headers.get('set-cookie');
        if (!cookieStr) throw new Error('เซิร์ฟเวอร์ไม่ได้ Cookie กลับมา');
        
        const resCrumb = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
            headers: { ...headers, 'Cookie': cookieStr }
        });
        const crumbStr = await resCrumb.text();
        
        if (crumbStr.includes('<html>')) throw new Error('Crumb ถูกบล็อกโดย Yahoo');
        
        yahooCookie = cookieStr;
        yahooCrumb = crumbStr;
        console.log('🔓 ปลดล็อกงบการเงินสำเร็จ!');
        return { cookie: yahooCookie, crumb: yahooCrumb };
    } catch (e) {
        yahooCookie = ''; 
        yahooCrumb = '';
        return { cookie: '', crumb: '' };
    }
}

async function fetchStockDataNative(symbol) {
    let currentPrice = 0, changePercent = 0, prices = [], chartSeries = [];
    try {
        const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=60d`;
        const chartRes = await fetch(chartUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const chartData = await chartRes.json();
        const result = chartData.chart.result[0];
        
        currentPrice = result.meta.regularMarketPrice;
        const previousClose = result.meta.chartPreviousClose || currentPrice;
        changePercent = ((currentPrice - previousClose) / previousClose) * 100;
        
        const timestamps = result.timestamp || [];
        const closes = result.indicators.quote[0].close || [];
        
        const thirtyAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

        for (let i = 0; i < closes.length; i++) {
            if (closes[i] !== null) {
                prices.push(closes[i]);
                const date = new Date(timestamps[i] * 1000);
                if (date.getTime() >= thirtyAgo) {
                    chartSeries.push({
                        dateLabel: `${months[date.getMonth()]} ${date.getDate()}`,
                        t: `${months[date.getMonth()]} ${date.getDate()}`,
                        price: Math.round(closes[i] * 100) / 100
                    });
                }
            }
        }
    } catch (e) {
        console.log(`⚠️ ข้ามกราฟของ ${symbol}`);
    }

    let name = symbol;
    let debtM = 0;
    let assetsM = 0;
    let isPass = true;
    let debtRatioStr = "0.0";

    try {
        const auth = await getYahooAuth();
        const finUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=financialData,price${auth.crumb ? '&crumb='+auth.crumb : ''}`;
        const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
        if (auth.cookie) headers['Cookie'] = auth.cookie;

        const finRes = await fetch(finUrl, { headers });
        const finData = await finRes.json();
        
        if (finData.quoteSummary && finData.quoteSummary.result) {
            const finResult = finData.quoteSummary.result[0];
            name = finResult.price?.shortName || symbol;
            const marketCap = finResult.price?.marketCap?.raw || 0;
            const totalDebt = finResult.financialData?.totalDebt?.raw || 0;

            if (marketCap > 0) {
                const ratio = (totalDebt / marketCap) * 100;
                isPass = ratio <= 33;
                debtRatioStr = ratio.toFixed(1);
                debtM = (totalDebt / 1000000).toFixed(0);
                assetsM = (marketCap / 1000000).toFixed(0);
            }
        }
    } catch (e) {
        try {
            const quoteRes = await fetch(`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`);
            const quoteData = await quoteRes.json();
            const qResult = quoteData.quoteResponse.result[0];
            name = qResult.shortName || symbol;
            const marketCap = qResult.marketCap || 0;
            if(marketCap > 0) assetsM = (marketCap / 1000000).toFixed(0);
        } catch (fallbackErr) {}
    }

    const rsi = prices.length > 0 ? calculateRSI(prices) : 50;
    const supportLevel = prices.length > 0 ? Math.min(...prices) : 0;
    const resistanceLevel = prices.length > 0 ? Math.max(...prices) : 0;

    return {
        symbol, name, price: currentPrice, change: changePercent,
        chartSeries, historicalPrices: prices, supportLevel, resistanceLevel,
        rsi, debtRatio: debtRatioStr, totalDebt: debtM, totalAssets: assetsM, isHalal: isPass
    };
}

async function updateAllStocks() {
    console.log('🔄 เริ่มดึงข้อมูลพร้อมพ่วงระบบวิเคราะห์ AI...');
    for (let i = 0; i < WATCHLIST.length; i++) {
        const symbol = WATCHLIST[i];
        try {
            const data = await fetchStockDataNative(symbol);
            
            // 🌟 ให้ AI ทำงานเฉพาะตอนที่ยังไม่มีข้อมูล หรือข้อมูลเก่าเกิน 7 วัน
            const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
            const now = Date.now();

            if (!cacheData[symbol] || !cacheData[symbol].aiInsight || !cacheData[symbol].aiInsight.lastUpdated || (now - cacheData[symbol].aiInsight.lastUpdated > SEVEN_DAYS_MS)) {
                console.log(`🤖 กำลังให้ AI ศึกษาข้อมูลบริษัท ${symbol}...`);
                data.aiInsight = await getAIBusinessAndHalalInsight(symbol, data.name);
                data.aiInsight.lastUpdated = now; // 🕒 บันทึกเวลาที่ดึงข้อมูลล่าสุด
            } else {
                // ถ้ามีแล้วและยังไม่หมดอายุ ให้ดึงของเดิมมาใช้เลย (ประหยัด API)
                data.aiInsight = cacheData[symbol].aiInsight;
            }

            cacheData[symbol] = data;
            
            if (data.historicalPrices.length > 0) {
                const ema20 = calculateEMA(data.historicalPrices, 20);
                const ema50 = calculateEMA(data.historicalPrices, 50);
                const trend = ema20 > ema50 ? '📈 ขาขึ้น' : '📉 ขาลง';
                
                const currentState = determineState(data.rsi);
                const lastAlertedState = stockStates[symbol];

                if (currentState !== 'NEUTRAL') {
                    if (currentState !== lastAlertedState) {
                        let alertTitle = '';
                        if (currentState === 'STRONG_BUY') alertTitle = '🚨 <b>ซื้ออย่างยิ่ง (Strong Buy)</b>';
                        else if (currentState === 'BUY') alertTitle = '🟢 <b>สัญญาณซื้อ (Buy)</b>';
                        else if (currentState === 'SELL') alertTitle = '🔴 <b>สัญญาณขาย (Sell)</b>';
                        else if (currentState === 'STRONG_SELL') alertTitle = '💥 <b>ขายตัดทุน (Strong Sell)</b>';

                        if (isMarketOpen() && data.isHalal) {
                            // แจ้งเตือนผ่าน Telegram แบบใหม่ พ่วงสรุป AI
                            sendTelegramMessage(`${alertTitle}\n📌 หุ้น: <b>${symbol}</b> (${data.name})\n💰 ราคา: $${data.price}\n📊 RSI: ${data.rsi}\nทิศทาง (EMA): ${trend}\n🕌 หนี้สิน: ${data.debtRatio}%\n\n🏢 <b>ธุรกิจ:</b> ${data.aiInsight.business}\n⚖️ <b>ความเสี่ยง:</b> ${data.aiInsight.halalRisk}`);
                            stockStates[symbol] = currentState; 
                        }
                    }
                } else {
                    if (lastAlertedState && lastAlertedState !== 'NEUTRAL') {
                        stockStates[symbol] = 'NEUTRAL';
                    }
                }
            }
            
            initProgress = i + 1;
            console.log(`✅ อัปเดต ${symbol} สำเร็จ (${initProgress}/${WATCHLIST.length})`);
        } catch (err) {
            console.log(`⚠️ ดึงข้อมูล ${symbol} พลาด: ${err.message}`);
        }
        await delay(2500); 
    }
    isReady = true;
    console.log('✅ โหลดข้อมูลและให้ AI วิเคราะห์ครบ 100% พร้อมให้บริการหน้าเว็บแล้ว!');
}

app.get('/', (req, res) => res.send('🚀 เครื่องยนต์ทำงานปกติ และตื่นอยู่เสมอ!'));
app.get('/api/stocks', (req, res) => { 
    res.json({
        isReady: isReady,
        progress: initProgress,
        total: WATCHLIST.length,
        data: Object.values(cacheData)
    }); 
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 พร้อมที่พอร์ต ${PORT}`);
    sendTelegramMessage('🚀 <b>บอทฮาลาล (อัปเกรด AI) สตาร์ทเครื่องแล้ว!</b>\nระบบกำลังดึงงบการเงินและวิเคราะห์ธุรกิจ (รอสักครู่)...');
    updateAllStocks(); 
    setInterval(updateAllStocks, 15 * 60 * 1000); 
});