import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import AsyncContent from '@/components/AsyncContent';
import IconBadge from '@/components/IconBadge';
import SearchResultsList from '@/components/SearchResultsList';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePreferredStore } from '@/hooks/usePreferredStore';
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
 * pauses for SEARCH_DEBOUNCE_MS, not on every keystroke. The In stock filter (T096) narrows it to
 * products in stock at the shopper's own store (T078), or at any store if they haven't picked
 * one; turning it on or off searches again right away.
 */
export default function SearchScreen() {
  const router = useRouter();
  const { store: preferred } = usePreferredStore();
  const [text, setText] = useState('');
  const [inStock, setInStock] = useState(false);
  const typed = text.trim();
  const debounced = useDebouncedValue(typed, SEARCH_DEBOUNCE_MS);
  // Only a store with its slug can filter (usePreferredStore fills in a missing one).
  const myStore = preferred?.slug ? preferred : null;
  // Clearing the box clears the results right away instead of after the pause.
  const search = useProductSearch(typed ? debounced : '', {
    store: inStock ? myStore?.slug : null,
    inStock,
  });
  const where = myStore ? `at ${myStore.name}` : 'at any store';

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

      <View style={styles.filters}>
        <FilterChip
          label={`In stock ${where}`}
          icon="checkmark-circle-outline"
          selected={inStock}
          onPress={() => setInStock((on) => !on)}
        />
        {myStore ? null : (
          <Pressable
            onPress={() => router.push('/stores')}
            accessibilityRole="button"
            accessibilityLabel="Choose your store to filter by it"
            style={styles.chip}
          >
            <Ionicons name="storefront-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.chipText}>Choose your store</Text>
          </Pressable>
        )}
      </View>

      <SearchContent
        state={search}
        filtered={inStock ? `in stock ${where}` : null}
        onOpen={(product) => router.push(`/product/${product.id}`)}
      />
    </View>
  );
}

/** A filter that's on or off, e.g. "In stock". */
function FilterChip({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  selected: boolean;
  onPress: () => void;
}) {
  const color = selected ? colors.accent : colors.textSecondary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[styles.chipText, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function SearchContent({
  state: { query, loading, results, error, reload },
  filtered,
  onOpen,
}: {
  state: ProductSearchState;
  /** The filter that's on, e.g. "in stock at Camp Lejeune MCX", or null for none. */
  filtered: string | null;
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
          text={
            filtered
              ? `No products match "${query}" ${filtered}. Try turning off "In stock".`
              : `No products match "${query}". Check the spelling or try fewer words.`
          }
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
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
  },
  chip: {
    ...sharedStyles.row,
    gap: spacing.xs,
    maxWidth: '100%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  chipText: {
    ...textStyles.label,
    flexShrink: 1,
    color: colors.textSecondary,
  },
  message: {
    gap: spacing.md,
    padding: spacing.xl,
  },
  center: {
    textAlign: 'center',
  },
});
