/**
 * Centralized password validation utility.
 * Used by RegisterPage, ResetPasswordPage, and ProfileSettingsPage.
 * Keep the rules here in sync with backend/src/utils/passwordValidator.js.
 */

const WEAK_PATTERNS = [
  'password', 'passw0rd', 'qwerty', 'qwerty123', 'azerty',
  '123456', '1234567', '12345678', '123456789', '1234567890',
  'abcdefgh', 'letmein', 'welcome', 'monkey', 'dragon', 'master',
  'football', 'baseball', 'soccer', 'shadow', 'sunshine', 'princess',
  'iloveyou', 'admin', 'login', 'test', 'user123',
];

export function hasSequentialDigits(pw) {
  for (let i = 0; i <= pw.length - 4; i++) {
    const a = pw.charCodeAt(i);
    const b = pw.charCodeAt(i + 1);
    const c = pw.charCodeAt(i + 2);
    const d = pw.charCodeAt(i + 3);
    const isDigit = (code) => code >= 48 && code <= 57;
    if (
      isDigit(a) && isDigit(b) && isDigit(c) && isDigit(d) &&
      b === a + 1 && c === b + 1 && d === c + 1
    ) return true;
  }
  return false;
}

export function hasWeakPattern(pw) {
  const lower = pw.toLowerCase();
  return WEAK_PATTERNS.some((p) => lower === p || lower.startsWith(p));
}

/**
 * Returns an evaluation object with per-rule booleans, strength label,
 * strength colour, bar percentage, and an allValid flag.
 */
export function evaluatePassword(pw) {
  const rules = {
    length:       pw.length >= 8,
    upper:        /[A-Z]/.test(pw),
    lower:        /[a-z]/.test(pw),
    number:       /[0-9]/.test(pw),
    special:      /[^A-Za-z0-9]/.test(pw),
    noSequential: pw.length > 0 && !hasSequentialDigits(pw),
    noWeak:       pw.length > 0 && !hasWeakPattern(pw),
  };

  const TOTAL = Object.keys(rules).length; // 7
  const passed = Object.values(rules).filter(Boolean).length;
  const allValid = passed === TOTAL;

  let strength = '';
  let strengthColor = '#ef4444';
  let strengthPct = 0;

  if (pw.length > 0) {
    if (passed <= 2) {
      strength = 'Weak';
      strengthColor = '#ef4444';
      strengthPct = 20;
    } else if (passed <= 4) {
      strength = 'Fair';
      strengthColor = '#f59e0b';
      strengthPct = 55;
    } else if (passed <= 6) {
      strength = 'Strong';
      strengthColor = '#10b981';
      strengthPct = 80;
    } else {
      strength = 'Very Strong';
      strengthColor = '#059669';
      strengthPct = 100;
    }
  }

  return { rules, passed, allValid, strength, strengthColor, strengthPct };
}
