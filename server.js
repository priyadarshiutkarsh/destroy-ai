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
        
        // Wait for processing - check for text changes in the right column
        let result = '';
        let attempts = 0;
        const maxAttempts = 60;
        
        while (attempts < maxAttempts && !result) {
            await page.waitForTimeout(1000);
            
            // Look for content changes in the right side
            const humanizedContent = await page.evaluate(() => {
                // Find the span with class="text-gray-600" which typically shows "Your humanized text will appear here."
                const rightSpans = document.querySelectorAll('.text-gray-600');
                
                for (const span of rightSpans) {
                    const parent = span.parentElement;
                    
                    // Check if the span text has changed from the placeholder
                    if (span.textContent && 
                        !span.textContent.includes('Your humanized text will appear here') &&
                        span.textContent.length > 50) {
                        return span.textContent.trim();
                    }
                    
                    // Also check if the parent has text content (in case span is just a wrapper)
                    if (parent && parent.textContent && 
                        !parent.textContent.includes('Your humanized text will appear here') &&
                        !parent.textContent.includes('Type your text here') &&
                        parent.textContent.length > 50) {
                        return parent.textContent.trim();
                    }
                }
                
                // Alternative approach: look for any div in the right column with substantial content
                const gridContainers = document.querySelectorAll('.grid > div');
                if (gridContainers.length > 1) {
                    const rightContainer = gridContainers[1];
                    
                    // Check all divs in the right container
                    const divs = rightContainer.querySelectorAll('div');
                    for (const div of divs) {
                        const text = div.textContent?.trim() || '';
                        if (text.length > 100 && 
                            !text.includes('Your humanized text will appear here') &&
                            !text.includes('Type your text here') &&
                            !text.includes('Verify & Use') &&
                            !text.includes('Review and confirm')) {
                            return text;
                        }
                    }
                }
                
                return '';
            });
            
            console.log(`Attempt ${attempts}: Found content length = ${humanizedContent.length}`);
            
            if (humanizedContent && humanizedContent.length > 50) {
                result = humanizedContent;
                console.log(`Found result after ${attempts} seconds`);
                console.log(`Preview: ${result.substring(0, 100)}...`);
                break;
            }
            
            attempts++;
        }
        
        // If still no result, wait for button state change and do final check
        if (!result) {
            console.log('No result yet, checking button state...');
            
            // Check if button is disabled (processing) or enabled (done)
            const buttonState = await page.evaluate(() => {
                const button = document.querySelector('button');
                if (button && button.textContent.includes('Humanize')) {
                    return {
                        disabled: button.disabled,
                        text: button.textContent
                    };
                }
                return null;
            });
            
            console.log('Button state:', buttonState);
            
            // Wait for button to be enabled (processing complete)
            if (buttonState && buttonState.disabled) {
                console.log('Waiting for processing to complete...');
                
                await page.evaluate(() => {
                    return new Promise((resolve) => {
                        const checkButton = () => {
                            const button = document.querySelector('button');
                            if (button && button.textContent.includes('Humanize') && !button.disabled) {
                                resolve();
                            } else {
                                setTimeout(checkButton, 1000);
                            }
                        };
                        checkButton();
                    });
                });
                
                console.log('Processing complete, getting final result...');
            }
            
            // Final extraction attempt
            result = await page.evaluate(() => {
                // Look for any substantial text in the right column
                const rightContainers = document.querySelectorAll('.grid > div');
                
                if (rightContainers.length > 1) {
                    const rightSide = rightContainers[1];
                    
                    // Get all text nodes
                    const walker = document.createTreeWalker(rightSide, NodeFilter.SHOW_TEXT);
                    let node;
                    let combinedText = '';
                    
                    while (node = walker.nextNode()) {
                        const text = node.textContent?.trim() || '';
                        if (text && 
                            !text.includes('Your humanized text will appear here') &&
                            !text.includes('Type your text') &&
                            !text.includes('Verify & Use') &&
                            text.length > 10) {
                            combinedText += text + ' ';
                        }
                    }
                    
                    return combinedText.trim();
                }
                
                return '';
            });
        }
        
        console.log('Final result length:', result?.length || 0);
        console.log('Final result preview:', result?.substring(0, 200) || 'No result');
        
        return result || 'Could not retrieve humanized text. Ghost AI may be experiencing issues.';
        
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
