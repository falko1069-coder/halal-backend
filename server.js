import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';

const app = express();
app.use(cors());

const TELEGRAM_TOKEN = (process.env.TELEGRAM_TOKEN || '').trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();

// 🌎 ตะกร้าหุ้นรวม: คัดเฉพาะหุ้นที่คลีนจาก BDS และเกาะเมกะเทรนด์โลก (US 15 ตัว + TH 8 ตัว = 23 ตัว)
const WATCHLIST = [
    // หุ้นอเมริกา & เมกะเทรนด์โลก (US Market - ตัด AAPL, MSFT, GOOGL, CSCO, CAT ออกแล้ว)
    'HLAL', 'PCOR', 'SPUS', 'TSM', 'ASML', 
    'ANET', 'ADBE', 'CRM', 'AMD', 'ISRG', 
    'TSLA', 'FSLR', 'LLY', 'JNJ', 'TXN',
    // หุ้นไทย (Thai SET Market)
    'BDMS.BK', 'BH.BK', 'ADVANC.BK', 'HMPRO.BK', 
    'AOT.BK', 'DELTA.BK', 'PTTEP.BK', 'GULF.BK'
]; 

// 🛡️ ฐานข้อมูลงบการเงินรายไตรมาสสำรอง (ทำงานอัตโนมัติเมื่อ Yahoo บล็อก IP ของ Render)
const FINANCIAL_FALLBACK = {
    'HLAL':      { name: 'Wahed FTSE USA Shariah ETF', debtM: 0, assetsM: 580, ratio: '0.0', business: 'กองทุน ETF ที่ลงทุนในหุ้นสหรัฐฯ ขนาดใหญ่และขนาดกลางที่ผ่านเกณฑ์ชะรีอะฮ์', risk: 'ไม่มีความเสี่ยงด้านหนี้สินดอกเบี้ย เนื่องจากคัดกรองตามมาตรฐานฮาลาลแล้ว' },
    'PCOR':      { name: 'Procore Technologies Inc.', debtM: 92, assetsM: 10800, ratio: '0.9', business: 'พัฒนาซอฟต์แวร์ระบบคลาวด์สำหรับบริหารจัดการงานก่อสร้างครบวงจร', risk: 'รายได้มาจากค่าสมาชิกซอฟต์แวร์ (SaaS) สัดส่วนหนี้สินต่ำมาก ไม่มีความเสี่ยงต้องห้าม' },
    'SPUS':      { name: 'SP Funds S&P 500 Shariah ETF', debtM: 0, assetsM: 920, ratio: '0.0', business: 'กองทุน ETF อ้างอิงดัชนี S&P 500 เฉพาะบริษัทที่ผ่านเกณฑ์ศาสนาอิสลาม', risk: 'คัดกรองหุ้นที่มีหนี้สินต่ำกว่า 33% และไร้ธุรกิจต้องห้ามตามหลักชะรีอะฮ์' },
    'TSM':       { name: 'Taiwan Semiconductor (TSMC)', debtM: 58000, assetsM: 910000, ratio: '6.4', business: 'โรงงานรับจ้างผลิตชิปเซมิคอนดักเตอร์และชิป AI อันดับ 1 ของโลกจากไต้หวัน', risk: 'สัดส่วนหนี้สินต่ำเพียง 6.4% รายได้มาจากการผลิตฮาร์ดแวร์ชิปต้นน้ำ ผ่านเกณฑ์ฮาลาลและคลีนจาก BDS' },
    'ASML':      { name: 'ASML Holding N.V.', debtM: 14500, assetsM: 380000, ratio: '3.8', business: 'ผู้ผูกขาดการผลิตเครื่องฉายแสงลิโทกราฟี (EUV) สำหรับผลิตชิปขั้นสูงรายเดียวในโลก (เนเธอร์แลนด์)', risk: 'หนี้สินต่อมูลค่าตลาดต่ำมาก (3.8%) ธุรกิจเครื่องจักรผลิตชิปผ่านเกณฑ์ฮาลาลชัดเจน' },
    'ANET':      { name: 'Arista Networks Inc.', debtM: 0, assetsM: 118000, ratio: '0.0', business: 'ผู้นำด้านสวิตช์เครือข่ายความเร็วสูงและซอฟต์แวร์ระบบคลาวด์สำหรับ AI Data Center', risk: 'บริษัทไร้หนี้สินที่มีดอกเบี้ย (Debt 0.0%) งบการเงินคลีนและผ่านเกณฑ์ฮาลาล 100%' },
    'ADBE':      { name: 'Adobe Inc.', debtM: 5600, assetsM: 215000, ratio: '2.6', business: 'ผู้พัฒนาซอฟต์แวร์สร้างสรรค์ระดับโลก เช่น Photoshop, Illustrator และ Acrobat', risk: 'รายได้หลักจากระบบสมาชิก Creative Cloud งบการเงินแข็งแกร่งและหนี้ต่ำมาก' },
    'CRM':       { name: 'Salesforce Inc.', debtM: 11800, assetsM: 285000, ratio: '4.1', business: 'ผู้นำซอฟต์แวร์บริหารความสัมพันธ์ลูกค้า (CRM) บนระบบคลาวด์สำหรับองค์กร', risk: 'สัดส่วนหนี้สินราว 4.1% ต่ำกว่าเพดาน 33% อย่างปลอดภัย ธุรกิจหลักฮาลาล' },
    'AMD':       { name: 'Advanced Micro Devices', debtM: 2470, assetsM: 248000, ratio: '1.0', business: 'ออกแบบและผลิตชิปประมวลผล CPU, GPU และชิป AI สำหรับ Data Center', risk: 'หนี้สินต่ำเพียง 1.0% รายได้จากการขายฮาร์ดแวร์และเซมิคอนดักเตอร์เป็นฮาลาลชัดเจน' },
    'ISRG':      { name: 'Intuitive Surgical Inc.', debtM: 0, assetsM: 185000, ratio: '0.0', business: 'ผู้นำระดับโลกด้านหุ่นยนต์ช่วยผ่าตัดอัจฉริยะ (Da Vinci Surgical System) และอุปกรณ์การแพทย์', risk: 'ไร้หนี้สินที่มีดอกเบี้ย (0.0%) ธุรกิจนวัตกรรมการแพทย์ช่วยชีวิตผู้ป่วย ผ่านเกณฑ์ฮาลาล 100%' },
    'TSLA':      { name: 'Tesla Inc.', debtM: 12700, assetsM: 1020000, ratio: '1.2', business: 'ผลิตรถยนต์ไฟฟ้า (EV) ระบบกักเก็บพลังงานแบตเตอรี่ และเทคโนโลยีขับเคลื่อนอัตโนมัติ', risk: 'หนี้สินต่อมูลค่าตลาดต่ำมาก (1.2%) มีบริการสินเชื่อรถยนต์บางส่วนแต่สัดส่วนไม่เกินเกณฑ์' },
    'FSLR':      { name: 'First Solar Inc.', debtM: 620, assetsM: 24000, ratio: '2.6', business: 'ผู้ผลิตแผงโซลาร์เซลล์เทคโนโลยี Thin-Film ชั้นนำสำหรับโรงไฟฟ้าพลังงานแสงอาทิตย์และ Data Center', risk: 'หนี้สินต่ำมากเพียง 2.6% ธุรกิจพลังงานสะอาดเป็นมิตรต่อสิ่งแวดล้อมและผ่านเกณฑ์ฮาลาล' },
    'LLY':       { name: 'Eli Lilly and Company', debtM: 31200, assetsM: 760000, ratio: '4.1', business: 'วิจัยและผลิตยาแผนปัจจุบันระดับโลก โดดเด่นด้านยาเบาหวาน ลดน้ำหนัก และมะเร็ง', risk: 'ธุรกิจเวชภัณฑ์เป็นประโยชน์ต่อสุขภาพ สัดส่วนหนี้สินต่ำเพียง 4.1%' },
    'JNJ':       { name: 'Johnson & Johnson', debtM: 36500, assetsM: 378000, ratio: '9.7', business: 'ผู้นำด้านเวชภัณฑ์ยารักษาโรคและเครื่องมือแพทย์ระดับโลก (MedTech)', risk: 'หนี้สินต่อมูลค่าตลาดราว 9.7% ต่ำกว่าเกณฑ์ 33% ธุรกิจหลักอยู่ในหมวดการแพทย์' },
    'TXN':       { name: 'Texas Instruments Inc.', debtM: 14100, assetsM: 178000, ratio: '7.9', business: 'ผลิตชิปอนาล็อกและเซมิคอนดักเตอร์สำหรับอุตสาหกรรมยานยนต์และอิเล็กทรอนิกส์', risk: 'สัดส่วนหนี้สิน 7.9% อยู่ในโซนปลอดภัย รายได้มาจากการผลิตชิ้นส่วนอิเล็กทรอนิกส์' },
    'BDMS.BK':   { name: 'Bangkok Dusit Medical Services', debtM: 18500, assetsM: 429000, ratio: '4.3', business: 'เครือข่ายโรงพยาบาลเอกชนขนาดใหญ่ที่สุดในไทย (รพ.กรุงเทพ, สมิติเวช, พญาไท, เปาโล)', risk: 'ธุรกิจการแพทย์ถูกต้องตามหลักศาสนา สัดส่วนหนี้สินต่ำมากเพียง 4.3%' },
    'BH.BK':     { name: 'Bumrungrad Hospital PCL', debtM: 320, assetsM: 158000, ratio: '0.2', business: 'โรงพยาบาลเอกชนระดับพรีเมียม รองรับผู้ป่วยไทยและต่างชาติ โดยเฉพาะกลุ่มตะวันออกกลาง', risk: 'แทบไม่มีหนี้สินที่มีดอกเบี้ยเลย (0.2%) และมีบริการรองรับผู้ป่วยมุสลิมอย่างครบวงจร' },
    'ADVANC.BK': { name: 'Advanced Info Service PCL (AIS)', debtM: 124000, assetsM: 815000, ratio: '15.2', business: 'ผู้ให้บริการโครงข่ายโทรศัพท์เคลื่อนที่ 5G อินเทอร์เน็ตบ้าน AIS Fibre และบริการดิจิทัล', risk: 'มีหนี้จากการลงทุนคลื่นความถี่และโครงข่ายราว 15.2% แต่ยังต่ำกว่าเกณฑ์ 33% อย่างปลอดภัย' },
    'HMPRO.BK':  { name: 'Home Product Center PCL', debtM: 19800, assetsM: 132000, ratio: '15.0', business: 'ผู้นำธุรกิจค้าปลีกวัสดุก่อสร้าง สินค้าตกแต่งซ่อมแซมบ้าน และเครื่องใช้ไฟฟ้า (โฮมโปร)', risk: 'ธุรกิจค้าปลีกสินค้าของใช้ในบ้านไม่ขัดหลักศาสนา สัดส่วนหนี้สินอยู่ที่ 15.0%' },
    'AOT.BK':    { name: 'Airports of Thailand PCL', debtM: 58200, assetsM: 857000, ratio: '6.8', business: 'บริหารจัดการท่าอากาศยานหลัก 6 แห่งของไทย (สุวรรณภูมิ, ดอนเมือง, ภูเก็ต, เชียงใหม่ ฯลฯ)', risk: 'หนี้สินต่ำ (6.8%) แต่มีรายได้บางส่วนจากสัมปทานพื้นที่ร้านค้าปลอดภาษี ควรทำ Purification เงินปันผล' },
    'DELTA.BK':  { name: 'Delta Electronics (Thailand)', debtM: 4200, assetsM: 1620000, ratio: '0.3', business: 'ผลิตและส่งออกชิ้นส่วนอิเล็กทรอนิกส์ ระบบจัดการพลังงานสำหรับ Data Center และรถยนต์ไฟฟ้า', risk: 'งบการเงินแข็งแกร่งมาก หนี้สินต่อมูลค่าตลาดเพียง 0.3% ธุรกิจเทคโนโลยีสะอาดผ่านเกณฑ์ฮาลาล' },
    'PTTEP.BK':  { name: 'PTT Exploration & Production', debtM: 108000, assetsM: 575000, ratio: '18.8', business: 'สำรวจและผลิตปิโตรเลียมและก๊าซธรรมชาติทั้งในประเทศไทยและต่างประเทศ', risk: 'ธุรกิจพลังงานต้นน้ำเป็นฮาลาล สัดส่วนหนี้สินราว 18.8% ต่ำกว่าเพดาน 33%' },
    'GULF.BK':   { name: 'Gulf Energy Development PCL', debtM: 285000, assetsM: 690000, ratio: '41.3', business: 'ผลิตไฟฟ้าจากก๊าซธรรมชาติ พลังงานหมุนเวียน โครงสร้างพื้นฐาน และธุรกิจดิจิทัล', risk: 'สัดส่วนหนี้สินจากโครงการโรงไฟฟ้าอยู่ที่ราว 41.3% ซึ่งเกินเพดาน 33% จึงไม่ผ่านเกณฑ์ด้านหนี้สิน' }
};

