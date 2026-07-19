import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const WATCHLIST = [
    'HLAL', 'PCOR', 'SPUS', 'AAPL', 'MSFT', 
    'GOOGL', 'ADBE', 'CRM', 'AMD', 'CSCO', 
    'TSLA', 'CAT', 'LLY', 'JNJ', 'TXN'
]; 

// 🎯 [เพิ่มใหม่]: สมุดจดจำสถานะหุ้น (Anti-Spam Alert)
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

// 🎯 [อัปเดตใหม่]: เปลี่ยนเวลาตลาดเป็น 21:30 - 03:00 น. (เวลาไทย)
function isMarketOpen() {
    const now = new Date();
    const day = now.getUTCDay(); 
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    const time = hour + (minute / 60);
    if (day === 0 || day === 6) return false;
    // 14.5 UTC = 21:30 BKK | 20.0 UTC = 03:00 BKK
    return (time >= 14.5 && time < 20.0);
}

// 🎯 [เพิ่มใหม่]: ฟังก์ชันแยกแยะสถานะหุ้นตาม RSI
function determineState(rsi) {
    if (rsi <= 20) return 'STRONG_BUY';  // ซื้ออย่างยิ่ง
    if (rsi <= 30) return 'BUY';         // ซื้อ
    if (rsi >= 80) return 'STRONG_SELL'; // ขายตัดทุน
    if (rsi >= 70) return 'SELL';        // ขาย
    return 'NEUTRAL';                    // อยู่ในโซนปกติ
}

// 🔑 อัปเกรดฟังก์ชัน: จำแลงกายไปขโมย Cookie ให้เนียนกว่าเดิม
async function getYahooAuth() {
    if (yahooCookie && yahooCrumb) return { cookie: yahooCookie, crumb: yahooCrumb };
    try {
        console.log('🔑 กำลังสร้าง Cookie ยืนยันตัวตนกับ Yahoo...');
        
        // เพิ่ม Headers ให้เหมือนเบราว์เซอร์ของคนจริงๆ มากที่สุดเพื่อหลบ Anti-Bot
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
        
        // ดักจับกรณีที่ Yahoo จับได้แล้วส่งหน้า Error HTML กลับมาแทน Crumb
        if (crumbStr.includes('<html>')) throw new Error('Crumb ถูกบล็อกโดย Yahoo');
        
        yahooCookie = cookieStr;
        yahooCrumb = crumbStr;
        console.log('🔓 ปลดล็อกงบการเงินสำเร็จ!');
        return { cookie: yahooCookie, crumb: yahooCrumb };
    } catch (e) {
        console.log(`⚠️ ดึง Cookie ไม่สำเร็จ (${e.message}) จะใช้โหมดสำรองชั่วคราว`);
        // รีเซ็ตค่าเพื่อเปิดโอกาสให้ระบบลองเจาะเกราะใหม่ในรอบ 15 นาทีถัดไป
        yahooCookie = ''; 
        yahooCrumb = '';
        return { cookie: '', crumb: '' };
    }
}

// ฟังก์ชันดึงข้อมูล (คงเดิม 100%)
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
    console.log('🔄 เริ่มดึงข้อมูลด้วยเทคนิค Native API + Authentication Bypass...');
    for (let i = 0; i < WATCHLIST.length; i++) {
        const symbol = WATCHLIST[i];
        try {
            const data = await fetchStockDataNative(symbol);
            cacheData[symbol] = data;
            
            // 🎯 [อัปเดตใหม่]: ระบบตรวจจับสถานะและกันสแปม
            if (data.historicalPrices.length > 0) {
                const ema20 = calculateEMA(data.historicalPrices, 20);
                const ema50 = calculateEMA(data.historicalPrices, 50);
                const trend = ema20 > ema50 ? '📈 ขาขึ้น' : '📉 ขาลง';
                
                const currentState = determineState(data.rsi);
                const lastAlertedState = stockStates[symbol];

                if (currentState !== 'NEUTRAL') {
                    // แจ้งเตือนเฉพาะ "สถานะที่เปลี่ยนไป" และตลาดต้องเปิด & หุ้นต้องผ่านฮาลาล
                    if (currentState !== lastAlertedState) {
                        let alertTitle = '';
                        if (currentState === 'STRONG_BUY') alertTitle = '🚨 <b>ซื้ออย่างยิ่ง (Strong Buy)</b>';
                        else if (currentState === 'BUY') alertTitle = '🟢 <b>สัญญาณซื้อ (Buy)</b>';
                        else if (currentState === 'SELL') alertTitle = '🔴 <b>สัญญาณขาย (Sell)</b>';
                        else if (currentState === 'STRONG_SELL') alertTitle = '💥 <b>ขายตัดทุน (Strong Sell)</b>';

                        if (isMarketOpen() && data.isHalal) {
                            sendTelegramMessage(`${alertTitle}\n📌 หุ้น: <b>${symbol}</b>\n💰 ราคา: $${data.price}\n📊 RSI: ${data.rsi}\nทิศทาง (EMA): ${trend}\n🕌 หนี้สิน: ${data.debtRatio}%`);
                            stockStates[symbol] = currentState; // อัปเดตสมุดจด
                        }
                    }
                } else {
                    // หากกลับมาโซนปกติ (RSI 31-69) ให้ลบสมุดจด รอแจ้งเตือนรอบใหม่
                    if (lastAlertedState && lastAlertedState !== 'NEUTRAL') {
                        stockStates[symbol] = 'NEUTRAL';
                    }
                }
            }
            
            initProgress = i + 1;
            console.log(`✅ อัปเดต ${symbol} สำเร็จ (${initProgress}/15)`);
        } catch (err) {
            console.log(`⚠️ ดึงข้อมูล ${symbol} พลาด: ${err.message}`);
        }
        await delay(2500); 
    }
    isReady = true;
    console.log('✅ โหลดข้อมูลครบ 100% พร้อมให้บริการหน้าเว็บแล้ว!');
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
    sendTelegramMessage('🚀 <b>บอทสตาร์ทเครื่องแล้ว!</b>\nระบบกำลังดึงงบการเงินและกราฟแบบเจาะเกราะ (รอสักครู่)...');
    updateAllStocks(); 
    setInterval(updateAllStocks, 15 * 60 * 1000); 
});
