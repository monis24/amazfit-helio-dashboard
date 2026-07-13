import { StyleSheet, Text } from 'react-native';

import { colors, spacing } from './theme';

export interface StateMessageProps {
  readonly text: string;
  readonly tone?: 'neutral' | 'error';
}

/** Shared loading/error/insufficient-data line every panel renders while
 *  its hook isn't in a 'ready'-with-data state — kept as one component so
 *  the four panels read consistently rather than each inventing its own. */
export function StateMessage({ text, tone = 'neutral' }: StateMessageProps): React.JSX.Element {
  return <Text style={[styles.text, tone === 'error' && styles.error]}>{text}</Text>;
}

const styles = StyleSheet.create({
  text: {
    color: colors.textSecondary,
    paddingVertical: spacing.sm,
  },
  error: {
    color: colors.negative,
  },
});
