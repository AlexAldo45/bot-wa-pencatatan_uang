/**
 * Currency utility functions for TripWallet AI
 * Handles Indonesian currency parsing and formatting
 */

/**
 * Parse Indonesian currency formats to integer
 * Supports: 10rb, 10 rb, 10ribu, 10 ribu, 10k, 1jt, 1 jt, 1juta, 1 juta, Rp50.000, Rp 50.000
 * @param {string} text - Currency text to parse
 * @returns {number|null} Integer amount or null if parsing fails
 */
function parseCurrency(text) {
    if (!text || typeof text !== 'string') {
        return null;
    }

    // Clean and normalize the text
    let cleaned = text.trim().toLowerCase();
    
    // Remove "rp" prefix and spaces
    cleaned = cleaned.replace(/rp\s*/g, '').trim();
    
    // Check for million (jt/million)
    const millionMatch = cleaned.match(/^([0-9]+[.,]?[0-9]*)\s*(juta|jt)$/);
    if (millionMatch) {
        const val = parseFloat(millionMatch[1].replace(',', '.'));
        return Math.round(val * 1000000);
    }
    
    // Check for thousand (rb/thousand/k)
    const thousandMatch = cleaned.match(/^([0-9]+[.,]?[0-9]*)\s*(ribu|r|rb|k)$/);
    if (thousandMatch) {
        const val = parseFloat(thousandMatch[1].replace(',', '.'));
        return Math.round(val * 1000);
    }
    
    // Remove commas and dots used as thousand separators
    cleaned = cleaned.replace(/,/g, '').replace(/\./g, '');
    
    // Try to parse as plain number
    const number = parseInt(cleaned, 10);
    if (!isNaN(number) && number > 0) {
        return number;
    }
    
    return null;
}

/**
 * Format integer amount to Indonesian currency string
 * @param {number} amount - Integer amount
 * @returns {string} Formatted currency string
 */
function formatCurrency(amount) {
    if (typeof amount !== 'number' || isNaN(amount)) {
        return 'Rp0';
    }
    
    return `Rp${amount.toLocaleString('id-ID')}`;
}

/**
 * Parse price from description using regex
 * @param {string} description - Text description
 * @returns {number|null} Parsed amount or null
 */
function extractPriceFromText(description) {
    if (!description || typeof description !== 'string') {
        return null;
    }
    
    // Pattern 1: Rp followed by number with optional dots/commas
    const rpPattern = /rp\s*([\d.,]+)/i;
    const rpMatch = description.match(rpPattern);
    if (rpMatch) {
        const cleaned = rpMatch[1].replace(/,/g, '.');
        const number = parseFloat(cleaned);
        if (!isNaN(number)) {
            return Math.round(number);
        }
    }
    
    // Pattern 2: Number followed by unit (rb, ribu, k, jt, juta)
    const unitPattern = /([\d.,]+)\s*(juta|jt|ribu|r|rb|k)\b/i;
    const unitMatch = description.match(unitPattern);
    if (unitMatch) {
        return parseCurrency(unitMatch[0]);
    }
    
    return null;
}

module.exports = {
    parseCurrency,
    formatCurrency,
    extractPriceFromText,
};
