import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MIN_PASSWORD_LENGTH, hasErrors, useAuth, validateSignUp, type FieldErrors } from '@/auth';
import Button from '@/components/Button';
import ErrorBanner from '@/components/ErrorBanner';
import IconBadge from '@/components/IconBadge';
import TextField from '@/components/TextField';
import { sharedStyles, spacing } from '@/theme';

/**
 * Create an account. If the Supabase project requires email confirmation, shows "Check your
 * email" afterwards; otherwise the new user is signed in and the stack swaps to the tabs.
 */
export default function SignUpScreen() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  async function submit() {
    const errors = validateSignUp(email, password, confirmPassword);
    setFieldErrors(errors);
    setError(null);
    if (hasErrors(errors)) return;

    setSubmitting(true);
    const result = await signUp(email.trim(), password);
    if (!result.ok) {
      setError(result.message);
      setSubmitting(false);
    } else if (result.needsConfirmation) {
      setNeedsConfirmation(true);
    }
  }

  if (needsConfirmation) {
    return (
      <View style={[sharedStyles.screen, sharedStyles.screenContent, styles.confirm]}>
        <IconBadge icon="mail-outline" />
        <Text style={sharedStyles.heading}>Check your email</Text>
        <Text style={[sharedStyles.secondaryText, styles.center]}>
          We sent a confirmation link to {email.trim()}. Open it, then sign in.
        </Text>
        <Button title="Back to sign in" onPress={() => router.back()} style={styles.stretch} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={sharedStyles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={sharedStyles.screenContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.intro}>
          <Text style={sharedStyles.title}>Create your account.</Text>
          <Text style={sharedStyles.secondaryText}>
            Use your email and a password of at least {MIN_PASSWORD_LENGTH} characters.
          </Text>
        </View>

        {error ? <ErrorBanner message={error} /> : null}

        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          error={fieldErrors.email}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          error={fieldErrors.password}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
        />
        <TextField
          label="Confirm password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          error={fieldErrors.confirmPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          onSubmitEditing={submit}
        />

        <Button title="Create Account" onPress={submit} loading={submitting} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  intro: {
    gap: spacing.sm,
  },
  confirm: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    textAlign: 'center',
  },
  stretch: {
    alignSelf: 'stretch',
  },
});
