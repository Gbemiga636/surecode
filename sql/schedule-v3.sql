-- SureCode: v3 schedulers (Supabase pg_cron + pg_net). Vercel Hobby crons are daily only.
-- Run in Supabase → SQL editor after schema-eval-v3.sql and after the app is deployed.
--
-- 1. Database → Extensions: enable pg_cron and pg_net.
-- 2. Store the cron secret (same value as CRAWL_SECRET in Vercel) in Vault — replace the placeholder,
--    run this one line once, and do not commit the real value anywhere:
--      select vault.create_secret('<CRAWL_SECRET value>', 'surecode_cron_secret');
-- 3. Run the rest of this file. Re-running replaces the jobs.

-- B2: SportyBet price ~5 minutes before kickoff for every published and shadow selection.
select cron.schedule(
  'surecode-closing',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := 'https://surecodev1.vercel.app/api/cron/closing',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'surecode_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);

-- Phase 0 / C1: sharp prices. Needs SHARP_ODDS_API_KEY in Vercel.
-- Trial key (100 requests/day): hourly, 4 sports per run = 96 requests/day.
-- Paid plan: change the schedule to '*/5 * * * *'.
select cron.schedule(
  'surecode-sharp',
  '7 * * * *',
  $$
  select net.http_get(
    url := 'https://surecodev1.vercel.app/api/cron/sharp',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'surecode_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);

-- Check:   select jobname, schedule, active from cron.job;
--          select status, return_message, start_time from cron.job_run_details order by start_time desc limit 20;
-- Remove:  select cron.unschedule('surecode-closing'); select cron.unschedule('surecode-sharp');
