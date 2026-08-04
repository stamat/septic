// septic-forms.js — progressive enhancement for septic forms. Optional.
//
// Without this script, native HTML5 validation still fires (required, pattern,
// type=email/number, min/max) — the browser blocks the submit and shows its own
// bubbles. With it, those same native checks drive styled inline messages in the
// `.septic-error` slot the server re-renders into, so client and server errors
// look identical. No rules live here: everything is read from the element's
// native `.validity`, so there is nothing to keep in sync with the field DSL.

// Pure: native ValidityState → a message. The one piece worth a unit test.
export function validationMessage(validity, { label = 'This field' } = {}) {
  if (validity.valueMissing) return `${label} is required`
  if (validity.typeMismatch) return `${label} is not valid`
  if (validity.patternMismatch) return `${label} is not in the right format`
  if (validity.rangeUnderflow || validity.rangeOverflow) return `${label} is out of range`
  if (validity.tooLong || validity.tooShort) return `${label} is the wrong length`
  if (validity.stepMismatch) return `${label} must be a whole step`
  return 'Please fix this field'
}

const labelText = (el) =>
  el.form?.querySelector(`label[for="${el.id}"]`)?.textContent.trim() || el.name || 'This field'

function slot(el) {
  const field = el.closest('.field')
  if (!field) return null
  let s = field.querySelector('.septic-error')
  if (!s) { s = document.createElement('small'); s.className = 'septic-error'; field.appendChild(s) }
  return s
}

function reflect(el) {
  const s = slot(el)
  if (el.validity.valid) {
    if (s) s.textContent = ''
    el.removeAttribute('aria-invalid')
    return true
  }
  if (s) s.textContent = validationMessage(el.validity, { label: labelText(el) })
  el.setAttribute('aria-invalid', 'true')
  return false
}

export function enhance(form) {
  if (form.dataset.septicEnhanced) return
  form.dataset.septicEnhanced = '1'
  form.noValidate = true // take over from native bubbles; we render our own
  const fields = () => [...form.elements].filter((e) => e.name && e.willValidate)

  form.addEventListener('submit', (ev) => {
    let ok = true
    for (const el of fields()) ok = reflect(el) && ok
    if (!ok) {
      ev.preventDefault()
      ev.stopPropagation() // also gate HTMX, which submits over this same event
      form.querySelector('[aria-invalid]')?.focus()
    }
  })
  form.addEventListener('blur', (ev) => { if (ev.target.name) reflect(ev.target) }, true)
}

const enhanceAll = (root = document) => root.querySelectorAll?.('form.septic-form').forEach(enhance)

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => enhanceAll())
  // HTMX swaps in a fresh form (e.g. server-side errors) — re-enhance it.
  document.body?.addEventListener('htmx:afterSwap', (ev) => enhanceAll(ev.target))
}
