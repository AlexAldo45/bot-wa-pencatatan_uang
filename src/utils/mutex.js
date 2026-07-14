/**
 * Per-chat concurrency queue (mutex/lock equivalent)
 * Ensures messages in the same chat are processed sequentially to avoid race conditions.
 */
class ChatQueue {
    constructor() {
        this.queues = new Map();
    }

    /**
     * Run an async task in queue for a specific chat ID.
     * @param {string} chatId - WhatsApp chat ID
     * @param {Function} task - Async function to run
     * @returns {Promise<any>} Resolves or rejects with the task's result
     */
    async run(chatId, task) {
        if (!this.queues.has(chatId)) {
            this.queues.set(chatId, Promise.resolve());
        }

        const previous = this.queues.get(chatId);
        
        let resolveTask, rejectTask;
        const taskPromise = new Promise((resolve, reject) => {
            resolveTask = resolve;
            rejectTask = reject;
        });

        // Append the new task to the chain
        const next = previous.then(async () => {
            try {
                const result = await task();
                resolveTask(result);
            } catch (err) {
                rejectTask(err);
            }
        });

        this.queues.set(chatId, next);

        // Cleanup: remove the entry from Map if there are no more tasks queued
        next.then(() => {
            if (this.queues.get(chatId) === next) {
                this.queues.delete(chatId);
            }
        });

        return taskPromise;
    }
}

module.exports = new ChatQueue();
