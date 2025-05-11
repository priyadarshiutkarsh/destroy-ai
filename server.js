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

// Ghost AI humanization function
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
        
        // Fill the left textarea
        const leftTextarea = await page.locator('textarea').first();
        await leftTextarea.fill(text);
        console.log('Filled input text');
        
        // Click the Humanize button
        await page.click('text=Humanize');
        console.log('Clicked Humanize button');
        
        // Wait and monitor multiple possible locations for the result
        let result = '';
        let attempts = 0;
        const maxAttempts = 60;
        
        while (attempts < maxAttempts && !result) {
            await page.waitForTimeout(1000);
            
            // Check multiple possible locations
            const currentResult = await page.evaluate((originalText) => {
                // Check all textareas
                const textareas = document.querySelectorAll('textarea');
                for (let i = 1; i < textareas.length; i++) { // Start from index 1 to skip input textarea
                    const ta = textareas[i];
                    if (ta.value && ta.value !== originalText && ta.value.length > 50) {
                        return { source: 'textarea', content: ta.value.trim() };
                    }
                }
                
                // Check the specific span
                const span = document.querySelector('div.grow.bg-white.p-4.pt-3.rounded-br-xl.overflow-y-auto.leading-relaxed.h-60 span.text-gray-600');
                if (span && span.textContent !== 'Your humanized text will appear here.' && span.textContent.length > 50) {
                    return { source: 'span', content: span.textContent.trim() };
                }
                
                // Check the parent div of the span
                const parentDiv = document.querySelector('div.grow.bg-white.p-4.pt-3.rounded-br-xl.overflow-y-auto.leading-relaxed.h-60');
                if (parentDiv) {
                    const divText = parentDiv.textContent || '';
                    const cleanText = divText.replace('Your humanized text will appear here.', '').trim();
                    if (cleanText && cleanText !== originalText && cleanText.length > 50) {
                        return { source: 'parentDiv', content: cleanText };
                    }
                }
                
                // Check any element with substantial text that's different from original
                const allElements = document.querySelectorAll('div, p, span');
                for (const el of allElements) {
                    const text = el.textContent || '';
                    if (text && 
                        text !== originalText && 
                        text.length > 100 && 
                        !text.includes('Your humanized text will appear here') &&
                        !text.includes('Light') &&
                        !text.includes('Medium') &&
                        !text.includes('Strong') &&
                        !text.includes('Humanize') &&
                        !text.includes('Type your text here')) {
                        
                        // Extra check to see if it's in the right column area
                        const elementRect = el.getBoundingClientRect();
                        if (elementRect.left > window.innerWidth / 2) {
                            return { source: 'rightColumn', content: text.trim() };
                        }
                    }
                }
                
                return { source: 'none', content: '' };
            }, text);
            
            console.log(`Attempt ${attempts}: Found ${currentResult.source} with ${currentResult.content.length} chars`);
            
            if (currentResult.content && currentResult.content.length > 50) {
                result = currentResult.content;
                console.log(`Found result from ${currentResult.source} after ${attempts} seconds`);
                break;
            }
            
            attempts++;
            
            // Take screenshot every 20 attempts
            if (attempts % 20 === 0) {
                await page.screenshot({ path: `ghost-debug-${attempts}.png`, fullPage: true });
            }
        }
        
        // If still no result, try waiting for changes more specifically
        if (!result) {
            console.log('No result found, trying final extraction...');
            
            // Take a final screenshot
            await page.screenshot({ path: `ghost-final.png`, fullPage: true });
            
            // Try one more comprehensive search
            result = await page.evaluate(() => {
                // Get ALL text from the right side
                const rightContainer = document.querySelector('.grid > div:last-child');
                if (rightContainer) {
                    // Get all text nodes
                    const walker = document.createTreeWalker(rightContainer, NodeFilter.SHOW_TEXT);
                    let node;
                    let allText = '';
                    
                    while (node = walker.nextNode()) {
                        const text = node.textContent.trim();
                        if (text && 
                            !text.includes('Your humanized text will appear here') &&
                            !text.includes('Words') &&
                            text.length > 10) {
                            allText += text + ' ';
                        }
                    }
                    
                    return allText.trim();
                }
                return '';
            });
        }
        
        console.log('Final result length:', result?.length || 0);
        console.log('Final result preview:', result?.substring(0, 200) || 'No result');
        
        return result || 'Ghost AI processing completed but no humanized text was detected. This might be a temporary issue with the service.';
        
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
