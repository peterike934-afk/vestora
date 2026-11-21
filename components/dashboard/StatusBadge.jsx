const STATUS_TONES = {
  active: "positive",
  paid: "positive",
  verified: "positive",
  up: "positive",
  pending: "pending",
  rejected: "negative",
  down: "negative",
}

export default function StatusBadge({ status, children }) {
  const tone = STATUS_TONES[String(status || "").toLowerCase()] || "neutral"

  return (
    <span className="dashboard-status-badge" data-tone={tone}>
      {children || status}
    </span>
  )
}
