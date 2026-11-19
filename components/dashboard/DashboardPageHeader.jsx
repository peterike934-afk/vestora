export default function DashboardPageHeader({ eyebrow, title, description, actions }) {
  return (
    <header className="dashboard-page-header">
      <div className="dashboard-page-header__copy">
        {eyebrow && <div className="dashboard-page-header__eyebrow">{eyebrow}</div>}
        <h1 className="dashboard-page-header__title">{title}</h1>
        {description && <p className="dashboard-page-header__description">{description}</p>}
      </div>
      {actions && <div className="dashboard-page-header__actions">{actions}</div>}
    </header>
  )
}
