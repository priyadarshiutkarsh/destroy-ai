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
        
        // Click the Strong button
        await page.click('text=Strong');
        console.log('Selected Strong mode');
        await page.waitForTimeout(2000);
        
        // Find the input textarea and fill it
        const leftTextarea = await page.locator('textarea').first();
        await leftTextarea.click();
        await leftTextarea.fill(text);
        console.log('Filled input text');
        
        // Click the Humanize button
        await page.click('text=Humanize');
        console.log('Clicked Humanize button');
        
        // Wait for result - monitor changes to the output span
        let result = '';
        let attempts = 0;
        const maxAttempts = 60;
        
        while (attempts < maxAttempts && !result) {
            await page.waitForTimeout(1000);
            
            // Check the specific output span that contains the result
            const humanizedContent = await page.evaluate((originalText) => {
                // Find the span with text-gray-600 class in the output area
                const outputDiv = document.querySelector('div.grow.bg-white.p-4.pt-3.rounded-br-xl.overflow-y-auto.leading-relaxed.h-60');
                
                if (outputDiv) {
                    const span = outputDiv.querySelector('span.text-gray-600');
                    
                    if (span) {
                        const text = span.textContent || '';
                        const cleanText = text.trim();
                        
                        // Check if the text has changed from the placeholder
                        if (cleanText && 
                            cleanText !== 'Your humanized text will appear here.' &&
                            cleanText !== originalText &&
                            cleanText.length > 50) {
                            
                            return cleanText;
                        }
                    }
                    
                    // Also check if there's any other content in the output div
                    const divText = outputDiv.textContent || '';
                    const cleanDivText = divText.trim();
                    
                    if (cleanDivText && 
                        !cleanDivText.includes('Your humanized text will appear here') &&
                        cleanDivText !== originalText &&
                        cleanDivText.length > 50) {
                        
                        return cleanDivText;
                    }
                }
                
                return '';
            }, text);
            
            console.log(`Attempt ${attempts}: Found content length = ${humanizedContent.length}`);
            
            if (humanizedContent && humanizedContent.length > 50) {
                result = humanizedContent;
                console.log(`Found result after ${attempts} seconds`);
                console.log(`Preview: ${result.substring(0, 100)}...`);
                break;
            }
            
            attempts++;
            
            // Take screenshot for debugging every 20 seconds
            if (attempts % 20 === 0) {
                await page.screenshot({ path: `ghost-debug-${attempts}.png`, fullPage: true });
            }
        }
        
        // If still no result, try waiting for a visual change in the output area
        if (!result) {
            console.log('Waiting for DOM changes in output area...');
            
            // Wait for the span content to change
            await page.waitForFunction(() => {
                const span = document.querySelector('div.grow.bg-white.p-4.pt-3.rounded-br-xl.overflow-y-auto.leading-relaxed.h-60 span.text-gray-600');
                return span && span.textContent !== 'Your humanized text will appear here.';
            }, { timeout: 30000 })
            .catch(() => console.log('Timeout waiting for content change'));
            
            // Get the final result
            result = await page.evaluate(() => {
                const outputDiv = document.querySelector('div.grow.bg-white.p-4.pt-3.rounded-br-xl.overflow-y-auto.leading-relaxed.h-60');
                if (outputDiv) {
                    const span = outputDiv.querySelector('span.text-gray-600');
                    if (span && span.textContent !== 'Your humanized text will appear here.') {
                        return span.textContent.trim();
                    }
                    // Fallback to any text in the div
                    const allText = outputDiv.textContent?.trim() || '';
                    if (allText && !allText.includes('Your humanized text will appear here')) {
                        return allText;
                    }
                }
                return '';
            });
        }
        
        console.log('Final result length:', result?.length || 0);
        console.log('Final result preview:', result?.substring(0, 200) || 'No result');
        
        return result || 'Processing completed but no humanized text was generated. Please try again.';
        
    } catch (error) {
        console.error('Error with Ghost AI:', error.message);
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
