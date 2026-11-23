#!/usr/bin/env node
// Financial database test runner.
//
// Starts a disposable Postgres 16 container, builds the stand-in base
// schema, applies the real migrations from supabase/migrations in filename
// order, and runs the SQL suites in tests/db/suites. Every suite gets its
// own fresh database. The container is removed afterwards.
//
// Never connects to Supabase or any production database.
//
//   npm run test:db
//
// Requires Docker. Exits non-zero if any assertion fails or any SQL error
// occurs inside a suite.

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const migrationsDir = join(root, 'supabase', 'migrations')
const rollbackDir = join(root, 'supabase', 'rollback')
const suitesDir = join(here, 'suites')
const container = `vestora-financial-tests-${process.pid}`

const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
const migration = (name) => {
  const file = migrations.find((m) => m.startsWith(name))
  if (!file) throw new Error(`migration ${name} not found`)
  return join(migrationsDir, file)
}
const migrationsBefore = (name) => migrations.filter((m) => m < name).map((m) => join(migrationsDir, m))
const allMigrations = () => migrations.map((m) => join(migrationsDir, m))

const sh = (args, opts = {}) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts })

// Runs SQL in the container and returns stdout and stderr together (psql
// prints NOTICE lines, where the suites report PASS/FAIL, on stderr).
function runPsql(db, sql, { stopOnError = false, tuplesOnly = false } = {}) {
  const args = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-q', '-v', `ON_ERROR_STOP=${stopOnError ? 1 : 0}`]
  if (tuplesOnly) args.push('-t', '-A')
  args.push('-f', '-')
  const res = spawnSync('docker', args, { input: sql, encoding: 'utf8' })
  const text = `${res.stdout || ''}${res.stderr || ''}`
  if (stopOnError && res.status !== 0) throw new Error(text)
  return text
}
const psql = (db, sql, opts) => runPsql(db, sql, opts)
const psqlAll = (db, sql) => runPsql(db, sql)

function psqlCapture(db, sql) {
  return new Promise((resolve) => {
    const p = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-q', '-v', 'ON_ERROR_STOP=0', '-f', '-'])
    let text = ''
    p.stdout.on('data', (d) => { text += d })
    p.stderr.on('data', (d) => { text += d })
    p.on('close', () => resolve(text))
    p.stdin.end(sql)
  })
}

const read = (path) => readFileSync(path, 'utf8')
// Suites are piped to psql over stdin, so \ir includes are expanded here.
const suite = (name) => read(join(suitesDir, name))
  .replace(/^\\ir[ \t]+(\S+)[ \t]*$/gm, (_, file) => read(join(suitesDir, file)).replace(/\s*$/, '\n'))
let dbCounter = 0
function freshDb() {
  const name = `t${++dbCounter}`
  psql('postgres', `create database ${name};`, { stopOnError: true })
  psql(name, read(join(here, 'base_schema.sql')), { stopOnError: true })
  psql(name, read(join(here, 'production_baseline.sql')), { stopOnError: true })
  // Production referrals / audit_logs; log_admin_action body partly stand-in (see file).
  psql(name, read(join(here, 'referral_baseline.sql')), { stopOnError: true })
  // Supabase default grants for objects the migrations create.
  psql(name, read(join(here, 'supabase_default_privileges.sql')), { stopOnError: true })
  return name
}
function apply(db, files) {
  for (const f of files) psql(db, read(f), { stopOnError: true })
}

const results = []
function record(suite, output) {
  const lines = output.split(/\r?\n/)
  const pass = lines.filter((l) => /\bPASS\s/.test(l)).length
  const fail = lines.filter((l) => /\bFAIL\s/.test(l))
  const errors = lines.filter((l) => /ERROR:/.test(l))
  results.push({ suite, pass, fail, errors })
  console.log(`\n## ${suite}: ${pass} passed, ${fail.length} failed, ${errors.length} SQL errors`)
  const diag = lines.filter((l) => /\bDIAG\s/.test(l))
  for (const l of [...fail, ...errors, ...diag]) console.log('   ' + l.replace(/^psql:[^ ]+ /, '').replace(/^NOTICE:\s+/, ''))
}

