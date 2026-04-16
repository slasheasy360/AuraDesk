/**
 * Password strength indicator — strength bar + only MISSING conditions in red.
 *
 * Props:
 *  evaluation  — result of evaluatePassword() from utils/passwordValidation.js
 *  dark        — true = white tones (dark auth backgrounds), false = dark tones (white card)
 */

const RULES = [
  { key: 'length',       missing: 'At least 8 characters required' },
  { key: 'upper',        missing: 'Missing uppercase letter (A–Z)' },
  { key: 'lower',        missing: 'Missing lowercase letter (a–z)' },
  { key: 'number',       missing: 'Missing number (0–9)' },
  { key: 'special',      missing: 'Missing special character (@, #, $, %, &, *)' },
  { key: 'noSequential', missing: 'Contains sequential numbers (e.g. 1234)' },
  { key: 'noWeak',       missing: 'Password is too common or weak' },
];

export default function PasswordStrengthChecker({ evaluation, dark = false }) {
  if (!evaluation || evaluation.strengthPct === 0) return null;

  const trackBg   = dark ? 'bg-white/10' : 'bg-gray-200';
  const bulletCls = dark ? 'text-red-400' : 'text-red-500';

  const unmet = RULES.filter(({ key }) => !evaluation.rules[key]);

  return (
    <div className="mt-2 space-y-2">
      {/* Strength bar */}
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

      {/* Missing conditions only — shown as red bullet points */}
      {!evaluation.allValid && unmet.length > 0 && (
        <ul className="space-y-1 px-0.5" aria-label="Password issues">
          {unmet.map(({ key, missing }) => (
            <li key={key} className={`flex items-start gap-1.5 text-[12px] font-medium ${bulletCls}`}>
              <span className="mt-px leading-none select-none">•</span>
              <span>{missing}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
