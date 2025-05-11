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
        
        // Humanize with Undetectable AI
        const humanized = await humanizeWithUndetectableAI(textToHumanize.trim());
        
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
                    <p>Your text has been humanized with Undetectable AI:</p>
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

// Helper function to decode HTML entities
function decodeHtmlEntities(text) {
    const entities = {
        '&lt;': '<',
        '&gt;': '>',
        '&amp;': '&',
        '&quot;': '"',
        '&#x27;': "'",
        '&#x60;': '`'
    };
    
    return text.replace(/&[^;]+;/g, function(entity) {
        return entities[entity] || entity;
    });
}

// Undetectable AI humanization function
async function humanizeWithUndetectableAI(text) {
    let browser;
    try {
        console.log('Starting humanization with Undetectable AI');
        
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
        
        // Navigate to Undetectable AI
        await page.goto('https://www.undetectableai.pro/', {
            waitUntil: 'networkidle',
            timeout: 30000
        });
        
        console.log('Loaded Undetectable AI');
        
        // Wait for the page to be fully loaded
        await page.waitForTimeout(5000);
        
        // Fill the input textarea
        const inputTextarea = await page.locator('textarea.Home_editor__textarea__W6jTe').first();
        await inputTextarea.fill(text);
        console.log('Filled input text');
        
        // Click the Humanize button
        await page.click('button.Home_editor__button__iu08P');
        console.log('Clicked Humanize button');
        
        // Wait for the result textarea to appear and populate
        let result = '';
        let attempts = 0;
        const maxAttempts = 30; // 30 seconds max (since you said it takes ~20 seconds)
        
        while (attempts < maxAttempts && !result) {
            await page.waitForTimeout(1000);
            
            // Check for the result textarea that appears after processing
            const resultText = await page.evaluate((originalText) => {
                // Find the result textarea with both classes
                const resultTextarea = document.querySelector('textarea.Home_editor__textarea__W6jTe.Home_editor__result__GpHzx');
                
                if (resultTextarea) {
                    // Get the text content (innerHTML for HTML entities)
                    let content = resultTextarea.innerHTML || resultTextarea.value || '';
                    
                    // Skip if it's still empty or has placeholder
                    if (content && 
                        content !== originalText && 
                        content !== 'Enter text here' && 
                        content.length > 10 &&
                        !content.includes('&lt;textarea') // Skip if it's showing the HTML structure
                    ) {
                        return content;
                    }
                }
                
                return '';
            }, text);
            
            console.log(`Attempt ${attempts}: Found ${resultText.length} characters`);
            
            if (resultText && resultText.length > 10) {
                // Decode HTML entities
                result = decodeHtmlEntities(resultText);
                console.log(`Found result after ${attempts} seconds`);
                console.log(`Preview: ${result.substring(0, 100)}...`);
                break;
            }
            
            attempts++;
        }
        
        // If still no result, try a final extraction
        if (!result) {
            console.log('Waiting for textarea to fully populate...');
            
            // Wait specifically for the result textarea to appear
            await page.waitForSelector('textarea.Home_editor__textarea__W6jTe.Home_editor__result__GpHzx', {
                timeout: 25000,
                state: 'visible'
            });
            
            // Get the final result with proper handling
            result = await page.evaluate(() => {
                const resultTextarea = document.querySelector('textarea.Home_editor__textarea__W6jTe.Home_editor__result__GpHzx');
                
                if (resultTextarea) {
                    // Try multiple methods to get the content
                    let content = '';
                    
                    // Method 1: innerHTML (for HTML entities)
                    content = resultTextarea.innerHTML;
                    
                    // Method 2: textContent
                    if (!content || content.includes('&lt;textarea')) {
                        content = resultTextarea.textContent;
                    }
                    
                    // Method 3: value
                    if (!content || content.includes('&lt;textarea')) {
                        content = resultTextarea.value;
                    }
                    
                    return content || '';
                }
                
                return '';
            });
            
            // Clean up and decode entities
            if (result) {
                result = decodeHtmlEntities(result);
                
                // If it still contains HTML structure, extract just the text
                if (result.includes('&lt;textarea') || result.includes('<textarea')) {
                    const textMatch = result.match(/>([^<]*)</);
                    if (textMatch && textMatch[1]) {
                        result = textMatch[1].trim();
                    }
                }
            }
        }
        
        console.log('Final result length:', result?.length || 0);
        
        return result || 'Processing completed but no humanized text was returned. Please try again.';
        
    } catch (error) {
        console.error('Error with Undetectable AI:', error.message);
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
        const humanized = await humanizeWithUndetectableAI(req.body.text);
        res.json({ humanized });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
