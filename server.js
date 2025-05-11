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
        
        // Wait for processing and ignore UI elements
        let result = '';
        let attempts = 0;
        const maxAttempts = 60;
        
        while (attempts < maxAttempts && !result) {
            await page.waitForTimeout(1000);
            
            // Look for content but skip UI elements
            const humanizedContent = await page.evaluate((originalText) => {
                // Get the right side div container
                const gridContainers = document.querySelectorAll('.grid > div');
                
                if (gridContainers.length > 1) {
                    const rightSide = gridContainers[1];
                    
                    // Find all text in the right side
                    const walker = document.createTreeWalker(rightSide, NodeFilter.SHOW_TEXT);
                    let node;
                    let collectedText = '';
                    
                    while (node = walker.nextNode()) {
                        const text = node.textContent?.trim() || '';
                        if (text && 
                            text !== 'Your humanized text will appear here.' &&
                            !text.includes('Verify & Use') &&
                            !text.includes('Review and confirm') &&
                            !text.includes('ensuring undetectable') &&
                            !text.includes('AI humanized text') &&
                            !text.includes('Words') &&
                            text.length > 20) {
                            
                            // Check if this is actual content, not UI
                            const parent = node.parentElement;
                            if (!parent.tagName.match(/^(BUTTON|LABEL|A|SPAN)$/i) ||
                                parent.className.includes('content')) {
                                collectedText += text + ' ';
                            }
                        }
                    }
                    
                    // Clean up the collected text
                    collectedText = collectedText.trim();
                    
                    // Validate it's not the original and not empty
                    if (collectedText && 
                        collectedText !== originalText && 
                        collectedText.length > 50) {
                        return collectedText;
                    }
                }
                
                return '';
            }, text);
            
            console.log(`Attempt ${attempts}: Found content length = ${humanizedContent.length}`);
            
            if (humanizedContent) {
                result = humanizedContent;
                console.log(`Found result after ${attempts} seconds`);
                console.log(`Preview: ${result.substring(0, 100)}...`);
                break;
            }
            
            attempts++;
            
            // Take screenshot every 20 seconds for debugging
            if (attempts % 20 === 0) {
                await page.screenshot({ path: `ghost-wait-${attempts}.png`, fullPage: true });
            }
        }
        
        // If still no result, wait for button to be enabled and try final extraction
        if (!result) {
            console.log('No result yet, waiting for processing to complete...');
            
            // Wait for button to not be disabled
            await page.waitForFunction(() => {
                const button = document.querySelector('button:has-text("Humanize")');
                return button && !button.disabled;
            }, { timeout: 30000 });
            
            console.log('Processing complete, extracting final result...');
            
            // Final extraction attempt
            result = await page.evaluate(() => {
                // Look in the right column for the actual humanized text
                const rightSides = document.querySelectorAll('.grid > div');
                
                if (rightSides.length > 1) {
                    const rightContent = rightSides[1];
                    
                    // Look for divs that contain substantial text
                    const divs = rightContent.querySelectorAll('div');
                    for (const div of divs) {
                        const text = div.textContent?.trim() || '';
                        
                        if (text.length > 100 && 
                            !text.includes('Verify & Use') &&
                            !text.includes('Your humanized text') &&
                            !text.includes('Review and confirm') &&
                            !text.includes('AI humanized') &&
                            !text.includes('Words')) {
                            
                            // Check if this div has a background (likely the result container)
                            const styles = getComputedStyle(div);
                            if (styles.background || styles.backgroundColor !== 'rgba(0, 0, 0, 0)') {
                                return text;
                            }
                        }
                    }
                }
                
                return '';
            });
        }
        
        console.log('Final result length:', result?.length || 0);
        console.log('Final result preview:', result?.substring(0, 200) || 'No result');
        
        return result || 'Processing completed but could not extract humanized text. Please try again.';
        
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
