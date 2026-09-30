import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';
const crons = cronJobs();
crons.interval('recover live cycle', { minutes: 1 }, internal.game.watchdog);
export default crons;
