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

// Form result handler
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

// Rewritify automation core
async function humanizeWithRewritifyAI(text) {
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    try {
        console.log("Launching Rewritify...");
        await page.goto('https://rewritify.ai/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(4000);

        console.log("Typing input...");
        await page.click('div.tiptap.ProseMirror[contenteditable="true"]');
        await page.keyboard.type(text, { delay: 10 });

        console.log("Clicking humanize...");
        await page.click('button:has-text("Humanize")');
        await page.waitForTimeout(8000);

        // 🧠 Log all ProseMirror blocks
        const proseBlocks = await page.evaluate(() => {
            const blocks = Array.from(document.querySelectorAll('div.tiptap.ProseMirror'));
            return blocks.map(el => ({
                content: el.textContent?.trim(),
                readOnly: el.getAttribute('contenteditable'),
                className: el.className
            }));
        });
        console.log("🧩 ProseMirror blocks:\n", proseBlocks);

        // 🧠 Try extracting from read-only ProseMirror
        let result = '';
        for (let i = 0; i < 15; i++) {
            await page.waitForTimeout(1000);
            result = await page.evaluate(() => {
                const el = document.querySelector('div.tiptap.ProseMirror[contenteditable="false"]');
                return el?.innerText?.trim() || '';
            });
            if (result.length > 50) break;
        }

        if (!result) {
            console.log("⚠️ Fallback: dumping full page text...");
            const allText = await page.evaluate(() => document.body.innerText);
            console.log("📄 Page dump:\n", allText.slice(0, 500) + '...');
        }

        return result || 'Processing completed but no humanized text was returned.';
    } catch (err) {
        console.error("❌ Error during automation:", err.message);
        return `Error: ${err.message}`;
    } finally {
        await browser.close();
    }
}

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
});
