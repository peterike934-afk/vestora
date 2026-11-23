# Guest chat security release (20261128000000)

Website visitors can still chat without an account; this release makes sure
only the real admin can write as the admin, and each visitor can reach only
their own conversation.

## What changes

| Area | Before | After |
|---|---|---|
| Who a visitor is | The thread ID (from `localStorage`, sent in URLs and bodies) | A 256-bit secret in an HttpOnly, SameSite=Lax cookie scoped to `/api/guest-chat` (Secure in production); only its SHA-256 is stored (`guest_threads.guest_token_hash`) |
| Sender of a visitor message | Taken from the request (`sender: "admin"` was accepted) | Always `guest`; any other `sender` is refused (403) |
| Admin replies | Any admin session; RLS allowed any sender | Only an admin session, only `sender = 'admin'` (RLS) |
| Editing/deleting messages | Possible for customers (admin replies in their own thread) and through broad grants | Nobody through the API; customers and the admin can change only the `read` flag |
| Visitor (anon key) access to chat tables | All privileges (blocked only by RLS) | None |
| Abuse | No limits; raw database errors returned | Database-backed rate limits (work across Vercel instances), same-site JSON only, 8 KB requests, 1-2000 character messages, generic errors |
| Thread summary and unread counters | Read-then-write in the application (could lose counts) | Database trigger, same transaction |

Rate limits (`lib/guest-chat.js`): starting a chat 5/hour and 20/day per
address, 200/hour for everyone; messages 10/minute and 300/day per
conversation, 30/minute per address. The address comes from Vercel's own
header (`x-vercel-forwarded-for`, which clients cannot set); IPv6 is grouped
by /64; only hashes are stored. If the limiter is unavailable, requests are
refused.

## Release order

The Production kit is outside the repository:
`C:\vest\backups\guest-chat-security\` (`backup-before-28`, `migrate-28`).
Follow `migrate-28\PROCEDURE.txt`:

1. Backup (`backup-before-28\backup.ps1`) → `BACKUP COMPLETE AND VERIFIED`.
2. Apply (`migrate-28\apply_28.ps1`) → `MIGRATION 20261128000000 COMMITTED AND VERIFIED`.
3. Merge this branch and deploy promptly. No environment variable changes.
4. Post-deployment checks (private window chat, admin reply, customer chat).

Between steps 2 and 3 the previous application keeps working, but its
visitor routes are still open to the old attacks (the database migration
alone does not close them; the routes run with the service role), and unread
badges may double-count. Keep that window short.

## Conversations started before the release (limitation)

Existing visitor threads have no ownership secret. A visitor whose browser
still remembers such a thread sees the start form again (name prefilled) and
continues the old conversation by entering the **same email** they gave
originally. This works **once per thread**.

- A visitor on another device, with cleared browser data, or with a
  different email gets a new conversation. The old one stays in the admin
  dashboard; contact them by email if a reply there matters.
- Someone holding both a legacy thread ID (only ever stored in that
  visitor's browser) and that visitor's email could claim the thread first;
  the real visitor would then get a new conversation.

## Rollback

Roll the application back first, then run `migrate-28\rollback_28.ps1`
(gate: the 50 post-migration checks; confirmation `ROLLBACK 20261128000000`).
It restores the previous grants and policies exactly and keeps every
message, but reopens the weaknesses above. Script:
`supabase/rollback/20261128000000_guest_chat_security_rollback.sql`.

## Tests

`npm run test:unit`, `npm run test:db`, `npm run test:integration` (see
`tests/README.md`): `tests/integration/guest-chat-flow.test.mjs`,
`tests/unit/guest-chat.test.mjs`, `tests/db/suites/guest_chat_security.sql`
and `gcs_upgrade_*`.
