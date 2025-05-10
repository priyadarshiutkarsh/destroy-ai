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
        const submission = req.body.rawRequest || req.body;
        
        // Extract text from JotForm
        let text = '';
        for (const [key, value] of Object.entries(submission)) {
            if (typeof value === 'string') text += value + ' ';
        }
        
        // Humanize text (this happens in background)
        humanizeText(text).then(humanized => {
            // Store or process the result
            console.log('Humanized:', humanized);
        });
        
        // Respond immediately to JotForm
        res.status(200).send('OK');
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Result display page - this receives form data directly from JotForm
app.post('/result', async (req, res) => {
    try {
        // Extract text from the form submission
        let text = '';
        const submission = req.body;
        
        for (const [key, value] of Object.entries(submission)) {
            if (typeof value === 'string') text += value + ' ';
        }
        
        // Humanize the text
        const humanized = await humanizeText(text);
        
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
                    .original { background: #f0f0f0; padding: 10px; margin-bottom: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Thank You!</h1>
                    <p>Your text has been humanized:</p>
                    <div class="original"><strong>Original:</strong><br>${text}</div>
                    <div class="result"><strong>Humanized:</strong><br>${humanized}</div>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
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

// Humanize function using exact IDs
async function humanizeText(text) {
    const browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
        const page = await browser.newPage();
        await page.goto('https://ai-text-humanizer.com/');
        
        // Wait for elements to load
        await page.waitForSelector('#textareaBefore');
        
        // Fill input textarea
        await page.fill('#textareaBefore', text);
        
        // Click the humanize button
        await page.click('#btnGo');
        
        // Wait for processing (give it time)
        await page.waitForTimeout(8000);
        
        // Get the humanized result
        const result = await page.inputValue('#textareaAfter');
        
        return result || 'No result found';
    } finally {
        await browser.close();
    }
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
