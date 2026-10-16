import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import AsyncContent from '@/components/AsyncContent';
import IconBadge from '@/components/IconBadge';
import SearchResultsList from '@/components/SearchResultsList';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_MAX_LENGTH,
  useProductSearch,
  type ProductSearchState,
} from '@/hooks/useProductSearch';
import { colors, radius, sharedStyles, spacing, textStyles } from '@/theme';
import type { Product } from '@/types/product';

/**
 * Search screen: type a product name and matching products appear. The search runs once typing
 * pauses for SEARCH_DEBOUNCE_MS, not on every keystroke.
 */
export default function SearchScreen() {
  const router = useRouter();
  const [text, setText] = useState('');
  const typed = text.trim();
  const debounced = useDebouncedValue(typed, SEARCH_DEBOUNCE_MS);
  // Clearing the box clears the results right away instead of after the pause.
  const search = useProductSearch(typed ? debounced : '');

  return (
    <View style={sharedStyles.screen}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={20} color={colors.textMuted} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Search products"
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Search products"
          // Longer searches would only get a validation error from the API.
          maxLength={SEARCH_MAX_LENGTH}
          autoFocus
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

      <SearchContent state={search} onOpen={(product) => router.push(`/product/${product.id}`)} />
    </View>
  );
}

function SearchContent({
  state: { query, loading, results, error, reload },
  onOpen,
}: {
  state: ProductSearchState;
  onOpen: (product: Product) => void;
}) {
  if (!query) {
    return (
      <Message
        icon="search-outline"
        title="Find a product"
        text="Search by product name, e.g. coffee or chips."
      />
    );
  }

  return (
    <AsyncContent
      loading={loading}
      error={error?.message}
      onRetry={reload}
      loadingMessage="Searching…"
    >
      {results?.length === 0 ? (
        <Message
          icon="help-circle-outline"
          title="No results"
          text={`No products match "${query}". Check the spelling or try fewer words.`}
        />
      ) : (
        <SearchResultsList results={results ?? []} onOpen={onOpen} />
      )}
    </AsyncContent>
  );
}

function Message({
  icon,
  title,
  text,
}: {
  icon: ComponentProps<typeof IconBadge>['icon'];
  title: string;
  text: string;
}) {
  return (
    <View style={[sharedStyles.centered, styles.message]} accessibilityLiveRegion="polite">
      <IconBadge icon={icon} />
      <Text style={[sharedStyles.heading, styles.center]}>{title}</Text>
      <Text style={[sharedStyles.secondaryText, styles.center]}>{text}</Text>
    </View>
  );
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
  message: {
    gap: spacing.md,
    padding: spacing.xl,
  },
  center: {
    textAlign: 'center',
  },
});
