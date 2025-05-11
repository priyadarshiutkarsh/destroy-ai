const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => res.json({ status: 'healthy' }));

// JotForm result handler
app.post('/result', async (req, res) => {
    try {
        const submission = req.body;
        let textToHumanize = '';

        for (const [key, value] of Object.entries(submission)) {
            if (key.includes('email') || key.includes('name')) continue;
            if (typeof value === 'string' && value.length > 20) {
                textToHumanize = value;
                break;
            }
        }

        console.log('Text to humanize:', textToHumanize);
        const humanized = await humanizeWithRewritifyAI(textToHumanize.trim());

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Humanized Result</title>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; }
                    .container { background: #f5f5f5; padding: 30px; border-radius: 10px; }
                    .result, .original { white-space: pre-wrap; background: white; padding: 20px; border-radius: 5px; margin-top: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Thank You!</h1>
                    <p>Your text has been humanized with Rewritify AI:</p>
                    <div class="original"><strong>Original:</strong><br>${textToHumanize}</div>
                    <div class="result"><strong>Humanized:</strong><br>${humanized}</div>
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        console.error('Error in /result:', err);
        res.status(500).send('Error processing your request');
    }
});

// Rewritify automation
async function humanizeWithRewritifyAI(text) {
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    try {
        console.log("🌐 Launching Rewritify...");
        await page.goto('https://rewritify.ai/', { waitUntil: 'domcontentloaded', timeout: 60000 });

        await page.waitForSelector('div.tiptap.ProseMirror[contenteditable="true"]', { timeout: 10000 });
        console.log("✏️ Filling input...");
        await page.fill('div.tiptap.ProseMirror[contenteditable="true"]', text);
        await page.waitForTimeout(1000);

        console.log("🚀 Clicking Humanize...");
        await page.click('button:has-text("Humanize")');
        await page.waitForTimeout(8000);

        let result = '';
        for (let i = 0; i < 15; i++) {
            await page.waitForTimeout(1000);
            result = await page.evaluate(() => {
                const el = document.querySelector(
                    '#outputView div.tiptap.ProseMirror[contenteditable="false"]'
                );
                return el?.innerText?.trim() || '';
            });
            if (result.length > 50) break;
        }

        return result || 'Processing completed but no humanized text was returned.';
    } catch (err) {
        console.error("❌ Automation error:", err.message);
        return `Error: ${err.message}`;
    } finally {
        await browser.close();
    }
}

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
});
