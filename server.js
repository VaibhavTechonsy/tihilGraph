import express from "express";
import fs from "fs";
import cors from "cors";
import path from "path";
import scrapePowerBI from "./index.js";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve()));

const activeOperations = new Map();

app.post("/scrape/:country/:hsCode/:hsLevel", async (req, res) => {
    const { country, hsCode, hsLevel } = req.params;
    const operationId = `${country}-${hsCode}-${hsLevel}-${Date.now()}`;

    const abortController = new AbortController();
    activeOperations.set(operationId, abortController);

    res.on('close', () => {
        if (!res.headersSent) {
            abortController.abort();
        }
    });

    try {
        const filePath = await scrapePowerBI(country, hsCode, hsLevel, abortController.signal);
        res.json({ 
            message: "Scraping completed", 
            filePath,
            operationId 
        });
    } catch (error) {
        if (error.name === 'AbortError') {
            res.status(499).json({ error: "Request cancelled" });
        } else {
            res.status(500).json({ error: "Scraping failed" });
        }
    } finally {
        activeOperations.delete(operationId);
    }
});

app.get("/countries", (req, res) => {
    fs.readFile("countries.json", "utf8", (err, data) => {
        if (err) {
            return res.status(500).json({ error: "File not found" });
        }
        try {
            const jsonData = JSON.parse(data);
            res.json(jsonData);
        } catch (parseError) {
            res.status(500).json({ error: "Invalid JSON format" });
        }
    });
});

app.get("/data/:country/:hsCode/:hsLevel", (req, res) => {
    const { country, hsCode, hsLevel } = req.params;
    const safeCountryName = country.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "");
    const filePath = `data/${safeCountryName}_${hsCode}.json`;

    fs.readFile(filePath, "utf8", (err, data) => {
        if (err) {
            return res.status(404).json({ error: "Data not found" });
        }

        try {
            const jsonData = JSON.parse(data);
            let result = jsonData.find(item => item.HSCode === hsCode);

            if (!result) {
                let hsPrefix = hsCode;
                while (hsPrefix.length > hsLevel) { 
                    hsPrefix = hsPrefix.slice(0, -1);
                    result = jsonData.find(item => item.HSCode.startsWith(hsPrefix));
                    if (result) break;
                }
            }

            if (!result) {
                return res.status(404).json({ error: "HS Code not found in data" });
            }

            res.json(result);

            // ✅ Delete the file after response is sent
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) {} else {}
            });

        } catch (parseError) {
            res.status(500).json({ error: "Invalid JSON format" });
        }
    });
});


app.delete('/cancel/:operationId', (req, res) => {
    const { operationId } = req.params;
    const abortController = activeOperations.get(operationId);
    
    if (abortController) {
        abortController.abort();
        activeOperations.delete(operationId);
        res.json({ message: "Operation cancelled" });
    } else {
        res.status(404).json({ error: "Operation not found" });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at https://tihilgraph.onrender.com`);
});
