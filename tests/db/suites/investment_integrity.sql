-- Investment financial integrity (fixes A-D) with all migrations applied.
-- Plan P12 = 12% APY, 90 days; full-term interest on 1000 = 29.589.. -> 29.58.
\ir _integrity_helpers.sql

\echo '=== A. Early-withdrawal fee: approved keeps fee, rejected refunds only what the wallet paid'
select public.t_setup('01', 1000, 7000, 60);
insert into t_ids select 'w01', public.t_withdraw('01', 7000);
select public.t_ok(public.bal(public.id('u01')) = 300, 'early withdrawal: 700 fee taken from wallet (1000 -> 300)');
select public.t_ok((public.tx(public.fee_of(public.id('w01')))).amount_usd = 700, 'fee recorded as verified early_withdrawal_fee linked to the withdrawal');
select public.t_approve(public.id('w01'));
select public.t_ok(public.bal(public.id('u01')) = 7300, 'approved early withdrawal pays principal; fee retained (300 + 7000)');
select public.t_ok(public.refunds_of(public.fee_of(public.id('w01'))) = 0, 'approved withdrawal: no fee refund');
select public.t_ok((public.inv(public.id('i01'))).status = 'withdrawn', 'full principal approved -> investment withdrawn');

select public.t_setup('02', 1000, 7000, 60);
insert into t_ids select 'w02', public.t_withdraw('02', 7000);
select public.t_reject(public.id('w02'), 'Destination account could not be verified');
select public.t_ok(public.bal(public.id('u02')) = 1000, 'rejected: wallet-funded fee refunded (300 -> 1000)');
select public.t_ok(public.refunds_of(public.fee_of(public.id('w02'))) = 1, 'exactly one refund transaction');
select public.t_ok((select type = 'early_withdrawal_fee_refund' and status = 'verified' and amount_usd = 700
                    and related_transaction_id = public.fee_of(public.id('w02')) and investment_id = public.id('i02')
                    from public.transactions where related_transaction_id = public.fee_of(public.id('w02'))),
                   'refund is a separate verified transaction linked to the original fee');
select public.t_ok((public.tx(public.id('w02'))).admin_note = 'Destination account could not be verified', 'admin rejection note preserved exactly');
select public.t_ok((public.tx(public.id('w02'))).status = 'rejected', 'withdrawal marked rejected');
select public.t_ok((public.inv(public.id('i02'))).status = 'active' and (public.inv(public.id('i02'))).withdrawn_principal = 0, 'rejected withdrawal leaves investment untouched');
select public.t_err(format('select public.t_reject(%L, %L)', public.id('w02'), 'again'), 'no longer pending', 'repeated rejection blocked');
select public.t_ok(public.bal(public.id('u02')) = 1000 and public.refunds_of(public.fee_of(public.id('w02'))) = 1, 'no duplicate refund after retried rejection');
select public.t_ok(public._refund_early_withdrawal_fees(public.id('w02'), null) = 0, 'refund helper re-run refunds nothing');
select public.t_err(format($$insert into public.transactions (user_id, type, amount_usd, status, related_transaction_id) values (%L, 'early_withdrawal_fee_refund', 700, 'verified', %L)$$,
                           public.id('u02'), public.fee_of(public.id('w02'))),
                    'transactions_one_refund_per_fee', 'database refuses a second refund for the same fee');

select public.t_setup('03', 0, 7000, 60);
insert into t_ids select 'w03', public.t_withdraw('03', 7000);
select public.t_ok((public.tx(public.id('w03'))).amount_usd = 6300 and public.fee_of(public.id('w03')) is null, 'empty wallet: fee deducted from payout (6300), no fee transaction');
select public.t_reject(public.id('w03'), 'Rejected');
select public.t_ok(public.bal(public.id('u03')) = 0, 'payout-deducted fee is not refunded (nothing was collected)');
select public.t_ok((select count(*) from public.transactions where user_id = public.id('u03') and type = 'early_withdrawal_fee_refund') = 0, 'no refund transaction for payout-deducted fee');

