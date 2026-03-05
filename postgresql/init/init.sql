-- Enable extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS http;

-- Optional: example cron job that calls an HTTP endpoint
-- SELECT cron.schedule(
--     'example-http-post-every-10-min',
--     '*/10 * * * *',
--     $$
--     SELECT status, content::text
--     FROM http_post(
--         'https://httpbin.org/post',
--         '{"message": "Hello from pg_cron at ' || now()::text || '"}',
--         'application/json'
--     );
--     $$
-- );

-- View scheduled jobs
-- SELECT * FROM cron.job;

-- View execution log
-- SELECT * FROM cron.job_run_details ORDER BY start DESC LIMIT 10;