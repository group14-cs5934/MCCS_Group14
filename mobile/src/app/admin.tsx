import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/auth';
import AsyncContent from '@/components/AsyncContent';
import Button from '@/components/Button';
import ErrorState from '@/components/ErrorState';
import Loader from '@/components/Loader';
import SearchResultsList from '@/components/SearchResultsList';
import { useApiGet } from '@/hooks/useApiGet';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { SEARCH_DEBOUNCE_MS, SEARCH_MAX_LENGTH } from '@/hooks/useProductSearch';
import { colors, radius, sharedStyles, spacing, textStyles } from '@/theme';
import type { Product } from '@/types/product';

/** Most products the list loads at once (the API's limit for GET /admin/products). */
export const ADMIN_PRODUCTS_PAGE_SIZE = 100;

/**
 * Admin area (T090): the product list admins manage the catalog from. Only admins can open it;
 * anyone else sees "Admins only". The API checks too, so hiding the screen isn't the only guard.
 */
export default function AdminScreen() {
  const { roleLoading, isAdmin } = useAuth();

  if (roleLoading) {
    return (
      <View style={sharedStyles.screen}>
        <Loader message="Checking access…" style={sharedStyles.centered} />
      </View>
    );
  }
  return <View style={sharedStyles.screen}>{isAdmin ? <AdminProducts /> : <AccessDenied />}</View>;
}

function AccessDenied() {
  const router = useRouter();
  return (
    <ErrorState
      title="Admins only"
      message="You need an admin account to open the admin area."
      icon="lock-closed-outline"
      style={sharedStyles.centered}
    >
      <Button title="Go Home" variant="secondary" onPress={() => router.replace('/(tabs)')} />
    </ErrorState>
  );
}

/** Every product, sorted by name, with a search box. Tapping one opens its product page. */
function AdminProducts() {
  const router = useRouter();
  const [text, setText] = useState('');
  const query = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
  const params = new URLSearchParams({ limit: String(ADMIN_PRODUCTS_PAGE_SIZE) });
  if (query) params.set('q', query);
  const { loading, data, error, reload } = useApiGet<Product[]>(`/admin/products?${params}`);

  // The API decides who's an admin. If it says no (e.g. the role was removed since sign-in),
  // show the same message as for anyone else.
  if (error?.status === 403) {
    return <AccessDenied />;
  }

  const products = data ?? [];
  return (
    <>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={20} color={colors.textMuted} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Search products"
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Search products"
          maxLength={SEARCH_MAX_LENGTH}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          style={styles.input}
        />
        {text ? (
          <Pressable
            onPress={() => setText('')}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={spacing.sm}
          >
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <AsyncContent
        loading={loading}
        error={error?.message}
        onRetry={reload}
        loadingMessage="Loading products…"
      >
        <Text style={styles.count} accessibilityLiveRegion="polite">
          {productCount(products.length, query)}
        </Text>
        <SearchResultsList
          results={products}
          onOpen={(product) => router.push(`/product/${product.id}`)}
        />
      </AsyncContent>
    </>
  );
}

/** "12 products", "No products match "x"", or "Showing the first 100 products". */
function productCount(count: number, query: string): string {
  if (count === 0) return query ? `No products match "${query}".` : 'No products yet.';
  if (count >= ADMIN_PRODUCTS_PAGE_SIZE) {
    return `Showing the first ${ADMIN_PRODUCTS_PAGE_SIZE} products. Search to find others.`;
  }
  return `${count} ${count === 1 ? 'product' : 'products'}`;
}

const styles = StyleSheet.create({
  searchBar: {
    ...sharedStyles.row,
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    ...textStyles.body,
    flex: 1,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
  },
  count: {
    ...textStyles.caption,
    color: colors.textSecondary,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
});
