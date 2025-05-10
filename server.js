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
        // Look for specific fields that contain the text to humanize
        const submission = req.body;
        let textToHumanize = '';
        
        console.log('Received submission:', submission);
        
        // Try to find the main text field (adjust field names as needed)
        for (const [key, value] of Object.entries(submission)) {
            // Skip email, name, phone fields
            if (key.includes('email') || key.includes('name') || key.includes('phone') || key.includes('address')) {
                continue;
            }
            
            // Check if this is a text field that's long enough
            if (typeof value === 'string' && value.length > 20) {
                textToHumanize = value;
                break;
            }
        }
        
        console.log('Text to humanize:', textToHumanize);
        
        // If no specific field found, use all text combined (as fallback)
        if (!textToHumanize) {
            for (const [key, value] of Object.entries(submission)) {
                if (typeof value === 'string' && !key.includes('email') && !key.includes('name')) {
                    textToHumanize += value + ' ';
                }
            }
        }
        
        // Humanize the text
        const humanized = await humanizeText(textToHumanize.trim());
        
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
                    <p>Your text has been humanized:</p>
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

// Direct API endpoint
app.post('/humanize', async (req, res) => {
    try {
        const humanized = await humanizeText(req.body.text);
        res.json({ humanized });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Humanize function using exact IDs with better timing and error handling
async function humanizeText(text) {
    let browser;
    try {
        console.log('Starting humanization for:', text.substring(0, 50));
        
        browser = await chromium.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        // Wait for the page to load completely
        await page.goto('https://ai-text-humanizer.com/', {
            waitUntil: 'networkidle'
        });
        
        // Wait for elements to be ready
        await page.waitForSelector('#textareaBefore', { timeout: 15000 });
        console.log('Found input field');
        
        // Clear and fill input textarea
        await page.fill('#textareaBefore', '');
        await page.fill('#textareaBefore', text);
        console.log('Filled input');
        
        // Click the humanize button
        await page.click('#btnGo');
        console.log('Clicked button');
        
        // Wait and check for output with retries
        let result = '';
        let attempts = 0;
        const maxAttempts = 20; // 20 seconds max
        
        while (attempts < maxAttempts && !result) {
            await page.waitForTimeout(1000);
            result = await page.inputValue('#textareaAfter');
            attempts++;
            
            if (result && result.trim() !== '' && result !== text) {
                console.log('Got result after', attempts, 'seconds');
                break;
            }
        }
        
        if (!result || result === text) {
            console.log('No new result found, trying alternative selector');
            // Try getting text content instead of input value
            result = await page.evaluate(() => {
                const textarea = document.querySelector('#textareaAfter');
                return textarea ? textarea.value || textarea.textContent : '';
            });
        }
        
        console.log('Final result:', result);
        return result || 'Processing timed out. Please try again.';
        
    } catch (error) {
        console.error('Error in humanizeText:', error);
        return `Error: ${error.message}`;
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (e) {
                console.error('Error closing browser:', e);
            }
        }
    }
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
