const { google } = require('googleapis');
const config = require('../config');

class SheetsService {
    constructor() {
        this.auth = null;
        this.sheets = null;
        this.initialized = false;
    }

    async init(credentialsJson) {
        if (this.initialized) return;
        const credentials = typeof credentialsJson === 'string' 
            ? JSON.parse(credentialsJson) 
            : credentialsJson;
        
        this.auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
        this.sheets = google.sheets({ version: 'v4', auth: this.auth });
        this.initialized = true;
    }

    async ensureInitialized() {
        if (!this.initialized) {
            const cfg = config.googleSheets;
            if (!cfg || !cfg.credentials) {
                throw new Error('Google Sheets credentials not configured. Use !sheetconfig to set up.');
            }
            await this.init(cfg.credentials);
        }
    }

    /**
     * Append rows to a sheet, creating header row if sheet is empty.
     * Uses Google Sheets native append API which automatically finds the first empty row.
     */
    async appendRows(spreadsheetId, sheetName, rows, headerRow) {
        await this.ensureInitialized();
        
        // First check if sheet exists and has header
        const getRes = await this.sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A1:Z1`
        });
        const existing = getRes.data.values || [];
        
        const allRows = [];
        if (existing.length === 0 && headerRow) {
            allRows.push(headerRow);
        }
        allRows.push(...rows);
        
        // Use the native append API - automatically finds first empty row (default OVERWRITE)
        await this.sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${sheetName}!A:Z`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: allRows
            }
        });
    }

    /**
     * Ensure a sheet (tab) exists; create if missing.
     */
    async ensureSheet(spreadsheetId, sheetName) {
        await this.ensureInitialized();
        // Get spreadsheet metadata to list sheets
        const meta = await this.sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
        const exists = meta.data.sheets.some(s => s.properties.title === sheetName);
        if (!exists) {
            await this.sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                        addSheet: {
                            properties: { title: sheetName }
                        }
                    }]
                }
            });
        }
    }

    /**
     * Delete a sheet (tab) if it exists.
     */
    async deleteSheetIfExists(spreadsheetId, sheetName) {
        try {
            await this.ensureInitialized();
            const meta = await this.sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId,title))' });
            if (!meta.data.sheets) return;
            const targetSheet = meta.data.sheets.find(s => s.properties.title === sheetName);
            if (targetSheet) {
                const sheetId = targetSheet.properties.sheetId;
                await this.sheets.spreadsheets.batchUpdate({
                    spreadsheetId,
                    requestBody: {
                        requests: [{
                            deleteSheet: {
                                sheetId: sheetId
                            }
                        }]
                    }
                });
            }
        } catch (err) {
            console.warn(`Could not delete sheet "${sheetName}" (non-fatal):`, err.message);
        }
    }

    /**
     * Full sync: replace entire sheet content with fresh data (header + rows).
     * Clears the sheet first to ensure deleted rows are actually removed.
     */
    async fullSync(spreadsheetId, sheetName, rows, headerRow) {
        await this.ensureInitialized();
        await this.ensureSheet(spreadsheetId, sheetName);

        // Small delay to ensure sheet is fully created (avoids "Unable to parse range" error)
        await new Promise(resolve => setTimeout(resolve, 500));

        // Clear the entire sheet first so old/deleted rows don't remain
        await this.sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: `${sheetName}!A:Z`
        });

        const allRows = headerRow ? [headerRow, ...rows] : rows;
        if (allRows.length === 0) return; // nothing to write

        // Retry update in case of propagation delay
        let lastError;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await this.sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `${sheetName}!A1`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: allRows }
                });
                return; // success
            } catch (err) {
                lastError = err;
                if (err.message?.includes('Unable to parse range')) {
                    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
                    continue;
                }
                throw err; // other errors, don't retry
            }
        }
        throw lastError;
    }

}

module.exports = new SheetsService();
