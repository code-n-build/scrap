const puppeteer = require('puppeteer-core');
const fs = require('fs');

async function runCloudScraper() {
    console.log("Launching headless browser on cloud servers...");
    
    // Clean connection string without rejected parameters
    const browser = await puppeteer.connect({
        browserWSEndpoint: `wss://production-lon.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Inject logged-in session cookies
    await page.setCookie({
        name: process.env.COOKIE_NAME,
        value: process.env.COOKIE_VALUE,
        domain: 'hamrocsit.com'
    });

    const semesters = ['fifth', 'sixth', 'seventh', 'eighth'];
    const subjectUrls = [];

    console.log("--- Phase 1: Discovering Subject Question Banks ---");
    for (const sem of semesters) {
        const semUrl = `https://hamrocsit.com/semester/${sem}/`;
        console.log(`Scanning: ${semUrl}`);
        
        try {
            await page.goto(semUrl, { waitUntil: 'domcontentloaded' });
            const uniqueLinks = await page.evaluate((baseUrl) => {
                const anchors = Array.from(document.querySelectorAll('a'));
                const validBanks = new Set();
                anchors.forEach(a => {
                    if (a.href.startsWith(baseUrl) && a.href.length > baseUrl.length) {
                        const remainder = a.href.substring(baseUrl.length);
                        const parts = remainder.split('/').filter(p => p.length > 0);
                        if (parts.length === 1 && !parts[0].includes('#')) {
                            validBanks.add(baseUrl + parts[0] + '/question-bank/');
                        }
                    }
                });
                return Array.from(validBanks);
            }, semUrl);
            subjectUrls.push(...uniqueLinks);
        } catch (err) {
            console.error(`Failed to load ${sem}:`, err.message);
        }
    }

    let masterHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Comprehensive Question Bank - Semesters 5 to 8</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; max-width: 900px; margin: 20px auto; padding: 20px; color: #333; }
            h1 { text-align: center; border-bottom: 3px solid #0366d6; padding-bottom: 10px; }
            h2 { color: #0366d6; margin-top: 40px; border-bottom: 1px solid #ccc; padding-bottom: 5px; }
            .qa-block { border: 1px solid #ddd; padding: 20px; margin-bottom: 20px; border-radius: 5px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
            .question { font-weight: bold; font-size: 1.1em; margin-bottom: 15px; border-bottom: 2px solid #555; padding-bottom: 10px; }
            .answer { background-color: #f9f9f9; padding: 15px; border-left: 4px solid #0d6efd; }
            img { max-width: 100%; height: auto; display: block; margin: 15px 0; border: 1px solid #eee; }
        </style>
    </head>
    <body>
        <h1>Comprehensive Question Bank (Sem 5 - 8)</h1>
    `;

    let globalSeenQuestions = {};

    console.log(`\n--- Phase 2: Processing ${subjectUrls.length} subjects with your core logic ---`);
    for (let sIdx = 0; sIdx < subjectUrls.length; sIdx++) {
        const subUrl = subjectUrls[sIdx];
        console.log(`\n[${sIdx + 1}/${subjectUrls.length}] Processing Subject: ${subUrl}`);

        try {
            await page.goto(subUrl, { waitUntil: 'domcontentloaded' });
            
            const subjectTitle = await page.evaluate(() => {
                const titleEl = document.querySelector('h1') || document.querySelector('.page-title');
                return titleEl ? titleEl.innerText.trim() : "Unknown Subject";
            });
            masterHtml += `<h1 style="color: #d63031; margin-top: 60px;">Subject: ${subjectTitle}</h1>`;

            const subjectResult = await page.evaluate(async (seenQuestionsMap) => {
                const delay = ms => new Promise(res => setTimeout(res, ms));
                
                async function getBase64ImageFromUrl(imageUrl) {
                    try {
                        const response = await fetch(imageUrl);
                        const blob = await response.blob();
                        return new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        });
                    } catch (error) { return imageUrl; }
                }

                async function processImagesInElement(element) {
                    const images = element.querySelectorAll('img');
                    for (let img of images) {
                        const originalSrc = img.src || img.getAttribute('src');
                        if (originalSrc && !originalSrc.startsWith('data:')) {
                            img.src = await getBase64ImageFromUrl(originalSrc);
                            img.removeAttribute('srcset'); 
                            img.removeAttribute('fetchpriority');
                            img.removeAttribute('decoding');
                        }
                    }
                }

                const sidebar = document.querySelector('.course-index');
                if (!sidebar) return { html: "<p>No exam years found for this subject.</p>", updatedMap: seenQuestionsMap };

                const links = Array.from(sidebar.querySelectorAll('a')).map(a => ({ name: a.innerText.trim(), url: a.href }));
                
                let localHtml = '';
                const iframe = document.createElement('iframe');
                iframe.style.cssText = "width: 1200px; height: 800px; position: fixed; top: 0; left: -10000px; z-index: -9999;";
                document.body.appendChild(iframe);

                for (const link of links) {
                    localHtml += `<h2>Exam Year: ${link.name}</h2>`;

                    await new Promise(resolve => { iframe.onload = resolve; iframe.src = link.url; });
                    await delay(2000); 

                    const doc = iframe.contentDocument;
                    const questionContainers = doc.querySelectorAll('.single_question_container');

                    for (let i = 0; i < questionContainers.length; i++) {
                        const container = questionContainers[i];
                        const qId = container.getAttribute('data-id');
                        const qNumberElement = container.querySelector('.qnbank_number');
                        const qNumber = qNumberElement ? qNumberElement.innerText.trim() : (i + 1);

                        localHtml += `<div class="qa-block">`;

                        if (qId && seenQuestionsMap[qId]) {
                            const origYear = seenQuestionsMap[qId].year;
                            const origNum = seenQuestionsMap[qId].qNum;
                            localHtml += `<div class="question">Q${qNumber}: <i>[Skipped Duplicate] Please refer to the exact same question and answer in <strong>Exam Year ${origYear}, Q${origNum}</strong>.</i></div></div>`;
                            continue; 
                        }

                        if (qId) seenQuestionsMap[qId] = { year: link.name, qNum: qNumber };

                        const qContentElement = container.querySelector('.qnbank_content');
                        if (qContentElement) {
                            const tempQDiv = document.createElement('div');
                            tempQDiv.innerHTML = qContentElement.innerHTML;
                            await processImagesInElement(tempQDiv);
                            localHtml += `<div class="question">Q${qNumber}: ${tempQDiv.innerHTML}</div>`;
                        } else {
                            localHtml += `<div class="question">Q${qNumber}: </div>`;
                        }

                        const answerButton = container.querySelector('.has_answer_tick i');
                        if (answerButton) {
                            answerButton.click();
                            await delay(2000);
                            const popupContent = doc.querySelector('#modal-content-content');
                            if (popupContent) {
                                const tempADiv = document.createElement('div');
                                tempADiv.innerHTML = popupContent.innerHTML;
                                await processImagesInElement(tempADiv);
                                localHtml += `<div class="answer"><h3>Answer:</h3>${tempADiv.innerHTML}</div>`;
                            } else {
                                localHtml += `<div class="answer"><p><i>Answer content not found.</i></p></div>`;
                            }
                            const closeButton = doc.querySelector('.btn-close');
                            if (closeButton) { closeButton.click(); await delay(1000); }
                        } else {
                            localHtml += `<div class="answer"><p><i>No answer available.</i></p></div>`;
                        }
                        localHtml += `</div>`;
                    }
                }
                document.body.removeChild(iframe);
                return { html: localHtml, updatedMap: seenQuestionsMap };
            }, globalSeenQuestions);

            masterHtml += subjectResult.html;
            globalSeenQuestions = subjectResult.updatedMap;

        } catch (subErr) {
            console.error(`Error processing subject ${subUrl}:`, subErr.message);
        }
    }

    masterHtml += `</body></html>`;

    console.log("\n--- Phase 3: Writing Compiled Data to Disk ---");
    fs.writeFileSync('All_Years_Complete_Offline_QnA.html', masterHtml);
    console.log("Extraction complete! File saved.");

    await browser.close();
}

runCloudScraper().catch(console.error);
