/**
 * Reusable password strength checker.
 *
 * Props:
 *  evaluation  — result of evaluatePassword() from utils/passwordValidation.js
 *  dark        — boolean; true = white text (AuthLayout dark backgrounds),
 *                false (default) = dark text (settings page white card)
 */

function RuleItem({ ok, label, dark }) {
  return (
    <li
      className={`flex items-center gap-2 text-[12px] transition-colors ${
        ok
          ? 'text-emerald-500'
          : dark
            ? 'text-white/50'
            : 'text-gray-400'
      }`}
    >
      <span
        className={`inline-flex items-center justify-center w-4 h-4 rounded-full border flex-shrink-0 transition ${
          ok
            ? 'bg-emerald-500 border-emerald-500 text-white'
            : dark
              ? 'border-white/25'
              : 'border-gray-300'
        }`}
      >
        {ok && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </span>
      <span>{label}</span>
    </li>
  );
}

export default function PasswordStrengthChecker({ evaluation, dark = false }) {
  if (!evaluation) return null;

  const labelColor = dark ? 'text-white/50' : 'text-gray-500';
  const trackBg    = dark ? 'bg-white/10'   : 'bg-gray-200';

  return (
    <div className="mt-2 space-y-3">
      {/* Strength bar */}
      <div>
        <div className={`h-[3px] w-full rounded-full ${trackBg} overflow-hidden`}>
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${evaluation.strengthPct}%`,
              backgroundColor: evaluation.strengthColor,
            }}
          />
        </div>
        {evaluation.strength && (
          <div className={`mt-1 flex items-center justify-between text-[11px] ${labelColor}`}>
            <span>Password strength</span>
            <span className="font-semibold tracking-wide" style={{ color: evaluation.strengthColor }}>
              {evaluation.strength}
            </span>
          </div>
        )}
      </div>

      {/* Rule checklist */}
      <ul className="grid grid-cols-1 gap-1.5 px-0.5" role="list" aria-label="Password requirements">
        <RuleItem dark={dark} ok={evaluation.rules.length}       label="At least 8 characters" />
        <RuleItem dark={dark} ok={evaluation.rules.upper}        label="One uppercase letter (A–Z)" />
        <RuleItem dark={dark} ok={evaluation.rules.lower}        label="One lowercase letter (a–z)" />
        <RuleItem dark={dark} ok={evaluation.rules.number}       label="One number (0–9)" />
        <RuleItem dark={dark} ok={evaluation.rules.special}      label="One special character (@, #, $, %, &, *)" />
        <RuleItem dark={dark} ok={evaluation.rules.noSequential} label="No sequential numbers (e.g. 1234, 4567)" />
        <RuleItem dark={dark} ok={evaluation.rules.noWeak}       label="Not a common weak password" />
      </ul>
    </div>
  );
}
