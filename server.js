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
        
        // Humanize the text with longer timeout
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

// Enhanced humanize function with multiple strategies
async function humanizeText(text) {
    let browser;
    try {
        console.log('Starting humanization for:', text.substring(0, 50));
        
        browser = await chromium.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        // Set page timeout
        page.setDefaultTimeout(60000);
        
        // Wait for the page to load completely
        await page.goto('https://ai-text-humanizer.com/', {
            waitUntil: 'networkidle',
            timeout: 30000
        });
        
        // Wait for elements to be ready
        await page.waitForSelector('#textareaBefore', { timeout: 20000 });
        console.log('Found input field');
        
        // Clear and fill input textarea
        await page.fill('#textareaBefore', '');
        await page.fill('#textareaBefore', text);
        console.log('Filled input');
        
        // Wait a bit before clicking
        await page.waitForTimeout(2000);
        
        // Click the humanize button
        await page.click('#btnGo');
        console.log('Clicked button');
        
        // Wait and check for output with extended retries
        let result = '';
        let attempts = 0;
        const maxAttempts = 45; // 45 seconds max
        
        while (attempts < maxAttempts && !result) {
            await page.waitForTimeout(1000);
            
            // Try multiple ways to get the result
            result = await page.evaluate(() => {
                const textarea = document.querySelector('#textareaAfter');
                if (textarea) {
                    // Check value first, then textContent
                    return textarea.value || textarea.textContent || textarea.innerText || '';
                }
                return '';
            });
            
            attempts++;
            console.log(`Attempt ${attempts}, result length:`, result?.length || 0);
            
            // Check if we got a meaningful result
            if (result && result.trim() !== '' && result !== text && result.length > 10) {
                console.log('Got result after', attempts, 'seconds');
                break;
            }
        }
        
        // Final check with different approach
        if (!result || result === text || result.trim() === '') {
            console.log('Trying alternative approach');
            
            // Wait a bit more
            await page.waitForTimeout(5000);
            
            // Try to detect if the button is still processing
            const isProcessing = await page.evaluate(() => {
                const button = document.querySelector('#btnGo');
                return button ? button.disabled || button.classList.contains('loading') : false;
            });
            
            if (isProcessing) {
                console.log('Still processing, waiting more...');
                await page.waitForTimeout(10000);
                
                // Try one more time
                result = await page.inputValue('#textareaAfter');
            }
        }
        
        // Final fallback - take screenshot for debugging
        if (!result || result === text) {
            await page.screenshot({ path: `debug-${Date.now()}.png`, fullPage: true });
            console.log('Saved debug screenshot');
        }
        
        console.log('Final result:', result);
        return result || 'The AI humanizer is taking longer than expected. Please try again in a moment.';
        
    } catch (error) {
        console.error('Error in humanizeText:', error);
        return `Error: ${error.message}. Please try again.`;
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
