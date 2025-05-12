const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (_, res) => res.json({ status: 'healthy' }));

// Result endpoint
app.post('/result', async (req, res) => {
    try {
        const submission = req.body;
        let textToHumanize = '';

        for (const [key, value] of Object.entries(submission)) {
            if (key.includes('email') || typeof value !== 'string') continue;
            if (value.length > 20) {
                textToHumanize = value;
                break;
            }
        }

        const humanized = await humanizeWithRewritify(textToHumanize);

        res.send(`
            <html>
              <head><title>Humanized Result</title></head>
              <body style="font-family:sans-serif; max-width: 800px; margin: auto; padding: 2em;">
                <h2>✅ Humanized Result</h2>
                <div style="background:#f9f9f9;padding:1em;border-radius:10px;margin-bottom:20px;">
                  <strong>Original:</strong><br>${textToHumanize}
                </div>
                <div style="background:#e0ffe0;padding:1em;border-radius:10px;">
                  <strong>Humanized:</strong><br>${humanized}
                </div>
              </body>
            </html>
        `);
    } catch (error) {
        console.error('❌ Error at /result:', error);
        res.status(500).send('Error processing your request.');
    }
});

// Automation core
async function humanizeWithRewritify(input) {
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.goto('https://rewritify.ai', { waitUntil: 'load', timeout: 60000 });

        await page.waitForSelector('div.tiptap.ProseMirror[contenteditable="true"]', { timeout: 15000 });
        await page.fill('div.tiptap.ProseMirror[contenteditable="true"]', input);

        await page.click('button:has-text("Humanize")');
        await page.waitForTimeout(10000); // give it time to generate

        // 🔍 Try strict selector first
        let result = '';
        try {
            result = await page.textContent(
                'div.scrollbar.h-full.overflow-y-auto div.tiptap.ProseMirror[contenteditable="false"]',
                { timeout: 60000 }
            );
        } catch {
            console.warn('⚠️ Primary selector failed. Trying fallback...');
            // 🔁 Fallback selector
            const blocks = await page.$$('div.tiptap.ProseMirror[contenteditable="false"]');
            for (const block of blocks) {
                const text = await block.innerText();
                if (text && text.length > 100 && !text.includes('Humanize')) {
                    result = text.trim();
                    break;
                }
            }
        }

        // 🔍 Dump HTML and screenshot for debugging
        const html = await page.content();
        fs.writeFileSync('debug_output.html', html);
        await page.screenshot({ path: 'humanize_output_debug.png', fullPage: true });

        return result || '⚠️ Humanized text could not be extracted. Check debug_output.html or screenshot.';
    } catch (err) {
        console.error('❌ Rewritify automation error:', err);
        return `Error: ${err.message}`;
    } finally {
        await browser.close();
    }
}

// Start server
const server = app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});
