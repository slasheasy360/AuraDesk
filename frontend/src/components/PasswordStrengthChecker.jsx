/**
 * Minimal password strength indicator — no rule list, just a bar + label.
 *
 * Props:
 *  evaluation  — result of evaluatePassword() from utils/passwordValidation.js
 *  dark        — true = white text (dark auth backgrounds), false = dark text (white card)
 */
export default function PasswordStrengthChecker({ evaluation, dark = false }) {
  if (!evaluation || !evaluation.strength) return null;

  const isStrong = evaluation.allValid;
  const label    = isStrong ? 'Strong' : evaluation.strength;
  const color    = isStrong ? '#10b981' : evaluation.strengthColor;
  const pct      = evaluation.strengthPct;
  const trackBg  = dark ? 'bg-white/10' : 'bg-gray-200';
  const labelCls = dark ? 'text-white/50' : 'text-gray-400';

  return (
    <div className="mt-2 space-y-1">
      <div className={`h-[3px] w-full rounded-full ${trackBg} overflow-hidden`}>
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <div className={`flex justify-end text-[11px] ${labelCls}`}>
        <span className="font-semibold tracking-wide" style={{ color }}>
          {label}
        </span>
      </div>
    </div>
  );
}
