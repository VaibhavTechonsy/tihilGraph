import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

async function scrapePowerBI(countryCode, hsCode, hsLevel, signal) {
    const actual_hsn = hsCode;
    if (hsCode.length % 2 !== 0) {
        hsCode = hsCode.slice(0, -1);
    }

    console.log(puppeteer.executablePath());

    const browser = await puppeteer.launch({ 
        headless: "new",
        executablePath: '/opt/render/.cache/puppeteer/chrome/linux-134.0.6998.35/chrome-linux64/chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    try {
        if (signal.aborted) {
            throw new Error('Operation cancelled');
        }

        await page.setDefaultNavigationTimeout(120000);
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        const checkCancellation = () => {
            if (signal.aborted) {
                throw new Error('Operation cancelled');
            }
        };

        // Navigation with cancellation check
        checkCancellation();
        await Promise.race([
            page.goto("https://tradestat.commerce.gov.in/eidb/ecntcomq.asp", {
                waitUntil: "networkidle2",
                timeout: 60000
            }),
            new Promise((_, reject) => {
                signal.addEventListener('abort', () => reject(new Error('Operation cancelled')));
            })
        ]);

        const dataDir = path.join(path.resolve(), "data");
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir);
        }

        let consolidatedData = {};

        for (let year = 2020; year < 2025; year++) {
            checkCancellation();
            
            try {
                // Form submission with cancellation check
                await Promise.race([
                    (async () => {
                        await page.select("#select2", year.toString());
                        await page.select("#select3", countryCode);
                        await page.select("#hslevel", hsLevel);
                        await page.click("#radioDAll");
                        await Promise.all([
                            page.click("#button1"),
                            page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 })
                        ]);
                    })(),
                    new Promise((_, reject) => {
                        signal.addEventListener('abort', () => reject(new Error('Operation cancelled')));
                    })
                ]);

                checkCancellation();
                await page.waitForSelector("table", { timeout: 30000 });

                const countryRegion = await page.evaluate(() => {
                    const elements = Array.from(document.querySelectorAll("font"));
                    const element = elements.find(el => el.textContent.includes("Country / Region:"));
                    return element ? element.textContent.replace("Country / Region:", "").trim() : "Unknown";
                });

                checkCancellation();
                const tableData = await page.evaluate((targetHsCode) => {
                    const table = document.querySelector("table");
                    if (!table) return [];

                    const headers = Array.from(table.querySelectorAll("th")).map(th => th.textContent.trim());
                    const rows = Array.from(table.querySelectorAll("tbody tr"));

                    return rows.map(row => {
                        const cells = Array.from(row.querySelectorAll("td")).map(td => td.textContent.trim());
                        const rowData = {};
                        headers.forEach((header, index) => {
                            rowData[header] = cells[index] || "";
                        });
                        
                        const rowHsCode = rowData["HSCode"] ? rowData["HSCode"].replace(/[.\s]/g, "") : "";
                        
                        let isMatch = false;
                        if (targetHsCode.length <= 2) {
                            isMatch = rowHsCode.startsWith(targetHsCode.substring(0, 2));
                        } else if (targetHsCode.length <= 4) {
                            isMatch = rowHsCode.startsWith(targetHsCode.substring(0, 4));
                        } else if (targetHsCode.length <= 6) {
                            isMatch = rowHsCode.startsWith(targetHsCode.substring(0, 6));
                        } else {
                            isMatch = rowHsCode === targetHsCode;
                        }
                        
                        rowData["_isMatch"] = isMatch;
                        rowData["_rowHsCode"] = rowHsCode;
                        
                        return rowData;
                    });
                }, hsCode);

                tableData.forEach(row => {
                    if (row._isMatch) {
                        const rowHSCode = row["_rowHsCode"];
                        
                        if (!consolidatedData[rowHSCode]) {
                            consolidatedData[rowHSCode] = {
                                HSCode: rowHSCode,
                                Commodity: row["Commodity"],
                                Country: countryRegion
                            };
                        }

                        const yearKey = `${year}-${year + 1}`;
                        if (row[yearKey]) {
                            consolidatedData[rowHSCode][yearKey] = row[yearKey];
                        }

                        if (year === 2024 && row["2024-2025(Apr-Dec)"]) {
                            consolidatedData[rowHSCode]["2024-2025(Apr-Dec)"] = row["2024-2025(Apr-Dec)"];
                        }
                    }
                });

                
            } catch (error) {
                if (error.message === 'Operation cancelled') throw error;
            }

            checkCancellation();
            await Promise.race([
                page.goto("https://tradestat.commerce.gov.in/eidb/ecntcomq.asp", {
                    waitUntil: "networkidle2",
                    timeout: 60000
                }),
                new Promise((_, reject) => {
                    signal.addEventListener('abort', () => reject(new Error('Operation cancelled')));
                })
            ]);
        }

        const finalData = Object.values(consolidatedData);
        
        if (finalData.length === 0) {
            throw new Error("No matching HS codes found in any year");
        }

        const safeCountryName = countryCode.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "");
        const filePath = path.join(dataDir, `${safeCountryName}_${actual_hsn}.json`);

        fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));

        return filePath;

    } catch (error) {
        throw error;
    } finally {
        await browser.close();
    }
}

export default scrapePowerBI;
