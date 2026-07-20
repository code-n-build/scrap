const puppeteer = require('puppeteer-core');
const fs = require('fs');

async function runCloudScraper() {
    console.log("Launching headless browser on cloud servers...");
    
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

    // Explicitly target your semester or subject question bank URLs here
    // Add your core subject question-bank URLs directly so it never fails Phase 1
    const subjectUrls = [
        'https://hamrocsit.com/semester/fifth/daa/question-bank/',
        'https://hamrocsit.com/semester/fifth/sad/question-bank/',
        'https://hamrocsit.com/semester/fifth/cryptography/question-bank/',
        'https://hamrocsit.com/semester/fifth/sm/question-bank/',
        'https://hamrocsit.com/semester/fifth/web-tech/question-bank/',
        'https://hamrocsit.com/semester/fifth/knoledge-management/question-bank/',
        'https://hamrocsit.com/semester/fifth/multimedia/question-bank/'
        
        // Add your 5th, 6th, 7th, and 8th semester subject question-bank URLs here:
        // 'https://hamrocsit.com/semester/fifth/your-subject/question-bank/',
        // 'https://hamrocsit.com/semester/sixth/your-subject/question-bank/',
    ];

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

    console.log(`\n--- Starting extraction across ${subjectUrls.length} configured subjects ---`);
    for (let sIdx = 0; sIdx < subjectUrls.length; sIdx++) {
        const subUrl = subjectUrls[sIdx];
        console.log(`\n[${sIdx + 1}/${subjectUrls.length}] Processing Subject: ${subUrl}`);

        try {
            await page.goto(subUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('.course-index', { timeout: 15000 });

            const subjectTitle = await page.evaluate(() => {
                const titleEl = document.querySelector('h1') || document.querySelector('.page-title');
                return titleEl ? titleEl.innerText.trim() : "Question Bank";
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
                    if (!doc) continue;
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
                            localHtml += `<div class="question">Q${qNumber}: <i>[Skipped Duplicate] Please refer to <strong>Exam Year ${origYear}, Q${origNum}</strong>.</i></div></div>`;
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

    console.log("\n--- Writing Compiled Data to Disk ---");
    fs.writeFileSync('All_Years_Complete_Offline_QnA.html', masterHtml);
    console.log("Extraction complete! File saved.");

    await browser.close();
}

runCloudScraper().catch(console.error);