select public.t_setup('04', 200, 7000, 60);
insert into t_ids select 'w04', public.t_withdraw('04', 7000);
select public.t_ok(public.bal(public.id('u04')) = 0 and (public.tx(public.id('w04'))).amount_usd = 6500, 'split fee: 200 from wallet, 500 from payout');
select public.t_reject(public.id('w04'), 'Rejected');
select public.t_ok(public.bal(public.id('u04')) = 200 and public.refund_amount(public.fee_of(public.id('w04'))) = 200, 'only the 200 actually debited is refunded');

select public.t_setup('05', 1000, 7000, 60);
insert into t_ids select 'w05', public.t_withdraw('05', 3500);
select public.t_ok(public.bal(public.id('u05')) = 650, 'partial early withdrawal: 350 fee from wallet');
do $$ begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
  set local role authenticated;
  perform public.cancel_investment_atomically(public.id('i05'), 'Cancelled by admin in test');
end $$;
select public.t_ok((public.tx(public.id('w05'))).status = 'rejected', 'cancellation auto-rejects the pending withdrawal');
select public.t_ok(public.bal(public.id('u05')) = 8000, 'cancellation refunds principal and the wallet-funded fee (650 + 7000 + 350)');
select public.t_ok(public.refunds_of(public.fee_of(public.id('w05'))) = 1, 'cancellation fee refund recorded once');

\echo '=== B. Maturity interest is never paid twice'
select public.t_setup('06', 0, 1000, 100);
insert into t_ids select 'w06', public.t_withdraw('06', 1000);
select public.t_ok((public.tx(public.id('w06'))).amount_usd = 1029.58, 'matured, nothing claimed: principal + full-term interest (1029.58)');
select public.t_approve(public.id('w06'));
select public.t_ok(public.bal(public.id('u06')) = 1029.58 and (public.inv(public.id('i06'))).status = 'withdrawn', 'approved maturity withdrawal');

select public.t_setup('07', 0, 1000, 100);
insert into t_ids select 'c07', public.t_claim('07');
select public.t_ok((public.tx(public.id('c07'))).amount_usd = 29.58, 'matured claim = full-term interest (29.58)');
select public.t_approve(public.id('c07'));
insert into t_ids select 'w07', public.t_withdraw('07', 1000);
select public.t_ok((public.tx(public.id('w07'))).amount_usd = 1000, 'claimed then full withdrawal: principal only, interest not paid again (was 1029.58 before fix)');
select public.t_approve(public.id('w07'));
select public.t_ok(public.bal(public.id('u07')) = 1029.58, 'total received = principal + interest once');
select public.t_ok((public.inv(public.id('i07'))).withdrawn_claimed_interest = 29.58, 'claimed interest allocated to the withdrawn principal');

select public.t_setup('08', 0, 1000, 100);
insert into t_ids select 'c08', public.t_claim('08');
select public.t_approve(public.id('c08'));
insert into t_ids select 'w08', public.t_withdraw('08', 400);
select public.t_ok((public.tx(public.id('w08'))).amount_usd = 400, 'partial withdrawal after full claim: no extra interest on the 400');
select public.t_ok(round((public.tx(public.id('w08'))).claimed_interest_allocated, 4) = 11.832, 'claimed interest allocated pro rata (29.58 x 400/1000)');
select public.t_approve(public.id('w08'));
select public.t_ok((public.inv(public.id('i08'))).status = 'active' and (public.inv(public.id('i08'))).withdrawn_principal = 400, 'partial approval keeps the investment active');
select public.t_err(format('select public.t_claim(%L)', '08'), 'Nothing available', 'remaining 600 has no unclaimed interest left');
select public.t_ok(public.bal(public.id('u08')) = 429.58, 'received 29.58 interest + 400 principal');

select public.t_setup('09', 0, 1000, 100);
insert into t_ids select 'w09', public.t_withdraw('09', 400);
select public.t_ok((public.tx(public.id('w09'))).amount_usd = 411.83, 'partial maturity withdrawal before any claim: 400 + 11.83 interest');
select public.t_approve(public.id('w09'));
insert into t_ids select 'c09', public.t_claim('09');
select public.t_ok((public.tx(public.id('c09'))).amount_usd = 17.75, 'then claim on remaining 600: 17.75');
select public.t_approve(public.id('c09'));
select public.t_ok(public.bal(public.id('u09')) = 429.58, 'total interest paid 29.58 = one full-term interest');

