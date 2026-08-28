import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const CONSECUTIVE_FAILS_TO_OPEN_INCIDENT = 2 // require 2 bad checks in a row before alarming

export async function GET(req) {
  // Only allow this route to run if the caller knows the secret password
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { data: services, error } = await supabase.from('services').select('*')
  if (error) return new Response('Failed to load services', { status: 500 })

  for (const svc of services) {
    if (!svc.endpoint) continue // skip services with nothing to ping

    const start = Date.now()
    let status
    try {
      const res = await fetch(svc.endpoint, { signal: AbortSignal.timeout(5000) })
      const ms = Date.now() - start
      status = res.ok ? (ms > 2000 ? 'degraded' : 'up') : 'down'
      await supabase.from('status_checks').insert({ service_id: svc.id, status, response_ms: ms })
    } catch {
      status = 'down'
      await supabase.from('status_checks').insert({ service_id: svc.id, status, response_ms: null })
    }

    await reconcileIncident(svc, status)
  }

  return Response.json({ checked: services.length })
}

async function reconcileIncident(svc, status) {
  const { data: links } = await supabase
    .from('incident_services')
    .select('incident_id')
    .eq('service_id', svc.id)

  const incidentIds = links?.map(r => r.incident_id) || []

  const { data: openIncident } = incidentIds.length
    ? await supabase
        .from('incidents')
        .select('id, status, auto_created')
        .neq('status', 'resolved')
        .in('id', incidentIds)
        .maybeSingle()
    : { data: null }

  if (status === 'down' || status === 'degraded') {
    if (openIncident) return // already tracking it

    const { data: recent } = await supabase
      .from('status_checks')
      .select('status')
      .eq('service_id', svc.id)
      .order('checked_at', { ascending: false })
      .limit(CONSECUTIVE_FAILS_TO_OPEN_INCIDENT)

    const allBad = recent?.length === CONSECUTIVE_FAILS_TO_OPEN_INCIDENT &&
      recent.every(r => r.status === 'down' || r.status === 'degraded')
    if (!allBad) return

    const impact = status === 'down' ? 'major' : 'minor'
    const { data: incident } = await supabase
      .from('incidents')
      .insert({
        title: `${svc.name} is experiencing ${status === 'down' ? 'an outage' : 'degraded performance'}`,
        impact,
        status: 'investigating',
        auto_created: true,
      })
      .select()
      .single()

    await supabase.from('incident_services').insert({ incident_id: incident.id, service_id: svc.id })
    await supabase.from('incident_updates').insert({
      incident_id: incident.id,
      status: 'investigating',
      body: `Automated monitoring detected ${status === 'down' ? 'a service outage' : 'degraded response times'} for ${svc.name}. We're looking into it.`,
    })
  } else if (status === 'up' && openIncident) {
    if (openIncident.auto_created) {
      await supabase.from('incidents').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', openIncident.id)
      await supabase.from('incident_updates').insert({
        incident_id: openIncident.id,
        status: 'resolved',
        body: `${svc.name} has recovered and is responding normally.`,
      })
    }
  }
}