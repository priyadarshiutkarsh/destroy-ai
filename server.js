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
        await page.waitForTimeout(3000);
        
        // Find and fill the input textarea
        // Adjust these selectors based on actual Ghost AI structure
        const inputSelectors = [
            'textarea[placeholder*="paste"]',
            'textarea[placeholder*="text"]',
            'textarea:first-of-type',
            '#input-text',
            '.input-area textarea'
        ];
        
        let inputFilled = false;
        for (const selector of inputSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 5000 });
                await page.fill(selector, text);
                console.log(`Filled input with selector: ${selector}`);
                inputFilled = true;
                break;
            } catch (e) {
                continue;
            }
        }
        
        if (!inputFilled) {
            throw new Error('Could not find input field');
        }
        
        // Set to Strong mode if there's a dropdown or option
        // Look for strength/mode selector
        const strengthSelectors = [
            'select[name*="strength"]',
            'select[name*="mode"]',
            '.strength-selector',
            '#mode-selector',
            'button:has-text("Strong")',
            'label:has-text("Strong")'
        ];
        
        for (const selector of strengthSelectors) {
            try {
                const element = await page.$(selector);
                if (element) {
                    const tagName = await element.evaluate(el => el.tagName.toLowerCase());
                    
                    if (tagName === 'select') {
                        await page.selectOption(selector, 'strong');
                        console.log('Selected strong mode from dropdown');
                    } else if (tagName === 'button' || tagName === 'label') {
                        await page.click(selector);
                        console.log('Clicked strong mode button');
                    }
                    break;
                }
            } catch (e) {
                continue;
            }
        }
        
        // Find and click the humanize/process button
        const buttonSelectors = [
            'button:has-text("Humanize")',
            'button:has-text("Process")',
            'button:has-text("Generate")',
            'button:has-text("Submit")',
            'button[type="submit"]',
            '.submit-btn',
            '#humanize-btn',
            '[type="button"]:has-text("Process")'
        ];
        
        let buttonClicked = false;
        for (const selector of buttonSelectors) {
            try {
                await page.click(selector);
                console.log(`Clicked button with selector: ${selector}`);
                buttonClicked = true;
                break;
            } catch (e) {
                continue;
            }
        }
        
        if (!buttonClicked) {
            // Try clicking any button that might be the submit button
            const buttons = await page.$$('button[type="button"]');
            for (const button of buttons) {
                const text = await button.textContent();
                if (text && (text.includes('Process') || text.includes('Humanize') || text.includes('Generate'))) {
                    await button.click();
                    console.log(`Clicked button with text: ${text}`);
                    buttonClicked = true;
                    break;
                }
            }
        }
        
        if (!buttonClicked) {
            throw new Error('Could not find submit button');
        }
        
        // Wait for result with multiple attempts
        let result = '';
        let attempts = 0;
        const maxAttempts = 40;
        
        const outputSelectors = [
            'textarea[placeholder*="output"]',
            'textarea:last-of-type',
            '#output-text',
            '.output-area textarea',
            '.result-area',
            '#result',
            '.response-text'
        ];
        
        while (attempts < maxAttempts && !result) {
            await page.waitForTimeout(1000);
            
            // Try to get the result from various selectors
            for (const selector of outputSelectors) {
                try {
                    const element = await page.$(selector);
                    if (element) {
                        result = await element.evaluate(el => el.value || el.textContent || el.innerText || '');
                        if (result && result.trim() !== '' && result !== text && result.length > 10) {
                            console.log(`Got result with selector: ${selector}`);
                            break;
                        }
                    }
                } catch (e) {
                    continue;
                }
            }
            
            attempts++;
            
            if (result && result.trim() !== '' && result !== text) {
                console.log('Got result after', attempts, 'seconds');
                break;
            }
            
            // Log progress every 10 seconds
            if (attempts % 10 === 0) {
                console.log(`Still waiting... attempt ${attempts}`);
            }
        }
        
        console.log('Final result:', result);
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
