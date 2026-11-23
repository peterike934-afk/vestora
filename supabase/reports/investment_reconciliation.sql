-- Investment financial reconciliation — READ ONLY.
--
-- Every statement here is a SELECT. Nothing is modified, no refunds are
-- issued. Run in the Supabase SQL editor (each query separately), review the
-- results, and decide on corrections separately.
--
-- Fee model (from request_investment_withdrawal): an early-withdrawal fee is
-- taken from the wallet first, recorded as a verified 'early_withdrawal_fee'
-- transaction whose related_transaction_id is the withdrawal; any shortfall
-- is deducted from the withdrawal payout instead (no fee transaction).

-- 1. Rejected investment withdrawals whose wallet-funded fee has NOT been
--    refunded. CONFIRMED amount owed = fee_from_wallet.
select w.id as withdrawal_id, w.user_id, w.investment_id, w.created_at, w.verified_at,
       w.amount_usd as payout, w.principal_portion, w.fee_charged,
       f.id as fee_transaction_id, f.amount_usd as fee_from_wallet,
       w.admin_note as rejection_note
from transactions w
join transactions f on f.related_transaction_id = w.id
  and f.type = 'early_withdrawal_fee' and f.status = 'verified'
where w.type = 'investment_withdrawal' and w.status = 'rejected'
  and not exists (select 1 from transactions r
                  where r.related_transaction_id = f.id and r.type = 'early_withdrawal_fee_refund')
order by w.created_at;

-- 2. Rejected investment withdrawals with a fee but NO fee transaction: the
--    fee was deducted from the (never paid) payout, so nothing was collected.
--    Verified when payout = principal + interest - fee (here interest = 0
--    for early withdrawals, so payout = principal - fee).
select w.id as withdrawal_id, w.user_id, w.investment_id, w.amount_usd as payout,
       w.principal_portion, w.fee_charged,
       (w.principal_portion - w.amount_usd) as fee_taken_from_payout,
       case when abs((w.principal_portion - w.amount_usd) - w.fee_charged) < 0.005
            then 'fee fully deducted from payout: nothing to refund'
            else 'INVESTIGATE: payout does not account for the fee' end as finding
from transactions w
where w.type = 'investment_withdrawal' and w.status = 'rejected' and coalesce(w.fee_charged, 0) > 0
  and not exists (select 1 from transactions f
                  where f.related_transaction_id = w.id and f.type = 'early_withdrawal_fee')
order by w.created_at;

-- 3. Duplicate refunds (should be empty; the integrity migration adds a unique index).
select related_transaction_id as fee_transaction_id, count(*) as refunds, sum(amount_usd) as refunded
from transactions
where type = 'early_withdrawal_fee_refund'
group by related_transaction_id
having count(*) > 1;

-- 4. Approved investment withdrawals with fees (legitimate: retained).
select w.id as withdrawal_id, w.user_id, w.investment_id, w.amount_usd as payout, w.principal_portion,
       w.fee_charged, coalesce(f.amount_usd, 0) as fee_from_wallet,
       w.fee_charged - coalesce(f.amount_usd, 0) as fee_from_payout
from transactions w
left join transactions f on f.related_transaction_id = w.id and f.type = 'early_withdrawal_fee'
where w.type = 'investment_withdrawal' and w.status = 'verified' and coalesce(w.fee_charged, 0) > 0
order by w.created_at;

-- 5. Pending investment withdrawals with fees (refunded automatically if
--    rejected once the integrity migration is live).
select w.id as withdrawal_id, w.user_id, w.investment_id, w.amount_usd as payout, w.fee_charged,
       f.id as fee_transaction_id, coalesce(f.amount_usd, 0) as fee_from_wallet
from transactions w
left join transactions f on f.related_transaction_id = w.id and f.type = 'early_withdrawal_fee'
where w.type = 'investment_withdrawal' and w.status = 'pending' and coalesce(w.fee_charged, 0) > 0;

-- 6. Interest paid vs interest earned, per investment. Interest paid =
--    approved gains claims + interest inside approved withdrawals (payout
--    above principal). Entitlement = full-term interest on the original
--    principal (the most any investment can earn from its APY) + admin profit.
--    Rows where paid exceeds the entitlement are possible duplicate earnings.
with paid as (
  select investment_id,
         sum(case when type = 'investment_interest_claim' then amount_usd else 0 end) as claimed,
         sum(case when type = 'investment_withdrawal' then greatest(amount_usd - coalesce(principal_portion, 0), 0) else 0 end) as withdrawal_interest
  from transactions
  where status = 'verified' and investment_id is not null
  group by investment_id
)
select i.id as investment_id, i.user_id, i.status, i.amount_usd, p.apy_percent, p.term_days,
       round(i.amount_usd * p.apy_percent / 100.0 * p.term_days / 365.0, 2) as max_term_interest,
       i.admin_profit,
       coalesce(paid.claimed, 0) as claimed_paid,
       coalesce(paid.withdrawal_interest, 0) as interest_paid_in_withdrawals,
       coalesce(paid.claimed, 0) + coalesce(paid.withdrawal_interest, 0)
         - (i.amount_usd * p.apy_percent / 100.0 * p.term_days / 365.0 + i.admin_profit) as excess_paid
from investments i
join investment_plans p on p.id = i.plan_id
left join paid on paid.investment_id = i.id
where coalesce(paid.claimed, 0) + coalesce(paid.withdrawal_interest, 0)
      > i.amount_usd * p.apy_percent / 100.0 * p.term_days / 365.0 + i.admin_profit + 0.01
order by excess_paid desc;

-- 7. Closed investments whose principal return is not fully recorded as
--    investment_withdrawal transactions (admin cancellations leave no
--    transaction). Verify against audit_logs before drawing conclusions.
select i.id as investment_id, i.user_id, i.status, i.amount_usd, i.withdrawn_principal,
       i.amount_usd - i.withdrawn_principal as principal_without_transaction
from investments i
where i.status in ('withdrawn', 'cancelled')
  and i.amount_usd - i.withdrawn_principal > 0.005
order by i.created_at;

select a.*
from audit_logs a
where a.action in ('investment_cancelled')
order by a.created_at;

-- 8. Cancellations of investments that had approved partial withdrawals.
--    (audit_logs column names assumed from log_admin_action parameters:
--    action, target_user_id, amount_usd; adjust if they differ.)
--    Before the integrity migration, cancellation refunded the ORIGINAL
--    amount, so principal already paid out was paid again. Possible
--    overpayment = amount refunded (audit_logs.amount_usd) - remaining
--    principal at cancellation (amount_usd - withdrawn_principal).
select i.id as investment_id, i.user_id, i.amount_usd, i.withdrawn_principal,
       i.amount_usd - i.withdrawn_principal as remaining_principal,
       a.amount_usd as refunded_per_audit_log, a.created_at as cancelled_at,
       a.amount_usd - (i.amount_usd - i.withdrawn_principal) as possible_overpayment
from investments i
join audit_logs a on a.target_user_id = i.user_id and a.action = 'investment_cancelled'
  and abs(a.amount_usd - i.amount_usd) < 0.005
where i.withdrawn_principal > 0 and i.status in ('withdrawn', 'cancelled')
order by a.created_at;