async function main() {
  try { sh(['rm', '-f', container]) } catch {}
  sh(['run', '-d', '--rm', '--name', container, '-e', 'POSTGRES_PASSWORD=localtest', 'postgres:16'])
  // The postgres image first runs a temporary server for initialisation
  // (which already answers pg_isready) and then restarts. Wait for the
  // image's "init process complete" message before using the database.
  let ready = false
  for (let i = 0; i < 120 && !ready; i++) {
    const logs = spawnSync('docker', ['logs', container], { encoding: 'utf8' })
    ready = /PostgreSQL init process complete/.test(`${logs.stdout}${logs.stderr}`)
    if (ready) {
      try { sh(['exec', container, 'pg_isready', '-U', 'postgres', '-q']) } catch { ready = false }
    }
    if (!ready) await new Promise((r) => setTimeout(r, 500))
  }
  if (!ready) throw new Error('test database did not become ready')
  console.log(`Disposable test database ready (${container}). Migrations: ${migrations.join(', ')}`)

  // 1. Withdrawal holds and approval/rejection behaviour, all migrations applied.
  {
    const db = freshDb()
    apply(db, allMigrations())
    record('withdrawal holds, approvals, rejections, deposits, access control', psqlAll(db, suite('withdrawal_holds.sql')))
  }

  // 2. Upgrade compatibility and rollback: state built under the previous
  //    migrations, then the holds migration, then the rollback script.
  {
    const db = freshDb()
    apply(db, migrationsBefore('20261122000000'))
    let out = psqlAll(db, suite('compat_a_before.sql'))
    apply(db, [migration('20261122000000')])
    out += psqlAll(db, suite('compat_b_after.sql'))
    apply(db, [join(rollbackDir, '20261122000000_withdrawal_reservations_rollback.sql')])
    out += psqlAll(db, suite('compat_c_after_rollback.sql'))
    record('upgrade from production state, then rollback', out)
  }

  // 3. Concurrency: two withdrawal requests for the same balance at once.
  {
    const db = freshDb()
    apply(db, allMigrations())
    psql(db, `
      insert into profiles values ('44444444-0000-0000-0000-000000000004','user');
      insert into wallets values ('44444444-0000-0000-0000-000000000004', 100, now());
      insert into settings (id) values (true);`, { stopOnError: true })
    const as = (id, sleep) => `
      select set_config('request.jwt.claim.sub','44444444-0000-0000-0000-000000000004',false);
      set role authenticated;
      begin;
      select request_withdrawal('${id}', 80, 'bank');
      select pg_sleep(${sleep});
      commit;`
    const first = psqlCapture(db, as('00000000-0000-0000-0000-0000000000e1', 2))
    await new Promise((r) => setTimeout(r, 500))
    const second = psqlCapture(db, as('00000000-0000-0000-0000-0000000000e2', 0))
    const [a, b] = await Promise.all([first, second])
    const state = psql(db, `select balance_usd || '|' || (select count(*) from withdrawal_reservations where state = 'held')
      from wallets where user_id = '44444444-0000-0000-0000-000000000004';`, { stopOnError: true, tuplesOnly: true }).trim()
    const [balance, held] = state.split('|')
    const ok = Number(balance) === 20 && Number(held) === 1
      && /Insufficient available balance/.test(a + b)
    record('concurrent withdrawal requests (80 + 80 against 100)',
      `${ok ? 'PASS' : 'FAIL'}  one succeeds, one refused; balance ${balance}, holds ${held}`)
  }

  // 4. The defects exist in the current production logic (proves the
  //    integrity tests exercise real failures).
  {
    const db = freshDb()
    apply(db, migrationsBefore('20261123000000'))
    record('defects reproduced on current production logic (before fix)', psqlAll(db, suite('defects_before_fix.sql')))
  }

  // 5. Investment financial integrity fixes A-D, all migrations applied.
  {
    const db = freshDb()
    apply(db, allMigrations())
    record('investment integrity: fees, maturity interest, claims, full withdrawal', psqlAll(db, suite('investment_integrity.sql')))
  }

  // 6. Integrity upgrade from production-like state, then its rollback.
  {
    const db = freshDb()
    apply(db, migrationsBefore('20261123000000'))
    let out = psqlAll(db, suite('integrity_upgrade_a_before.sql'))
    apply(db, [migration('20261123000000')])
    out += psqlAll(db, suite('integrity_upgrade_b_after.sql'))
    apply(db, [join(rollbackDir, '20261123000000_investment_financial_integrity_rollback.sql')])
    out += psqlAll(db, suite('integrity_upgrade_c_after_rollback.sql'))
    record('integrity upgrade from production state, then rollback', out)
  }

  // 11. pay_referral preconditions on adjust_wallet_with_transaction. Each
  //     case alters the function in its own throw-away test database only,
  //     then applies 20261124000000 and expects a refusal with nothing
  //     created. The baseline case records the catalog form of an empty
  //     search_path.
  {
    const lines = []
    const SIG = 'public.adjust_wallet_with_transaction(uuid, uuid, text, numeric, text)'
    const tryMigration = (setupSql) => {
      const db = freshDb()
      apply(db, migrationsBefore('20261124000000'))
      if (setupSql) psql(db, setupSql, { stopOnError: true })
      let error = null
      try { apply(db, [migration('20261124000000')]) } catch (err) { error = err.message }
      const created = psql(db, `select to_regprocedure('public.pay_referral(bigint)') is not null;`, { stopOnError: true, tuplesOnly: true }).trim() === 't'
      return { db, error, created }
    }

    // Baseline: unmodified function is accepted; record how PostgreSQL stores
    // "set search_path = ''" for it and for a freshly created probe.
    {
      const { db, error, created } = tryMigration(null)
      const stored = psql(db, `select string_agg(c, ',') from pg_proc p, unnest(p.proconfig) c
        where p.oid = '${SIG}'::regprocedure and c like 'search_path=%';`, { stopOnError: true, tuplesOnly: true }).trim()
      const probe = psql(db, `create function pg_temp.probe() returns void language plpgsql set search_path = '' as 'begin end';
        select c from pg_proc p, unnest(p.proconfig) c where p.oid = 'pg_temp.probe()'::regprocedure and c like 'search_path=%';`,
        { stopOnError: true, tuplesOnly: true }).trim().split(/\r?\n/).pop()
      lines.push(`${!error && created ? 'PASS' : 'FAIL'}  unmodified adjust_wallet_with_transaction: migration applies and creates pay_referral${error ? ` (error: ${error.split('\n')[0]})` : ''}`)
      lines.push(`${stored && stored === probe ? 'PASS' : 'FAIL'}  catalog form of an empty search_path confirmed: adjust_wallet_with_transaction has ${JSON.stringify(stored)}, a new SET search_path = '' function has ${JSON.stringify(probe)}`)
    }

    const cases = [
      ['owned by another role',
       `create role vestora_other_owner nologin; alter function ${SIG} owner to vestora_other_owner;`,
       'must be owned by postgres'],
      ['not SECURITY DEFINER',
       `alter function ${SIG} security invoker;`,
       'must be SECURITY DEFINER'],
      ['non-empty search_path',
       `alter function ${SIG} set search_path = public;`,
       'must have an empty search_path'],
      ['missing search_path',
       `alter function ${SIG} reset search_path;`,
       'must have an empty search_path (found: none'],
      ['function missing (exact signature check kept)',
       `drop function ${SIG};`,
       'not found'],
    ]
    for (const [label, setupSql, expected] of cases) {
      const { error, created } = tryMigration(setupSql)
      const ok = error && error.includes(expected) && !created
      lines.push(`${ok ? 'PASS' : 'FAIL'}  ${label}: migration refused, pay_referral not created${ok ? '' : ` (error: ${error ? error.split('\n').find((l) => /ERROR/.test(l)) : 'none'}, created: ${created})`}`)
    }
    record('pay_referral preconditions on adjust_wallet_with_transaction', lines.join('\n'))
  }

  // 10. pay_referral (20261124000000): atomic referral payout, recovery,
  //     validation, rollback, audit, holds; plus two admins paying the same
  //     referral simultaneously. Uses tests/db/referral_baseline.sql.
  {
    const db = freshDb()
    apply(db, allMigrations())
    let out = psqlAll(db, suite('pay_referral.sql'))
    psql(db, `select public.t_people(20);
      insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd)
      values (20, public.r(20), public.d(20), 25, 10);`, { stopOnError: true })
    const payAs = (admin, sleep) => `begin; select public.t_pay('${admin}', 20); select pg_sleep(${sleep}); commit;`
    const first = psqlCapture(db, payAs('a1000000-0000-0000-0000-000000000001', 2))
    await new Promise((r) => setTimeout(r, 500))
    const second = psqlCapture(db, payAs('a2000000-0000-0000-0000-000000000002', 0))
    const both = (await first) + (await second)
    const state = psql(db, `select (select count(*) from transactions where user_id in (public.r(20), public.d(20)) and type = 'admin_credit')
      || '|' || public.bal(public.r(20)) || '|' || public.bal(public.d(20)) || '|' || public.audits(20) || '|' || public.ref_status(20);`,
      { stopOnError: true, tuplesOnly: true }).trim()
    const [credits, rBal, dBal, audits, status] = state.split('|')
    const ok = Number(credits) === 2 && Number(rBal) === 25 && Number(dBal) === 10 && Number(audits) === 2
      && status === 'paid' && /Already paid/.test(both)
    out += `\n${ok ? 'PASS' : 'FAIL'}  two admins pay referral 20 simultaneously: one payment, other refused (credits ${credits}, balances ${rBal}/${dBal}, audits ${audits}, ${status})`

    // Concurrent modification of the linked transaction of an existing
    // credit: pay_referral must wait for the row lock, then see the changed
    // record and abort for manual review, crediting nothing.
    const txnId = psql(db, `select public.t_people(24);
      insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd)
      values (24, public.r(24), public.d(24), 25, 10);
      create temp table if not exists t_dummy (x int);
      select public.t_txn(public.r(24), 25, 'admin_credit', 'verified', 'a1000000-0000-0000-0000-000000000001',
                          'Referral bonus (you referred someone)');`, { stopOnError: true, tuplesOnly: true }).trim().split(/\s+/).pop()
    psql(db, `select public.t_bad_request(24, 'referrer', public.r(24), 25, 'Referral bonus (you referred someone)', '${txnId}', 25);`,
      { stopOnError: true })
    const started = Date.now()
    const editor = psqlCapture(db, `begin; update public.transactions set admin_note = 'edited concurrently' where id = '${txnId}';
      select pg_sleep(2); commit;`)
    await new Promise((r) => setTimeout(r, 500))
    const payer = psqlCapture(db, `select public.t_pay('a2000000-0000-0000-0000-000000000002', 24);`)
    const payerOut = await payer
    const waitedMs = Date.now() - started
    await editor
    const after = psql(db, `select public.ref_status(24) || '|' || public.bal(public.d(24)) || '|' || public.audits(24);`,
      { stopOnError: true, tuplesOnly: true }).trim()
    const [st24, dBal24, audits24] = after.split('|')
    const ok24 = /missing or inconsistent/.test(payerOut) && waitedMs >= 1800 && st24 === 'pending' && Number(dBal24) === 0 && Number(audits24) === 0
    out += `\n${ok24 ? 'PASS' : 'FAIL'}  linked transaction edited concurrently: pay_referral waited (${waitedMs} ms) for the lock, saw the change and aborted (status ${st24}, referred balance ${dBal24}, audits ${audits24})`

    record('pay_referral: atomic payout, recovery, validation, audit, holds, concurrency', out)
  }

  // 9. Legacy two-call referral payouts (the route before pay_referral)
  //    through adjust_wallet_with_transaction: duplicates, recorded fields,
  //    holds and concurrency. Kept because pay_referral must recover
  //    partial payments this path may have left in production.
  {
    const db = freshDb()
    apply(db, allMigrations())
    let out = psqlAll(db, suite('referral_payments.sql'))
    psql(db, `insert into profiles (id, role) values ('54000000-0000-0000-0000-000000000004', 'user');
              insert into wallets (user_id, balance_usd) values ('54000000-0000-0000-0000-000000000004', 100);`, { stopOnError: true })
    const tx = (sql, sleep) => `begin; ${sql}; select pg_sleep(${sleep}); commit;`
    const race = async (a, b) => {
      const first = psqlCapture(db, a)
      await new Promise((r) => setTimeout(r, 500))
      const second = psqlCapture(db, b)
      return (await first) + (await second)
    }
    const num = (sql) => Number(psql(db, sql, { stopOnError: true, tuplesOnly: true }).trim())

    // Same referral paid twice at the same moment (double click / two tabs).
    const pay = `select public.t_pay('aaaaaaaa-0000-0000-0000-000000000001', '5a000000-0000-5000-8000-0000000000c1',
                   '51000000-0000-0000-0000-000000000001', 10, 'Referral bonus (concurrent)')`
    await race(tx(pay, 2), tx(pay, 0))
    const concurrentCredits = num(`select count(*) from transactions where user_id = '51000000-0000-0000-0000-000000000001' and admin_note = 'Referral bonus (concurrent)';`)
    const concurrentBal = num(`select balance_usd from wallets where user_id = '51000000-0000-0000-0000-000000000001';`)
    out += `\n${concurrentCredits === 1 && concurrentBal === 35 ? 'PASS' : 'FAIL'}  two simultaneous payments of one referral credit once (${concurrentCredits} credit, balance ${concurrentBal})`

    // OLD route pattern (read balance, then write balance + bonus) racing a
    // withdrawal hold: the hold's debit is overwritten.
    const withdraw = (user, id) => `select set_config('request.jwt.claim.sub','${user}',false); set role authenticated;
      select request_withdrawal('${id}', 80, 'bank'); reset role;`
    const oldPay = `select balance_usd as old_bal from wallets where user_id = '53000000-0000-0000-0000-000000000003' \\gset
      select pg_sleep(2);
      update wallets set balance_usd = :old_bal + 25 where user_id = '53000000-0000-0000-0000-000000000003';`
    await race(oldPay, withdraw('53000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000d3'))
    const oldBal = num(`select balance_usd from wallets where user_id = '53000000-0000-0000-0000-000000000003';`)
    const oldHeld = num(`select coalesce(sum(amount), 0) from withdrawal_reservations where user_id = '53000000-0000-0000-0000-000000000003' and state = 'held';`)
    out += `\n${oldBal === 125 && oldHeld === 80 ? 'PASS' : 'FAIL'}  DEFECT reproduced with the old route pattern: hold debit lost (balance ${oldBal} while ${oldHeld} is held; correct is 45)`

    // NEW route pattern under the same interleaving: no lost update.
    const newPay = tx(`select public.t_pay('aaaaaaaa-0000-0000-0000-000000000001', '5a000000-0000-5000-8000-0000000000c4',
                   '54000000-0000-0000-0000-000000000004', 25, 'Referral bonus (you referred someone)')`, 2)
    await race(newPay, withdraw('54000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000d4'))
    const newBal = num(`select balance_usd from wallets where user_id = '54000000-0000-0000-0000-000000000004';`)
    const newHeld = num(`select coalesce(sum(amount), 0) from withdrawal_reservations where user_id = '54000000-0000-0000-0000-000000000004' and state = 'held';`)
    out += `\n${newBal === 45 && newHeld === 80 ? 'PASS' : 'FAIL'}  new route pattern racing a withdrawal hold: both applied (balance ${newBal}, ${newHeld} held)`

    record('legacy two-call referral payouts: duplicates, recorded fields, holds, concurrency', out)
  }

  // 8. Migration ordering and rollback safety across both migrations.
  {
    const db = freshDb()
    apply(db, migrationsBefore('20261122000000'))
    psql(db, suite('chain_a_snapshot.sql'), { stopOnError: true })
    const lines = []
    let blocked = false
    try {
      apply(db, [migration('20261123000000')])
    } catch (err) {
      blocked = /Apply 20261122000000_withdrawal_reservations.sql first/.test(err.message)
    }
    lines.push(`${blocked ? 'PASS' : 'FAIL'}  integrity migration refuses to run before the holds migration`)
    apply(db, [migration('20261122000000'), migration('20261123000000'), migration('20261124000000')])
    const mid = psqlAll(db, suite('chain_mid_after_migrations.sql'))
    let guarded = false
    try {
      apply(db, [join(rollbackDir, '20261122000000_withdrawal_reservations_rollback.sql')])
    } catch (err) {
      guarded = /Run 20261123000000_investment_financial_integrity_rollback.sql first/.test(err.message)
    }
    lines.push(`${guarded ? 'PASS' : 'FAIL'}  holds rollback refuses to run while the integrity migration is applied`)
    apply(db, [join(rollbackDir, '20261124000000_pay_referral_rollback.sql')])
    apply(db, [join(rollbackDir, '20261123000000_investment_financial_integrity_rollback.sql')])
    apply(db, [join(rollbackDir, '20261122000000_withdrawal_reservations_rollback.sql')])
    record('migration ordering and full rollback chain (all three migrations)',
      lines.join('\n') + '\n' + mid + '\n' + psqlAll(db, suite('chain_b_after_rollbacks.sql')))
  }

  // 12. Permissions under Supabase default grants: the three pending
  //     migrations grant exactly the intended access, change nothing that
  //     exists, and the rollback chain restores every permission.
  {
    const db = freshDb()
    apply(db, migrationsBefore('20261122000000'))
    psql(db, suite('permissions_a_snapshot.sql'), { stopOnError: true })
    apply(db, [migration('20261122000000'), migration('20261123000000'), migration('20261124000000')])
    let out = psqlAll(db, suite('permissions_b_after.sql'))
    apply(db, [join(rollbackDir, '20261124000000_pay_referral_rollback.sql'),
      join(rollbackDir, '20261123000000_investment_financial_integrity_rollback.sql'),
      join(rollbackDir, '20261122000000_withdrawal_reservations_rollback.sql')])
    out += psqlAll(db, suite('permissions_c_after_rollback.sql'))
    record('permissions: intended grants only, nothing existing changed, restored by rollback', out)
  }

  // 13. Release scripts (supabase/release): the read-only pre-flight passes
  //     on the production-state database, blocks on each planted hazard,
  //     and the verification passes after the migrations with an unchanged
  //     record snapshot.
  {
    const releaseDir = join(root, 'supabase', 'release')
    const preflight = read(join(releaseDir, 'financial_integrity_preflight.sql'))
    const verify = read(join(releaseDir, 'financial_integrity_verify.sql'))
    const rows = (db, sql) => psql(db, sql, { stopOnError: true, tuplesOnly: true }).trim().split(/\r?\n/)
      .filter((l) => /^\d+\|/.test(l)).map((l) => { const [seq, name, result, ...d] = l.split('|'); return { seq, name, result, detail: d.join('|') } })
    const lines = []
    const db = freshDb()
    apply(db, migrationsBefore('20261122000000'))
    psql(db, suite('chain_a_snapshot.sql'), { stopOnError: true })
    const pre = rows(db, preflight)
    const bad = pre.filter((r) => !['OK', 'INFO'].includes(r.result))
    lines.push(`${pre.length >= 25 && bad.length === 0 ? 'PASS' : 'FAIL'}  pre-flight on production state: ${pre.length} checks, none BLOCK/REVIEW${bad.map((r) => `\n   DIAG  ${r.result} ${r.name}: ${r.detail}`).join('')}`)

    // Planted hazards, each removed again afterwards.
    const hazard = (label, setup, undo, seq) => {
      psql(db, setup, { stopOnError: true })
      const hit = rows(db, preflight).filter((r) => r.result === 'BLOCK' && r.seq === String(seq))
      psql(db, undo, { stopOnError: true })
      lines.push(`${hit.length === 1 ? 'PASS' : 'FAIL'}  pre-flight blocks: ${label}${hit[0] ? ` [${hit[0].detail}]` : ''}`)
    }
    hazard('pending referral whose referred user was already credited by the legacy route',
      `insert into transactions (id, user_id, type, amount_usd, status, admin_note) values
         ('c4a10000-0000-0000-0000-0000000000f1', 'c4a00000-0000-0000-0000-000000000004', 'admin_credit', 10, 'verified', 'Referral bonus (you signed up with a code)');`,
      `delete from transactions where id = 'c4a10000-0000-0000-0000-0000000000f1';`, 12)
    hazard('pending referral whose referrer holds more referral credits than paid referrals',
      `insert into transactions (id, user_id, type, amount_usd, status, admin_note) values
         ('c4a10000-0000-0000-0000-0000000000f2', 'c4a00000-0000-0000-0000-000000000002', 'admin_credit', 25, 'verified', 'Referral bonus (you referred someone)');`,
      `delete from transactions where id = 'c4a10000-0000-0000-0000-0000000000f2';`, 13)
    hazard('admin approval in flight',
      `insert into transactions (id, user_id, type, amount_usd, status) values ('c4a10000-0000-0000-0000-0000000000f3', 'c4a00000-0000-0000-0000-000000000002', 'deposit', 5, 'pending');
       insert into admin_financial_operation_claims (transaction_id, claim_token, action, state, admin_id)
         values ('c4a10000-0000-0000-0000-0000000000f3', gen_random_uuid(), 'verify', 'processing', 'c4a00000-0000-0000-0000-000000000001');`,
      `delete from admin_financial_operation_claims where transaction_id = 'c4a10000-0000-0000-0000-0000000000f3';
       delete from transactions where id = 'c4a10000-0000-0000-0000-0000000000f3';`, 11)
    hazard('a replaced function changed in production since the export',
      `update pg_proc set prosrc = prosrc || ' ' where oid = 'public.claim_investment_gains(uuid)'::regprocedure;`,
      `update pg_proc set prosrc = left(prosrc, -1) where oid = 'public.claim_investment_gains(uuid)'::regprocedure;`, 4)
    const writes = psql(db, preflight.replace('select seq, check_name', 'insert into public.wallets (user_id) values (gen_random_uuid());\nselect seq, check_name'))
    lines.push(`${/read-only transaction/.test(writes) ? 'PASS' : 'FAIL'}  pre-flight runs in a READ ONLY transaction (a write inside it is refused)`)

    apply(db, [migration('20261122000000'), migration('20261123000000'), migration('20261124000000')])
    const post = rows(db, verify)
    const failed = post.filter((r) => r.result === 'FAIL')
    lines.push(`${post.length >= 30 && failed.length === 0 ? 'PASS' : 'FAIL'}  verification after the migrations: ${post.length} checks, none FAIL${failed.map((r) => `\n   DIAG  ${r.name}: ${r.detail}`).join('')}`)
    const snap = (r) => r.find((x) => /record snapshot/.test(x.name))?.detail
    lines.push(`${snap(pre) && snap(pre) === snap(post) ? 'PASS' : 'FAIL'}  record snapshot identical before and after the migrations (${snap(post)})`)
    const again = rows(db, preflight).find((r) => r.seq === '2')
    lines.push(`${again?.result === 'BLOCK' && /already applied/.test(again.detail) ? 'PASS' : 'FAIL'}  pre-flight refuses a second application`)
    record('release scripts: pre-flight and post-deployment verification', lines.join('\n'))
  }

  // 7. Concurrency on one investment: simultaneous gains claims, and
  //    simultaneous full principal withdrawals.
  {
    const db = freshDb()
    apply(db, allMigrations())
    psql(db, suite('_integrity_helpers.sql') + `
      select public.t_setup('31', 0, 1000, 100);
      select public.t_setup('32', 0, 1000, 100);`, { stopOnError: true })
    const tx = (call, sleep) => `begin; select ${call}; select pg_sleep(${sleep}); commit;`
    const race = async (call) => {
      const first = psqlCapture(db, tx(call, 2))
      await new Promise((r) => setTimeout(r, 500))
      const second = psqlCapture(db, tx(call, 0))
      return (await first) + (await second)
    }
    const claims = await race("public.t_claim('31')")
    const claimRows = psql(db, `select count(*) || '|' || coalesce(sum(amount_usd), 0) from transactions
      where investment_id = public.id('i31') and type = 'investment_interest_claim';`, { stopOnError: true, tuplesOnly: true }).trim()
    const [nClaims, claimed] = claimRows.split('|')
    const withdrawals = await race("public.t_withdraw('32', 1000)")
    const nW = psql(db, `select count(*) from transactions where investment_id = public.id('i32') and type = 'investment_withdrawal';`,
      { stopOnError: true, tuplesOnly: true }).trim()
    record('concurrent gains claims and principal withdrawals on one investment', [
      `${Number(nClaims) === 1 && Number(claimed) === 29.58 && /Nothing available/.test(claims) ? 'PASS' : 'FAIL'}  two simultaneous claims -> one claim of 29.58 (${nClaims} rows, ${claimed})`,
      `${Number(nW) === 1 && /available to withdraw/.test(withdrawals) ? 'PASS' : 'FAIL'}  two simultaneous full withdrawals -> one accepted (${nW} rows)`,
    ].join('\n'))
  }
}

main()
  .catch((err) => {
    console.error('\nTest run aborted:', err.message)
    results.push({ suite: 'runner', pass: 0, fail: ['aborted'], errors: [] })
  })
  .finally(() => {
    try { sh(['rm', '-f', container]) } catch {}
    const pass = results.reduce((s, r) => s + r.pass, 0)
    const fail = results.reduce((s, r) => s + r.fail.length + r.errors.length, 0)
    console.log(`\n${fail === 0 ? 'ALL DATABASE TESTS PASSED' : `${fail} FAILURE(S)`} — ${pass} assertions passed`)
    process.exitCode = fail === 0 ? 0 : 1
  })
