// Add a direct content extraction fallback approach
async function extractContentDirectly(page, log) {
    log('🔍 Attempting direct content extraction...');
    
    try {
        // This is a more direct approach that doesn't rely on specific selectors
        // It looks for content that appears to be the result
        const directResult = await page.evaluate((originalTextStart) => {
            // Get all text nodes that might contain our result
            const getAllTextNodes = () => {
                const textNodes = [];
                const walk = document.createTreeWalker(
                    document.body,
                    NodeFilter.SHOW_TEXT,
                    { acceptNode: node => node.textContent.trim().length > 50 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT },
                    false
                );
                
                while (walk.nextNode()) {
                    textNodes.push(walk.currentNode);
                }
                
                return textNodes;
            };
            
            const textNodes = getAllTextNodes();
            
            // Filter out nodes that are likely input (contain the original text)
            // or are part of UI elements like buttons
            const possibleResults = textNodes.filter(node => {
                // Skip if it contains the original text
                if (node.textContent.includes(originalTextStart)) {
                    return false;
                }
                
                // Skip if it's in a button or input
                let parent = node.parentElement;
                while (parent && parent !== document.body) {
                    const tagName = parent.tagName.toLowerCase();
                    if (tagName === 'button' || tagName === 'input' || 
                        parent.getAttribute('role') === 'button' ||
                        parent.textContent.toLowerCase().includes('humanize') ||
                        parent.textContent.toLowerCase().includes('rewrite')) {
                        return false;
                    }
                    parent = parent.parentElement;
                }
                
                return true;
            });
            
            // Sort by length, with preference to longer results
            possibleResults.sort((a, b) => 
                b.textContent.trim().length - a.textContent.trim().length
            );
            
            // Return the longest result if available
            return possibleResults.length > 0 ? 
                possibleResults[0].textContent.trim() : '';
        }, text.substring(0, 30));
        
        if (directResult && directResult.length > 100) {
            log(`✅ Found result using direct content extraction: ${directResult.length} characters`);
            return directResult;
        }
        
        // If that didn't work, try an even more aggressive approach
        return await page.evaluate(() => {
            // Look for any element that might contain our result
            const candidates = [];
            
            // Check for results in common output containers
            const containerSelectors = [
                '.output', '.result', '.generated', '.ai-output', 
                '.answer', '.response', '.rewritten', '.humanized'
            ];
            
            for (const selector of containerSelectors) {
                const elements = document.querySelectorAll(selector);
                for (const el of elements) {
                    candidates.push({
                        text: el.textContent.trim(),
                        length: el.textContent.trim().length,
                        element: el
                    });
                }
            }
            
            // Check all divs that have significant text
            const divs = document.querySelectorAll('div');
            for (const div of divs) {
                const text = div.textContent.trim();
                if (text.length > 100) {
                    candidates.push({
                        text: text,
                        length: text.length,
                        element: div
                    });
                }
            }
            
            // Sort by text length
            candidates.sort((a, b) => b.length - a.length);
            
            // Return the longest candidate text
            return candidates.length > 0 ? candidates[0].text : '';
        });
    } catch (e) {
        log(`⚠️ Direct content extraction failed: ${e.message}`);
        return '';
    }
}const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('⚠️ SIGTERM received, shutting down gracefully...');
    server.close(() => {
        console.log('✅ HTTP server closed');
        process.exit(0);
    });
});

// Health check
app.get('/health', (_, res) => res.json({ status: 'healthy' }));

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
        
        console.log('📝 Received submission:', submission);
        
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
        
        console.log('📝 Text to humanize:', textToHumanize);
        
        // Humanize with Rewritify AI
        const humanized = await humanizeWithRewritify(textToHumanize.trim());
        
        // Display the result
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Humanized Result</title>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; }
                    .container { background: #f5f5f5; padding: 30px; border-radius: 10px; }
                    .result { white-space: pre-wrap; background: #e0ffe0; padding: 20px; border-radius: 5px; margin-top: 20px; }
                    .original { background: #f9f9f9; padding: 20px; margin-bottom: 20px; border-radius: 5px; }
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
        console.error('❌ Error in result page:', error);
        res.status(500).send('Error processing your request');
    }
});

