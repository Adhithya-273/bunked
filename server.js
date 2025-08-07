// server.js
// A brand new backend written in JavaScript using Node.js, Express, and Puppeteer.
// [FIXED] The definitive solution: A robust, step-by-step navigation with patient waits.

const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

// --- Express App Initialization ---
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// --- Configuration ---
const LOGIN_URL = "https://asiet.etlab.app/user/login";

// --- Attendance Calculation Functions (in JavaScript) ---
const calculateCurrentPercentage = (attended, total) => {
    if (total === 0) return 0.0;
    return (attended / total) * 100;
};

const classesNeededForTarget = (attended, total, targetPercentage) => {
    if (calculateCurrentPercentage(attended, total) >= targetPercentage) return 0;
    let classesToAttend = 0;
    while (true) {
        classesToAttend++;
        const newAttended = attended + classesToAttend;
        const newTotal = total + classesToAttend;
        if (calculateCurrentPercentage(newAttended, newTotal) >= targetPercentage) {
            return classesToAttend;
        }
    }
};

const classesToBunk = (attended, total, targetPercentage) => {
    if (calculateCurrentPercentage(attended, total) < targetPercentage) return 0;
    let bunkableClasses = 0;
    while (true) {
        const newTotal = total + bunkableClasses + 1;
        if (calculateCurrentPercentage(attended, newTotal) < targetPercentage) {
            return bunkableClasses;
        }
        bunkableClasses++;
    }
};

// --- Web Scraping Function (Using Puppeteer) ---
const getAttendanceData = async (username, password) => {
    console.log("Starting robust Puppeteer scraper...");
    let browser = null;
    let page = null;
    let scrapedData = {};
    let errorMessage = null;

    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
            ],
        });
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        // Set a generous default timeout for all actions
        page.setDefaultNavigationTimeout(60000); // 60 seconds
        page.setDefaultTimeout(60000); // 60 seconds


        // Step 1: Log in
        console.log(`Navigating to login page: ${LOGIN_URL}`);
        await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });
        const loginButtonSelector = '[name="yt0"]';
        await page.waitForSelector(loginButtonSelector);
        await page.type('#LoginForm_username', username);
        await page.type('#LoginForm_password', password);
        
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click(loginButtonSelector)
        ]);
        console.log("Clicked login button and waited for dashboard.");

        // Step 2: On dashboard, find and click the "Attendance" link
        console.log("Waiting for 'Attendance' link...");
        const attendanceLinkSelector = 'aria/Attendance';
        await page.waitForSelector(attendanceLinkSelector);
        
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click(attendanceLinkSelector)
        ]);
        console.log("Clicked 'Attendance' link and navigated.");

        // Step 3: On the attendance page, find and click "Attendance By Subject"
        console.log("Waiting for 'Attendance By Subject' link...");
        const subjectLinkSelector = 'aria/Attendance By Subject';
        await page.waitForSelector(subjectLinkSelector);

        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click(subjectLinkSelector)
        ]);
        console.log("Clicked 'Attendance By Subject' link and navigated.");

        // Step 4: On the final page, wait for the table to appear.
        console.log("Waiting for final attendance table...");
        await page.waitForSelector('table.items');
        console.log("Found attendance summary table. Parsing data...");

        // Step 5: Parse the table
        const subjectAttendance = await page.evaluate(() => {
            const data = {};
            const headerRow = document.querySelector('table.items thead tr');
            const subjects = Array.from(headerRow.querySelectorAll('th')).slice(3, -2).map(th => th.innerText.trim());
            
            const dataRow = document.querySelector('table.items tbody tr');
            const attendanceCells = Array.from(dataRow.querySelectorAll('td')).slice(3, -2);

            subjects.forEach((subjectCode, i) => {
                const cellText = attendanceCells[i].innerText.trim();
                const match = cellText.match(/(\d+)\/(\d+)/);
                if (match) {
                    data[subjectCode] = {
                        attended: parseInt(match[1], 10),
                        total: parseInt(match[2], 10),
                    };
                }
            });
            return data;
        });

        scrapedData = subjectAttendance;
        console.log("Successfully parsed all attendance data.");

    } catch (e) {
        console.error(`An error occurred: ${e.message}`);
        errorMessage = "An error occurred. It could be due to incorrect credentials or a change in the website's structure.";
        
        if (page) {
            await page.screenshot({ path: 'error_screenshot.png' });
            console.log("Screenshot saved to error_screenshot.png for debugging.");
        }

    } finally {
        if (browser) {
            await browser.close();
            console.log("Closing the scraper.");
        }
    }

    return { scrapedData, errorMessage };
};

// --- API Route ---
app.post('/api/attendance', async (req, res) => {
    const { username, password, target } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: "Missing username or password" });
    }

    const { scrapedData, errorMessage } = await getAttendanceData(username, password);

    if (errorMessage) {
        return res.status(500).json({ error: errorMessage });
    }
    
    if (Object.keys(scrapedData).length === 0) {
        return res.status(500).json({ error: "Could not parse any attendance data." });
    }

    const targetNum = parseFloat(target) || 75.0;
    const results = {};
    for (const [subject, data] of Object.entries(scrapedData)) {
        const { attended, total } = data;
        const percentage = calculateCurrentPercentage(attended, total);
        results[subject] = {
            attended,
            total,
            percentage,
            needed: classesNeededForTarget(attended, total, targetNum),
            bunks_available: classesToBunk(attended, total, targetNum),
        };
    }
    
    return res.json({ results, target: targetNum });
});

// --- Server Start ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
