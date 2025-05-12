const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('⚠️ SIGTERM received, shutting down gracefully...');
    server.close(() => {
        console.log('✅ HTTP server closed');
        process.exit(0);
    });
});

// Health check
app.get('/health', (_, res) => res.json({ status: 'healthy' }));

// JotForm webhook
app.post('/jotform-webhook', async (req, res) => {
    try {
        res.status(200).send('OK');
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Result display page
app.post('/result', async (req, res) => {
    try {
        const submission = req.body;
        let textToHumanize = '';
        
        console.log('📝 Received submission:', submission);
        
        // Try to find the main text field
        for (const [key, value] of Object.entries(submission)) {
            if (key.includes('email') || key.includes('name') || key.includes('phone') || key.includes('address')) {
                continue;
            }
            
            if (typeof value === 'string' && value.length > 20) {
                textToHumanize = value;
                break;
            }
        }
        
        console.log('📝 Text to humanize:', textToHumanize);
        
        // Humanize with Rewritify AI
        const humanized = await humanizeWithRewritify(textToHumanize.trim());
        
        // Display the result
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Humanized Result</title>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; }
                    .container { background: #f5f5f5; padding: 30px; border-radius: 10px; }
                    .result { white-space: pre-wrap; background: #e0ffe0; padding: 20px; border-radius: 5px; margin-top: 20px; }
                    .original { background: #f9f9f9; padding: 20px; margin-bottom: 20px; border-radius: 5px; }
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
    } catch (error) {
        console.error('❌ Error in result page:', error);
        res.status(500).send('Error processing your request');
    }
});

// Rewritify AI humanization function
async function humanizeWithRewritify(text) {
    let browser;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    try {
        console.log('🚀 Starting humanization with Rewritify AI');
        
        browser = await chromium.launch({ 
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });
        
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
        });
        
        const page = await context.newPage();
        
        // Navigate to Rewritify AI
        console.log('🌐 Navigating to Rewritify.ai...');
        await page.goto('https://rewritify.ai/', {
            waitUntil: 'load',
            timeout: 60000
        });
        
        console.log('✅ Loaded Rewritify AI');
        
        // Wait for the input editor to be visible
        console.log('⏳ Waiting for input editor...');
        await page.waitForSelector('div.tiptap.ProseMirror[contenteditable="true"]', { timeout: 15000 });
        
        // Fill the input editor
        console.log('📝 Filling input text...');
        await page.fill('div.tiptap.ProseMirror[contenteditable="true"]', text);
        
        // Click the Humanize button
        console.log('🖱️ Clicking Humanize button...');
        await page.click('button:has-text("Humanize")');
        
        // Wait for generation to complete
        console.log('⏳ Waiting for generation to complete...');
        await page.waitForTimeout(10000);
        
        // Try multiple selectors to find result
        let result = '';
        
        // Primary selector
        try {
            console.log('🔍 Trying primary selector...');
            result = await page.textContent(
                'div.scrollbar.h-full.overflow-y-auto div.tiptap.ProseMirror[contenteditable="false"]',
                { timeout: 30000 }
            );
            
            if (result && result.trim().length > 50) {
                console.log('✅ Found result with primary selector');
            } else {
                throw new Error('Primary selector returned insufficient text');
            }
        } catch (err) {
            console.warn('⚠️ Primary selector failed:', err.message);
            
            // Fallback 1: Try alternate selector
            try {
                console.log('🔍 Trying fallback selector 1...');
                result = await page.textContent(
                    'div.editor_tiptap__f6ZIP.OutputEditor_bypassEditor__OD8nR div.tiptap.ProseMirror',
                    { timeout: 5000 }
                );
                
                if (result && result.trim().length > 50) {
                    console.log('✅ Found result with fallback selector 1');
                } else {
                    throw new Error('Fallback selector 1 returned insufficient text');
                }
            } catch (err2) {
                console.warn('⚠️ Fallback selector 1 failed:', err2.message);
                
                // Fallback 2: Try any content-editable false div with substantial text
                console.log('🔍 Trying fallback selector 2 (all content-editable=false divs)...');
                const divs = await page.$$('div.tiptap.ProseMirror[contenteditable="false"]');
                
                for (const div of divs) {
                    const divText = await div.textContent();
                    if (divText && divText.trim().length > 100 && !divText.includes('Humanize')) {
                        result = divText.trim();
                        console.log('✅ Found result with fallback selector 2');
                        break;
                    }
                }
                
                // If still no result, try all paragraph elements
                if (!result || result.trim().length <= 50) {
                    console.log('🔍 Trying fallback selector 3 (all paragraphs)...');
                    const paragraphs = await page.$$('div.tiptap.ProseMirror[contenteditable="false"] p');
                    
                    for (const p of paragraphs) {
                        const pText = await p.textContent();
                        if (pText && pText.trim().length > 100) {
                            result = pText.trim();
                            console.log('✅ Found result with fallback selector 3');
                            break;
                        }
                    }
                }
            }
        }
        
        // Save debug info if no result
        if (!result || result.trim().length <= 50) {
            console.log('⚠️ No sufficient result found, saving debug info...');
            
            // Take a screenshot
            const screenshotPath = path.join(logsDir, `rewritify_screenshot_${timestamp}.png`);
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`📸 Screenshot saved to ${screenshotPath}`);
            
            // Save page HTML
            const htmlPath = path.join(logsDir, `rewritify_html_${timestamp}.html`);
            const html = await page.content();
            fs.writeFileSync(htmlPath, html);
            console.log(`💾 HTML saved to ${htmlPath}`);
            
            // Try one more direct approach - get all visible text from the page
            const allVisibleText = await page.evaluate(() => {
                const walker = document.createTreeWalker(
                    document.body,
                    NodeFilter.SHOW_TEXT,
                    {
                        acceptNode: function(node) {
                            // Skip hidden elements
                            if (node.parentElement.offsetParent === null) {
                                return NodeFilter.FILTER_SKIP;
                            }
                            return NodeFilter.FILTER_ACCEPT;
                        }
                    }
                );
                
                let node;
                let texts = [];
                
                while(node = walker.nextNode()) {
                    const text = node.nodeValue.trim();
                    if (text.length > 100 && !text.includes('Humanize') && !text.includes('Enter the text')) {
                        texts.push(text);
                    }
                }
                
                return texts.join('\n\n');
            });
            
            if (allVisibleText && allVisibleText.length > 100) {
                result = allVisibleText;
                console.log('✅ Found text using DOM tree walker');
            }
        }
        
        console.log(`📏 Final result length: ${result?.trim().length || 0}`);
        
        return result?.trim() || 'The AI humanizer service may be experiencing issues. Please try again later.';
        
    } catch (error) {
        console.error('❌ Error with Rewritify AI:', error);
        
        // Try to take a screenshot if browser is still accessible
        if (browser) {
            try {
                const pages = await browser.pages();
                if (pages.length > 0) {
                    const errorScreenshotPath = path.join(logsDir, `rewritify_error_${timestamp}.png`);
                    await pages[0].screenshot({ path: errorScreenshotPath, fullPage: true });
                    console.log(`📸 Error screenshot saved to ${errorScreenshotPath}`);
                }
            } catch (screenshotError) {
                console.error('❌ Failed to take error screenshot:', screenshotError.message);
            }
        }
        
        return `Error: ${error.message}`;
    } finally {
        if (browser) {
            try {
                await browser.close();
                console.log('🔒 Browser closed');
            } catch (e) {
                console.error('❌ Error closing browser:', e.message);
            }
        }
    }
}

// Direct API endpoint
app.post('/humanize', async (req, res) => {
    try {
        const humanized = await humanizeWithRewritify(req.body.text);
        res.json({ humanized });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
