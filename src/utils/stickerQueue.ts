interface QueueItem<T = any> {
    task: () => Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: any) => void;
}

class StickerQueue {
    private queue: QueueItem[] = [];
    private processing = false;
    private readonly maxQueueSize = 100;

    /**
     * Add a task to the queue and wait for its completion.
     */
    async add<T>(task: () => Promise<T>): Promise<T> {
        if (this.queue.length >= this.maxQueueSize) {
            const { getTranslator } = await import('./i18n.js');
            throw new Error(getTranslator('en')('media.sticker.queue_full'));
        }
        return new Promise<T>((resolve, reject) => {
            this.queue.push({ task, resolve, reject });
            this.process();
        });
    }

    get length(): number {
        return this.queue.length;
    }

    private async process(): Promise<void> {
        if (this.processing || this.queue.length === 0) return;
        this.processing = true;

        const item = this.queue.shift();
        if (!item) {
            this.processing = false;
            return;
        }

        const { task, resolve, reject } = item;
        try {
            const result = await task();
            resolve(result);
        } catch (err) {
            reject(err);
        } finally {
            this.processing = false;
            // Process the next task in the microtask queue
            Promise.resolve().then(() => this.process());
        }
    }
}

export const stickerQueue = new StickerQueue();
