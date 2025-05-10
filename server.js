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
        
        // Humanize with Ghost AI
        const humanized = await humanizeWithGhostAI(textToHumanize.trim());
        
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
                    <p>Your text has been humanized with Ghost AI (Strong mode):</p>
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

// Ghost AI specific humanization function
async function humanizeWithGhostAI(text) {
    let browser;
    try {
        console.log('Starting humanization with Ghost AI');
        
        browser = await chromium.launch({ 
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled'
            ]
        });
        
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
        });
        
        const page = await context.newPage();
        
        // Navigate to Ghost AI
        await page.goto('https://www.the-ghost-ai.com/', {
            waitUntil: 'networkidle',
            timeout: 30000
        });
        
        console.log('Loaded Ghost AI');
        
        // Wait for the page to be fully loaded
        await page.waitForTimeout(5000);
        
        // Click the Strong button (it's the third button)
        await page.click('button:has-text("Strong")');
        console.log('Selected Strong mode');
        await page.waitForTimeout(1000);
        
        // Find and fill the input textarea (left column)
        await page.waitForSelector('textarea', { timeout: 10000 });
        const textareas = await page.$$('textarea');
        
        if (textareas.length >= 1) {
            await textareas[0].click();
            await textareas[0].fill(text);
            console.log('Filled input text');
        } else {
            throw new Error('Could not find input textarea');
        }
        
        // Click the Humanize button
        await page.click('button:has-text("Humanize")');
        console.log('Clicked Humanize button');
        
        // Wait for the result to appear in the right column
        let result = '';
        let attempts = 0;
        const maxAttempts = 60; // 60 seconds max
        
        while (attempts < maxAttempts && !result) {
            await page.waitForTimeout(1000);
            
            // Check if processing is complete
            const isProcessing = await page.evaluate(() => {
                const button = document.querySelector('button:has-text("Humanize")');
                return button ? button.disabled : false;
            });
            
            if (!isProcessing) {
                // Get the result from the right textarea
                const rightTextarea = await page.evaluate(() => {
                    const textareas = document.querySelectorAll('textarea');
                    if (textareas.length >= 2) {
                        return textareas[1].value || textareas[1].textContent || '';
                    }
                    return '';
                });
                
                if (rightTextarea && rightTextarea.trim() !== '' && rightTextarea !== text && rightTextarea.length > 10) {
                    result = rightTextarea;
                    console.log('Got result from right column');
                    break;
                }
            }
            
            attempts++;
            
            // Log progress every 10 seconds
            if (attempts % 10 === 0) {
                console.log(`Still waiting... attempt ${attempts}`);
            }
        }
        
        // If still no result, try alternative methods
        if (!result) {
            console.log('Trying alternative detection method');
            
            // Take screenshot for debugging
            await page.screenshot({ path: `debug-${Date.now()}.png`, fullPage: true });
            
            // Try to get any text from the right side
            result = await page.evaluate(() => {
                // Look for the right column container
                const containers = document.querySelectorAll('.grid > div');
                if (containers.length >= 2) {
                    const rightContainer = containers[1];
                    const textarea = rightContainer.querySelector('textarea');
                    if (textarea) {
                        return textarea.value || textarea.textContent || '';
                    }
                }
                return '';
            });
        }
        
        console.log('Final result length:', result?.length || 0);
        return result || 'Could not get result from Ghost AI';
        
    } catch (error) {
        console.error('Error with Ghost AI:', error);
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
        const humanized = await humanizeWithGhostAI(req.body.text);
        res.json({ humanized });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
