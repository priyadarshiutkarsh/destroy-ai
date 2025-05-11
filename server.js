const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Graceful shutdown
process.on('SIGTERM', () => {
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'healthy' }));

// Result page
app.post('/result', async (req, res) => {
    try {
        const submission = req.body;
        let textToHumanize = '';

        for (const [key, value] of Object.entries(submission)) {
            if (
                typeof value === 'string' &&
                value.length > 20 &&
                !key.includes('email')
            ) {
                textToHumanize = value;
                break;
            }
        }

        const humanized = await humanizeWithRewritify(textToHumanize);

        res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>Humanized Output</title>
            <style>
                body { font-family: sans-serif; padding: 2em; max-width: 800px; margin: auto; }
                .result { background: #f0f0f0; padding: 1em; border-radius: 10px; white-space: pre-wrap; }
                .original { margin-top: 2em; font-size: 0.9em; color: #555; }
            </style>
            </head>
            <body>
                <h2>✅ Humanized Result:</h2>
                <div class="result">${humanized}</div>
                <div class="original"><strong>Original Text:</strong><br>${textToHumanize}</div>
            </body>
            </html>
        `);
    } catch (e) {
        console.error(e);
        res.status(500).send('Error processing your request.');
    }
});

// Rewritify AI automation
async function humanizeWithRewritify(input) {
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox']
    });

    try {
        const context = await browser.newContext({
            userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/114.0 Safari/537.36',
            viewport: { width: 1280, height: 800 }
        });

        const page = await context.newPage();
        await page.goto('https://rewritify.ai', { waitUntil: 'load', timeout: 60000 });

        // Type into the editor
        await page.waitForSelector('div.tiptap.ProseMirror[contenteditable="true"]');
        await page.fill('div.tiptap.ProseMirror[contenteditable="true"]', input);

        // Click Humanize button
        await page.click('button:has-text("Humanize")');
        await page.waitForTimeout(10000); // wait for generation

        // Extract result
        const output = await page.textContent(
            'div.scrollbar.h-full.overflow-y-auto div.tiptap.ProseMirror[contenteditable="false"]'
        );

        return output?.trim() || 'Processing completed but no humanized text was returned.';
    } catch (err) {
        console.error('❌ Error during automation:', err);
        return `Error: ${err.message}`;
    } finally {
        await browser.close();
    }
}

// Launch server
const server = app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});
