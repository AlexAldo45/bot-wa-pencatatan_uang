const config = require('../config');

const INDONESIAN_MONTHS = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

/**
 * Get date string in YYYY-MM-DD format for a given Date and timezone
 */
function getLocalDateString(date = new Date(), timezone = config.timezone) {
    try {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour12: false
        });
        const parts = formatter.formatToParts(date);
        const map = {};
        parts.forEach(p => { map[p.type] = p.value; });
        return `${map.year}-${map.month}-${map.day}`;
    } catch (err) {
        // Fallback to UTC-based local date if timezone is invalid
        const offset = date.getTimezoneOffset();
        const adjustedDate = new Date(date.getTime() - (offset * 60 * 1000));
        return adjustedDate.toISOString().split('T')[0];
    }
}

/**
 * Get date-time string in YYYY-MM-DD HH:mm:ss format for a given Date and timezone
 */
function getLocalDateTimeString(date = new Date(), timezone = config.timezone) {
    try {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        const parts = formatter.formatToParts(date);
        const map = {};
        parts.forEach(p => { map[p.type] = p.value; });
        return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
    } catch (err) {
        // Fallback to UTC-based local date-time if timezone is invalid
        const offset = date.getTimezoneOffset();
        const adjustedDate = new Date(date.getTime() - (offset * 60 * 1000));
        return adjustedDate.toISOString().replace('T', ' ').split('.')[0];
    }
}

/**
 * Parse a relative date expression (e.g. "hari ini", "kemarin", "2 hari lalu")
 * and return it in YYYY-MM-DD format.
 */
function parseRelativeDate(expr, timezone = config.timezone) {
    if (!expr || typeof expr !== 'string') {
        return getLocalDateString(new Date(), timezone);
    }
    
    const cleaned = expr.trim().toLowerCase();
    const today = new Date();
    
    if (cleaned === 'hari ini' || cleaned === 'tadi') {
        return getLocalDateString(today, timezone);
    }
    
    if (cleaned === 'kemarin' || cleaned === 'kemarin malam') {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        return getLocalDateString(yesterday, timezone);
    }
    
    const relativeMatch = cleaned.match(/^(\d+)\s*hari\s*lalu$/);
    if (relativeMatch) {
        const days = parseInt(relativeMatch[1], 10);
        const targetDate = new Date(today);
        targetDate.setDate(targetDate.getDate() - days);
        return getLocalDateString(targetDate, timezone);
    }
    
    // Check if it matches YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
        return cleaned;
    }
    
    return getLocalDateString(today, timezone);
}

/**
 * Format a YYYY-MM-DD date string to friendly Indonesian format (e.g., "14 Juli 2026")
 */
function formatFriendlyDate(dateString) {
    if (!dateString) return '';
    const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return dateString;
    
    const year = match[1];
    const monthIndex = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    
    const monthName = INDONESIAN_MONTHS[monthIndex] || match[2];
    return `${day} ${monthName} ${year}`;
}

module.exports = {
    getLocalDateString,
    getLocalDateTimeString,
    parseRelativeDate,
    formatFriendlyDate,
};