// Improved Rewritify AI humanization function with direct content scraping
async function humanizeWithRewritify(text) {
    let browser;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFilePath = path.join(logsDir, `rewritify_log_${timestamp}.txt`);
    
    // Function to log both to console and file
    const log = (message) => {
        const logMsg = `[${new Date().toISOString()}] ${message}`;
        console.log(logMsg);
        fs.appendFileSync(logFilePath, logMsg + '\n');
    };
    
    try {
        log('🚀 Starting humanization with Rewritify AI');
        
        // Configure browser with stealth settings
        browser = await chromium.launch({ 
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-web-security',
                '--font-render-hinting=none',  // Reduce font loading issues
                '--disable-gpu',               // Disable GPU acceleration
                '--disable-font-subpixel-positioning', // Reduce font rendering issues
                '--disable-lcd-text'           // Reduce font rendering issues
            ]
        });
        
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 }, // Smaller viewport to reduce rendering load
            deviceScaleFactor: 1,
            hasTouch: false,
            isMobile: false,
            javaScriptEnabled: true,
            acceptDownloads: true,
            // Add a locale to make the browser appear more legitimate
            locale: 'en-US',
            timezoneId: 'America/New_York',
            geolocation: { longitude: -73.935242, latitude: 40.730610 },
            permissions: ['geolocation']
        });
        
        // Override automation flags
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            
            // Add fake notification permission
            if (!window.Notification) {
                window.Notification = { permission: 'granted' };
            }
            
            // Overwrite the automation controller property
            if (chrome) {
                chrome.runtime = chrome.runtime || {};
                chrome.runtime.sendMessage = function() {};
            }
        });
        
        const page = await context.newPage();
        
        // Emulate human-like behavior
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0'
        });
        
        // Add random mouse movements to avoid detection
        page.mouse.move(Math.random() * 500, Math.random() * 500);
        
        // Random scroll function to mimic human behavior
        const randomScroll = async () => {
            const scrollAmount = Math.floor(Math.random() * 100) + 50;
            await page.mouse.wheel(0, scrollAmount);
            await page.waitForTimeout(Math.random() * 1000 + 500);
        };
        
        // Navigate to Rewritify AI with enhanced page loading
        log('🌐 Navigating to Rewritify.ai...');
        try {
            // First attempt with minimal wait conditions to avoid timeout
            const response = await page.goto('https://rewritify.ai/', {
                waitUntil: 'domcontentloaded',  // Use domcontentloaded instead of networkidle
                timeout: 30000
            });
            
            if (!response || !response.ok()) {
                throw new Error(`Failed to load page: ${response ? response.status() : 'No response'}`);
            }
            
            log(`✅ Loaded Rewritify AI: ${response.status()}`);
            
            // Wait a bit for any dynamic content to load
            await page.waitForTimeout(3000);
            
        } catch (navError) {
            log(`⚠️ Navigation issue: ${navError.message}`);
            
            // Try again with even more minimal settings
            log('🔄 Retrying with minimal settings...');
            try {
                await page.goto('https://rewritify.ai/', {
                    waitUntil: 'commit',  // Even less waiting than domcontentloaded
                    timeout: 20000
                });
                
                // Just wait a fixed amount of time
                await page.waitForTimeout(5000);
                log('✅ Page loaded with minimal settings');
            } catch (minimalNavError) {
                log(`❌ Even minimal navigation failed: ${minimalNavError.message}`);
                throw new Error(`Could not load Rewritify.ai: ${minimalNavError.message}`);
            }
        }
        
        // Take a screenshot to see what we're working with
        try {
            const initialScreenshotPath = path.join(logsDir, `rewritify_initial_${timestamp}.png`);
            await page.screenshot({ 
                path: initialScreenshotPath, 
                fullPage: false,
                timeout: 5000
            });
            log(`📸 Initial screenshot saved to ${initialScreenshotPath}`);
        } catch (screenshotError) {
            log(`⚠️ Initial screenshot failed: ${screenshotError.message}`);
            // Continue execution even if screenshot fails
        }
        
        // Save page HTML for debugging
        const initialHtmlPath = path.join(logsDir, `rewritify_initial_${timestamp}.html`);
        fs.writeFileSync(initialHtmlPath, await page.content());
        log(`💾 Initial HTML saved to ${initialHtmlPath}`);
        
        // Detect if there's a cookie consent dialog and handle it
        try {
            const cookieSelectors = [
                'button:has-text("Accept")',
                'button:has-text("Accept All")',
                'button:has-text("I Agree")',
                'button:has-text("OK")',
                'button:has-text("Got it")',
                'button[aria-label="Accept cookies"]',
                '.cookie-consent-button',
                '.consent-button',
                '.accept-cookies'
            ];
            
            for (const selector of cookieSelectors) {
                const hasButton = await page.$(selector);
                if (hasButton) {
                    log(`🍪 Found cookie consent button: ${selector}`);
                    await page.click(selector);
                    await page.waitForTimeout(1000);
                    break;
                }
            }
        } catch (cookieError) {
            log(`⚠️ Error handling cookie consent: ${cookieError.message}`);
        }
        
        // Make some random movements to appear human-like
        await randomScroll();
        await page.mouse.move(Math.random() * 500, Math.random() * 500);
        await page.waitForTimeout(1000 + Math.random() * 1000);
        
        // Try multiple selectors for the input editor with a more thorough approach
        const inputSelectors = [
            'div.tiptap.ProseMirror[contenteditable="true"]',
            'div[contenteditable="true"]',
            '.editor-container [contenteditable="true"]',
            '.input-editor [contenteditable="true"]',
            '.tiptap[contenteditable="true"]',
            'div.ProseMirror[contenteditable="true"]',
            // Try more general selectors as fallbacks
            '[contenteditable="true"]',
            'textarea',
            'textarea.input-textarea',
            // Try using XPath as a last resort
            '//div[@contenteditable="true"]'
        ];
        
        let inputFound = false;
        let inputElement = null;
        
        for (const selector of inputSelectors) {
            try {
                log(`⏳ Trying input selector: ${selector}`);
                
                // Use a shorter timeout for each individual selector
                if (selector.startsWith('//')) {
                    // XPath selector
                    inputElement = await page.waitForXPath(selector, { timeout: 5000 });
                } else {
                    // CSS selector
                    inputElement = await page.waitForSelector(selector, { timeout: 5000 });
                }
                
                if (inputElement) {
                    // Test if we can actually interact with this element
                    if (selector.startsWith('//')) {
                        // For XPath selectors
                        await inputElement.evaluate(el => {
                            el.textContent = '';
                            el.focus();
                        });
                    } else {
                        // Try focus() first - this is more reliable in some cases
                        await page.evaluate(selector => {
                            const element = document.querySelector(selector);
                            if (element) {
                                element.textContent = '';
                                element.focus();
                            }
                        }, selector);
                    }
                    
                    // Wait a bit to see if the element stays focused
                    await page.waitForTimeout(500);
                    
                    // Insert text using different methods
                    log(`📝 Attempting to input text...`);
                    
                    // Try several methods to input text
                    try {
                        // Method 1: Using fill
                        await inputElement.fill(text);
                    } catch (fillErr) {
                        log(`⚠️ Fill method failed: ${fillErr.message}`);
                        
                        try {
                            // Method 2: Using type
                            await inputElement.type(text, { delay: 10 });
                        } catch (typeErr) {
                            log(`⚠️ Type method failed: ${typeErr.message}`);
                            
                            try {
                                // Method 3: Using evaluation
                                await inputElement.evaluate((el, value) => {
                                    el.textContent = value;
                                    // Create and dispatch an input event
                                    const event = new Event('input', { bubbles: true });
                                    el.dispatchEvent(event);
                                }, text);
                            } catch (evalErr) {
                                log(`⚠️ Evaluation method failed: ${evalErr.message}`);
                                throw new Error('All input methods failed');
                            }
                        }
                    }
                    
                    inputFound = true;
                    log(`✅ Found and filled input with selector: ${selector}`);
                    break;
                }
            } catch (e) {
                log(`⚠️ Input selector failed: ${selector} - ${e.message}`);
            }
        }
        
        // If we still can't find the input, try a more aggressive approach
        if (!inputFound) {
            log(`⚠️ Could not find input with standard selectors. Trying JavaScript evaluation...`);
            
            // Take another screenshot to see what we're working with
            try {
                const beforeJSScreenshotPath = path.join(logsDir, `rewritify_beforeJS_${timestamp}.png`);
                await page.screenshot({ 
                    path: beforeJSScreenshotPath, 
                    fullPage: false,
                    timeout: 5000
                });
            } catch (screenshotError) {
                log(`⚠️ Screenshot before JS evaluation failed: ${screenshotError.message}`);
            }
            
            // Try to find and fill any contenteditable element using JavaScript
            try {
                inputFound = await page.evaluate((inputText) => {
                    // Try to find any contenteditable element
                    const editableElements = Array.from(document.querySelectorAll('[contenteditable="true"]'));
                    
                    if (editableElements.length > 0) {
                        const mainEditor = editableElements[0];
                        mainEditor.textContent = inputText;
                        
                        // Create and dispatch an input event
                        const event = new Event('input', { bubbles: true });
                        mainEditor.dispatchEvent(event);
                        
                        return true;
                    }
                    
                    // If no contenteditable, try textareas
                    const textareas = Array.from(document.querySelectorAll('textarea'));
                    if (textareas.length > 0) {
                        textareas[0].value = inputText;
                        
                        // Create and dispatch an input event
                        const event = new Event('input', { bubbles: true });
                        textareas[0].dispatchEvent(event);
                        
                        return true;
                    }
                    
                    return false;
                }, text);
                
                if (inputFound) {
                    log(`✅ Found and filled input using JavaScript evaluation`);
                }
            } catch (jsError) {
                log(`⚠️ JavaScript evaluation failed: ${jsError.message}`);
            }
        }
        
        if (!inputFound) {
            throw new Error('Could not find or interact with the input editor on Rewritify.ai');
        }
        
        // Take a screenshot after text input with timeout handling
        try {
            const afterInputScreenshotPath = path.join(logsDir, `rewritify_afterInput_${timestamp}.png`);
            // Use a non-fullPage screenshot with a shorter timeout
            await page.screenshot({ 
                path: afterInputScreenshotPath, 
                fullPage: false,
                timeout: 5000 
            });
            log(`📸 After input screenshot saved to ${afterInputScreenshotPath}`);
        } catch (screenshotError) {
            log(`⚠️ Screenshot failed: ${screenshotError.message}`);
            // Continue execution even if screenshot fails
        }
        
        // Try multiple selectors for the Humanize button
        const buttonSelectors = [
            'button:has-text("Humanize")',
            'button.humanize-button',
            'button:text("Humanize")',
            'button.rewritify-button',
            'button:has-text("Rewrite")',
            'button:has-text("Generate")',
            'button.generate-button',
            // More generic selectors
            'button.primary-button',
            'button.main-action',
            'button.action-button',
            // Last resort XPath
            '//button[contains(text(), "Humanize")]',
            '//button[contains(text(), "Rewrite")]',
            '//button[contains(text(), "Generate")]'
        ];
        
        let buttonFound = false;
        
        for (const selector of buttonSelectors) {
            try {
                log(`⏳ Trying button selector: ${selector}`);
                
                // Use a shorter timeout for each selector
                let buttonElement;
                if (selector.startsWith('//')) {
                    // XPath selector
                    buttonElement = await page.waitForXPath(selector, { timeout: 5000 });
                } else {
                    // CSS selector
                    buttonElement = await page.waitForSelector(selector, { timeout: 5000 });
                }
                
                if (buttonElement) {
                    // Click the button
                    if (selector.startsWith('//')) {
                        await buttonElement.click();
                    } else {
                        await page.click(selector);
                    }
                    
                    buttonFound = true;
                    log(`✅ Clicked button with selector: ${selector}`);
                    break;
                }
            } catch (e) {
                log(`⚠️ Button selector failed: ${selector} - ${e.message}`);
            }
        }
        
        // If we still can't find the button, try a more aggressive approach
        if (!buttonFound) {
            log(`⚠️ Could not find button with standard selectors. Trying JavaScript evaluation...`);
            
            // Take another screenshot
            try {
                const beforeButtonJSScreenshotPath = path.join(logsDir, `rewritify_beforeButtonJS_${timestamp}.png`);
                await page.screenshot({ 
                    path: beforeButtonJSScreenshotPath, 
                    fullPage: false,
                    timeout: 5000
                });
            } catch (screenshotError) {
                log(`⚠️ Screenshot before button JS evaluation failed: ${screenshotError.message}`);
            }
            
            // Try to find and click any button that looks like a humanize button
            try {
                buttonFound = await page.evaluate(() => {
                    // Keywords to look for in button text
                    const keywords = ['humanize', 'rewrite', 'generate', 'submit', 'start'];
                    
                    // Get all buttons
                    const buttons = Array.from(document.querySelectorAll('button'));
                    
                    // Find a button that contains one of our keywords
                    for (const button of buttons) {
                        const buttonText = button.textContent.toLowerCase();
                        
                        for (const keyword of keywords) {
                            if (buttonText.includes(keyword)) {
                                button.click();
                                return true;
                            }
                        }
                    }
                    
                    // If no button matches our keywords, try clicking the most prominent button
                    if (buttons.length > 0) {
                        // Sort buttons by size (area) - larger buttons are usually more important
                        buttons.sort((a, b) => {
                            const aRect = a.getBoundingClientRect();
                            const bRect = b.getBoundingClientRect();
                            return (bRect.width * bRect.height) - (aRect.width * aRect.height);
                        });
                        
                        // Click the largest button
                        buttons[0].click();
                        return true;
                    }
                    
                    return false;
                });
                
                if (buttonFound) {
                    log(`✅ Found and clicked button using JavaScript evaluation`);
                }
            } catch (jsError) {
                log(`⚠️ JavaScript button evaluation failed: ${jsError.message}`);
            }
        }
        
        if (!buttonFound) {
            throw new Error('Could not find the Humanize/Generate button on Rewritify.ai');
        }
        
        // Wait for generation to complete with a longer timeout
        log('⏳ Waiting for generation to complete...');
        await page.waitForTimeout(30000); // 30 seconds to allow for generation
        
        // Take a screenshot after generation
        try {
            const afterGenerationScreenshotPath = path.join(logsDir, `rewritify_afterGeneration_${timestamp}.png`);
            await page.screenshot({ 
                path: afterGenerationScreenshotPath, 
                fullPage: false,
                timeout: 5000
            });
            log(`📸 After generation screenshot saved to ${afterGenerationScreenshotPath}`);
        } catch (screenshotError) {
            log(`⚠️ After generation screenshot failed: ${screenshotError.message}`);
        }
        
        // Try multiple selectors to find the result with a more thorough approach
        let result = '';
        
        // Expanded list of selectors for result content
        const resultSelectors = [
            // Original selectors
            'div.scrollbar.h-full.overflow-y-auto div.tiptap.ProseMirror[contenteditable="false"]',
            'div.editor_tiptap__f6ZIP.OutputEditor_bypassEditor__OD8nR div.tiptap.ProseMirror',
            // Additional selectors
            'div.tiptap.ProseMirror[contenteditable="false"]',
            'div.output-editor .tiptap',
            'div.result-container .tiptap',
            'div.result-text',
            'div.output-container .ProseMirror',
            'div.result-area',
            'div.output-text',
            // More generic selectors
            '.output-container',
            '.result-container',
            // Last resort
            'div.ProseMirror:not([contenteditable="true"])'
        ];
        
        for (const selector of resultSelectors) {
            try {
                log(`🔍 Trying result selector: ${selector}`);
                let content = await page.textContent(selector, { timeout: 5000 });
                
                if (content && content.trim().length > 50) {
                    result = content.trim();
                    log(`✅ Found result with selector: ${selector}`);
                    break;
                } else {
                    log(`⚠️ Insufficient content (${content?.length || 0} chars) found with selector: ${selector}`);
                }
            } catch (e) {
                log(`⚠️ Result selector failed: ${selector} - ${e.message}`);
            }
        }
        
        // If we still have no result, try looking for any significant text blocks
        if (!result || result.trim().length <= 50) {
            log(`⚠️ No sufficient result found with standard selectors. Trying to find any text blocks...`);
            
            try {
                // Look for any paragraph or div with substantial text
                const contentElements = await page.$$('p, div');
                
                for (const element of contentElements) {
                    const text = await element.textContent();
                    
                    // Check if this element contains significant text and isn't our input
                    if (text && text.trim().length > 100 && !text.includes(text.substring(0, 20))) {
                        result = text.trim();
                        log(`✅ Found result text block with ${result.length} characters`);
                        break;
                    }
                }
            } catch (findBlocksError) {
                log(`⚠️ Error finding text blocks: ${findBlocksError.message}`);
            }
        }
        
        // If we still don't have a result, try a JavaScript evaluation approach
        if (!result || result.trim().length <= 50) {
            log(`⚠️ Still no sufficient result. Trying JavaScript evaluation...`);
            
            try {
                // Use JavaScript to find the largest text block that isn't our input
                result = await page.evaluate((inputText) => {
                    // Find all text nodes in the document
                    const walker = document.createTreeWalker(
                        document.body,
                        NodeFilter.SHOW_TEXT,
                        null,
                        false
                    );
                    
                    let node;
                    let bestText = '';
                    let bestLength = 0;
                    
                    // Get the first 20 chars of input to avoid selecting our own input
                    const inputStart = inputText.substring(0, 20);
                    
                    while ((node = walker.nextNode())) {
                        const text = node.nodeValue.trim();
                        
                        // Skip small text or text that looks like our input
                        if (text.length <= 100 || text.includes(inputStart)) {
                            continue;
                        }
                        
                        // Find the element that contains this text
                        let element = node.parentElement;
                        
                        // Check if this is hidden or in an editor area
                        let isHidden = false;
                        let isEditor = false;
                        
                        while (element && element !== document.body) {
                            const style = window.getComputedStyle(element);
                            if (style.display === 'none' || style.visibility === 'hidden') {
                                isHidden = true;
                                break;
                            }
                            
                            // Check if this is in an editor area (likely our input)
                            if (element.getAttribute('contenteditable') === 'true' || 
                                element.classList.contains('input-editor') || 
                                element.classList.contains('editor-container')) {
                                isEditor = true;
                                break;
                            }
                            
                            element = element.parentElement;
                        }
                        
                        if (!isHidden && !isEditor && text.length > bestLength) {
                            bestText = text;
                            bestLength = text.length;
                        }
                    }
                    
                    return bestText;
                }, text);
                
                if (result && result.trim().length > 50) {
                    log(`✅ Found result using JavaScript evaluation: ${result.length} characters`);
                }
            } catch (jsEvalError) {
                log(`⚠️ JavaScript evaluation for result failed: ${jsEvalError.message}`);
            }
        }
        
        // If we still have no result, try direct content extraction as a last resort
        if (!result || result.trim().length <= 50) {
            log(`⚠️ No sufficient result with standard methods. Attempting direct content extraction...`);
            
            result = await extractContentDirectly(page, log);
            
            if (result && result.trim().length > 50) {
                log(`✅ Direct content extraction successful: ${result.length} characters`);
            } else {
                log(`⚠️ Direct content extraction failed to get sufficient content`);
            }
        }
        
        // Final check - if we still don't have a result, take a screenshot and save HTML
        if (!result || result.trim().length <= 50) {
            log(`⚠️ No sufficient result found after all attempts. Saving diagnostic information...`);
            
            // Take a final screenshot
            try {
                const finalScreenshotPath = path.join(logsDir, `rewritify_final_${timestamp}.png`);
                await page.screenshot({ 
                    path: finalScreenshotPath, 
                    fullPage: false,
                    timeout: 5000
                });
                log(`📸 Final screenshot saved to ${finalScreenshotPath}`);
            } catch (screenshotError) {
                log(`⚠️ Final screenshot failed: ${screenshotError.message}`);
            }
            
            // Save the final HTML
            const finalHtmlPath = path.join(logsDir, `rewritify_final_${timestamp}.html`);
            fs.writeFileSync(finalHtmlPath, await page.content());
            log(`💾 Final HTML saved to ${finalHtmlPath}`);
            
            // Return a helpful error message
            return `The AI humanizer service didn't return a valid result. This could be due to site changes, a temporary error, or detection of automation. Please try again later or check the logs for more information.`;
        }
        
        log(`📏 Final result length: ${result?.trim().length || 0}`);
        return result.trim();
        
    } catch (error) {
        log(`❌ Error with Rewritify AI: ${error.message}`);
        log(`${error.stack}`);
        
        // Try to take a screenshot if browser is still accessible
        if (browser) {
            try {
                const pages = await browser.pages();
                if (pages.length > 0) {
                    const errorScreenshotPath = path.join(logsDir, `rewritify_error_${timestamp}.png`);
                    await pages[0].screenshot({ 
                        path: errorScreenshotPath, 
                        fullPage: false,
                        timeout: 5000
                    });
                    log(`📸 Error screenshot saved to ${errorScreenshotPath}`);
                    
                    // Save the HTML too
                    const errorHtmlPath = path.join(logsDir, `rewritify_error_${timestamp}.html`);
                    fs.writeFileSync(errorHtmlPath, await pages[0].content());
                    log(`💾 Error HTML saved to ${errorHtmlPath}`);
                }
            } catch (screenshotError) {
                log(`❌ Failed to take error screenshot: ${screenshotError.message}`);
            }
        }
        
        return `Error: ${error.message}`;
    } finally {
        if (browser) {
            try {
                await browser.close();
                log('🔒 Browser closed');
            } catch (e) {
                log(`❌ Error closing browser: ${e.message}`);
            }
        }
    }
}

// Direct API endpoint
app.post('/humanize', async (req, res) => {
    try {
        const humanized = await humanizeWithRewritify(req.body.text);
        res.json({ humanized });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
