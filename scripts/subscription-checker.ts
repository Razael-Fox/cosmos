import { reconcileSubscriptions } from '../src/services/subscriptionChecker.js';

reconcileSubscriptions()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
