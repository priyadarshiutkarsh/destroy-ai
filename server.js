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
        await page.click('text=Humanize');
        console.log('Clicked Humanize button');
        
        // Wait for processing and check multiple locations for result
        let result = '';
        let attempts = 0;
        const maxAttempts = 60;
        
        while (attempts < maxAttempts && !result) {
            await page.waitForTimeout(1000);
            
            // Check multiple possible locations for the humanized text
            const allPossibleResults = await page.evaluate((originalText) => {
                const results = [];
                
                // Check all textareas
                const textareas = document.querySelectorAll('textarea');
                textareas.forEach((ta, i) => {
                    if (ta.value && ta.value !== originalText && ta.value.length > 10) {
                        results.push({
                            type: 'textarea',
                            index: i,
                            content: ta.value,
                            length: ta.value.length
                        });
                    }
                });
                
                // Check all divs with significant text content
                const divs = document.querySelectorAll('div');
                divs.forEach((div, i) => {
                    const text = div.textContent || div.innerText || '';
                    if (text && text !== originalText && text.length > 50 && !text.includes('Humanize') && !text.includes('Light')) {
                        results.push({
                            type: 'div',
                            index: i,
                            content: text.trim(),
                            length: text.length,
                            classes: div.className
                        });
                    }
                });
                
                // Check all pre elements
                const pres = document.querySelectorAll('pre');
                pres.forEach((pre, i) => {
                    const text = pre.textContent || pre.innerText || '';
                    if (text && text !== originalText && text.length > 10) {
                        results.push({
                            type: 'pre',
                            index: i,
                            content: text.trim(),
                            length: text.length
                        });
                    }
                });
                
                // Check for elements with specific classes that might contain results
                const resultClasses = [
                    '.result', '.output', '.humanized', 
                    '.generated', '.response', '.answer'
                ];
                
                resultClasses.forEach(className => {
                    const elements = document.querySelectorAll(className);
                    elements.forEach((el, i) => {
                        const text = el.textContent || el.innerText || '';
                        if (text && text !== originalText && text.length > 10) {
                            results.push({
                                type: 'class',
                                selector: className,
                                index: i,
                                content: text.trim(),
                                length: text.length
                            });
                        }
                    });
                });
                
                return results;
            }, text);
            
            console.log(`Attempt ${attempts}: Found ${allPossibleResults.length} potential results`);
            
            // Log details of found results
            allPossibleResults.forEach((result, i) => {
                console.log(`Result ${i}: ${result.type} - Length: ${result.length} - Preview: ${result.content.substring(0, 50)}...`);
            });
            
            // Pick the best result (longest, most likely to be humanized)
            if (allPossibleResults.length > 0) {
                const bestResult = allPossibleResults.reduce((prev, current) => {
                    return (current.length > prev.length) ? current : prev;
                });
                
                if (bestResult.content && bestResult.content !== text) {
                    result = bestResult.content;
                    console.log(`Found result in ${bestResult.type} after ${attempts} seconds`);
                    break;
                }
            }
            
            attempts++;
            
            // Log progress
            if (attempts % 15 === 0) {
                console.log(`Still waiting... attempt ${attempts}`);
                // Take screenshot for debugging
                await page.screenshot({ path: `ghost-debug-${attempts}-${Date.now()}.png`, fullPage: true });
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
