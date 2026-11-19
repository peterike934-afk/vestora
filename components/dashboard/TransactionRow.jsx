import StatusBadge from "./StatusBadge"

export default function TransactionRow({
  icon,
  title,
  description,
  amount,
  positive = false,
  negative = false,
  status,
  statusLabel,
  iconTone = "neutral",
  action,
}) {
  const Icon = icon

  return (
    <div className="dashboard-transaction-row">
      <div className="dashboard-transaction-row__main">
        {Icon && (
          <span className="dashboard-transaction-row__icon" data-tone={iconTone} aria-hidden="true">
            <Icon size={17} strokeWidth={1.9} />
          </span>
        )}
        <div className="dashboard-transaction-row__copy">
          <div className="dashboard-transaction-row__title">{title}</div>
          {description && <div className="dashboard-transaction-row__description">{description}</div>}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {status && <StatusBadge status={status}>{statusLabel || status}</StatusBadge>}
        {amount != null && (
          <div className="dashboard-transaction-row__amount" data-positive={positive} data-negative={negative}>
            {amount}
          </div>
        )}
        {action}
      </div>
    </div>
  )
}
