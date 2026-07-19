const puppeteer = require('puppeteer-core');
const fs = require('fs');

async function runCloudScraper() {
    console.log("Launching headless browser on cloud servers...");
    const browser = await puppeteer.connect({
        browserWSEndpoint: `wss://production-lon.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`
    });

    const page = await browser.newPage();

    // Inject your logged-in session cookies into the engine
    await page.setCookie({
        name: process.env.COOKIE_NAME,
        value: process.env.COOKIE_VALUE,
        domain: 'hamrocsit.com'
    });

    // Target scraping entry-point URL
    await page.goto('https://hamrocsit.com/'); 

    console.log("Injecting master scraping algorithm into window context...");
    
    // Evaluate your exact DOM script safely inside the cloud environment
    const offlineHtml = await page.evaluate(async () => {
        // --- YOUR EXACT INNER FUNCTION LOGIC STARTS HERE ---
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
            } catch (e) { return imageUrl; }
        }
        async function processImagesInElement(element) {
            const images = element.querySelectorAll('img');
            for (let img of images) {
                const originalSrc = img.src || img.getAttribute('src');
                if (originalSrc && !originalSrc.startsWith('data:')) {
                    img.src = await getBase64ImageFromUrl(originalSrc);
                    img.removeAttribute('srcset'); 
                }
            }
        }

        const sidebar = document.querySelector('.course-index');
        if (!sidebar) return "Error: Could not trace index sidebar elements.";
        const links = Array.from(sidebar.querySelectorAll('a')).map(a => ({ name: a.innerText.trim(), url: a.href }));

        let offlineHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Offline QnA</title></head><body>`;
        const seenQuestions = {}; 
        const iframe = document.createElement('iframe');
        iframe.style.cssText = "width:1200px;height:800px;position:fixed;left:-10000px;";
        document.body.appendChild(iframe);

        for (const link of links) {
            offlineHtml += `<h2>Exam Year: ${link.name}</h2>`;
            await new Promise(res => { iframe.onload = res; iframe.src = link.url; });
            await delay(2000); 

            const doc = iframe.contentDocument;
            const questionContainers = doc.querySelectorAll('.single_question_container');

            for (let i = 0; i < questionContainers.length; i++) {
                const container = questionContainers[i];
                const qId = container.getAttribute('data-id');
                const qNumberElement = container.querySelector('.qnbank_number');
                const qNumber = qNumberElement ? qNumberElement.innerText.trim() : (i + 1);

                offlineHtml += `<div>`;
                if (seenQuestions[qId]) {
                    offlineHtml += `<p>Q${qNumber}: Duplicate Ref: ${seenQuestions[qId].year}</p></div>`;
                    continue;
                }
                seenQuestions[qId] = { year: link.name, qNum: qNumber };

                const qContentElement = container.querySelector('.qnbank_content');
                if (qContentElement) {
                    const tempQDiv = document.createElement('div');
                    tempQDiv.innerHTML = qContentElement.innerHTML;
                    await processImagesInElement(tempQDiv);
                    offlineHtml += `<div>Q${qNumber}: ${tempQDiv.innerHTML}</div>`;
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
                        offlineHtml += `<div>Answer: ${tempADiv.innerHTML}</div>`;
                    }
                    const closeButton = doc.querySelector('.btn-close');
                    if (closeButton) { closeButton.click(); await delay(1000); }
                }
                offlineHtml += `</div>`;
            }
        }
        document.body.removeChild(iframe);
        offlineHtml += `</body></html>`;
        return offlineHtml;
        // --- YOUR EXACT INNER FUNCTION LOGIC ENDS HERE ---
    });

    console.log("Saving compiled file locally to runner disk...");
    fs.writeFileSync('All_Years_Complete_Offline_QnA.html', offlineHtml);
    console.log("File write operation complete!");
    
    await browser.close();
}

runCloudScraper().catch(console.error);