\echo '=== C. Gains claims: pending, multiple, approval re-check, rejection'
select public.t_setup('10', 0, 1000, 10, 50);
insert into t_ids select 'c10', public.t_claim('10');
select public.t_ok((public.tx(public.id('c10'))).amount_usd = 50, 'before maturity only admin profit is claimable (50)');
select public.t_err(format('select public.t_claim(%L)', '10'), 'Nothing available', 'second claim while first is pending: nothing left');
select public.t_approve(public.id('c10'));
update public.investments set admin_profit = 70 where id = public.id('i10');
insert into t_ids select 'c10b', public.t_claim('10');
select public.t_ok((public.tx(public.id('c10b'))).amount_usd = 20, 'later claim only gets the new 20');
select public.t_approve(public.id('c10b'));
select public.t_ok((public.inv(public.id('i10'))).claimed_interest = 70 and public.bal(public.id('u10')) = 70, 'claimed_interest and wallet both 70');

select public.t_setup('11', 0, 1000, 100);
insert into t_ids select 'c11', public.t_claim('11');
update public.transactions set amount_usd = 500 where id = public.id('c11');
select public.t_err(format('select public.t_approve(%L)', public.id('c11')), 'exceeds', 'approval refuses a claim larger than what is claimable');
select public.t_ok(public.bal(public.id('u11')) = 0 and (public.tx(public.id('c11'))).status = 'pending', 'refused approval credits nothing');
do $$ begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
  set local role authenticated;
  perform public.release_transaction_claim(public.id('c11'),
    (select claim_token from public.admin_financial_operation_claims where transaction_id = public.id('c11')), '{}');
exception when others then null; end $$;
select public.t_reject(public.id('c11'), 'Claim amount does not match earnings');
select public.t_ok((public.tx(public.id('c11'))).status = 'rejected' and (public.tx(public.id('c11'))).admin_note = 'Claim amount does not match earnings'
                   and public.bal(public.id('u11')) = 0, 'gains rejection: no credit, note stored');

select public.t_setup('12', 0, 1000, 100);
insert into t_ids select 'c12', public.t_claim('12');
update public.investments set status = 'withdrawn' where id = public.id('i12');
select public.t_err(format('select public.t_approve(%L)', public.id('c12')), 'no longer active', 'approval refuses a claim on a closed investment');
update public.investments set status = 'active' where id = public.id('i12');

select public.t_setup('13', 0, 1000, 100);
insert into t_ids select 'c13', public.t_claim('13');
select public.t_err(format('select public.t_withdraw(%L, 1000)', '13'), 'gains claim on this investment is pending', 'pending claim blocks principal withdrawal');
select public.t_reject(public.id('c13'), 'Rejected');
insert into t_ids select 'w13', public.t_withdraw('13', 500);
select public.t_err(format('select public.t_claim(%L)', '13'), 'withdrawal from this investment is pending', 'pending withdrawal blocks gains claim');
select public.t_ok((select available_to_claim from public.investments_with_value where id = public.id('i13')) = 0, 'view shows nothing claimable while a withdrawal is pending');

\echo '=== D. Full withdrawal protection and one shared calculation'
select public.t_setup('14', 0, 1000, 100, 30);
select public.t_err(format('select public.t_withdraw(%L, 1000)', '14'), 'Claim your profit', 'full withdrawal refused while admin profit is unclaimed');

select public.t_setup('15', 0, 1000, 100);
insert into t_ids select 'w15', public.t_withdraw('15', 1000);
select public.t_ok((public.inv(public.id('i15'))).status = 'active', 'pending full withdrawal does not close the investment');
select public.t_reject(public.id('w15'), 'Rejected');
select public.t_ok((public.inv(public.id('i15'))).status = 'active' and (public.inv(public.id('i15'))).withdrawn_principal = 0, 'rejected full withdrawal leaves it active');
insert into t_ids select 'w15b', public.t_withdraw('15', 1000);
update public.transactions set principal_portion = 1500 where id = public.id('w15b');
select public.t_err(format('select public.t_approve(%L)', public.id('w15b')), 'exceeds the principal remaining', 'approval refuses a withdrawal above remaining principal');

