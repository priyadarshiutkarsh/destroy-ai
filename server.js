const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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
        
        // Humanize text
        const humanized = await humanizeText(text);
        
        res.json({ success: true, humanized });
    } catch (error) {
        res.status(500).json({ error: error.message });
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
