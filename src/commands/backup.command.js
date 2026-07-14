const path = require('path');
const backupService = require('../services/backup.service');
const { AuthorizationError } = require('../utils/errors');
const config = require('../config');

module.exports = {
    async execute(args, chatId, userId) {
        const cleanUserNumber = userId.split('@')[0];
        const cleanOwnerNumber = config.botOwnerNumber.replace(/\D/g, '');
        
        if (cleanUserNumber !== cleanOwnerNumber) {
            throw new AuthorizationError('Hanya Owner Bot yang dapat melakukan backup.');
        }
        
        const backupPath = await backupService.runBackup();
        return `💾 Database berhasil dibackup.

File: _${path.basename(backupPath)}_`;
    }
};
