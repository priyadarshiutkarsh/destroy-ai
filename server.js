const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

app.get('/health', (req, res) => res.json({ status: 'healthy' }));

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

async function humanizeWithRewritifyAI(text) {
    let browser;
    try {
        console.log('Launching browser...');
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 }
        });

        const page = await context.newPage();
        await page.goto('https://rewritify.ai/', { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(5000);

        console.log('Typing input...');
        await page.fill('div.tiptap.ProseMirror[contenteditable="true"]', text);

        console.log('Clicking humanize...');
        await page.click('button.coco-btn.css-nx3rhx.coco-btn-primary');
        await page.waitForTimeout(10000);

        let result = '';
        for (let i = 0; i < 30; i++) {
            await page.waitForTimeout(1000);
            result = await page.evaluate(() => {
                const el = document.querySelector(
                    'div.editor_tiptap__f6ZIP.OutputEditor_bypassEditor__OD8nR div.tiptap.ProseMirror[contenteditable="false"]'
                );
                return el?.innerText?.trim() || '';
            });
            if (result.length > 50) break;
        }

        return result || 'Processing completed but no humanized text was returned.';
    } catch (error) {
        console.error('Rewritify error:', error);
        return 'Error during humanization.';
    } finally {
        if (browser) await browser.close();
    }
}

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
