export default function FinancialMetric({ label, value, detail, tone = "default", action }) {
  return (
    <div className="dashboard-financial-metric" data-tone={tone}>
      <div className="dashboard-financial-metric__label">{label}</div>
      <div className="dashboard-financial-metric__value">{value}</div>
      {detail && <div className="dashboard-financial-metric__detail">{detail}</div>}
      {action}
    </div>
  )
}
