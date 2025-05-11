const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

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
        
        // Humanize with Rewritify AI
        const humanized = await humanizeWithRewritifyAI(textToHumanize.trim());
        
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
                    <p>Your text has been humanized with Rewritify AI:</p>
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

// Rewritify AI humanization function
async function humanizeWithRewritifyAI(text) {
    let browser;
    try {
        console.log('Starting humanization with Rewritify AI');
        
        browser = await chromium.launch({ 
            headless: true,
            timeout: 60000,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage'
            ]
        });
        
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 }
        });
        
        const page = await context.newPage();
        
        // Navigate to Rewritify AI
        await page.goto('https://rewritify.ai/', {
            waitUntil: 'networkidle',
            timeout: 30000
        });
        
        console.log('Loaded Rewritify AI');
        
        // Wait for the page to be fully loaded
        await page.waitForTimeout(5000);
        
        // Fill the input editor
        console.log('Filling input text...');
        await page.fill('div.tiptap.ProseMirror[contenteditable="true"]', text);
        console.log('Input text filled');
        
        // Click the Humanize button
        console.log('Clicking Humanize button...');
        await page.click('button.coco-btn.css-nx3rhx.coco-btn-primary');
        console.log('Humanize button clicked');
        
        // Wait for generation to complete
        console.log('Waiting for generation to complete...');
        await page.waitForTimeout(10000); // 10 seconds wait
        
        // Wait for the result with multiple selector attempts
        let result = '';
        let attempts = 0;
        const maxAttempts = 30;
        
        while (attempts < maxAttempts && !result) {
            await page.waitForTimeout(1000);
            
            // Try multiple selectors for the output
            const outputText = await page.evaluate(() => {
                // Selector 1: The most specific one from the HTML
                let outputEditor = document.querySelector('#outputView div.OutputEditor_bypassEditor__OD8nR div.tiptap.ProseMirror[contenteditable="false"]');
                
                if (outputEditor) {
                    const text = outputEditor.innerText || outputEditor.textContent || '';
                    if (text && text.trim().length > 50) {
                        return text.trim();
                    }
                }
                
                // Selector 2: Try without ID scope
                outputEditor = document.querySelector('div.OutputEditor_bypassEditor__OD8nR div.tiptap.ProseMirror[contenteditable="false"]');
                
                if (outputEditor) {
                    const text = outputEditor.innerText || outputEditor.textContent || '';
                    if (text && text.trim().length > 50) {
                        return text.trim();
                    }
                }
                
                // Selector 3: Go for the p tag directly
                const pElement = document.querySelector('#outputView div.OutputEditor_bypassEditor__OD8nR div.tiptap.ProseMirror[contenteditable="false"] p');
                
                if (pElement) {
                    const text = pElement.innerText || pElement.textContent || '';
                    if (text && text.trim().length > 50) {
                        return text.trim();
                    }
                }
                
                return '';
            });
            
            console.log(`Attempt ${attempts}: Found ${outputText.length} characters`);
            
            if (outputText && outputText.length > 50) {
                result = outputText;
                console.log(`Found result after ${attempts} seconds`);
                console.log(`Preview: ${result.substring(0, 100)}...`);
                break;
            }
            
            attempts++;
        }
        
        // If still no result, do a comprehensive search
        if (!result) {
            console.log('Trying comprehensive search...');
            
            result = await page.evaluate(() => {
                // Look for any div with the OutputEditor class that contains text
                const possibleContainers = document.querySelectorAll('div.OutputEditor_bypassEditor__OD8nR');
                
                for (const container of possibleContainers) {
                    // Get all text from this container
                    const allText = container.innerText || container.textContent || '';
                    
                    // Extract just the main content (before "Human-written" appears)
                    const lines = allText.split('\n');
                    let mainContent = '';
                    
                    for (const line of lines) {
                        if (line.includes('Human-written') || line.includes('Words')) {
                            break;
                        }
                        if (line.trim().length > 0) {
                            mainContent += line.trim() + ' ';
                        }
                    }
                    
                    mainContent = mainContent.trim();
                    
                    if (mainContent.length > 100) {
                        return mainContent;
                    }
                }
                
                return '';
            });
        }
        
        console.log('Final result length:', result?.length || 0);
        
        return result || 'Processing completed but no humanized text was returned. Please try again.';
        
    } catch (error) {
        console.error('Error with Rewritify AI:', error.message);
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

// Direct API endpoint
app.post('/humanize', async (req, res) => {
    try {
        const humanized = await humanizeWithRewritifyAI(req.body.text);
        res.json({ humanized });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
