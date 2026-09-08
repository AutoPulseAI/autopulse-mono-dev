// Generic delimiter parsing only. Even '' is one group with one empty value.
// String.split preserves consecutive and leading/trailing empty positions.
export function splitRepeatingGroups(value) {
  if (typeof value !== 'string') throw new TypeError('REPEATING_VALUE_NOT_STRING');
  return value.split('|').map(group => group.split('^'));
}
