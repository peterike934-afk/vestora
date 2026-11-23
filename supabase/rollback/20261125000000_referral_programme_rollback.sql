-- ROLLBACK for 20261125000000_referral_programme.sql
--
-- NOT a migration. Run manually as postgres, only after the application has
-- been rolled back to a version that does not use the referral programme
-- functions.
--
-- Stops the new behaviour; KEEPS every record it created:
--   - removes the attribution, notification and review-field triggers and
--     the new functions;
--   - restores apply_referral_code's previous permissions (it was revoked,
--     never altered);
--   - KEEPS: referral_signup_intents, referral_review_notes,
--     notification_deliveries, marketing_consent_events,
--     marketing_campaign_controls (records); the new
--     profiles/referrals columns; the referrals status constraint that
--     allows 'rejected' (rejected referrals must stay valid); and the guard
--     trigger that stops customers editing referral_code, referred_by and
--     marketing consent directly, so consent cannot be changed without an
--     audit record while rolled back.
-- Pending notification deliveries are not sent while rolled back.

begin;

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Run this rollback as postgres';
  end if;
end;
$$;

drop trigger vestora_referral_capture_intent on auth.users;
drop trigger vestora_referral_on_email_confirmed on auth.users;
drop trigger vestora_referral_on_profile_created on public.profiles;
drop trigger vestora_referral_review_fields on public.referrals;
drop trigger vestora_referral_notifications on public.referrals;

drop function public._referral_capture_signup_intent();
drop function public._referral_on_email_confirmed();
drop function public._referral_on_profile_created();
drop function public._referral_process_intent(uuid);
drop function public._referral_review_fields();
drop function public._referral_notifications();
drop function public._enqueue_notification(text, text, uuid, bigint, jsonb);
drop function public.reject_referral(bigint, text, text);
drop function public.get_my_referral_history();
drop function public.list_notification_deliveries(text, text, integer, text);
drop function public.set_marketing_campaign_paused(text, boolean, uuid);
drop function public.preview_marketing_campaign_recipients();
drop function public.claim_notification_delivery(uuid, uuid);
drop function public.complete_notification_delivery(uuid, uuid, integer, text, text, text);
drop function public.recover_stale_notification_delivery(uuid, integer);
drop function public.retry_notification_delivery(uuid, text, text, text);
drop function public.set_my_marketing_consent(boolean, text);
drop function public.record_marketing_unsubscribe(uuid);
drop function public.enqueue_marketing_campaign(text);

-- Previous Production ACL: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
grant execute on function public.apply_referral_code(text) to public, anon, authenticated, service_role;

commit;
