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

// Ghost AI specific humanization function with detailed debugging
async function humanizeWithGhostAI(text) {
    let browser;
    try {
        console.log('Starting humanization with Ghost AI');
        console.log('Input text length:', text.length);
        
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
        
        // Take initial screenshot
        await page.screenshot({ path: `ghost-initial-${Date.now()}.png`, fullPage: true });
        
        // Click the Strong button
        await page.click('text=Strong');
        console.log('Selected Strong mode');
        await page.waitForTimeout(2000);
        
        // Find and fill the input textarea (left column)
        await page.waitForSelector('textarea', { timeout: 10000 });
        const textareas = await page.$$('textarea');
        console.log('Found textareas:', textareas.length);
        
        if (textareas.length >= 1) {
            // Clear the textarea first
            await textareas[0].click();
            await page.keyboard.down('Control');
            await page.keyboard.press('a');
            await page.keyboard.up('Control');
            await page.keyboard.press('Delete');
            await page.waitForTimeout(1000);
            
            // Type the text
            await textareas[0].type(text);
            console.log('Filled input text');
            
            // Verify the text was entered
            const inputValue = await textareas[0].evaluate(el => el.value);
            console.log('Input value length after filling:', inputValue.length);
        } else {
            throw new Error('Could not find input textarea');
        }
        
        // Take screenshot before clicking humanize
        await page.screenshot({ path: `ghost-before-humanize-${Date.now()}.png`, fullPage: true });
        
        // Click the Humanize button
        await page.click('text=Humanize');
        console.log('Clicked Humanize button');
        await page.waitForTimeout(3000);
        
        // Monitor the processing
        let result = '';
        let attempts = 0;
        const maxAttempts = 60; // 60 seconds max
        let previousRightText = '';
        
        while (attempts < maxAttempts && !result) {
            await page.waitForTimeout(1000);
            
            // Check button state
            const buttonState = await page.evaluate(() => {
                const buttons = document.querySelectorAll('button');
                for (const button of buttons) {
                    if (button.textContent && button.textContent.includes('Humanize')) {
                        return {
                            disabled: button.disabled,
                            text: button.textContent,
                            classes: button.className
                        };
                    }
                }
                return { disabled: false, text: 'not found', classes: '' };
            });
            
            console.log(`Attempt ${attempts}: Button state -`, buttonState);
            
            // Get content from both textareas
            const textareaContents = await page.evaluate(() => {
                const textareas = document.querySelectorAll('textarea');
                return Array.from(textareas).map((ta, i) => ({
                    index: i,
                    value: ta.value,
                    length: ta.value.length
                }));
            });
            
            console.log(`Attempt ${attempts}: Textareas -`, textareaContents);
            
            // Check if right textarea has changed
            if (textareaContents.length >= 2) {
                const rightText = textareaContents[1].value;
                
                if (rightText !== previousRightText && rightText !== text && rightText.length > 10) {
                    result = rightText;
                    console.log(`Got result after ${attempts} seconds`);
                    break;
                }
                
                previousRightText = rightText;
            }
            
            attempts++;
            
            // Take periodic screenshots
            if (attempts % 15 === 0) {
                await page.screenshot({ path: `ghost-waiting-${attempts}-${Date.now()}.png`, fullPage: true });
            }
        }
        
        // Final attempt to get result
        if (!result) {
            console.log('Trying final extraction...');
            
            // Take final screenshot
            await page.screenshot({ path: `ghost-final-${Date.now()}.png`, fullPage: true });
            
            // Get all text content from the page
            const fullPageContent = await page.evaluate(() => {
                const textareas = document.querySelectorAll('textarea');
                const results = [];
                
                textareas.forEach((ta, index) => {
                    results.push({
                        index,
                        value: ta.value,
                        placeholder: ta.placeholder,
                        id: ta.id,
                        name: ta.name
                    });
                });
                
                return results;
            });
            
            console.log('Final textarea contents:', fullPageContent);
            
            // Use the second textarea if it has different content
            if (fullPageContent.length >= 2 && fullPageContent[1].value !== text) {
                result = fullPageContent[1].value;
            }
        }
        
        console.log('Final result length:', result?.length || 0);
        console.log('Final result preview:', result?.substring(0, 100) || 'No result');
        
        return result || 'Could not get humanized result from Ghost AI';
        
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
