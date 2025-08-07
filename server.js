// server.js
// A brand new backend written in JavaScript using Node.js, Express, and Puppeteer.
// [FIXED] Using robust navigation waits to prevent race conditions on the server.

const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

// --- Express App Initialization ---
const app = express();
app.use(cors());
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
    console.log("Starting Puppeteer scraper with Python logic...");
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

        console.log(`Navigating to login page: ${LOGIN_URL}`);
        await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });

        // Step 1: Log in
        const loginButtonSelector = '[name="yt0"]';
        await page.waitForSelector(loginButtonSelector, { timeout: 30000 });
        await page.type('#LoginForm_username', username);
        await page.type('#LoginForm_password', password);
        await page.click(loginButtonSelector);
        console.log("Clicked login button.");

        // Step 2: Wait for dashboard to confirm login
        await page.waitForSelector('#breadcrumb', { timeout: 15000 });
        console.log("Successfully logged in.");

        // --- THIS IS THE FIX ---
        // Step 3: Find the "Attendance" link, click it, and wait for the subsequent page to load.
        console.log("Waiting for 'Attendance' link...");
        const attendanceLinkSelector = 'aria/Attendance';
        await page.waitForSelector(attendanceLinkSelector, { timeout: 10000 });
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }), // Wait for the new page to load
            page.click(attendanceLinkSelector) // Click the link that causes navigation
        ]);
        console.log("Clicked 'Attendance' link and navigated.");

        // Step 4: Now on the new page, find and click the "Attendance By Subject" link.
        console.log("Waiting for 'Attendance By Subject' link...");
        const subjectLinkSelector = 'aria/Attendance By Subject';
        await page.waitForSelector(subjectLinkSelector, { timeout: 15000 });
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click(subjectLinkSelector)
        ]);
        console.log("Clicked 'Attendance By Subject' link and navigated.");

        // Step 5: Wait for the final table
        await page.waitForSelector('table.items', { timeout: 10000 });
        console.log("Found attendance summary table. Parsing data...");

        // Step 6: Parse the table
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
