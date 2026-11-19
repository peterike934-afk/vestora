import { cloneElement, isValidElement } from "react"

const NATIVE_FIELD_TYPES = new Set(["input", "select", "textarea"])

export default function FormField({ id, label, hint, error, control }) {
  if (!id) {
    throw new Error("FormField requires an id to associate its label and descriptions.")
  }
  if (!isValidElement(control) || !NATIVE_FIELD_TYPES.has(control.type)) {
    throw new Error("FormField control must be a native input, select, or textarea element.")
  }

  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [
    control.props["aria-describedby"],
    hintId,
    errorId,
  ].filter(Boolean).join(" ")
  const field = cloneElement(control, {
    id,
    "aria-describedby": describedBy || undefined,
    "aria-invalid": error ? true : control.props["aria-invalid"],
  })

  return (
    <div className="dashboard-form-field">
      <label className="dashboard-form-field__label" htmlFor={id}>{label}</label>
      {field}
      {hint && <div className="dashboard-form-field__hint" id={hintId}>{hint}</div>}
      {error && (
        <div className="dashboard-form-field__error" id={errorId} role="alert">{error}</div>
      )}
    </div>
  )
}
