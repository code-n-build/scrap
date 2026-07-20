const puppeteer = require('puppeteer-core');
const fs = require('fs');

const delay = ms => new Promise(res => setTimeout(res, ms));

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

    const semesters = ['fifth', 'sixth', 'seventh', 'eighth'];
    const subjectUrls = [];

    console.log("--- Phase 1: Discovering Subject Question Banks ---");
    for (const sem of semesters) {
        const semUrl = `https://hamrocsit.com/semester/${sem}/`;
        console.log(`Scanning semester landing page: ${semUrl}`);
        
        try {
            await page.goto(semUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            
            // Extract all subject question-bank URLs from the semester page
            const links = await page.evaluate(() => {
                const anchors = Array.from(document.querySelectorAll('a'));
                return anchors
                    .map(a => a.href)
                    .filter(href => href && href.includes('/question-bank'));
            });

            // De-duplicate URLs
            const uniqueLinks = [...new Set(links)];
            console.log(`Found ${uniqueLinks.length} subject question bank(s) for ${sem} semester.`);
            subjectUrls.push(...uniqueLinks);
        } catch (err) {
            console.error(`Failed to load semester ${sem}:`, err.message);
        }
    }

    console.log(`\nTotal Subjects Found Across Semesters: ${subjectUrls.length}`);

    // Master HTML Shell Setup
    let masterHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>HamroCSIT Question Bank (Semesters 5-8)</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; max-width: 900px; margin: 20px auto; padding: 20px; color: #333; }
            h1 { text-align: center; border-bottom: 3px solid #0366d6; padding-bottom: 10px; }
            h2 { color: #0366d6; margin-top: 40px; border-bottom: 2px solid #0366d6; padding-bottom: 5px; }
            h3 { color: #555; margin-top: 25px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
            .qa-block { border: 1px solid #ddd; padding: 20px; margin-bottom: 20px; border-radius: 5px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
            .question { font-weight: bold; font-size: 1.1em; margin-bottom: 15px; border-bottom: 2px solid #555; padding-bottom: 10px; }
            .answer { background-color: #f9f9f9; padding: 15px; border-left: 4px solid #0d6efd; }
            img { max-width: 100%; height: auto; display: block; margin: 15px 0; border: 1px solid #eee; }
        </style>
    </head>
    <body>
        <h1>HamroCSIT Comprehensive Question Bank (Semesters 5 to 8)</h1>
    `;

    const seenQuestions = {};

    console.log("\n--- Phase 2: Extracting Questions and Answers ---");
    for (let sIdx = 0; sIdx < subjectUrls.length; sIdx++) {
        const subUrl = subjectUrls[sIdx];
        console.log(`\n[Subject ${sIdx + 1}/${subjectUrls.length}] Opening: ${subUrl}`);

        try {
            await page.goto(subUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            await delay(2000);

            // Extract subject name and year sidebar links
            const subjectData = await page.evaluate(() => {
                const titleEl = document.querySelector('h1') || document.querySelector('.page-title');
                const title = titleEl ? titleEl.innerText.trim() : "Subject Question Bank";

                const sidebar = document.querySelector('.course-index');
                if (!sidebar) return { title, yearLinks: [] };

                const yearLinks = Array.from(sidebar.querySelectorAll('a')).map(a => ({
                    name: a.innerText.trim(),
                    url: a.href
                }));

                return { title, yearLinks };
            });

            masterHtml += `<h2>Subject: ${subjectData.title}</h2>`;

            if (subjectData.yearLinks.length === 0) {
                console.log(`No year sidebar links found for ${subjectData.title}. Scraping current view directly...`);
                // Fallback to process current view if no sidebar years present
                subjectData.yearLinks.push({ name: 'Default', url: subUrl });
            }

            for (const yearLink of subjectData.yearLinks) {
                console.log(`Processing Year: ${yearLink.name} (${yearLink.url})`);
                masterHtml += `<h3>Exam Year: ${yearLink.name}</h3>`;

                await page.goto(yearLink.url, { waitUntil: 'networkidle2', timeout: 30000 });
                await delay(2000);

                // Run master extraction script in page context
                const yearHtmlContent = await page.evaluate(async (yearName, seenQMap) => {
                    const delayInPage = ms => new Promise(res => setTimeout(res, ms));

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
                        } catch (e) { return imageUrl; }
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

                    let localHtml = '';
                    const questionContainers = document.querySelectorAll('.single_question_container');

                    for (let i = 0; i < questionContainers.length; i++) {
                        const container = questionContainers[i];
                        const qId = container.getAttribute('data-id');
                        const qNumberElement = container.querySelector('.qnbank_number');
                        const qNumber = qNumberElement ? qNumberElement.innerText.trim() : (i + 1);

                        localHtml += `<div class="qa-block">`;

                        if (qId && seenQMap[qId]) {
                            const origYear = seenQMap[qId].year;
                            const origNum = seenQMap[qId].qNum;
                            localHtml += `<div class="question">Q${qNumber}: <i>[Skipped Duplicate] Refer to <strong>${origYear}, Q${origNum}</strong>.</i></div></div>`;
                            continue;
                        }

                        if (qId) {
                            seenQMap[qId] = { year: yearName, qNum: qNumber };
                        }

                        const qContentElement = container.querySelector('.qnbank_content');
                        let qContentHtml = '';
                        if (qContentElement) {
                            const tempQDiv = document.createElement('div');
                            tempQDiv.innerHTML = qContentElement.innerHTML;
                            await processImagesInElement(tempQDiv);
                            qContentHtml = tempQDiv.innerHTML;
                        }

                        localHtml += `<div class="question">Q${qNumber}: ${qContentHtml}</div>`;

                        const answerButton = container.querySelector('.has_answer_tick i');
                        if (answerButton) {
                            answerButton.click();
                            await delayInPage(2000);

                            const popupContent = document.querySelector('#modal-content-content');
                            if (popupContent) {
                                const tempADiv = document.createElement('div');
                                tempADiv.innerHTML = popupContent.innerHTML;
                                await processImagesInElement(tempADiv);
                                localHtml += `<div class="answer"><h3>Answer:</h3>${tempADiv.innerHTML}</div>`;
                            } else {
                                localHtml += `<div class="answer"><p><i>Answer content not found.</i></p></div>`;
                            }

                            const closeButton = document.querySelector('.btn-close');
                            if (closeButton) {
                                closeButton.click();
                                await delayInPage(1000);
                            }
                        } else {
                            localHtml += `<div class="answer"><p><i>No answer available.</i></p></div>`;
                        }

                        localHtml += `</div>`;
                    }

                    return { localHtml, updatedSeenMap: seenQMap };
                }, yearLink.name, seenQuestions);

                // Merge duplicate tracking map and append extracted HTML
                Object.assign(seenQuestions, yearHtmlContent.updatedSeenMap);
                masterHtml += yearHtmlContent.localHtml;
            }
        } catch (subErr) {
            console.error(`Error processing subject ${subUrl}:`, subErr.message);
        }
    }

    masterHtml += `</body></html>`;

    console.log("\n--- Phase 3: Writing Compiled Data to Disk ---");
    fs.writeFileSync('All_Years_Complete_Offline_QnA.html', masterHtml);
    console.log("File write operation complete: All_Years_Complete_Offline_QnA.html");

    await browser.close();
}

runCloudScraper().catch(console.error);
