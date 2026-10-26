import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { hasErrors, useAuth, validateSignIn, type FieldErrors } from '@/auth';
import Button from '@/components/Button';
import ErrorBanner from '@/components/ErrorBanner';
import TextField from '@/components/TextField';
import { sharedStyles, spacing } from '@/theme';

/** Shown to signed-out users. Signing in swaps the whole stack to the tabs (see _layout.tsx). */
export default function SignInScreen() {
  const router = useRouter();
  const { signIn, signedOutReason } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // E.g. "This account has been deactivated…" after the app signed the user out.
  const banner = error ?? signedOutReason;

  async function submit() {
    const errors = validateSignIn(email, password);
    setFieldErrors(errors);
    setError(null);
    if (hasErrors(errors)) return;

    setSubmitting(true);
    const result = await signIn(email.trim(), password);
    // On success this screen unmounts, so only a failure needs handling here.
    if (!result.ok) {
      setError(result.message);
      setSubmitting(false);
    }
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
          <Text style={sharedStyles.title}>Welcome back.</Text>
          <Text style={sharedStyles.secondaryText}>Sign in to scan and compare products.</Text>
        </View>

        {banner ? <ErrorBanner message={banner} /> : null}

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
          autoComplete="current-password"
          textContentType="password"
          onSubmitEditing={submit}
        />

        <Button title="Sign In" onPress={submit} loading={submitting} />
        <Button title="Create an account" variant="text" onPress={() => router.push('/sign-up')} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  intro: {
    gap: spacing.sm,
  },
});
