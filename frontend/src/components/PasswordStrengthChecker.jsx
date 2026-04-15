/**
 * Password strength checker with real-time rule feedback.
 *
 * Props:
 *  evaluation  — result of evaluatePassword() from utils/passwordValidation.js
 *  dark        — true = white tones (dark auth backgrounds), false = dark tones (white card)
 */

const RULES = [
  { key: 'length',       label: 'At least 8 characters' },
  { key: 'upper',        label: 'One uppercase letter (A–Z)' },
  { key: 'lower',        label: 'One lowercase letter (a–z)' },
  { key: 'number',       label: 'One number (0–9)' },
  { key: 'special',      label: 'One special character (@, #, $, %, &, *)' },
  { key: 'noSequential', label: 'No sequential numbers (e.g. 1234)' },
  { key: 'noWeak',       label: 'Not a common weak password' },
];

function RuleItem({ ok, label, dark }) {
  const metColor   = '#10b981';                        // emerald-500
  const unmetColor = '#ef4444';                        // red-500
  const color      = ok ? metColor : unmetColor;

  return (
    <li className="flex items-center gap-2 text-[12px]" style={{ color }}>
      <span
        className="inline-flex items-center justify-center w-4 h-4 rounded-full flex-shrink-0 border transition-all duration-200"
        style={{
          borderColor: color,
          backgroundColor: ok ? color : 'transparent',
          color: ok ? '#fff' : color,
        }}
        aria-hidden="true"
      >
        {ok ? (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        )}
      </span>
      <span className={ok ? 'opacity-60' : 'font-medium'}>{label}</span>
    </li>
  );
}

export default function PasswordStrengthChecker({ evaluation, dark = false }) {
  if (!evaluation || evaluation.strengthPct === 0) return null;

  const trackBg = dark ? 'bg-white/10' : 'bg-gray-200';

  return (
    <div className="mt-2 space-y-2.5">
      {/* Strength bar + label */}
      <div>
        <div className={`h-[3px] w-full rounded-full ${trackBg} overflow-hidden`}>
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{ width: `${evaluation.strengthPct}%`, backgroundColor: evaluation.strengthColor }}
          />
        </div>
        {evaluation.strength && (
          <div className="mt-1 flex justify-end text-[11px]">
            <span className="font-semibold tracking-wide" style={{ color: evaluation.strengthColor }}>
              {evaluation.allValid ? 'Strong' : evaluation.strength}
            </span>
          </div>
        )}
      </div>

      {/* Rule checklist — only rendered while password is not fully valid */}
      {!evaluation.allValid && (
        <ul className="space-y-1.5 px-0.5" role="list" aria-label="Password requirements">
          {RULES.map(({ key, label }) => (
            <RuleItem key={key} ok={evaluation.rules[key]} label={label} dark={dark} />
          ))}
        </ul>
      )}
    </div>
  );
}