const stockStates = {}; 
let cacheData = {}; 
let isReady = false; 
let initProgress = 0; 
let yahooCookie = '';
let yahooCrumb = '';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function isThaiStock(symbol) {
    return Boolean(symbol && symbol.toUpperCase().endsWith('.BK'));
}

async function sendTelegramMessage(text) {
    if (!TELEGRAM_TOKEN) return; 
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text, parse_mode: 'HTML' })
        });
    } catch (error) { 
        console.error('❌ ส่งข้อความพลาด:', error.message); 
    }
}

// 🧠 ฟังก์ชัน AI วิเคราะห์ธุรกิจและความเสี่ยงฮาลาล (อัปเดตโมเดล Gemini + ระบบสำรอง)
async function getAIBusinessAndHalalInsight(symbol, name) {
    const fallbackInfo = FINANCIAL_FALLBACK[symbol];
    let insight = {
        business: fallbackInfo ? fallbackInfo.business : "ดำเนินธุรกิจหลักตามหมวดอุตสาหกรรมของบริษัทจดทะเบียน",
        halalRisk: fallbackInfo ? fallbackInfo.risk : "ตรวจสอบสัดส่วนหนี้สินเทียบเกณฑ์มาตรฐาน AAOIFI ไม่เกิน 33%"
    };

    if (GEMINI_API_KEY) {
        try {
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            const marketName = isThaiStock(symbol) ? "ตลาดหลักทรัพย์แห่งประเทศไทย (SET)" : "ตลาดหุ้นสหรัฐอเมริกา (US)";

            const prompt = `
คุณคือนักวิเคราะห์หุ้นอิสลาม โปรดวิเคราะห์บริษัท ${symbol} (${name}) ซึ่งจดทะเบียนใน${marketName} อย่างกระชับที่สุด
คำสั่ง:
1. Business: บริษัทนี้ทำธุรกิจอะไร รายได้หลักมาจากไหน (ไม่เกิน 2 บรรทัด)
2. Halal Risk: มีความเสี่ยงเรื่องรายได้ต้องห้ามตามหลักอิสลามไหม (เช่น ดอกเบี้ยรับที่สูง, อาวุธ, แอลกอฮอล์, การพนัน, เนื้อสัตว์ต้องห้าม) (ไม่เกิน 2 บรรทัด)

รูปแบบการตอบ (ห้ามเปลี่ยนคำนำหน้า):
ธุรกิจ: [คำตอบ]
ความเสี่ยง: [คำตอบ]`;

            const result = await model.generateContent(prompt);
            const text = result.response.text().trim();
            
            const lines = text.split('\n');
            lines.forEach(line => {
                if (line.startsWith('ธุรกิจ:')) insight.business = line.replace('ธุรกิจ:', '').trim();
                if (line.startsWith('ความเสี่ยง:')) insight.halalRisk = line.replace('ความเสี่ยง:', '').trim();
            });
        } catch (e) {
            console.log(`ℹ️ ใช้ข้อมูลสรุปมาตรฐานสำหรับ ${symbol} (${e.message})`);
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

// ⏰ ฟังก์ชันตรวจสอบเวลาตลาดเปิด (แยกตามสัญชาติหุ้น)
function isMarketOpen(symbol) {
    const now = new Date();
    const day = now.getUTCDay(); 
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    const time = hour + (minute / 60);
    
    if (day === 0 || day === 6) return false;

    if (isThaiStock(symbol)) {
        const isMorningOpen = (time >= 3.0 && time <= 5.5);
        const isAfternoonOpen = (time >= 7.0 && time <= 9.5);
        return isMorningOpen || isAfternoonOpen;
    } else {
        return (time >= 14.5 && time < 20.0);
    }
}

function determineState(rsi) {
    if (rsi <= 20) return 'STRONG_BUY';  
    if (rsi <= 30) return 'BUY';         
    if (rsi >= 80) return 'STRONG_SELL'; 
    if (rsi >= 70) return 'SELL';        
    return 'NEUTRAL';                    
}

// 🔑 ปรับปรุงการดึง Cookie & Crumb ของ Yahoo ให้คัดกรองข้อความ Error ออกอย่างแม่นยำ
async function getYahooAuth() {
    if (yahooCookie && yahooCrumb) return { cookie: yahooCookie, crumb: yahooCrumb };
    try {
        const headers = { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5'
        };

        const resCookie = await fetch('https://fc.yahoo.com', { headers });
        const rawCookies = typeof resCookie.headers.getSetCookie === 'function'
            ? resCookie.headers.getSetCookie()
            : [resCookie.headers.get('set-cookie') || ''];
        const cleanCookie = rawCookies.map(c => c.split(';')[0]).filter(Boolean).join('; ');
        if (!cleanCookie) throw new Error('ไม่ได้รับ Cookie');
        
        const resCrumb = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
            headers: { ...headers, 'Cookie': cleanCookie }
        });
        if (!resCrumb.ok) throw new Error('Crumb HTTP ' + resCrumb.status);
        const crumbStr = (await resCrumb.text()).trim();
        
        // ป้องกันกรณี Yahoo ส่งข้อความ "Too Many Requests" กลับมาแทนรหัส Crumb
        if (!crumbStr || crumbStr.length > 25 || crumbStr.includes('<html>') || crumbStr.includes('Too Many') || crumbStr.includes('{')) {
            throw new Error('Crumb ถูกจำกัดการเข้าถึง');
        }
        
        yahooCookie = cleanCookie;
        yahooCrumb = crumbStr;
        return { cookie: yahooCookie, crumb: yahooCrumb };
    } catch (e) {
        yahooCookie = ''; 
        yahooCrumb = '';
        return { cookie: '', crumb: '' };
    }
}

async function fetchStockDataNative(symbol) {
    const fallback = FINANCIAL_FALLBACK[symbol] || { name: symbol, debtM: 0, assetsM: 1000, ratio: '0.0' };
    let currentPrice = 0, changePercent = 0, prices = [], chartSeries = [];
    let name = fallback.name;

    try {
        const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=60d`;
        const chartRes = await fetch(chartUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const chartData = await chartRes.json();
        const result = chartData.chart.result[0];
        
        if (result.meta?.shortName || result.meta?.longName) {
            name = result.meta.shortName || result.meta.longName;
        }

        currentPrice = Math.round((result.meta.regularMarketPrice || 0) * 100) / 100;
        const timestamps = result.timestamp || [];
        const closes = result.indicators.quote[0].close || [];
        
        const thirtyAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

        for (let i = 0; i < closes.length; i++) {
            if (closes[i] !== null && closes[i] !== undefined) {
                const roundedClose = Math.round(closes[i] * 100) / 100;
                prices.push(roundedClose);
                const date = new Date(timestamps[i] * 1000);
                if (date.getTime() >= thirtyAgo) {
                    chartSeries.push({
                        dateLabel: `${months[date.getMonth()]} ${date.getDate()}`,
                        t: `${months[date.getMonth()]} ${date.getDate()}`,
                        price: roundedClose
                    });
                }
            }
        }

        // ✅ คำนวณ % เปลี่ยนแปลงรายวันเทียบกับราคาปิดของวันก่อนหน้า
        const prevDayClose = prices.length >= 2 ? prices[prices.length - 2] : (result.meta.regularMarketPreviousClose || currentPrice);
        changePercent = prevDayClose > 0 ? Math.round(((currentPrice - prevDayClose) / prevDayClose) * 10000) / 100 : 0;
    } catch (e) {
        console.log(`⚠️ ข้ามกราฟของ ${symbol}: ${e.message}`);
    }

    // ค่าเริ่มต้นจากฐานข้อมูลงบการเงินรายไตรมาส (ป้องกันค่าเป็น 0.0% / N/A เมื่อ Yahoo บล็อก IP)
    let debtM = fallback.debtM;
    let assetsM = fallback.assetsM;
    let debtRatioStr = fallback.ratio;
    let isPass = Number(debtRatioStr) <= 33;

    // พยายามดึงงบการเงินสดจาก Yahoo หากไม่ถูกบล็อก
    try {
        const auth = await getYahooAuth();
        if (auth.crumb) {
            const finUrl = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=financialData,price&crumb=${encodeURIComponent(auth.crumb)}`;
            const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Cookie': auth.cookie };

            const finRes = await fetch(finUrl, { headers });
            if (finRes.ok) {
                const finData = await finRes.json();
                const finResult = finData?.quoteSummary?.result?.[0];
                if (finResult) {
                    name = finResult.price?.shortName || finResult.price?.longName || name;
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
            } else {
                yahooCookie = '';
                yahooCrumb = '';
            }
        }
    } catch (e) {
        // หาก Yahoo บล็อก IP จะใช้ค่าจาก FINANCIAL_FALLBACK โดยอัตโนมัติ
    }

    const rsi = prices.length > 0 ? calculateRSI(prices) : 50;
    const supportLevel = prices.length > 0 ? Math.round(Math.min(...prices) * 100) / 100 : 0;
    const resistanceLevel = prices.length > 0 ? Math.round(Math.max(...prices) * 100) / 100 : 0;
    const isTH = isThaiStock(symbol);

    return {
        symbol, 
        name, 
        market: isTH ? 'TH' : 'US',
        currency: isTH ? '฿' : '$',
        price: currentPrice, 
        change: changePercent,
        chartSeries, 
        historicalPrices: prices, 
        supportLevel, 
        resistanceLevel,
        rsi, 
        debtRatio: debtRatioStr, 
        totalDebt: debtM, 
        totalAssets: assetsM, 
        isHalal: isPass
    };
}

async function updateAllStocks() {
    console.log('🔄 เริ่มดึงข้อมูลหุ้น US และ TH พร้อมงบการเงินและ AI...');
    for (let i = 0; i < WATCHLIST.length; i++) {
        const symbol = WATCHLIST[i];
        try {
            const data = await fetchStockDataNative(symbol);
            
            const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
            const now = Date.now();

            if (!cacheData[symbol] || !cacheData[symbol].aiInsight || !cacheData[symbol].aiInsight.lastUpdated || (now - cacheData[symbol].aiInsight.lastUpdated > SEVEN_DAYS_MS)) {
                data.aiInsight = await getAIBusinessAndHalalInsight(symbol, data.name);
                data.aiInsight.lastUpdated = now;
            } else {
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
                        let actionAdvice = '';

                        if (currentState === 'STRONG_BUY') {
                            alertTitle = '🚨 <b>จังหวะช้อนซื้อโซนถูกจัด (Strong Buy / Extreme Oversold)</b>';
                            actionAdvice = 'ราคาย่อลงมาลึกมาก แนะนำพิจารณาทยอยช้อนซื้อสะสม';
                        } else if (currentState === 'BUY') {
                            alertTitle = '🟢 <b>สัญญาณเข้าซื้อโซนราคาถูก (Buy / Oversold)</b>';
                            actionAdvice = 'ราคาอ่อนตัวลงมาในจุดได้เปรียบ สามารถแบ่งไม้เข้าซื้อได้';
                        } else if (currentState === 'SELL') {
                            alertTitle = '🟠 <b>สัญญาณแบ่งขายทำกำไร / ราคาเริ่มตึง (Take Profit / Overbought)</b>';
                            actionAdvice = 'ราคาวิ่งขึ้นมาสูงในระยะสั้น มีหุ้นอยู่พิจารณาแบ่งขายล็อกกำไร ยังไม่มีห้ามไล่ราคา';
                        } else if (currentState === 'STRONG_SELL') {
                            alertTitle = '💰 <b>สัญญาณขายล็อกกำไร / ราคาพุ่งตึงจัด (Strong Take Profit / Extreme Overbought)</b>';
                            actionAdvice = 'ราคาพุ่งแรงจนตึงตัวมาก แนะนำแบ่งขายทำกำไรเข้ากระเป๋า และงดไล่ราคาเด็ดขาด';
                        }

                        if (isMarketOpen(symbol) && data.isHalal) {
                            const flag = data.market === 'TH' ? '🇹🇭' : '🇺🇸';
                            const curr = data.currency;
                            
                            sendTelegramMessage(`${alertTitle}\n${flag} หุ้น: <b>${symbol}</b> (${data.name})\n💰 ราคา: ${curr}${data.price}\n📊 RSI (14D): ${data.rsi}\nทิศทาง (EMA): ${trend}\n🕌 หนี้สิน: ${data.debtRatio}%\n💡 <b>คำแนะนำ:</b> ${actionAdvice}\n\n🏢 <b>ธุรกิจ:</b> ${data.aiInsight.business}\n⚖️ <b>ความเสี่ยง:</b> ${data.aiInsight.halalRisk}`);
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
            console.log(`✅ อัปเดต ${symbol} สำเร็จ (${initProgress}/${WATCHLIST.length}) - หนี้สิน: ${data.debtRatio}%`);
        } catch (err) {
            console.log(`⚠️ ดึงข้อมูล ${symbol} พลาด: ${err.message}`);
        }
        await delay(1500); 
    }
    isReady = true;
    console.log('✅ โหลดข้อมูลและงบการเงินครบ 100% พร้อมให้บริการหน้าเว็บแล้ว!');
}

app.get('/', (req, res) => res.send('🚀 เครื่องยนต์ทำงานปกติ รองรับทั้งตลาด US และ TH (BDS-Free Edition)!'));
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
    sendTelegramMessage('🚀 <b>บอทฮาลาล (US & TH Market + AI) อัปเดตระบบแจ้งเตือน RSI และตะกร้าหุ้นใหม่สำเร็จ!</b>\nกำลังซิงค์ข้อมูลล่าสุด...');
    updateAllStocks(); 
    setInterval(updateAllStocks, 15 * 60 * 1000); 
});