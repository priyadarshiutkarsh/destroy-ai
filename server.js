async function humanizeWithRewritify(input) {
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox']
    });

    try {
        const context = await browser.newContext({
            userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/114.0 Safari/537.36',
            viewport: { width: 1280, height: 800 }
        });

        const page = await context.newPage();
        await page.goto('https://rewritify.ai', { waitUntil: 'load', timeout: 60000 });

        // Type into the editor
        await page.waitForSelector('div.tiptap.ProseMirror[contenteditable="true"]', { timeout: 15000 });
        await page.fill('div.tiptap.ProseMirror[contenteditable="true"]', input);

        // Click Humanize button
        await page.click('button:has-text("Humanize")');
        await page.waitForTimeout(8000); // wait for generation

        // Retry loop: attempt to locate ANY matching output divs
        const maxRetries = 10;
        let result = '';

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const possible = await page.evaluate(() => {
                const divs = document.querySelectorAll('div.tiptap.ProseMirror[contenteditable="false"]');
                for (const div of divs) {
                    const text = div.innerText || div.textContent;
                    if (text && text.length > 100 && !text.includes('Humanize')) {
                        return text.trim();
                    }
                }
                return '';
            });

            if (possible) {
                result = possible;
                break;
            }

            await page.waitForTimeout(1000); // wait 1 sec before next try
        }

        return result || '⚠️ Output not found after generation. Try again.';
    } catch (err) {
        console.error('❌ Error during automation:', err);
        return `Error: ${err.message}`;
    } finally {
        await browser.close();
    }
}
