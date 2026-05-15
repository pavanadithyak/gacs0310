/*
Schedule hourly priority score refresh.

Runs at minute 5 of every hour:
05:00, 06:00, 07:00, etc.
*/

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
    'priority-score-refresh',
    '5 * * * *',
    $$SELECT refresh_priority_scores();$$
);
