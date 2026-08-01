alter type app.assignment_skip_reason
  add value if not exists 'employee_refusal';
alter type app.assignment_skip_reason
  add value if not exists 'approved_restriction';
alter type app.assignment_skip_reason
  add value if not exists 'customer_declined';
