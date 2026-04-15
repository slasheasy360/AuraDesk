/**
 * Centralized password validation for the backend.
 * Keep these rules in sync with frontend/src/utils/passwordValidation.js.
 */

const WEAK_PATTERNS = [
  'password', 'passw0rd', 'qwerty', 'qwerty123', 'azerty',
  '123456', '1234567', '12345678', '123456789', '1234567890',
  'abcdefgh', 'letmein', 'welcome', 'monkey', 'dragon', 'master',
  'football', 'baseball', 'soccer', 'shadow', 'sunshine', 'princess',
  'iloveyou', 'admin', 'login', 'test', 'user123',
];

function hasSequentialDigits(pw) {
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

/**
 * Validates a password against all rules.
 * Returns null if valid, or an error string describing the first violation.
 */
export function validatePassword(pw) {
  if (typeof pw !== 'string' || !pw) return 'Password is required';
  if (pw.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(pw)) return 'Password must include an uppercase letter (A–Z)';
  if (!/[a-z]/.test(pw)) return 'Password must include a lowercase letter (a–z)';
  if (!/[0-9]/.test(pw)) return 'Password must include a number (0–9)';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must include a special character (@, #, $, %, &, * …)';
  if (hasSequentialDigits(pw)) return 'Password must not contain sequential numbers (e.g. 1234, 4567)';
  const lower = pw.toLowerCase();
  if (WEAK_PATTERNS.some((p) => lower === p || lower.startsWith(p))) {
    return 'Password is too common. Please choose a more unique password.';
  }
  return null; // valid
}
