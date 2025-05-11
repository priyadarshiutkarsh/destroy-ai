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
        await page.click('button:has-text("Humanize")');
        console.log('Clicked Humanize button');
        
        // Wait for the result to appear in the right div
        let result = '';
        let attempts = 0;
        const maxAttempts = 60;
        
        while (attempts < maxAttempts && !result) {
            await page.waitForTimeout(1000);
            
            // Check the right side div for the humanized result
            const rightDivContent = await page.evaluate(() => {
                // Look for the right side container
                const rightContainers = document.querySelectorAll('div');
                
                for (const container of rightContainers) {
                    const text = container.textContent || '';
                    
                    // Skip the placeholder text
                    if (text.includes('Your humanized text will appear here')) {
                        continue;
                    }
                    
                    // Look for the actual result div
                    if (text.length > 50 && 
                        !text.includes('AI Humanizer') && 
                        !text.includes('Bypass AI Detection') &&
                        !text.includes('Type your text here') &&
                        !text.includes('Words') &&
                        !text.includes('Humanize') &&
                        !text.includes('Light') &&
                        !text.includes('Medium') &&
                        !text.includes('Strong')) {
                        
                        // Check if this div is in the right column (has specific parent structure)
                        const parent = container.parentElement;
                        const grandParent = parent?.parentElement;
                        
                        // Look for the right side based on DOM structure
                        if (grandParent?.className?.includes('grid') || 
                            grandParent?.className?.includes('col') ||
                            container.style?.background?.includes('purple') ||
                            container.className?.includes('result')) {
                            
                            return text.trim();
                        }
                    }
                }
                return '';
            });
            
            console.log(`Attempt ${attempts}: Right div content length = ${rightDivContent.length}`);
            
            if (rightDivContent && rightDivContent.length > 10) {
                result = rightDivContent;
                console.log(`Found result after ${attempts} seconds`);
                break;
            }
            
            attempts++;
            
            // Take screenshot every 15 seconds for debugging
            if (attempts % 15 === 0) {
                await page.screenshot({ path: `ghost-debug-${attempts}.png`, fullPage: true });
            }
        }
        
        // If still no result, wait for button to be enabled and try once more
        if (!result) {
            console.log('No result yet, waiting for processing to complete...');
            
            // Wait for the Humanize button to be enabled again (processing complete)
            await page.waitForSelector('button:has-text("Humanize"):not([disabled])', { timeout: 30000 });
            console.log('Processing complete, getting final result...');
            
            // Get the final result
            result = await page.evaluate(() => {
                // Find any div that looks like it contains the humanized result
                const allDivs = document.querySelectorAll('div');
                
                for (const div of allDivs) {
                    const text = div.textContent?.trim() || '';
                    
                    // Look for substantial text content that's not UI elements
                    if (text.length > 100 && 
                        !text.includes('Humanize') && 
                        !text.includes('Light') && 
                        !text.includes('Medium') && 
                        !text.includes('Strong') &&
                        !text.includes('Type your text here') &&
                        !text.includes('Your humanized text will appear here') &&
                        !text.includes('Bypass AI Detection')) {
                        
                        // Check if this is likely the result based on styling
                        const styles = getComputedStyle(div);
                        if (styles.padding || styles.margin || div.className) {
                            return text;
                        }
                    }
                }
                return '';
            });
        }
        
        console.log('Final result length:', result?.length || 0);
        console.log('Final result preview:', result?.substring(0, 100) || 'No result');
        
        return result || 'Could not retrieve humanized text. Please try again.';
        
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
