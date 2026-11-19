export default function DashboardState({ variant = "empty", title, description, action }) {
  return (
    <div
      className="dashboard-state"
      role={variant === "error" ? "alert" : "status"}
      aria-live={variant === "error" ? "assertive" : "polite"}
    >
      <div className="dashboard-state__title">{title}</div>
      {description && <div className="dashboard-state__description">{description}</div>}
      {action}
    </div>
  )
}
