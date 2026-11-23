-- ROLLBACK for 20261124000000_pay_referral.sql
--
-- NOT a migration. Run manually as postgres, only after the application no
-- longer calls pay_referral (roll the deployment back first).
--
-- Removes the two functions. Credits, audit entries and referral statuses
-- written while it was live are real records and are kept.

begin;

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Run this rollback as postgres';
  end if;
end;
$$;

drop function public.pay_referral(bigint);
drop function public.referral_payout_request_id(text, text);

commit;
