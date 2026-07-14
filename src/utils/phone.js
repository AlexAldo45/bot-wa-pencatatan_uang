/**
 * Phone and WhatsApp ID utility functions
 */

/**
 * Extract clean phone number (digits only) from WhatsApp JID/ID
 * E.g., "628123456789@c.us" -> "628123456789"
 */
function extractPhoneNumber(whatsappId) {
    if (!whatsappId || typeof whatsappId !== 'string') {
        return '';
    }
    return whatsappId.split('@')[0].replace(/\D/g, '');
}

/**
 * Format phone number/ID to standard WhatsApp User ID (JID)
 * E.g., "628123456789" -> "628123456789@c.us"
 */
function formatWhatsappId(phone) {
    if (!phone || typeof phone !== 'string') {
        return '';
    }
    let cleaned = phone.trim();
    if (cleaned.endsWith('@c.us') || cleaned.endsWith('@g.us')) {
        return cleaned;
    }
    // Remove non-digits
    cleaned = cleaned.replace(/\D/g, '');
    
    // Normalize Indonesian numbers: 0812... -> 62812...
    if (cleaned.startsWith('0')) {
        cleaned = '62' + cleaned.substring(1);
    }
    
    return `${cleaned}@c.us`;
}

module.exports = {
    extractPhoneNumber,
    formatWhatsappId,
};
