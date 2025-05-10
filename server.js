const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => res.json({ status: 'healthy' }));

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
        
        console.log('Received submission:', submission);
        
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
        
        console.log('Text to humanize:', textToHumanize);
        
        // Humanize the text
        const humanized = await humanizeText(textToHumanize.trim());
        
        // Display the result
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Humanized Result</title>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; }
                    .container { background: #f5f5f5; padding: 30px; border-radius: 10px; }
                    .result { white-space: pre-wrap; background: white; padding: 20px; border-radius: 5px; margin-top: 20px; }
                    .original { background: white; padding: 20px; margin-bottom: 20px; border-radius: 5px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Thank You!</h1>
                    <p>Your text has been humanized:</p>
                    <div class="original"><strong>Original:</strong><br>${textToHumanize}</div>
                    <div class="result"><strong>Humanized:</strong><br>${humanized}</div>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Error in result page:', error);
        res.status(500).send('Error processing your request');
    }
});

// Humanize function with human-like behavior
async function humanizeText(text) {
    let browser;
    try {
        console.log('Starting humanization for:', text.substring(0, 50));
        
        // Random user agents to appear more human
        const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0'
        ];
        
        const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
        
        browser = await chromium.launch({ 
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        });
        
        const context = await browser.newContext({
            userAgent: randomUA,
            viewport: { width: 1366, height: 768 },
            ignoreHTTPSErrors: true
        });
        
        const page = await context.newPage();
        
        // Add stealth scripts
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
        });
        
        // Set random delays to appear human
        const randomDelay = () => Math.floor(Math.random() * 1000) + 500;
        
        // Navigate with a real referrer
        await page.goto('https://ai-text-humanizer.com/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        
        // Random delay like a human would take
        await page.waitForTimeout(randomDelay());
        
        // Wait for elements to be ready
        await page.waitForSelector('#textareaBefore', { timeout: 20000 });
        console.log('Found input field');
        
        // Simulate human typing with delays
        await page.click('#textareaBefore');
        await page.waitForTimeout(randomDelay());
        
        // Clear the field
        await page.keyboard.down('Control');
        await page.keyboard.press('a');
        await page.keyboard.up('Control');
        await page.waitForTimeout(300);
        
        // Type with human-like speed
        for (const char of text) {
            await page.keyboard.type(char);
            await page.waitForTimeout(Math.random() * 50 + 10);
        }
        
        console.log('Filled input');
        
        // Wait before clicking
        await page.waitForTimeout(randomDelay());
        
        // Click the humanize button
        await page.click('#btnGo');
        console.log('Clicked button');
        
        // Enhanced waiting strategy
        let result = '';
        let attempts = 0;
        const maxAttempts = 60; // 60 seconds max
        
        while (attempts < maxAttempts && !result) {
            await page.waitForTimeout(1000);
            
            // Check multiple selectors
            result = await page.evaluate(() => {
                // Try multiple methods to get the result
                const textarea = document.querySelector('#textareaAfter');
                if (textarea) {
                    return textarea.value || textarea.textContent || textarea.innerText || '';
                }
                
                // Alternative selectors in case the site changes
                const altTextarea = document.querySelector('textarea:last-of-type');
                if (altTextarea) {
                    return altTextarea.value || altTextarea.textContent || '';
                }
                
                return '';
            });
            
            attempts++;
            
            if (result && result.trim() !== '' && result !== text && result.length > 10) {
                console.log('Got result after', attempts, 'seconds');
                break;
            }
            
            // Log progress every 10 seconds
            if (attempts % 10 === 0) {
                console.log(`Still waiting... attempt ${attempts}`);
            }
        }
        
        // Try additional methods if still no result
        if (!result || result === text) {
            console.log('Trying additional methods');
            
            // Take screenshot for debugging
            await page.screenshot({ path: `debug-${Date.now()}.png`, fullPage: true });
            
            // Check if there's any error message
            const errorMessage = await page.evaluate(() => {
                const errors = document.querySelectorAll('.error, .warning, .alert');
                for (const error of errors) {
                    if (error.textContent) return error.textContent;
                }
                return '';
            });
            
            if (errorMessage) {
                console.log('Error message:', errorMessage);
            }
        }
        
        console.log('Final result:', result);
        return result || 'The AI humanizer is currently unavailable. Please try again later.';
        
    } catch (error) {
        console.error('Error in humanizeText:', error);
        return `Error: ${error.message}`;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Direct API endpoint
app.post('/humanize', async (req, res) => {
    try {
        const humanized = await humanizeText(req.body.text);
        res.json({ humanized });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