select public.t_setup('16', 0, 1000, 45);
select public.t_ok(abs((select current_value from public.investments_with_value where id = public.id('i16'))
                   - (1000 * (1 + 0.12 * 45 / 365.0))) < 0.01, 'view current_value matches the original production formula');
select public.t_ok((select available_to_claim from public.investments_with_value where id = public.id('i16')) = 0, 'before maturity with no profit: nothing claimable');

\echo '=== E. Cancellation after partial withdrawals refunds only the remaining principal'
create function public.t_cancel(i uuid) returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
  set local role authenticated;
  return public.cancel_investment_atomically(i, 'Cancelled by admin in test');
end $$;

select public.t_setup('17', 0, 1000, 60);
insert into t_ids select 'w17', public.t_withdraw('17', 400);
select public.t_approve(public.id('w17'));
select public.t_ok(public.bal(public.id('u17')) = 360, 'early partial withdrawal of 400 paid 360 (40 fee from payout)');
create table public.t_cancel_result (k text primary key, v jsonb);
insert into t_cancel_result select '17', public.t_cancel(public.id('i17'));
select public.t_ok(public.bal(public.id('u17')) = 960, 'cancel refunds remaining 600 only (360 + 600), not the original 1000');
select public.t_ok((select (v ->> 'amountUsd')::numeric = 600 and (v ->> 'originalAmountUsd')::numeric = 1000 from t_cancel_result where k = '17'),
                   'cancel result reports refunded 600 and original 1000 (audit log records 600)');
select public.t_ok((public.inv(public.id('i17'))).status = 'withdrawn', 'cancelled investment closed');

select public.t_setup('18', 100, 1000, 60);
insert into t_ids select 'w18', public.t_withdraw('18', 300);
select public.t_ok(public.bal(public.id('u18')) = 70, 'first partial: 30 fee from wallet (100 -> 70)');
select public.t_approve(public.id('w18'));
select public.t_ok(public.bal(public.id('u18')) = 370, 'first partial approved: +300 principal');
insert into t_ids select 'w18b', public.t_withdraw('18', 200);
select public.t_ok(public.bal(public.id('u18')) = 350, 'second partial pending: 20 fee from wallet (370 -> 350)');
select public.t_cancel(public.id('i18'));
select public.t_ok((public.tx(public.id('w18b'))).status = 'rejected', 'pending partial auto-rejected by cancellation');
select public.t_ok(public.bal(public.id('u18')) = 1070, 'cancel: remaining 700 principal + 20 pending-fee refund (350 + 700 + 20)');
select public.t_ok(public.refunds_of(public.fee_of(public.id('w18b'))) = 1 and public.refunds_of(public.fee_of(public.id('w18'))) = 0,
                   'only the rejected withdrawal''s fee is refunded; the approved one keeps its fee');

\echo '=== Regressions: admin credits/debits, balances'
do $$ begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
  set local role authenticated;
  perform public.adjust_wallet_with_transaction('00000000-0000-0000-0000-0000000000f1', public.id('u03'), 'credit', 100, 'Goodwill');
  perform public.adjust_wallet_with_transaction('00000000-0000-0000-0000-0000000000f2', public.id('u03'), 'debit', 40, 'Correction');
end $$;
select public.t_ok(public.bal(public.id('u03')) = 60, 'admin credit and debit still work (0 + 100 - 40)');
select public.t_err($q$do $x$ begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
  set local role authenticated;
  perform public.adjust_wallet_with_transaction('00000000-0000-0000-0000-0000000000f3', public.id('u03'), 'debit', 1000, 'Too much');
end $x$$q$, 'negative', 'admin debit cannot take a balance negative');
select public.t_ok((select min(balance_usd) from public.wallets) >= 0, 'no wallet balance is negative anywhere');
